use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;

/// Transitions the proposal from Registration → Voting.
///
/// After this call, voters can begin submitting ZK proofs via `cast_vote`.
/// The Merkle root is frozen at this point — no new voters can be registered
/// once voting is open, ensuring the eligibility tree is fixed for all proofs.
///
/// # Guards
/// - Caller must be the proposal admin.
/// - Proposal must be in `Registration` status (not already open or closed).
/// - Current time must be within the configured voting window
///   (`voting_start <= now <= voting_end`). This prevents the admin from
///   opening voting arbitrarily outside the agreed period.
/// - At least one voter must be registered. Opening an empty election is
///   almost certainly a mistake, and an empty Merkle tree would make every
///   proof trivially invalid.
pub fn handler(ctx: Context<OpenVoting>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    // Must still be in the registration phase
    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Prevent opening before the agreed start time.
    // The upper bound (voting_end) is not checked here — cast_vote already
    // enforces it, so opening late is harmless (no votes can be cast).
    require!(
        clock.unix_timestamp >= proposal.voting_start,
        BallotError::VotingNotOpen
    );

    // Require at least one registered voter — an empty election is invalid.
    // An empty Merkle tree also means no proof can ever be valid.
    require!(proposal.voter_count > 0, BallotError::NotInRegistration);

    proposal.status = ProposalStatus::Voting;

    msg!(
        "Voting opened. Registered voters: {}. Window: {} – {}",
        proposal.voter_count,
        proposal.voting_start,
        proposal.voting_end,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct OpenVoting<'info> {
    /// The proposal admin. Must match `proposal.admin`.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The proposal being transitioned to Voting status.
    /// Verified to be owned by `admin` via `has_one`.
    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,
}
