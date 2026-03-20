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

/// PDA seeds
pub const SEED_PROPOSAL: &[u8] = b"proposal";
pub const SEED_NULLIFIER: &[u8] = b"nullifier";
pub const SEED_VOTE: &[u8] = b"vote";
