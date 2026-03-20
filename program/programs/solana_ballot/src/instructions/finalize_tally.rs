use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::REVEAL_GRACE_PERIOD;

pub fn handler(ctx: Context<FinalizeTally>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    require!(
        proposal.status == ProposalStatus::Closed,
        BallotError::VotingStillOpen
    );

    // Prevent premature finalization before all voters have had a chance to reveal.
    // Finalization is allowed when either:
    //   a) All cast votes have been revealed (yes + no == vote_count), OR
    //   b) The reveal grace period after voting_end has expired.
    let all_revealed = proposal.yes_count + proposal.no_count >= proposal.vote_count;
    let grace_expired = clock.unix_timestamp >= proposal.voting_end + REVEAL_GRACE_PERIOD;

    require!(all_revealed || grace_expired, BallotError::VotingStillOpen);

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
    /// Any account may finalize once all votes are revealed or the grace period expires.
    #[account(mut)]
    pub finalizer: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
}
