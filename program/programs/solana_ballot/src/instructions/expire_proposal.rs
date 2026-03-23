use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::SEED_PROPOSAL;

/// Transitions a Registration proposal to Expired after its voting window passes
/// without the admin calling open_voting.
///
/// # Permissionless design
///
/// Any account may call this after `voting_end` has elapsed. The admin cannot
/// brick a proposal — whether through negligence, key loss, or griefing — and
/// permanently strand the rent locked in CommitmentRecord accounts. Once Expired,
/// the existing `close_commitment_record` and `close_proposal` flow reclaims all rent.
///
/// # Why not just extend close_proposal?
///
/// `close_proposal` requires `closed_commitment_count >= voter_count`, which means
/// commitment records must be closed first. By making expiry an explicit state
/// transition, `close_commitment_record` can safely gate on `is_terminal()` and
/// the cleanup sequence mirrors the normal finalized path.
pub fn handler(ctx: Context<ExpireProposal>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp > ctx.accounts.proposal.voting_end,
        BallotError::VotingWindowNotExpired
    );
    ctx.accounts.proposal.status = ProposalStatus::Expired;
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireProposal<'info> {
    /// Pays the transaction fee — any account may trigger expiry.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Registration @ BallotError::NotInRegistration,
    )]
    pub proposal: Account<'info, Proposal>,
}
