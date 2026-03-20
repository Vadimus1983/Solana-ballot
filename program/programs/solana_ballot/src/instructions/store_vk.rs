use anchor_lang::prelude::*;
use crate::state::vk::VerificationKeyAccount;
use crate::constants::*;

/// Stores the Groth16 prepared verifying key on-chain.
///
/// Must be called by the admin once after the trusted setup ceremony produces
/// the combined circuit's verification key. After this, `cast_vote` will perform
/// real ZK proof verification.
///
/// # When to call
///
/// 1. Run the trusted setup for the combined ZK circuit (off-chain)
/// 2. Serialize the verification key to the byte format expected by `groth16-solana`
/// 3. Call this instruction with the serialized VK bytes
///
/// # Parameters
///
/// - `vk_alpha_g1` — G1 point: vk.alpha (64 bytes, big-endian uncompressed)
/// - `vk_beta_g2`  — G2 point: vk.beta  (128 bytes, big-endian uncompressed)
/// - `vk_gamma_g2` — G2 point: vk.gamma (128 bytes, big-endian uncompressed)
/// - `vk_delta_g2` — G2 point: vk.delta (128 bytes, big-endian uncompressed)
/// - `vk_ic`       — IC points: vk.ic[0..=NUM_PUBLIC_INPUTS] (5 × 64 bytes)
///                   vk_ic[0] is the constant term; vk_ic[1..=4] correspond to
///                   nullifier, proposal_id, merkle_root, vote_commitment
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
    /// The admin who deploys this program and runs the trusted setup
    #[account(mut)]
    pub admin: Signer<'info>,

    /// PDA that holds the verifying key — one per program deployment
    #[account(
        init,
        payer = admin,
        space = VerificationKeyAccount::LEN,
        seeds = [SEED_VK],
        bump
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    pub system_program: Program<'info, System>,
}
