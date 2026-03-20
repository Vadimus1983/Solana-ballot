use anchor_lang::prelude::*;
use crate::constants::*;

#[account]
pub struct Proposal {
    /// Unique proposal identifier — set to the PDA pubkey at creation
    pub id: [u8; HASH_SIZE],

    /// The admin who created this proposal and controls its lifecycle
    pub admin: Pubkey,

    /// Human-readable title shown to voters (max 128 chars)
    pub title: String,

    /// Full description of what is being voted on (max 256 chars)
    pub description: String,

    /// Unix timestamp when voting opens — voters cannot cast before this
    pub voting_start: i64,

    /// Unix timestamp when voting closes — voters cannot cast after this
    pub voting_end: i64,

    /// Current lifecycle state of the proposal
    pub status: ProposalStatus,

    /// Root of the Merkle tree of registered voter commitments.
    /// Used in ZK proofs to prove a voter is eligible without revealing identity.
    pub merkle_root: [u8; HASH_SIZE],

    /// Total number of registered voters (Merkle tree leaves)
    pub voter_count: u64,

    /// Total number of votes cast (including unrevealed)
    pub vote_count: u64,

    /// Number of revealed yes votes (1) after voting closes
    pub yes_count: u64,

    /// Number of revealed no votes (0) after voting closes
    pub no_count: u64,

    /// PDA bump seed for address derivation
    pub bump: u8,
}

impl Proposal {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + HASH_SIZE                                // id
        + PUBKEY_SIZE                              // admin
        + STRING_PREFIX_SIZE + MAX_TITLE_LEN       // title
        + STRING_PREFIX_SIZE + MAX_DESCRIPTION_LEN // description
        + 8                                        // voting_start
        + 8                                        // voting_end
        + 1                                        // status
        + HASH_SIZE                                // merkle_root
        + 8                                        // voter_count
        + 8                                        // vote_count
        + 8                                        // yes_count
        + 8                                        // no_count
        + 1;                                       // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Voters can be registered, voting has not started yet
    Registration,
    /// Voting is open, voters can cast ZK proofs
    Voting,
    /// Voting period ended, voters can reveal their votes
    Closed,
    /// Tally is complete, result is final
    Finalized,
}
