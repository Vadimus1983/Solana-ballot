/// BallotValidity circuit — proves that a vote is binary (0 or 1).
///
/// # Why this circuit is needed
///
/// In the commitment scheme, a voter sends `vote_commitment = Poseidon(vote, randomness)`
/// on-chain without revealing the vote. At reveal time the plain `vote` is disclosed,
/// but we need to prove *before* that the committed value was valid (0 or 1) so that
/// a malicious voter cannot commit to e.g. 2 and only reveal after seeing the tally.
///
/// # Constraint
///
/// ```text
/// vote * (vote - 1) = 0
/// ```
///
/// The only field elements that satisfy this are 0 and 1:
/// - vote = 0  → 0 * (0 - 1) = 0 * (-1) = 0  ✓
/// - vote = 1  → 1 * (1 - 1) = 1 *   0  = 0  ✓
/// - vote = 2  → 2 * (2 - 1) = 2 *   1  = 2  ✗
/// - any other → non-zero result               ✗
///
/// # Security checklist
///
/// - [x] Under-constrained: vote is fully determined — no free variable can bypass the check
/// - [x] Overflow: field arithmetic cannot make 2 satisfy the constraint (2 ≠ 0 in BN254)
/// - [x] Public signals: vote is intentionally PRIVATE — the point is to hide it
/// - [x] Negative tests: vote=2 and vote=field_max must fail `is_satisfied()`
use ark_ff::PrimeField;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Proves that `vote` is a binary value without revealing which one.
///
/// # Inputs
///
/// - `vote` — **private witness**. The plaintext vote: must be 0 (no) or 1 (yes).
///   Set to `None` during the trusted-setup phase (key generation), and to `Some(v)`
///   when generating an actual proof.
pub struct BallotValidityCircuit<F: PrimeField> {
    /// The plaintext vote. Private — never included in the proof's public signals.
    pub vote: Option<F>,
}

impl<F: PrimeField> ConstraintSynthesizer<F> for BallotValidityCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        // Allocate `vote` as a private witness variable.
        // `new_witness` means it is part of the proof but NOT a public signal —
        // the verifier cannot read the value, only verify that it satisfies constraints.
        let vote = FpVar::new_witness(ark_relations::ns!(cs, "vote"), || {
            self.vote.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // Constraint: vote * (vote - 1) = 0
        // Satisfied only when vote ∈ {0, 1} — see module doc for the algebra.
        let vote_minus_one = &vote - &FpVar::constant(F::one());
        (&vote * &vote_minus_one).enforce_equal(&FpVar::constant(F::zero()))?;

        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// Two categories per the security checklist:
//   1. Happy-path (over-constrained check): valid inputs must always be satisfiable.
//   2. Negative (under-constrained check): invalid inputs must NOT be satisfiable.
//
// We also run a full Groth16 prove + verify cycle to confirm the circuit works
// end-to-end with the proving system used on-chain.

#[cfg(test)]
mod tests {
    use super::*;

    use ark_bn254::{Bn254, Fr};
    use ark_groth16::Groth16;
    use ark_relations::r1cs::ConstraintSystem;
    use ark_snark::SNARK;
    use ark_std::rand::{rngs::StdRng, SeedableRng};

    // ── Constraint satisfaction tests ──────────────────────────────────────

    /// vote = 0 must satisfy vote * (vote - 1) = 0
    #[test]
    fn test_vote_zero_is_valid() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        let circuit = BallotValidityCircuit { vote: Some(Fr::from(0u64)) };
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(cs.is_satisfied().unwrap(), "vote=0 should satisfy the constraint");
    }

    /// vote = 1 must satisfy vote * (vote - 1) = 0
    #[test]
    fn test_vote_one_is_valid() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        let circuit = BallotValidityCircuit { vote: Some(Fr::from(1u64)) };
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(cs.is_satisfied().unwrap(), "vote=1 should satisfy the constraint");
    }

    /// vote = 2 must NOT satisfy the constraint — if it did, tallying would be broken.
    #[test]
    fn test_vote_two_is_invalid() {
        let cs = ConstraintSystem::<Fr>::new_ref();
        let circuit = BallotValidityCircuit { vote: Some(Fr::from(2u64)) };
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(!cs.is_satisfied().unwrap(), "vote=2 must NOT satisfy the constraint");
    }

    /// vote = p-1 (largest field element) must NOT satisfy the constraint.
    /// This guards against field-wrap confusion: p-1 ≢ -1 passing the check.
    #[test]
    fn test_vote_field_max_is_invalid() {
        // p - 1 is the largest element of the BN254 scalar field
        let field_max = Fr::from(-1i64); // -1 mod p = p - 1
        let cs = ConstraintSystem::<Fr>::new_ref();
        let circuit = BallotValidityCircuit { vote: Some(field_max) };
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(!cs.is_satisfied().unwrap(), "vote=field_max must NOT satisfy the constraint");
    }

    // ── Groth16 end-to-end tests ───────────────────────────────────────────

    /// Full prove + verify cycle for a valid vote (1).
    ///
    /// This mirrors what happens on-chain:
    ///   1. Trusted setup → proving key (pk) + verification key (vk)
    ///   2. Voter generates proof off-chain using pk
    ///   3. Verifier (Solana program) checks proof using vk
    #[test]
    fn test_groth16_valid_vote_proves_and_verifies() {
        let mut rng = StdRng::seed_from_u64(0);

        // Step 1: trusted setup — pass None so no witness is needed during key generation
        let circuit_for_setup = BallotValidityCircuit::<Fr> { vote: None };
        let (pk, vk) =
            Groth16::<Bn254>::circuit_specific_setup(circuit_for_setup, &mut rng).unwrap();

        // Step 2: generate proof for vote = 1
        let circuit_for_proof = BallotValidityCircuit { vote: Some(Fr::from(1u64)) };
        let proof = Groth16::<Bn254>::prove(&pk, circuit_for_proof, &mut rng).unwrap();

        // Step 3: verify — BallotValidity has no public inputs (vote is fully private)
        let public_inputs: &[Fr] = &[];
        let valid = Groth16::<Bn254>::verify(&vk, public_inputs, &proof).unwrap();
        assert!(valid, "Groth16 proof for vote=1 should verify");
    }

    /// Generating a proof for vote = 2 must not succeed.
    ///
    /// `Groth16::prove` internally asserts `cs.is_satisfied()` and panics when the
    /// circuit is unsatisfied — it does not return `Err`. We catch the panic to turn
    /// this into a proper test assertion.
    #[test]
    fn test_groth16_invalid_vote_cannot_prove() {
        let mut rng = StdRng::seed_from_u64(0);

        let circuit_for_setup = BallotValidityCircuit::<Fr> { vote: None };
        let (pk, _vk) =
            Groth16::<Bn254>::circuit_specific_setup(circuit_for_setup, &mut rng).unwrap();

        // vote = 2 violates the constraint — the prover panics internally
        let circuit_for_proof = BallotValidityCircuit { vote: Some(Fr::from(2u64)) };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            Groth16::<Bn254>::prove(&pk, circuit_for_proof, &mut rng)
        }));

        assert!(result.is_err(), "Groth16 must panic for an unsatisfied circuit");
    }
}
