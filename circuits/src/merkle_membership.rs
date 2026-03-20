/// MerkleMembership circuit — proves a commitment is a leaf in the eligibility Merkle tree.
///
/// # Why this circuit is needed
///
/// Voters are registered by adding their `commitment = Poseidon(secret_key, randomness)`
/// as a leaf in an on-chain Merkle tree. When casting a vote, the voter must prove they
/// are in that tree without revealing which leaf is theirs — i.e., without revealing
/// their identity.
///
/// The circuit proves: "I know a `commitment` and a valid Merkle path such that
/// hashing up the path produces `merkle_root`" — in zero knowledge.
///
/// # Tree structure
///
/// The tree is a binary Merkle tree of depth [`DEPTH`] = 20, supporting up to
/// 2^20 = 1,048,576 registered voters. Each internal node is:
///
/// ```text
/// node = Poseidon(left_child, right_child)
/// ```
///
/// The path from a leaf to the root consists of:
/// - `path` — the sibling hash at each level (20 values)
/// - `path_indices` — whether the current node is the left (false) or right (true) child
///
/// At each level:
/// ```text
/// if path_index == false: parent = Poseidon(current, sibling)   // current is left
/// if path_index == true:  parent = Poseidon(sibling, current)   // current is right
/// ```
///
/// # Public vs private signals
///
/// | Signal        | Visibility | Why                                                      |
/// |---------------|------------|----------------------------------------------------------|
/// | merkle_root   | PUBLIC     | Must match the on-chain root — verifier checks this      |
/// | commitment    | PRIVATE    | Reveals which voter — must stay hidden                   |
/// | path          | PRIVATE    | Reveals the voter's position in the tree — must be hidden|
/// | path_indices  | PRIVATE    | Reveals the voter's leaf index — must be hidden          |
///
/// # Security: unverified registry
///
/// The `merkle_root` public input MUST be checked against the on-chain proposal state
/// in the Solana program. If the program accepts any root the prover provides, a voter
/// could construct their own tree and prove membership in it.
use ark_crypto_primitives::sponge::{
    constraints::CryptographicSpongeVar,
    poseidon::{constraints::PoseidonSpongeVar, PoseidonConfig},
};
use ark_ff::PrimeField;
use ark_r1cs_std::{boolean::Boolean, fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Depth of the Merkle tree.
/// Supports up to 2^20 = 1,048,576 registered voters.
pub const DEPTH: usize = 20;

/// Proves that `commitment` is a leaf in the Merkle tree with the given `merkle_root`.
///
/// # Fields
///
/// - `merkle_root`   — **public input**. The root of the on-chain eligibility tree.
///                     Must match what is stored in the proposal account.
/// - `commitment`    — **private witness**. `Poseidon(secret_key, randomness)` — the voter's leaf.
/// - `path`          — **private witness**. Sibling hashes at each of the [`DEPTH`] levels.
/// - `path_indices`  — **private witness**. `false` = current node is left child,
///                     `true` = current node is right child, at each level.
/// - `poseidon_config` — Poseidon parameters. Use `poseidon_params::poseidon_config()`.
pub struct MerkleMembershipCircuit<F: PrimeField> {
    /// Root of the eligibility Merkle tree — public, verified against on-chain state
    pub merkle_root: Option<F>,

    /// The voter's commitment leaf — private, reveals identity if exposed
    pub commitment: Option<F>,

    /// Sibling hashes along the path from leaf to root — private, reveals position if exposed
    pub path: Vec<Option<F>>,

    /// Left/right indicators at each level — private, reveals leaf index if exposed
    pub path_indices: Vec<Option<bool>>,

    /// Poseidon configuration — must match the config used when building the on-chain tree
    pub poseidon_config: PoseidonConfig<F>,
}

impl<F: PrimeField> ConstraintSynthesizer<F> for MerkleMembershipCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        assert_eq!(self.path.len(), DEPTH, "path length must equal DEPTH");
        assert_eq!(self.path_indices.len(), DEPTH, "path_indices length must equal DEPTH");

        // ── Public input ─────────────────────────────────────────────────────

        let merkle_root = FpVar::new_input(ark_relations::ns!(cs, "merkle_root"), || {
            self.merkle_root.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Private witnesses ────────────────────────────────────────────────

        // Start at the leaf — the voter's commitment
        let mut current = FpVar::new_witness(ark_relations::ns!(cs, "commitment"), || {
            self.commitment.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // ── Core constraint: traverse the Merkle path ─────────────────────────
        //
        // At each level, hash the current node with its sibling to produce the parent.
        // The order (left, right) is determined by path_indices[i]:
        //   false → current is the left child  → parent = Poseidon(current, sibling)
        //   true  → current is the right child → parent = Poseidon(sibling, current)

        for i in 0..DEPTH {
            // Sibling hash at this level — private
            let sibling = FpVar::new_witness(
                ark_relations::ns!(cs, "sibling"),
                || self.path[i].ok_or(SynthesisError::AssignmentMissing),
            )?;

            // Left/right indicator — private
            // Boolean gadget enforces this is 0 or 1 (adds its own binary constraint)
            let is_right = Boolean::new_witness(
                ark_relations::ns!(cs, "index"),
                || self.path_indices[i].ok_or(SynthesisError::AssignmentMissing),
            )?;

            // Conditionally place current and sibling in the correct order.
            // `is_right.select(a, b)` returns `a` when is_right=true, `b` when false.
            let left = is_right.select(&sibling, &current)?;
            let right = is_right.select(&current, &sibling)?;

            // Compute parent = Poseidon(left, right)
            let mut sponge = PoseidonSpongeVar::<F>::new(cs.clone(), &self.poseidon_config);
            sponge.absorb(&left)?;
            sponge.absorb(&right)?;
            current = sponge.squeeze_field_elements(1)?[0].clone();
        }

        // After traversing all levels, `current` is the computed root.
        // It must equal the public merkle_root — otherwise the path is invalid.
        current.enforce_equal(&merkle_root)?;

        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

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

    /// Hash two field elements natively: Poseidon(left, right)
    fn poseidon2(left: Fr, right: Fr) -> Fr {
        let config = poseidon_config::<Fr>();
        let mut sponge = PoseidonSponge::<Fr>::new(&config);
        sponge.absorb(&left);
        sponge.absorb(&right);
        sponge.squeeze_field_elements::<Fr>(1)[0]
    }

    /// Build a depth-20 Merkle path for the leftmost leaf (index 0).
    ///
    /// In this test tree all leaves except index 0 are `Fr::zero()`.
    /// The siblings at each level are the hashes of the all-zero subtrees.
    ///
    /// Returns `(path, path_indices, root)`:
    /// - `path`          — sibling hashes at each of the 20 levels
    /// - `path_indices`  — all `false` (our leaf is always the left child)
    /// - `root`          — the resulting Merkle root
    fn build_leftmost_path(commitment: Fr) -> (Vec<Fr>, Vec<bool>, Fr) {
        // Pre-compute empty subtree hashes bottom-up:
        //   empty[0] = 0  (empty leaf)
        //   empty[i] = Poseidon(empty[i-1], empty[i-1])
        let mut empty = vec![Fr::from(0u64); DEPTH + 1];
        for i in 1..=DEPTH {
            empty[i] = poseidon2(empty[i - 1], empty[i - 1]);
        }

        // Our leaf is the leftmost (index 0) — all siblings are empty subtrees
        let path: Vec<Fr> = (0..DEPTH).map(|i| empty[i]).collect();
        let path_indices: Vec<bool> = vec![false; DEPTH];

        // Compute the root by hashing up:
        // at level i: parent = Poseidon(current, empty[i])
        let mut current = commitment;
        for i in 0..DEPTH {
            current = poseidon2(current, empty[i]);
        }

        (path, path_indices, current)
    }

    fn make_circuit(commitment: Fr) -> (MerkleMembershipCircuit<Fr>, Fr) {
        let (path, path_indices, root) = build_leftmost_path(commitment);
        let circuit = MerkleMembershipCircuit {
            merkle_root: Some(root),
            commitment: Some(commitment),
            path: path.iter().map(|&v| Some(v)).collect(),
            path_indices: path_indices.iter().map(|&v| Some(v)).collect(),
            poseidon_config: poseidon_config(),
        };
        (circuit, root)
    }

    // ── Constraint satisfaction tests ──────────────────────────────────────

    /// Valid membership proof must satisfy the circuit.
    #[test]
    fn test_valid_membership_satisfied() {
        let commitment = Fr::from(42u64);
        let (circuit, _root) = make_circuit(commitment);

        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.generate_constraints(cs.clone()).unwrap();

        assert!(cs.is_satisfied().unwrap(), "Valid membership proof must satisfy the circuit");
    }

    /// Wrong commitment (not in the tree) must not satisfy the circuit.
    #[test]
    fn test_wrong_commitment_fails() {
        let commitment = Fr::from(42u64);
        let (_circuit, root) = make_circuit(commitment);

        let (path, path_indices, _) = build_leftmost_path(commitment);

        // Use a different commitment — the computed root will differ from `root`
        let cs = ConstraintSystem::<Fr>::new_ref();
        MerkleMembershipCircuit {
            merkle_root: Some(root),
            commitment: Some(Fr::from(99u64)), // tampered
            path: path.iter().map(|&v| Some(v)).collect(),
            path_indices: path_indices.iter().map(|&v| Some(v)).collect(),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "Wrong commitment must not satisfy the circuit");
    }

    /// Tampered sibling in the path must not satisfy the circuit.
    #[test]
    fn test_wrong_path_fails() {
        let commitment = Fr::from(42u64);
        let (path, path_indices, root) = build_leftmost_path(commitment);

        // Tamper the first sibling
        let mut bad_path = path.clone();
        bad_path[0] = Fr::from(0xdeadbeefu64);

        let cs = ConstraintSystem::<Fr>::new_ref();
        MerkleMembershipCircuit {
            merkle_root: Some(root),
            commitment: Some(commitment),
            path: bad_path.iter().map(|&v| Some(v)).collect(),
            path_indices: path_indices.iter().map(|&v| Some(v)).collect(),
            poseidon_config: poseidon_config(),
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "Tampered path sibling must not satisfy the circuit");
    }

    /// Wrong merkle_root must not satisfy the circuit.
    /// This is the key guard against using a self-constructed tree.
    #[test]
    fn test_wrong_root_fails() {
        let commitment = Fr::from(42u64);
        let (circuit_data, _real_root) = make_circuit(commitment);

        let cs = ConstraintSystem::<Fr>::new_ref();
        MerkleMembershipCircuit {
            merkle_root: Some(Fr::from(0u64)), // fake root
            ..circuit_data
        }
        .generate_constraints(cs.clone())
        .unwrap();

        assert!(!cs.is_satisfied().unwrap(), "Fake merkle_root must not satisfy the circuit");
    }

    // ── Groth16 end-to-end ─────────────────────────────────────────────────

    /// Full trusted-setup → prove → verify cycle with depth-20 tree.
    /// Public input: [merkle_root].
    #[test]
    fn test_groth16_proves_and_verifies() {
        let mut rng = StdRng::seed_from_u64(0);
        let commitment = Fr::from(42u64);
        let (_, root) = make_circuit(commitment);

        // Trusted setup
        let setup_circuit = MerkleMembershipCircuit::<Fr> {
            merkle_root: None,
            commitment: None,
            path: vec![None; DEPTH],
            path_indices: vec![None; DEPTH],
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        // Prove
        let (proof_circuit, _) = make_circuit(commitment);
        let proof = Groth16::<Bn254>::prove(&pk, proof_circuit, &mut rng).unwrap();

        // Verify — the Solana program provides [merkle_root] as the public input
        let valid = Groth16::<Bn254>::verify(&vk, &[root], &proof).unwrap();
        assert!(valid, "Groth16 proof should verify with correct merkle_root");
    }

    /// A valid proof must not verify against a different (attacker-controlled) root.
    #[test]
    fn test_groth16_wrong_root_fails() {
        let mut rng = StdRng::seed_from_u64(0);
        let commitment = Fr::from(42u64);

        let setup_circuit = MerkleMembershipCircuit::<Fr> {
            merkle_root: None,
            commitment: None,
            path: vec![None; DEPTH],
            path_indices: vec![None; DEPTH],
            poseidon_config: poseidon_config(),
        };
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

        let (proof_circuit, _) = make_circuit(commitment);
        let proof = Groth16::<Bn254>::prove(&pk, proof_circuit, &mut rng).unwrap();

        let attacker_root = Fr::from(0u64);
        let valid = Groth16::<Bn254>::verify(&vk, &[attacker_root], &proof).unwrap();
        assert!(!valid, "Proof must not verify against an attacker-controlled root");
    }
}
