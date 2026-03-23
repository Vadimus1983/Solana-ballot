use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::SEED_PROPOSAL;

/// Closes a finalized Proposal account and returns the rent-exempt lamports
/// to the admin.
///
/// Callable only by the proposal admin after finalization. All vote accounts
/// (NullifierRecord, VoteRecord) must be closed via `close_vote_accounts`
/// first — the `closed_vote_count >= vote_count` constraint enforces this,
/// preventing rent from being permanently stranded in unclosed vote records.
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
        constraint = proposal.closed_vote_count >= proposal.vote_count @ BallotError::VoteAccountsNotClosed,
        constraint = proposal.closed_commitment_count >= proposal.voter_count @ BallotError::CommitmentAccountsNotClosed,
        close = admin,
    )]
    pub proposal: Account<'info, Proposal>,
}
