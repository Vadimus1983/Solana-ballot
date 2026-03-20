use anchor_lang::prelude::*;
use crate::state::vk::VerificationKeyAccount;
use crate::state::program_config::ProgramConfig;
use crate::error::BallotError;
use crate::constants::*;

/// Stores (or updates) the Groth16 prepared verifying key on-chain.
///
/// Gated to the program authority stored in `ProgramConfig` (set by `initialize`).
/// Using `init_if_needed` allows the authority to replace the VK after a
/// re-ceremony without redeploying the program.
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
    /// `init_if_needed` allows the authority to update the VK after a re-ceremony.
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
