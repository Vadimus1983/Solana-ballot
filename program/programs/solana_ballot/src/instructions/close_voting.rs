use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;

pub fn handler(ctx: Context<CloseVoting>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Voting,
        BallotError::VotingNotOpen
    );

    proposal.status = ProposalStatus::Closed;

    msg!("Voting closed. Total votes cast: {}", proposal.vote_count);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVoting<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,
}
