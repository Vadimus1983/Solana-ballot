use anchor_lang::prelude::*;

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    msg!("Solana Ballot initialized by {:?}", ctx.accounts.admin.key());
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}
