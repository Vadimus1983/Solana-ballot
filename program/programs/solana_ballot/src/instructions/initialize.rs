use anchor_lang::prelude::*;
use crate::state::program_config::ProgramConfig;
use crate::constants::{SEED_CONFIG, PROGRAM_AUTHORITY};
use crate::error::BallotError;

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    // The `init` constraint on `program_config` ensures this can only be called
    // once — no second caller can claim authority after the first initialization.
    // In production, run this instruction in the same transaction as `anchor deploy`
    // to close the front-running window.
    //
    // PROGRAM_AUTHORITY (constants.rs) is an additional compile-time guard:
    // when set to a non-zero pubkey, only that specific wallet may initialize.
    // The default (all-zeros) disables the check for testing and local development.
    let expected = Pubkey::new_from_array(PROGRAM_AUTHORITY);
    if expected != Pubkey::default() {
        require!(
            ctx.accounts.admin.key() == expected,
            BallotError::Unauthorized
        );
    }

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
