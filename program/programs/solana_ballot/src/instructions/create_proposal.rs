use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::*;

pub fn handler(
    ctx: Context<CreateProposal>,
    title: String,
    description: String,
    voting_start: i64,
    voting_end: i64,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, BallotError::TitleTooLong);
    require!(description.len() <= MAX_DESCRIPTION_LEN, BallotError::DescriptionTooLong);
    require!(voting_end > voting_start, BallotError::InvalidVotingPeriod);

    // Capture key before mutable borrow
    let proposal_key = ctx.accounts.proposal.key();
    let proposal = &mut ctx.accounts.proposal;

    // Use the PDA pubkey as proposal ID — unique by construction (admin + title seeds)
    proposal.id = proposal_key.to_bytes();
    proposal.admin = ctx.accounts.admin.key();
    proposal.title = title;
    proposal.description = description;
    proposal.voting_start = voting_start;
    proposal.voting_end = voting_end;
    proposal.status = ProposalStatus::Registration;
    proposal.merkle_root = [0u8; HASH_SIZE];
    proposal.voter_count = 0;
    proposal.vote_count = 0;
    proposal.yes_count = 0;
    proposal.no_count = 0;
    proposal.bump = ctx.bumps.proposal;

    msg!("Proposal created: {:?}", proposal.title);
    Ok(())
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Proposal::LEN,
        seeds = [
            SEED_PROPOSAL,
            admin.key().as_ref(),
            &title.as_bytes()[..title.len().min(MAX_SEED_LEN)],
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}
