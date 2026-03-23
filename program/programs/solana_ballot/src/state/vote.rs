use anchor_lang::prelude::*;
use crate::constants::*;

#[account]
pub struct VoteRecord {
    pub proposal_id: [u8; HASH_SIZE],
    pub vote_commitment: [u8; HASH_SIZE],
    pub nullifier: [u8; HASH_SIZE],
    pub revealed: bool,
    pub vote: u8,   // 0=No, 1=Yes when revealed=true; VOTE_UNREVEALED (0xFF) otherwise
    pub bump: u8,
}

impl VoteRecord {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + HASH_SIZE     // proposal_id
        + HASH_SIZE     // vote_commitment
        + HASH_SIZE     // nullifier
        + 1             // revealed
        + 1             // vote
        + 1;            // bump
}

/// One account per (proposal, commitment) pair — its existence prevents the same
/// commitment from being inserted into the Merkle tree more than once.
///
/// Stores the commitment value so the account is self-describing: any holder of
/// an on-chain RPC connection can enumerate all CommitmentRecord accounts for a
/// proposal and close them via `close_commitment_record` without any off-chain
/// data (event logs or admin records).
#[account]
pub struct CommitmentRecord {
    /// The voter commitment registered for this proposal.
    /// Stored here (rather than derived from seeds) so the account can be closed
    /// permissionlessly after finalization without requiring the caller to supply
    /// the commitment value from off-chain sources.
    pub commitment: [u8; HASH_SIZE],
    pub bump: u8,
}

impl CommitmentRecord {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + HASH_SIZE  // commitment
        + 1;         // bump
}

/// One account per nullifier — its existence means the nullifier is spent
#[account]
pub struct NullifierRecord {
    pub proposal_id: [u8; HASH_SIZE],
    pub nullifier: [u8; HASH_SIZE],
    pub bump: u8,
}

impl NullifierRecord {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + HASH_SIZE     // proposal_id
        + HASH_SIZE     // nullifier
        + 1;            // bump
}
