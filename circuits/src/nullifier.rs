/// Nullifier circuit — proves `nullifier = Poseidon(secret_key, proposal_id)`.
///
/// # Why this circuit is needed
///
/// A nullifier is a deterministic, one-way fingerprint of the voter's identity
/// tied to a specific proposal. It is stored on-chain after voting to prevent
/// the same voter from voting twice — without revealing who the voter is.
///
/// The voter proves in zero-knowledge:
/// - "I know a `secret_key` such that `Poseidon(secret_key, proposal_id) = nullifier`"
/// - Without ever revealing `secret_key`
///
/// # Public vs private signals
///
/// | Signal       | Visibility | Why                                                  |
/// |--------------|------------|------------------------------------------------------|
/// | nullifier    | PUBLIC     | Stored on-chain; verifier must check it is fresh     |
/// | proposal_id  | PUBLIC     | Binds proof to a specific proposal — prevents replay |
/// | secret_key   | PRIVATE    | Voter identity — must never be revealed              |
///
/// # Security: replay attack prevention
///
/// `proposal_id` MUST be a public input AND used inside the Poseidon constraint.
/// If it were omitted, the same nullifier and proof would be valid for every
/// proposal in the system — one vote could be replayed infinitely.
///
/// # Security: under-constrained check
///
/// The only way to produce a valid `nullifier` is to know the correct `secret_key`.
/// The constraint `Poseidon(secret_key, proposal_id) == nullifier` fully determines
/// `nullifier` once `secret_key` and `proposal_id` are fixed.
use ark_crypto_primitives::sponge::{
    constraints::CryptographicSpongeVar,
    poseidon::{constraints::PoseidonSpongeVar, PoseidonConfig},
};
use ark_ff::PrimeField;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Proves `nullifier = Poseidon(secret_key, proposal_id)` in zero-knowledge.
///
/// # Fields
///
/// - `nullifier`      — **public input**. The expected output of `Poseidon(secret_key, proposal_id)`.
///                      The on-chain program stores this to mark the voter as having voted.
/// - `proposal_id`    — **public input**. Identifies the proposal being voted on.
///                      Must be in the circuit to prevent replay across proposals.
/// - `secret_key`     — **private witness**. The voter's secret. Never leaves the prover's machine.
/// - `poseidon_config` — Poseidon parameters. Must be the same instance used when computing
///                      the expected nullifier off-chain (use `poseidon_params::poseidon_config()`).
pub struct NullifierCircuit<F: PrimeField> {
    /// Poseidon(secret_key, proposal_id) — public, stored on-chain after voting
    pub nullifier: Option<F>,

    /// The proposal this vote belongs to — public, prevents replay attacks
    pub proposal_id: Option<F>,

    /// The voter's secret key — private, never revealed
    pub secret_key: Option<F>,

    /// Poseidon configuration — must match the config used for native hash computation
    pub poseidon_config: PoseidonConfig<F>,
}

