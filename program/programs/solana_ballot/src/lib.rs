use anchor_lang::prelude::*;

declare_id!("2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ");

#[program]
pub mod solana_ballot {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Solana Ballot program initialized");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
