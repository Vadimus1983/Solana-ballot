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
        proposal.voting_has_ended(clock.unix_timestamp),
        BallotError::VotingStillOpen
    );

    proposal.status = ProposalStatus::Closed;

    emit!(VotingClosed {
        proposal_id: proposal.id,
        vote_count: proposal.vote_count,
    });

    msg!("Voting closed. Total votes cast: {}", proposal.vote_count);
    Ok(())
}

#[event]
pub struct VotingClosed {
    pub proposal_id: [u8; 32],
    pub vote_count: u64,
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
    pub proposal: Box<Account<'info, Proposal>>,
}
