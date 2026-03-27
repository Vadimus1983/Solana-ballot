use anchor_lang::prelude::*;
use crate::state::vk::VerificationKeyAccount;
use crate::state::program_config::ProgramConfig;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::*;
use super::store_vk::{validate_g1, validate_g2};

/// Replaces the Groth16 verifying key for a proposal that is still in the
/// `Registration` phase.
///
/// This is a safety valve for the case where an incorrect VK was uploaded
/// via `store_vk` — e.g. a test key, a key generated from the wrong circuit,
/// or a key with wrong public-input ordering. Once `open_voting` is called
/// the VK is permanently frozen; no replacement is possible after that point.
///
/// # Guards
/// - Caller must be the program authority (same as `store_vk`).
/// - Proposal must be in `Registration` status.
/// - The VK account must already be initialized — use `store_vk` for
///   first-time uploads.
/// - New key components must pass the same BN254 field-element range
///   validation applied by `store_vk`.
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<ReplaceVk>,
    vk_alpha_g1: [u8; PROOF_A_SIZE],
    vk_beta_g2: [u8; PROOF_B_SIZE],
    vk_gamma_g2: [u8; PROOF_B_SIZE],
    vk_delta_g2: [u8; PROOF_B_SIZE],
    vk_ic: [[u8; PROOF_A_SIZE]; NUM_PUBLIC_INPUTS + 1],
) -> Result<()> {
    let proposal  = &ctx.accounts.proposal;
    let vk_account = &mut ctx.accounts.vk_account;

    // Must have been initialized first — direct callers to store_vk otherwise.
    require!(vk_account.is_initialized, BallotError::VkNotInitialized);

    // Replacement is only safe before the Merkle root is frozen by open_voting.
    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Run the same BN254 field-element range validation as store_vk.
    require!(validate_g1(&vk_alpha_g1), BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_beta_g2),  BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_gamma_g2), BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_delta_g2), BallotError::InvalidVerificationKey);
    for ic_elem in &vk_ic {
        require!(validate_g1(ic_elem), BallotError::InvalidVerificationKey);
    }

    vk_account.vk_alpha_g1 = vk_alpha_g1;
    vk_account.vk_beta_g2  = vk_beta_g2;
    vk_account.vk_gamma_g2 = vk_gamma_g2;
    vk_account.vk_delta_g2 = vk_delta_g2;
    vk_account.vk_ic       = vk_ic;

    msg!("Verification key replaced. Previous key overwritten.");
    Ok(())
}

#[derive(Accounts)]
pub struct ReplaceVk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Program config — verifies the caller is the program authority.
    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
        constraint = program_config.authority == admin.key() @ BallotError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// The proposal whose VK is being replaced.
    /// Heap-boxed to keep the BPF stack frame within the 4 096-byte limit.
    /// `has_one = admin` ensures only the proposal's creator can replace its VK;
    /// `seeds` + `bump` verify this is the genuine program PDA.
    #[account(
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, Proposal>>,

    /// Per-proposal VK PDA — must already exist (created by store_vk).
    #[account(
        mut,
        seeds = [SEED_VK, proposal.key().as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}
