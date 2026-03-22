use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::SEED_PROPOSAL;

/// Closes a finalized Proposal account and returns the rent-exempt lamports
/// to the admin.
///
/// Callable only by the proposal admin after finalization. All vote accounts
/// (NullifierRecord, VoteRecord) should be closed via `close_vote_accounts`
/// before closing the proposal so that rent is fully reclaimed.
pub fn handler(_ctx: Context<CloseProposal>) -> Result<()> {
    // All work is performed by the `close = admin` constraint.
    Ok(())
}

#[derive(Accounts)]
pub struct CloseProposal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Finalized @ BallotError::NotFinalized,
        close = admin,
    )]
    pub proposal: Account<'info, Proposal>,
}
