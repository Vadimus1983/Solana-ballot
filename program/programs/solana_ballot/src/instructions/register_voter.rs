use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{CommitmentRecord, VoterRecord};
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

    // Guard against pre-funded PDA squatting (init_if_needed defence).
    //
    // `init_if_needed` recovers a squatted (pre-funded) PDA by calling
    // `allocate`+`assign`, leaving all data zeroed. On a genuine second-call
    // attempt the fields are already set to non-zero/true values, so the
    // guards below fire before any state is written.
    require!(
        ctx.accounts.commitment_record.commitment == [0u8; HASH_SIZE],
        BallotError::CommitmentAlreadyRegistered
    );
    require!(
        !ctx.accounts.voter_record.is_initialized,
        BallotError::VoterAlreadyRegistered
    );

    // Store the commitment and voter pubkey so close_commitment_record can
    // derive and verify both PDAs permissionlessly without off-chain data.
    ctx.accounts.commitment_record.commitment = commitment;
    ctx.accounts.commitment_record.voter = ctx.accounts.voter.key();
    ctx.accounts.commitment_record.bump = ctx.bumps.commitment_record;

    ctx.accounts.voter_record.is_initialized = true;
    ctx.accounts.voter_record.bump = ctx.bumps.voter_record;

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

    /// The voter being registered. Must co-sign so the admin cannot register a
    /// different commitment under the same voter identity without the voter's key,
    /// and so one Solana identity maps to at most one commitment per proposal.
    pub voter: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    /// Commitment uniqueness guard. `init_if_needed` recovers a pre-funded (squatted)
    /// PDA transparently; genuine duplicate calls are caught by the handler's
    /// `CommitmentAlreadyRegistered` guard on `commitment_record.commitment`.
    #[account(
        init_if_needed,
        payer = admin,
        space = CommitmentRecord::LEN,
        seeds = [SEED_COMMITMENT, proposal.key().as_ref(), commitment.as_ref()],
        bump,
    )]
    pub commitment_record: Account<'info, CommitmentRecord>,

    /// Identity uniqueness guard. `init_if_needed` recovers a pre-funded (squatted)
    /// PDA transparently; genuine double-registration attempts are caught by the
    /// handler's `VoterAlreadyRegistered` guard on `voter_record.is_initialized`.
    #[account(
        init_if_needed,
        payer = admin,
        space = VoterRecord::LEN,
        seeds = [SEED_VOTER, proposal.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub voter_record: Account<'info, VoterRecord>,

    pub system_program: Program<'info, System>,
}
