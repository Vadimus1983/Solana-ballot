use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{NullifierRecord, VoteRecord};
use crate::error::BallotError;
use crate::constants::*;

/// Closes one NullifierRecord + VoteRecord pair for a finalized proposal,
/// returning the rent-exempt lamports to `closer`.
///
/// Permissionless: any account may call this once finalization is complete.
/// The Anchor `close` constraint zeroes the account data and sets the closed
/// discriminator, preventing resurrection attacks.
pub fn handler(_ctx: Context<CloseVoteAccounts>) -> Result<()> {
    // All work is performed by the `close` constraints — no handler body needed.
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVoteAccounts<'info> {
    /// Pays any fee and receives the reclaimed lamports from both closed accounts.
    #[account(mut)]
    pub closer: Signer<'info>,

    /// Proposal must be Finalized before vote records can be reclaimed.
    #[account(
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Finalized @ BallotError::NotFinalized,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [SEED_NULLIFIER, proposal.key().as_ref(), nullifier_record.nullifier.as_ref()],
        bump = nullifier_record.bump,
        constraint = nullifier_record.proposal_id == proposal.id @ BallotError::Unauthorized,
        close = closer,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    #[account(
        mut,
        seeds = [SEED_VOTE, proposal.key().as_ref(), vote_record.nullifier.as_ref()],
        bump = vote_record.bump,
        constraint = vote_record.proposal_id == proposal.id @ BallotError::Unauthorized,
        // Guard against mismatched pairs: both records must share the same nullifier.
        constraint = vote_record.nullifier == nullifier_record.nullifier @ BallotError::Unauthorized,
        close = closer,
    )]
    pub vote_record: Account<'info, VoteRecord>,
}
