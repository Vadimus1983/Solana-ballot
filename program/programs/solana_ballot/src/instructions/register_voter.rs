use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::*;

pub fn handler(ctx: Context<RegisterVoter>, commitment: [u8; HASH_SIZE]) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::VotingAlreadyClosed
    );

    // Stub merkle root update: XOR current root with new commitment
    // TODO Phase 2: replace with proper incremental Merkle tree
    for i in 0..HASH_SIZE {
        proposal.merkle_root[i] ^= commitment[i];
    }
    proposal.voter_count += 1;

    emit!(VoterRegistered {
        proposal_id: proposal.id,
        commitment,
        leaf_index: proposal.voter_count - 1,
    });

    msg!("Voter registered. Total voters: {}", proposal.voter_count);
    Ok(())
}

#[event]
pub struct VoterRegistered {
    pub proposal_id: [u8; HASH_SIZE],
    pub commitment: [u8; HASH_SIZE],
    pub leaf_index: u64,
}

#[derive(Accounts)]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}
