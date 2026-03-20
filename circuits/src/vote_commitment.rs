/// VoteCommitment circuit — proves `vote_commitment = Poseidon(vote, randomness)`.
///
/// # Why this circuit is needed
///
/// Votes are cast privately: instead of revealing the vote, the voter submits
/// `vote_commitment = Poseidon(vote, randomness)` on-chain. After voting closes,
/// they reveal `vote` and `randomness` and the program verifies the commitment.
///
/// The circuit proves two things simultaneously:
/// 1. The commitment was formed correctly — `Poseidon(vote, randomness) == vote_commitment`
/// 2. The vote is binary — `vote * (vote - 1) == 0`
///
/// Without constraint (2), a voter could commit to an invalid value (e.g. 2) and
/// only reveal after seeing the tally, then claim they voted yes or no depending
/// on which outcome they prefer.
///
/// # Public vs private signals
///
/// | Signal          | Visibility | Why                                                       |
/// |-----------------|------------|-----------------------------------------------------------|
/// | vote_commitment | PUBLIC     | Stored on-chain; verifier checks the commitment is valid  |
/// | vote            | PRIVATE    | Hidden until reveal phase — the whole point of commitment |
/// | randomness      | PRIVATE    | Blinding factor — prevents brute-forcing the vote         |
///
/// # Security: privacy
///
/// Without `randomness`, an attacker could brute-force `vote_commitment` by trying
/// `Poseidon(0)` and `Poseidon(1)` — there are only two possible votes. The random
/// blinding factor makes the commitment computationally hiding.
use ark_crypto_primitives::sponge::{
    constraints::CryptographicSpongeVar,
    poseidon::{constraints::PoseidonSpongeVar, PoseidonConfig},
};
use ark_ff::PrimeField;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Proves `vote_commitment = Poseidon(vote, randomness)` and `vote ∈ {0, 1}`.
///
/// # Fields
///
/// - `vote_commitment` — **public input**. `Poseidon(vote, randomness)` stored on-chain.
/// - `vote`            — **private witness**. The plaintext vote: 0 (no) or 1 (yes).
/// - `randomness`      — **private witness**. Random blinding factor chosen by the voter.
///                       Prevents brute-forcing the commitment (only 2 possible votes).
/// - `poseidon_config` — Poseidon parameters. Use `poseidon_params::poseidon_config()`.
pub struct VoteCommitmentCircuit<F: PrimeField> {
    /// Poseidon(vote, randomness) — public, stored on-chain at cast_vote time
    pub vote_commitment: Option<F>,

    /// The plaintext vote (0 or 1) — private, revealed only after voting closes
    pub vote: Option<F>,

    /// Random blinding factor — private, prevents commitment brute-force
    pub randomness: Option<F>,

    /// Poseidon configuration — must match the config used for native hash computation
    pub poseidon_config: PoseidonConfig<F>,
}