impl<F: PrimeField> ConstraintSynthesizer<F> for NullifierCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        // ── Public inputs ────────────────────────────────────────────────────
        // Allocated with `new_input` — the verifier provides these values.
        // Order here determines the order in the public inputs vector passed to verify().

        // The nullifier the prover claims corresponds to their secret_key + this proposal
        let nullifier = FpVar::new_input(ark_relations::ns!(cs, "nullifier"), || {
            self.nullifier.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // The proposal_id binds this proof to one specific proposal.
        // Without this in the constraint, the same proof works for all proposals (replay).
        let proposal_id = FpVar::new_input(ark_relations::ns!(cs, "proposal_id"), || {
            self.proposal_id.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Private witness ──────────────────────────────────────────────────
        // Allocated with `new_witness` — only the prover knows this value.

        let secret_key = FpVar::new_witness(ark_relations::ns!(cs, "secret_key"), || {
            self.secret_key.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Core constraint: nullifier = Poseidon(secret_key, proposal_id) ───
        //
        // We use the Poseidon sponge gadget which mirrors the native PoseidonSponge
        // computation inside the R1CS constraint system. The gadget adds constraints
        // that ensure the output is correct for the given inputs.

        let mut sponge = PoseidonSpongeVar::<F>::new(cs.clone(), &self.poseidon_config);
        sponge.absorb(&secret_key)?;
        sponge.absorb(&proposal_id)?;
        let computed = sponge.squeeze_field_elements(1)?;

        // If computed[0] != nullifier, the proof is invalid.
        // This is the key soundness constraint — a fake nullifier cannot pass.
        computed[0].enforce_equal(&nullifier)?;

        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// Security checklist coverage:
//   [x] Under-constrained: wrong secret_key cannot produce the right nullifier
//   [x] Replay attack: changing proposal_id changes the nullifier (proofs are not portable)
//   [x] Over-constrained: valid inputs always satisfy the circuit
//   [x] Groth16 end-to-end: prove + verify with correct public inputs

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

    /// Compute Poseidon(secret_key, proposal_id) natively (outside circuit).
    /// Used in tests to derive the expected nullifier that the circuit must match.
    fn native_nullifier(secret_key: Fr, proposal_id: Fr) -> Fr {
        let config = poseidon_config::<Fr>();
        let mut sponge = PoseidonSponge::<Fr>::new(&config);
        sponge.absorb(&secret_key);
        sponge.absorb(&proposal_id);
        sponge.squeeze_field_elements::<Fr>(1)[0]
    }

    fn make_circuit(secret_key: Fr, proposal_id: Fr) -> NullifierCircuit<Fr> {
        let nullifier = native_nullifier(secret_key, proposal_id);
        NullifierCircuit {
            nullifier: Some(nullifier),
            proposal_id: Some(proposal_id),
            secret_key: Some(secret_key),
            poseidon_config: poseidon_config(),
        }
    }

    // ── Constraint satisfaction tests ──────────────────────────────────────

    /// Valid inputs must satisfy the circuit (over-constrained check).
    #[test]
    fn test_valid_inputs_satisfied() {
        let secret_key = Fr::from(42u64);
        let proposal_id = Fr::from(1u64);

        let cs = ConstraintSystem::<Fr>::new_ref();
        make_circuit(secret_key, proposal_id)
            .generate_constraints(cs.clone())
            .unwrap();

        assert!(
            cs.is_satisfied().unwrap(),
            "Valid inputs should satisfy the circuit"
        );
    }

    /// Wrong secret_key must not satisfy the circuit (under-constrained check).
    /// The nullifier was computed from secret_key=42 but the witness uses 99.
    #[test]
    fn test_wrong_secret_key_fails() {
        let proposal_id = Fr::from(1u64);
        let correct_key = Fr::from(42u64);
        let wrong_key = Fr::from(99u64);

        let nullifier = native_nullifier(correct_key, proposal_id);

        let cs = ConstraintSystem::<Fr>::new_ref();
        NullifierCircuit {
            nullifier: Some(nullifier),
            proposal_id: Some(proposal_id),
            secret_key: Some(wrong_key), // tampered
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(
            !cs.is_satisfied().unwrap(),
            "Wrong secret_key must not satisfy the circuit"
        );
    }

    /// Changing proposal_id must produce a different nullifier (replay attack prevention).
    /// A proof for proposal 1 must not validate for proposal 2.
    #[test]
    fn test_wrong_proposal_id_fails() {
        let secret_key = Fr::from(42u64);
        let proposal_id_1 = Fr::from(1u64);
        let proposal_id_2 = Fr::from(2u64);

        // Nullifier computed for proposal 1
        let nullifier_for_1 = native_nullifier(secret_key, proposal_id_1);

        // Circuit uses proposal_id_2 — the computed hash won't match nullifier_for_1
        let cs = ConstraintSystem::<Fr>::new_ref();
        NullifierCircuit {
            nullifier: Some(nullifier_for_1),
            proposal_id: Some(proposal_id_2), // different proposal
            secret_key: Some(secret_key),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(
            !cs.is_satisfied().unwrap(),
            "Proof for proposal 1 must not satisfy constraints for proposal 2"
        );
    }

    /// Tampered nullifier (wrong value, correct key and proposal_id) must fail.
    #[test]
    fn test_tampered_nullifier_fails() {
        let secret_key = Fr::from(42u64);
        let proposal_id = Fr::from(1u64);
        let fake_nullifier = Fr::from(0u64); // not the real Poseidon output

        let cs = ConstraintSystem::<Fr>::new_ref();
        NullifierCircuit {
            nullifier: Some(fake_nullifier),
            proposal_id: Some(proposal_id),
            secret_key: Some(secret_key),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(
            !cs.is_satisfied().unwrap(),
            "Fake nullifier must not satisfy the circuit"
        );
    }

    // ── Groth16 end-to-end ─────────────────────────────────────────────────

    /// Full trusted-setup → prove → verify cycle.
    ///
    /// Public inputs are provided in allocation order: [nullifier, proposal_id].
    /// This mirrors what the Solana program does: it reads both values from the
    /// transaction and passes them to the on-chain verifier.
    #[test]
    fn test_groth16_proves_and_verifies() {
        let mut rng = StdRng::seed_from_u64(0);

        let secret_key = Fr::from(42u64);
        let proposal_id = Fr::from(1u64);
        let nullifier = native_nullifier(secret_key, proposal_id);

        // Step 1: trusted setup (single-party — fine for testing and portfolio)
        let setup_circuit = NullifierCircuit::<Fr> {
            nullifier: None,
            proposal_id: None,
            secret_key: None,
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        // Step 2: prover generates proof with private witness
        let proof_circuit = make_circuit(secret_key, proposal_id);
        let proof = Groth16::<Bn254>::prove(&pk, proof_circuit, &mut rng).unwrap();

        // Step 3: verifier checks proof against public inputs [nullifier, proposal_id]
        // This is what the Solana program does — it has both values and verifies the proof.
        let public_inputs = vec![nullifier, proposal_id];
        let valid = Groth16::<Bn254>::verify(&vk, &public_inputs, &proof).unwrap();
        assert!(
            valid,
            "Groth16 proof should verify with correct public inputs"
        );
    }

    /// Verifying with the wrong proposal_id must fail, even with a valid proof.
    /// This ensures the on-chain program cannot be tricked by swapping proposal_id.
    #[test]
    fn test_groth16_wrong_public_inputs_fail() {
        let mut rng = StdRng::seed_from_u64(0);

        let secret_key = Fr::from(42u64);
        let proposal_id = Fr::from(1u64);
        let nullifier = native_nullifier(secret_key, proposal_id);

        let setup_circuit = NullifierCircuit::<Fr> {
            nullifier: None,
            proposal_id: None,
            secret_key: None,
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        let proof =
            Groth16::<Bn254>::prove(&pk, make_circuit(secret_key, proposal_id), &mut rng).unwrap();

        // Swap proposal_id to a different one — verification must fail
        let wrong_proposal_id = Fr::from(999u64);
        let valid = Groth16::<Bn254>::verify(&vk, &[nullifier, wrong_proposal_id], &proof).unwrap();
        assert!(!valid, "Proof must not verify with a different proposal_id");
    }
}
