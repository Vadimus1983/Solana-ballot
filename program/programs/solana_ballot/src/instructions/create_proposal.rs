use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::*;

fn keccak256(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

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

    let clock = Clock::get()?;

    // Reject start times that are more than MAX_VOTING_START_DRIFT seconds in the past.
    // A small drift allowance accommodates transaction latency and clock skew; an
    // arbitrarily stale voting_start (e.g. epoch 0) would be a configuration error.
    require!(
        voting_start >= clock.unix_timestamp - MAX_VOTING_START_DRIFT,
        BallotError::InvalidVotingPeriod
    );

    // Prevent proposals for periods that have already ended.
    require!(voting_end > clock.unix_timestamp, BallotError::InvalidVotingPeriod);

    let title_seed = keccak256(title.as_bytes());

    let proposal_key = ctx.accounts.proposal.key();
    let proposal = &mut ctx.accounts.proposal;

    proposal.id            = proposal_key.to_bytes();
    proposal.admin         = ctx.accounts.admin.key();
    proposal.title         = title;
    proposal.description   = description;
    proposal.title_seed    = title_seed;
    proposal.voting_start  = voting_start;
    proposal.voting_end    = voting_end;
    proposal.status        = ProposalStatus::Registration;
    proposal.merkle_root   = [0u8; HASH_SIZE];
    proposal.merkle_frontier = [[0u8; HASH_SIZE]; MERKLE_DEPTH];
    proposal.voter_count   = 0;
    proposal.vote_count    = 0;
    proposal.yes_count     = 0;
    proposal.no_count      = 0;
    proposal.bump          = ctx.bumps.proposal;

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
            &keccak256(title.as_bytes()),
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}