impl<F: PrimeField> ConstraintSynthesizer<F> for VoteCommitmentCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        // ── Public input ─────────────────────────────────────────────────────

        let vote_commitment = FpVar::new_input(ark_relations::ns!(cs, "vote_commitment"), || {
            self.vote_commitment.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Private witnesses ────────────────────────────────────────────────

        let vote = FpVar::new_witness(ark_relations::ns!(cs, "vote"), || {
            self.vote.ok_or(SynthesisError::AssignmentMissing)
        })?;

        let randomness = FpVar::new_witness(ark_relations::ns!(cs, "randomness"), || {
            self.randomness.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Constraint 1: vote ∈ {0, 1} ──────────────────────────────────────
        //
        // vote * (vote - 1) = 0
        // Satisfied only when vote = 0 or vote = 1.
        // Without this, a voter could commit to vote=2 and selectively reveal.
        let vote_minus_one = &vote - &FpVar::constant(F::one());
        (&vote * &vote_minus_one).enforce_equal(&FpVar::constant(F::zero()))?;

        // ── Constraint 2: vote_commitment = Poseidon(vote, randomness) ───────

        let mut sponge = PoseidonSpongeVar::<F>::new(cs.clone(), &self.poseidon_config);
        sponge.absorb(&vote)?;
        sponge.absorb(&randomness)?;
        let computed = sponge.squeeze_field_elements(1)?;

        computed[0].enforce_equal(&vote_commitment)?;

        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// Security checklist coverage:
//   [x] vote ∈ {0,1} enforced — vote=2 fails even with a matching commitment
//   [x] Wrong randomness cannot produce the same commitment
//   [x] Tampered commitment fails
//   [x] Groth16 end-to-end: prove + verify
//   [x] Wrong public commitment fails verification

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poseidon_params::poseidon_config;

    use ark_bn254::{Bn254, Fr};
    use ark_crypto_primitives::sponge::{poseidon::PoseidonSponge, CryptographicSponge};
    use ark_groth16::Groth16;
    use ark_relations::r1cs::ConstraintSystem;
    use ark_snark::SNARK;
    use ark_std::rand::{rngs::StdRng, SeedableRng};

    /// Compute Poseidon(vote, randomness) natively (outside circuit).
    fn native_commitment(vote: Fr, randomness: Fr) -> Fr {
        let config = poseidon_config::<Fr>();
        let mut sponge = PoseidonSponge::<Fr>::new(&config);
        sponge.absorb(&vote);
        sponge.absorb(&randomness);
        sponge.squeeze_field_elements::<Fr>(1)[0]
    }

    fn make_circuit(vote: Fr, randomness: Fr) -> VoteCommitmentCircuit<Fr> {
        let commitment = native_commitment(vote, randomness);
        VoteCommitmentCircuit {
            vote_commitment: Some(commitment),
            vote: Some(vote),
            randomness: Some(randomness),
            poseidon_config: poseidon_config(),
        }
    }

    // ── Constraint satisfaction tests ──────────────────────────────────────

    /// vote=0 with correct commitment must satisfy both constraints.
    #[test]
    fn test_vote_zero_satisfied() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        make_circuit(Fr::from(0u64), Fr::from(12345u64))
            .generate_constraints(cs.clone())
            .unwrap();
        assert!(cs.is_satisfied().unwrap());
    }

    /// vote=1 with correct commitment must satisfy both constraints.
    #[test]
    fn test_vote_one_satisfied() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        make_circuit(Fr::from(1u64), Fr::from(99999u64))
            .generate_constraints(cs.clone())
            .unwrap();
        assert!(cs.is_satisfied().unwrap());
    }

    /// vote=2 must fail the binary constraint even if the commitment is computed correctly.
    /// This prevents a voter from committing to an invalid value.
    #[test]
    fn test_invalid_vote_fails_binary_constraint() {
        let vote = Fr::from(2u64);
        let randomness = Fr::from(12345u64);
        // Commitment is technically "correct" for vote=2, but the binary constraint rejects it
        let commitment = native_commitment(vote, randomness);

        let cs = ConstraintSystem::<Fr>::new_ref();
        VoteCommitmentCircuit {
            vote_commitment: Some(commitment),
            vote: Some(vote),
            randomness: Some(randomness),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "vote=2 must fail the binary constraint");
    }

    /// Wrong randomness produces a different commitment — the circuit must not be satisfied.
    #[test]
    fn test_wrong_randomness_fails() {
        let vote = Fr::from(1u64);
        let correct_randomness = Fr::from(12345u64);
        let wrong_randomness = Fr::from(99999u64);

        let commitment = native_commitment(vote, correct_randomness);

        let cs = ConstraintSystem::<Fr>::new_ref();
        VoteCommitmentCircuit {
            vote_commitment: Some(commitment),
            vote: Some(vote),
            randomness: Some(wrong_randomness), // tampered
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "Wrong randomness must not satisfy the circuit");
    }

    /// Tampered commitment (wrong value, correct vote and randomness) must fail.
    #[test]
    fn test_tampered_commitment_fails() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        VoteCommitmentCircuit {
            vote_commitment: Some(Fr::from(0u64)), // fake
            vote: Some(Fr::from(1u64)),
            randomness: Some(Fr::from(12345u64)),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "Fake commitment must not satisfy the circuit");
    }

    // ── Groth16 end-to-end ─────────────────────────────────────────────────

    /// Full trusted-setup → prove → verify cycle.
    /// Public input: [vote_commitment] — the only value the verifier sees.
    #[test]
    fn test_groth16_proves_and_verifies() {
        let mut rng = StdRng::seed_from_u64(0);

        let vote = Fr::from(1u64);
        let randomness = Fr::from(12345u64);
        let commitment = native_commitment(vote, randomness);

        let setup_circuit = VoteCommitmentCircuit::<Fr> {
            vote_commitment: None,
            vote: None,
            randomness: None,
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        let proof = Groth16::<Bn254>::prove(&pk, make_circuit(vote, randomness), &mut rng).unwrap();

        let public_inputs = vec![commitment];
        let valid = Groth16::<Bn254>::verify(&vk, &public_inputs, &proof).unwrap();
        assert!(valid, "Groth16 proof should verify with correct commitment");
    }

    /// A valid proof must not verify against a different commitment.
    #[test]
    fn test_groth16_wrong_commitment_fails() {
        let mut rng = StdRng::seed_from_u64(0);

        let vote = Fr::from(1u64);
        let randomness = Fr::from(12345u64);

        let setup_circuit = VoteCommitmentCircuit::<Fr> {
            vote_commitment: None,
            vote: None,
            randomness: None,
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        let proof = Groth16::<Bn254>::prove(&pk, make_circuit(vote, randomness), &mut rng).unwrap();

        let fake_commitment = Fr::from(0u64);
        let valid = Groth16::<Bn254>::verify(&vk, &[fake_commitment], &proof).unwrap();
        assert!(!valid, "Proof must not verify against a fake commitment");
    }
}
