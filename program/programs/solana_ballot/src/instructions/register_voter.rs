use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::error::BallotError;
use crate::constants::*;
use crate::merkle::insert_leaf;

pub fn handler(ctx: Context<RegisterVoter>, commitment: [u8; HASH_SIZE]) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Insert commitment as a new leaf in the incremental Merkle tree.
    // voter_count before incrementing is the index of the new leaf.
    // Returns the new Merkle root which is stored on-chain and verified in cast_vote.
    let leaf_index = proposal.voter_count; // copy before mutable borrow
    let new_root = insert_leaf(
        &mut proposal.merkle_frontier,
        commitment,
        leaf_index,
    )?;
    proposal.merkle_root = new_root;
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
