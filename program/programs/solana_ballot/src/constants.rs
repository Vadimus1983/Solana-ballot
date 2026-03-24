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
pub const SEED_VOTER: &[u8] = b"voter";
pub const SEED_VK: &[u8] = b"vk";
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_PENDING_COMMITMENT: &[u8] = b"pending_commitment";

/// Minimum time after voting_end before finalize_tally can run.
/// Gives voters 24 hours to reveal after voting closes.
pub const REVEAL_GRACE_PERIOD: i64 = 86_400;

/// How far in the past voting_start may be when create_proposal is called.
/// A 60-second window accommodates transaction latency and clock skew without
/// allowing arbitrarily stale start times.
pub const MAX_VOTING_START_DRIFT: i64 = 60;

/// Sentinel stored in VoteRecord.vote before the vote is revealed.
/// Valid votes are 0 (No) or 1 (Yes); 0xFF is out of range and unambiguous.
/// Indexers must check VoteRecord.revealed == true before reading .vote.
pub const VOTE_UNREVEALED: u8 = 0xFF;

/// Minimum allowed voting window (voting_end - voting_start).
/// Prevents structurally un-openable proposals: with MAX_VOTING_START_DRIFT = 60 s,
/// a window shorter than 60 s can expire before open_voting is even callable.
/// 1 hour gives voters and the admin reasonable time to act.
pub const MIN_VOTING_DURATION: i64 = 60 * 60; // 3_600

/// Maximum allowed voting window (voting_end - voting_start).
/// Caps storage occupancy and prevents indefinitely open elections.
/// 30 days in seconds.
pub const MAX_VOTING_DURATION: i64 = 30 * 24 * 60 * 60; // 2_592_000

/// BN254 scalar field prime (big-endian, 32 bytes).
/// Voter commitments must be strictly less than this value to be valid field elements.
/// r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
pub const BN254_PRIME: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x42, 0xe0, 0xf8, 0x53, 0xd2, 0x69, 0x41, 0x6f,
];

/// Domain separator for the incremental Merkle tree's empty-leaf value (zeros[0]).
/// Using a non-zero domain makes empty tree slots cryptographically distinct from
/// any real voter commitment, following the Semaphore/Tornado Cash convention.
/// Value: b"solana_ballot_empty" (19 bytes, right-aligned in a 32-byte field element).
pub const ZERO_LEAF_DOMAIN_SEP: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    b's', b'o', b'l', b'a', b'n', b'a', b'_', // "solana_"
    b'b', b'a', b'l', b'l', b'o', b't', b'_', // "ballot_"
    b'e', b'm', b'p', b't', b'y',              // "empty"
];

/// Expected program authority for initialize.
/// All-zeros = no restriction (safe default for testing / local development).
/// Set to your deployment wallet's 32-byte public key before production deploy
/// to close the front-running window between program deployment and initialization.
pub const PROGRAM_AUTHORITY: [u8; 32] = [0u8; 32];

/// Compile-time guard: production builds with an all-zeros PROGRAM_AUTHORITY
/// fail to compile with a clear error message.
///
/// This is strictly stronger than the previous `build.rs` string-match guard,
/// which could be silently bypassed by comment variations, type-suffix changes
/// (`[0; 32]` vs `[0u8; 32]`), or trailing whitespace.
///
/// Gated on `#[cfg(not(feature = "dev"))]` so local development and tests
/// (which always pass `--features dev`) are unaffected.
#[cfg(not(feature = "dev"))]
const _PROGRAM_AUTHORITY_CHECK: () = {
    let mut all_zero = true;
    let mut i = 0usize;
    while i < 32 {
        if PROGRAM_AUTHORITY[i] != 0 {
            all_zero = false;
            break;
        }
        i += 1;
    }
    assert!(
        !all_zero,
        "PRODUCTION BUILD BLOCKED: PROGRAM_AUTHORITY is all-zeros. \
         Set it to your deployment wallet's 32-byte public key before building for production."
    );
};

