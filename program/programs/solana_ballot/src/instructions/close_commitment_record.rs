use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::CommitmentRecord;
use crate::error::BallotError;
use crate::constants::*;

/// Closes a single CommitmentRecord PDA and returns the rent to `closer`.
///
/// CommitmentRecords are created by `register_voter` and serve as Merkle
/// uniqueness guards (preventing duplicate tree insertions). After a proposal
/// is finalized they have no further purpose. Without this instruction they
/// would be permanently orphaned once `close_proposal` closes the Proposal
/// account — the proposal pubkey forms part of each commitment record's PDA
/// seed and the rent would be stranded forever.
///
/// # Permissionless design
///
/// Any caller may close any CommitmentRecord and receive the rent. The admin
/// paid at registration time but if they disappear after the election the rent
/// would be stranded. Permissionless cleanup ensures liveness, matching the
/// design of `close_vote_accounts`.
///
/// # No instruction parameter needed
///
/// The commitment value is read from the stored `commitment_record.commitment`
/// field and used directly in the seeds constraint. The caller cannot pass a
/// mismatched value, and anyone can enumerate all CommitmentRecord accounts
/// on-chain via RPC and close them without needing the admin's voter list or
/// event logs.
pub fn handler(ctx: Context<CloseCommitmentRecord>) -> Result<()> {
    ctx.accounts.proposal.closed_commitment_count =
        ctx.accounts.proposal.closed_commitment_count.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseCommitmentRecord<'info> {
    /// Pays the transaction fee and receives the reclaimed lamports.
    #[account(mut)]
    pub closer: Signer<'info>,

    /// Proposal must be Finalized before commitment records can be reclaimed.
    /// Marked `mut` so the handler can increment `closed_commitment_count`.
    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Finalized @ BallotError::NotFinalized,
    )]
    pub proposal: Account<'info, Proposal>,

    /// Seeds are derived from `commitment_record.commitment` — the value stored
    /// at registration time. Anchor re-derives the expected PDA from those bytes
    /// and compares it to this account's address: a wrong account simply fails
    /// to load, so no additional cross-check constraint is needed.
    #[account(
        mut,
        seeds = [SEED_COMMITMENT, proposal.key().as_ref(), commitment_record.commitment.as_ref()],
        bump = commitment_record.bump,
        close = closer,
    )]
    pub commitment_record: Account<'info, CommitmentRecord>,
}
