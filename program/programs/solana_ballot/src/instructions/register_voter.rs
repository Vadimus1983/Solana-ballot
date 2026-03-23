use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::CommitmentRecord;
use crate::error::BallotError;
use crate::constants::*;
use crate::merkle::insert_leaf;

pub fn handler(ctx: Context<RegisterVoter>, commitment: [u8; HASH_SIZE]) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Reject zero and out-of-range commitments.
    // - Zero wastes a Merkle leaf: no one can produce Poseidon(secret,randomness)=0
    //   and the ZK circuit would reject the proof anyway.
    // - Values >= BN254_PRIME are not valid field elements and would cause the
    //   ZK circuit to reject any proof for that slot.
    // Both checks use big-endian byte comparison (array PartialOrd is lexicographic,
    // which equals numeric order for big-endian byte arrays).
    require!(
        commitment != [0u8; HASH_SIZE] && commitment < BN254_PRIME,
        BallotError::InvalidCommitment
    );

    // commitment_record is initialized via `init`. If the same commitment has
    // already been registered for this proposal, `init` fails because the PDA
    // already exists — preventing Merkle tree slot exhaustion via duplicates.
    //
    // The commitment value is stored in the account so close_commitment_record
    // can derive and verify the PDA address without the caller supplying it
    // from off-chain sources, enabling fully permissionless cleanup.
    ctx.accounts.commitment_record.commitment = commitment;
    ctx.accounts.commitment_record.bump = ctx.bumps.commitment_record;

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
    proposal.voter_count = proposal.voter_count.saturating_add(1);

    emit!(VoterRegistered {
        proposal_id: proposal.id,
        commitment,
        leaf_index,  // captured before saturating_add, not recomputed after
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
#[instruction(commitment: [u8; HASH_SIZE])]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    // Uniqueness guard: creating this PDA proves the commitment is fresh for
    // this proposal. A second call with the same commitment bytes fails because
    // the account already exists, preventing duplicate tree insertions.
    #[account(
        init,
        payer = admin,
        space = CommitmentRecord::LEN,
        seeds = [SEED_COMMITMENT, proposal.key().as_ref(), commitment.as_ref()],
        bump,
    )]
    pub commitment_record: Account<'info, CommitmentRecord>,

    pub system_program: Program<'info, System>,
}
