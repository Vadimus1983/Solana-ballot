use anchor_lang::prelude::*;
use crate::state::program_config::ProgramConfig;
use crate::constants::SEED_CONFIG;

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    // The `init` constraint on `program_config` ensures this can only be called
    // once — no second caller can claim authority after the first initialization.
    // In production, run this instruction in the same transaction as `anchor deploy`
    // to prevent any front-running window.
    let config = &mut ctx.accounts.program_config;
    config.authority = ctx.accounts.admin.key();
    config.bump = ctx.bumps.program_config;

    msg!("Solana Ballot initialized. Authority: {}", config.authority);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramConfig::LEN,
        seeds = [SEED_CONFIG],
        bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}
