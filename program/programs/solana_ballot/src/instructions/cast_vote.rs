use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{VoteRecord, NullifierRecord};
use crate::error::BallotError;
use crate::constants::*;

pub fn handler(
    ctx: Context<CastVote>,
    // ZK proof fields — stub for now, real Groth16 verification added in Phase 2
    _proof_a: [u8; PROOF_A_SIZE],
    _proof_b: [u8; PROOF_B_SIZE],
    _proof_c: [u8; PROOF_C_SIZE],
    nullifier: [u8; HASH_SIZE],
    vote_commitment: [u8; HASH_SIZE],
    merkle_root: [u8; HASH_SIZE],
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    require!(
        proposal.status == ProposalStatus::Voting,
        BallotError::VotingNotOpen
    );
    require!(
        clock.unix_timestamp >= proposal.voting_start,
        BallotError::VotingNotOpen
    );
    require!(
        clock.unix_timestamp <= proposal.voting_end,
        BallotError::VotingNotOpen
    );
    require!(
        merkle_root == proposal.merkle_root,
        BallotError::MerkleRootMismatch
    );

    // TODO Phase 2: verify Groth16 proof here using groth16-solana
    // groth16_verify(&proof_a, &proof_b, &proof_c, &[merkle_root, nullifier, vote_commitment])?;

    let nullifier_record = &mut ctx.accounts.nullifier_record;
    nullifier_record.proposal_id = proposal.id;
    nullifier_record.nullifier = nullifier;
    nullifier_record.bump = ctx.bumps.nullifier_record;

    let vote_record = &mut ctx.accounts.vote_record;
    vote_record.proposal_id = proposal.id;
    vote_record.vote_commitment = vote_commitment;
    vote_record.revealed = false;
    vote_record.vote = 0;
    vote_record.bump = ctx.bumps.vote_record;

    proposal.vote_count += 1;

    msg!("Vote cast. Total votes: {}", proposal.vote_count);
    Ok(())
}

#[derive(Accounts)]
#[instruction(
    _proof_a: [u8; PROOF_A_SIZE],
    _proof_b: [u8; PROOF_B_SIZE],
    _proof_c: [u8; PROOF_C_SIZE],
    nullifier: [u8; HASH_SIZE],
    vote_commitment: [u8; HASH_SIZE],
)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    // Nullifier account — creating it proves nullifier is fresh
    // If it already exists, init will fail → prevents double voting
    #[account(
        init,
        payer = voter,
        space = NullifierRecord::LEN,
        seeds = [SEED_NULLIFIER, proposal.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    #[account(
        init,
        payer = voter,
        space = VoteRecord::LEN,
        seeds = [SEED_VOTE, proposal.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    pub system_program: Program<'info, System>,
}
