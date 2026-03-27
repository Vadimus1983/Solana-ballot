use anchor_lang::prelude::*;
use crate::constants::{ANCHOR_DISCRIMINATOR, HASH_SIZE, ROOT_HISTORY_SIZE};

/// Stores a ring buffer of the last ROOT_HISTORY_SIZE Merkle roots for a proposal.
///
/// Declared as zero_copy so Anchor skips Borsh deserialization entirely —
/// the account data is accessed via a direct reference into the heap-allocated
/// account buffer. This avoids the BPF 4096-byte stack limit that would be
/// exceeded by a [[u8;32];32] = 1024-byte field during Borsh deserialization.
///
/// Seeded by [SEED_ROOT_HISTORY, proposal_pubkey]. Created in create_proposal;
/// closed in close_proposal.
#[account(zero_copy)]
pub struct RootHistoryAccount {
    /// Ring buffer of Merkle roots written by register_voter.
    /// cast_vote accepts a proof for any root found here, eliminating the race
    /// condition where a voter generates their proof before all registrations complete.
    pub root_history: [[u8; HASH_SIZE]; ROOT_HISTORY_SIZE],

    /// Write head into root_history (wraps via wrapping_add, mod ROOT_HISTORY_SIZE).
    pub root_history_index: u8,
}

impl RootHistoryAccount {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + ROOT_HISTORY_SIZE * HASH_SIZE   // root_history  (256 × 32 = 8 192 bytes)
        + 1;                              // root_history_index (u8, wraps at 256 = ROOT_HISTORY_SIZE)
}
