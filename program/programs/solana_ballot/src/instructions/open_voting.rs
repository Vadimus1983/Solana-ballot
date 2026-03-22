use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::{SEED_PROPOSAL, SEED_VK};
#[cfg(not(feature = "dev"))]
use crate::state::VerificationKeyAccount;

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
/// - **VK must be initialized** (production builds): the verifying key must be
///   stored on-chain before voting opens. Without it every `cast_vote` would
///   fail, permanently bricking the election. Dev builds skip this check so
///   `anchor test` works without a real trusted-setup ceremony.
pub fn handler(ctx: Context<OpenVoting>) -> Result<()> {
    // ── VK gate (production only) ─────────────────────────────────────────────
    //
    // Require the verifying key to be on-chain and initialized before the
    // election transitions to Voting. Without a VK every cast_vote fails with
    // VkNotInitialized, permanently bricking the election since store_vk uses
    // `init` (one-time) and the proposal cannot revert to Registration.
    //
    // In dev builds the check is skipped so `anchor test` works without a real
    // Groth16 trusted-setup ceremony (matches the bypass in cast_vote.rs).
    #[cfg(not(feature = "dev"))]
    {
        let data = ctx.accounts.vk_account.try_borrow_data()?;
        let vk_ok = if data.len() >= VerificationKeyAccount::LEN {
            let mut slice: &[u8] = &data;
            VerificationKeyAccount::try_deserialize(&mut slice)
                .map(|vk| vk.is_initialized)
                .unwrap_or(false)
        } else {
            false
        };
        require!(vk_ok, BallotError::VkNotInitialized);
    }

    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    // Must still be in the registration phase
    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Require the call to land within the voting window: voting_start <= now < voting_end.
    // The upper bound prevents the admin from opening an already-expired window,
    // which would produce a finalizable proposal with 0/0 votes as the official result.
    require!(
        clock.unix_timestamp >= proposal.voting_start
            && !proposal.voting_has_ended(clock.unix_timestamp),
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
    pub admin: Signer<'info>,

    /// The proposal being transitioned to Voting status.
    /// Verified to be owned by `admin` via `has_one`.
    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Groth16 VK PDA — seeds validated. The handler manually checks
    /// that the account is initialized before allowing the transition to Voting
    /// in production builds. In dev builds the check is skipped for
    /// `anchor test` compatibility (mirrors the pattern in cast_vote.rs).
    #[account(seeds = [SEED_VK], bump)]
    pub vk_account: UncheckedAccount<'info>,
}
