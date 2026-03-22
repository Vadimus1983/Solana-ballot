use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::SEED_PROPOSAL;

pub fn handler(ctx: Context<CloseVoting>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    require!(
        proposal.status == ProposalStatus::Voting,
        BallotError::VotingNotOpen
    );
    // Anyone can trigger close once the agreed deadline has passed.
    // The admin cannot close early. No single party can block close
    // by disappearing — any account can call this after voting_end.
    require!(
        clock.unix_timestamp >= proposal.voting_end,
        BallotError::VotingStillOpen
    );

    proposal.status = ProposalStatus::Closed;

    msg!("Voting closed. Total votes cast: {}", proposal.vote_count);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVoting<'info> {
    /// Any account may close voting once voting_end has passed.
    pub closer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
}
