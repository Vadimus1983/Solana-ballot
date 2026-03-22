use anchor_lang::prelude::*;
use crate::state::vk::VerificationKeyAccount;
use crate::state::program_config::ProgramConfig;
use crate::error::BallotError;
use crate::constants::*;

/// Stores the Groth16 prepared verifying key on-chain.
///
/// Gated to the program authority stored in `ProgramConfig` (set by `initialize`).
///
/// Uses `init_if_needed` so that a pre-funded (squatted) PDA — an attacker sending
/// lamports to the deterministic VK address before this instruction is called — does
/// not block initialization. `init_if_needed` calls `allocate`+`assign` when the
/// account already has lamports but no data, recovering it transparently.
///
/// The single-write invariant previously provided by `init` is enforced explicitly:
/// the handler rejects any call where `is_initialized` is already true, preventing
/// mid-election key replacement.
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<StoreVk>,
    vk_alpha_g1: [u8; PROOF_A_SIZE],
    vk_beta_g2: [u8; PROOF_B_SIZE],
    vk_gamma_g2: [u8; PROOF_B_SIZE],
    vk_delta_g2: [u8; PROOF_B_SIZE],
    vk_ic: [[u8; PROOF_A_SIZE]; NUM_PUBLIC_INPUTS + 1],
) -> Result<()> {
    let vk_account = &mut ctx.accounts.vk_account;

    // Enforce single-write: reject if the VK was already stored.
    // This replaces the guarantee previously provided by `init` alone.
    require!(!vk_account.is_initialized, BallotError::VkAlreadyInitialized);

    vk_account.admin = ctx.accounts.admin.key();
    vk_account.vk_alpha_g1 = vk_alpha_g1;
    vk_account.vk_beta_g2 = vk_beta_g2;
    vk_account.vk_gamma_g2 = vk_gamma_g2;
    vk_account.vk_delta_g2 = vk_delta_g2;
    vk_account.vk_ic = vk_ic;
    vk_account.is_initialized = true;
    vk_account.bump = ctx.bumps.vk_account;

    msg!("Verification key stored. ZK proof verification is now active.");
    Ok(())
}

#[derive(Accounts)]
pub struct StoreVk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Program config created by `initialize`.
    /// Verifies the caller is the program authority — prevents first-caller-wins.
    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
        constraint = program_config.authority == admin.key() @ BallotError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// PDA holding the verifying key — one per program deployment.
    /// `init_if_needed` recovers a squatted (pre-funded) PDA without error.
    /// The single-write invariant is enforced by the `is_initialized` check
    /// in the handler, preventing mid-election key replacement.
    #[account(
        init_if_needed,
        payer = admin,
        space = VerificationKeyAccount::LEN,
        seeds = [SEED_VK],
        bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    pub system_program: Program<'info, System>,
}
