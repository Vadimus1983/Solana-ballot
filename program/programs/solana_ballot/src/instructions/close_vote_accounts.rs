use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{NullifierRecord, VoteRecord};
use crate::error::BallotError;
use crate::constants::*;

/// Closes one NullifierRecord + VoteRecord pair for a finalized proposal,
/// returning the rent-exempt lamports to `closer`.
///
/// # Permissionless design (intentional)
///
/// Any account may call this instruction and designate itself as `closer`,
/// receiving the rent that the original voter paid during `cast_vote`.
/// This is a deliberate liveness trade-off: if voters disappear after the
/// election, unclosed accounts would be stranded forever. Making cleanup
/// permissionless ensures the program can always reach a clean state.
///
/// # Economic trade-off
///
/// Voters pay rent when casting a vote but are not guaranteed to recover it —
/// a third party (e.g. a MEV bot) can front-run the close and claim the rent.
/// This is accepted because:
///   1. ZK anonymity prevents storing the original voter's address on-chain,
///      so there is no privacy-preserving way to enforce voter-only reclaim.
///   2. The rent amounts (~1,400 lamports per pair) are small relative to
///      transaction fees at current network conditions.
///
/// The Anchor `close` constraint zeroes account data and sets the closed
/// discriminator, preventing resurrection attacks regardless of who calls.
pub fn handler(ctx: Context<CloseVoteAccounts>) -> Result<()> {
    ctx.accounts.proposal.closed_vote_count = ctx.accounts.proposal.closed_vote_count.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVoteAccounts<'info> {
    /// Pays any fee and receives the reclaimed lamports from both closed accounts.
    #[account(mut)]
    pub closer: Signer<'info>,

    /// Proposal must be Finalized before vote records can be reclaimed.
    /// Marked `mut` so the handler can increment `closed_vote_count`.
    #[account(
        mut,
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
