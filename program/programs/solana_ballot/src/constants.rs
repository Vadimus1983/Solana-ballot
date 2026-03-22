/// Anchor account discriminator size (8 bytes added to every account)
pub const ANCHOR_DISCRIMINATOR: usize = 8;

/// Size of a Solana Pubkey in bytes
pub const PUBKEY_SIZE: usize = 32;

/// Size of a hash or commitment (SHA256 / Poseidon output) in bytes
pub const HASH_SIZE: usize = 32;

/// Maximum length of a proposal title in characters
pub const MAX_TITLE_LEN: usize = 128;

/// Maximum length of a proposal description in characters
pub const MAX_DESCRIPTION_LEN: usize = 256;

/// Borsh string prefix size (4 bytes for length encoding)
pub const STRING_PREFIX_SIZE: usize = 4;

/// Groth16 proof component A size in bytes (G1 point, uncompressed)
pub const PROOF_A_SIZE: usize = 64;

/// Groth16 proof component B size in bytes (G2 point, uncompressed)
pub const PROOF_B_SIZE: usize = 128;

/// Groth16 proof component C size in bytes (G1 point, uncompressed)
pub const PROOF_C_SIZE: usize = 64;

/// Maximum bytes usable as a single PDA seed (Solana limit)
pub const MAX_SEED_LEN: usize = 32;

/// Depth of the eligibility Merkle tree.
/// Supports up to 2^20 = 1,048,576 registered voters.
/// Must match `DEPTH` in the circuits crate.
pub const MERKLE_DEPTH: usize = 20;

/// Storage size for the incremental Merkle tree frontier (one hash per level).
pub const MERKLE_FRONTIER_SIZE: usize = MERKLE_DEPTH * HASH_SIZE; // 640 bytes

/// Number of public inputs in the combined ZK proof:
///   nullifier, proposal_id, merkle_root, vote_commitment
pub const NUM_PUBLIC_INPUTS: usize = 4;

/// PDA seeds
pub const SEED_PROPOSAL: &[u8] = b"proposal";
pub const SEED_NULLIFIER: &[u8] = b"nullifier";
pub const SEED_VOTE: &[u8] = b"vote";
pub const SEED_COMMITMENT: &[u8] = b"commitment";
pub const SEED_VK: &[u8] = b"vk";
pub const SEED_CONFIG: &[u8] = b"config";

/// Minimum time after voting_end before finalize_tally can run.
/// Gives voters 24 hours to reveal after voting closes.
pub const REVEAL_GRACE_PERIOD: i64 = 86_400;

/// How far in the past voting_start may be when create_proposal is called.
/// A 60-second window accommodates transaction latency and clock skew without
/// allowing arbitrarily stale start times.
pub const MAX_VOTING_START_DRIFT: i64 = 60;

/// Maximum allowed voting window (voting_end - voting_start).
/// Caps storage occupancy and prevents indefinitely open elections.
/// 30 days in seconds.
pub const MAX_VOTING_DURATION: i64 = 30 * 24 * 60 * 60; // 2_592_000

/// Expected program authority for initialize.
/// All-zeros = no restriction (safe default for testing / local development).
/// Set to your deployment wallet's 32-byte public key before production deploy
/// to close the front-running window between program deployment and initialization.
pub const PROGRAM_AUTHORITY: [u8; 32] = [0u8; 32];

