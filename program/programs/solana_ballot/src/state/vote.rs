use anchor_lang::prelude::*;
use crate::constants::*;

#[account]
pub struct VoteRecord {
    pub proposal_id: [u8; HASH_SIZE],
    pub vote_commitment: [u8; HASH_SIZE],
    pub nullifier: [u8; HASH_SIZE],
    pub revealed: bool,
    pub vote: u8,   // 0 or 1, valid only when revealed = true
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
#[account]
pub struct CommitmentRecord {
    pub bump: u8,
}

impl CommitmentRecord {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR + 1; // bump
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
