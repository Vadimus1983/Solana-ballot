use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;

pub fn handler(ctx: Context<FinalizeTally>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Closed,
        BallotError::VotingStillOpen
    );

    proposal.status = ProposalStatus::Finalized;

    emit!(ProposalFinalized {
        proposal_id: proposal.id,
        yes_count: proposal.yes_count,
        no_count: proposal.no_count,
        total_votes: proposal.vote_count,
    });

    msg!(
        "Proposal finalized. Yes: {}, No: {}, Total: {}",
        proposal.yes_count,
        proposal.no_count,
        proposal.vote_count,
    );
    Ok(())
}

#[event]
pub struct ProposalFinalized {
    pub proposal_id: [u8; 32],
    pub yes_count: u64,
    pub no_count: u64,
    pub total_votes: u64,
}

#[derive(Accounts)]
pub struct FinalizeTally<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,
}
