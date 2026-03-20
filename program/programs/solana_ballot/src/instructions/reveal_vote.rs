use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::VoteRecord;
use crate::error::BallotError;
use crate::constants::*;
use crate::merkle::poseidon2;

pub fn handler(ctx: Context<RevealVote>, vote: u8, randomness: [u8; HASH_SIZE]) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let vote_record = &mut ctx.accounts.vote_record;

    require!(
        proposal.status == ProposalStatus::Closed,
        BallotError::VotingStillOpen
    );
    require!(!vote_record.revealed, BallotError::AlreadyRevealed);
    require!(vote == 0 || vote == 1, BallotError::InvalidProof);

    // The commitment check is the sole authorization for revealing.
    // Only someone who knows the private (vote, randomness) pair can open the
    // commitment correctly — no on-chain link to the voter's wallet is needed or stored.
    //
    // `vote` is encoded as a 32-byte big-endian field element (last byte = vote,
    // upper 31 bytes = 0). This matches the BN254 scalar representation used in
    // the combined ZK circuit (Circom field element, big-endian byte encoding).
    let mut vote_bytes = [0u8; HASH_SIZE];
    vote_bytes[HASH_SIZE - 1] = vote;
    let computed = poseidon2(&vote_bytes, &randomness)?;
    require!(computed == vote_record.vote_commitment, BallotError::CommitmentMismatch);

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
    /// Any account may reveal a vote — anonymity is preserved because no voter
    /// identity is stored on-chain. The commitment check is the authorization.
    #[account(mut)]
    pub revealer: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    // Seeds include the nullifier so each voter has a unique, unlinkable record.
    // `proposal_id` guards against cross-proposal replay.
    #[account(
        mut,
        seeds = [SEED_VOTE, proposal.key().as_ref(), vote_record.nullifier.as_ref()],
        bump = vote_record.bump,
        constraint = vote_record.proposal_id == proposal.id @ BallotError::Unauthorized,
    )]
    pub vote_record: Account<'info, VoteRecord>,
}
