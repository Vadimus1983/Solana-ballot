use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::VoteRecord;
use crate::error::BallotError;
use crate::constants::*;

pub fn handler(ctx: Context<RevealVote>, vote: u8, _randomness: [u8; HASH_SIZE]) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let vote_record = &mut ctx.accounts.vote_record;

    require!(
        proposal.status == ProposalStatus::Closed,
        BallotError::VotingStillOpen
    );
    require!(!vote_record.revealed, BallotError::AlreadyRevealed);
    require!(vote == 0 || vote == 1, BallotError::InvalidProof);

    // TODO Phase 2: verify Poseidon(vote, randomness) == vote_record.vote_commitment
    // For now accept the reveal directly — ZK commitment check added later

    vote_record.revealed = true;
    vote_record.vote = vote;

    if vote == 1 {
        proposal.yes_count += 1;
    } else {
        proposal.no_count += 1;
    }

    msg!("Vote revealed. Yes: {}, No: {}", proposal.yes_count, proposal.no_count);
    Ok(())
}

#[derive(Accounts)]
pub struct RevealVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub vote_record: Account<'info, VoteRecord>,
}
