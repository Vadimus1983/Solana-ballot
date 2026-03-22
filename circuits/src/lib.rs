pub mod ballot_validity;
pub mod merkle_membership;
pub mod nullifier;
/// ZK circuits for the solana-ballot private voting system.
///
/// Each circuit encodes one piece of the proof that a voter must produce
/// when calling `cast_vote` on-chain. All circuits target the BN254 scalar
/// field and are designed to be proven with Groth16.
///
/// # Circuit overview
///
/// | Circuit           | What it proves                                      | Status      |
/// |-------------------|-----------------------------------------------------|-------------|
/// | BallotValidity    | vote ∈ {0, 1}                                       | implemented |
/// | Nullifier         | nullifier = Poseidon(secret_key, proposal_id)       | implemented |
/// | MerkleMembership  | commitment is a leaf in the eligibility Merkle tree | implemented |
/// | VoteCommitment    | vote_commitment = Poseidon(vote, randomness)        | implemented |
pub mod poseidon_params;
pub mod vote_commitment;
