use anchor_lang::prelude::*;
use crate::state::proposal::Proposal;
use crate::state::vk::VerificationKeyAccount;
use crate::error::BallotError;
use crate::constants::*;

/// Closes the per-proposal VerificationKeyAccount and returns its rent to the admin.
///
/// The VK account is only needed during the Voting phase. Once the proposal
/// reaches a terminal state (Finalized or Expired) the account has no further
/// purpose, and its ~0.00631 SOL rent deposit would otherwise be permanently
/// stranded.
///
/// Gated on `proposal.status.is_terminal()` so the VK cannot be closed while
/// votes are still being verified — removing it mid-election would brick
/// `cast_vote`, which requires the account to be present and initialized.
pub fn handler(_ctx: Context<CloseVk>) -> Result<()> {
    // All work is performed by the `close = admin` constraint on `vk_account`.
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Heap-boxed to keep the BPF stack frame within Solana's 4 096-byte limit.
    #[account(
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
        constraint = proposal.status.is_terminal() @ BallotError::NotFinalized,
    )]
    pub proposal: Box<Account<'info, Proposal>>,

    /// The VK PDA to close. Scoped to this proposal by its seeds.
    /// Rent is returned to `admin`.
    #[account(
        mut,
        seeds = [SEED_VK, proposal.key().as_ref()],
        bump = vk_account.bump,
        close = admin,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}
