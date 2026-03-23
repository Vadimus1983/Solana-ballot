use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{NullifierRecord, VoteRecord};
use crate::error::BallotError;
use crate::constants::*;

/// Closes one NullifierRecord + VoteRecord pair for a finalized proposal,
/// returning the rent-exempt lamports to `refund_to`.
///
/// # Permissionless design (intentional)
///
/// Any account may call this instruction. Making cleanup permissionless
/// ensures the program can always reach a clean state even if voters
/// disappear after the election.
///
/// # Rent recovery
///
/// Voters pay rent when casting a vote. If the voter designated a `refund_to`
/// address via `cast_vote`, the lamports are routed there regardless of who
/// calls this instruction — a MEV bot cannot redirect the rent to itself.
/// If the voter left `refund_to` as `Pubkey::default()` (all zeros), the
/// caller designates any address; permissionless cleanup is preserved and
/// the voter has explicitly opted out of protected reclaim.
///
/// Voters may use a fresh ephemeral key as `refund_to` to recover rent
/// without linking their Solana identity to their nullifier on-chain.
///
/// The Anchor `close` constraint zeroes account data and sets the closed
/// discriminator, preventing resurrection attacks regardless of who calls.
pub fn handler(ctx: Context<CloseVoteAccounts>) -> Result<()> {
    ctx.accounts.proposal.closed_vote_count = ctx.accounts.proposal.closed_vote_count.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVoteAccounts<'info> {
    /// Pays the transaction fee.
    #[account(mut)]
    pub closer: Signer<'info>,

    /// Receives the reclaimed lamports from both closed accounts.
    ///
    /// If the voter designated a `refund_to` address in their VoteRecord, this
    /// account must match it exactly. If the voter left `refund_to` unset
    /// (`Pubkey::default()`), this must equal `closer` — any caller may then
    /// direct the rent to themselves, preserving permissionless cleanup.
    ///
    /// CHECK: validated by constraint against vote_record.refund_to
    #[account(
        mut,
        constraint = (vote_record.refund_to == Pubkey::default() && refund_to.key() == closer.key())
            || refund_to.key() == vote_record.refund_to
            @ BallotError::InvalidRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

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
        close = refund_to,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    #[account(
        mut,
        seeds = [SEED_VOTE, proposal.key().as_ref(), vote_record.nullifier.as_ref()],
        bump = vote_record.bump,
        constraint = vote_record.proposal_id == proposal.id @ BallotError::Unauthorized,
        // Guard against mismatched pairs: both records must share the same nullifier.
        constraint = vote_record.nullifier == nullifier_record.nullifier @ BallotError::Unauthorized,
        close = refund_to,
    )]
    pub vote_record: Account<'info, VoteRecord>,
}
