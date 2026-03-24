use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{CommitmentRecord, VoterRecord, PendingCommitmentRecord};
use crate::error::BallotError;
use crate::constants::*;
use crate::merkle::insert_leaf;

pub fn handler(ctx: Context<RegisterVoter>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Read the commitment the voter deposited in register_commitment.
    // The PendingCommitmentRecord is closed by the `close = voter` constraint
    // after this instruction completes, so the commitment is read here before
    // the account is reclaimed.
    let commitment = ctx.accounts.pending_commitment.commitment;

    // Guard against pre-funded PDA squatting (init_if_needed defence).
    require!(
        ctx.accounts.commitment_record.commitment == [0u8; HASH_SIZE],
        BallotError::CommitmentAlreadyRegistered
    );
    require!(
        !ctx.accounts.voter_record.is_initialized,
        BallotError::VoterAlreadyRegistered
    );

    ctx.accounts.commitment_record.commitment = commitment;
    ctx.accounts.commitment_record.voter = ctx.accounts.voter.key();
    ctx.accounts.commitment_record.bump = ctx.bumps.commitment_record;

    ctx.accounts.voter_record.is_initialized = true;
    ctx.accounts.voter_record.bump = ctx.bumps.voter_record;

    // Insert commitment as a new leaf in the incremental Merkle tree.
    // voter_count before incrementing is the index of the new leaf.
    let leaf_index = proposal.voter_count;
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
        leaf_index,
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

    /// The voter being registered. Not required to sign here — their commitment
    /// was already bound to this pubkey when they called `register_commitment`
    /// (which required their signature). The admin cannot swap in a different
    /// voter pubkey without also producing a different `pending_commitment` PDA,
    /// which must have been created by that voter's signature.
    ///
    /// Marked `mut` so it can receive the `pending_commitment` rent refund.
    /// CHECK: pubkey is verified via seeds on `pending_commitment` and `voter_record`.
    #[account(mut)]
    pub voter: UncheckedAccount<'info>,

    /// Heap-boxed so the ~1 200-byte Proposal struct is allocated on the heap
    /// rather than the BPF stack, keeping the frame within Solana's 4 096-byte limit.
    #[account(
        mut,
        has_one = admin @ BallotError::Unauthorized,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, Proposal>>,

    /// The PendingCommitmentRecord created by the voter in `register_commitment`.
    /// Closed here — rent returned to `voter`. Reading `.commitment` before
    /// closure is the canonical way to hand off voter-controlled data to the admin.
    ///
    /// Must appear BEFORE `commitment_record` in this struct because Anchor
    /// evaluates seeds constraints top-to-bottom: `commitment_record` seeds
    /// reference `pending_commitment.commitment`.
    #[account(
        mut,
        seeds = [SEED_PENDING_COMMITMENT, proposal.key().as_ref(), voter.key().as_ref()],
        bump = pending_commitment.bump,
        close = voter,
    )]
    pub pending_commitment: Account<'info, PendingCommitmentRecord>,

    /// Commitment uniqueness guard. `init_if_needed` recovers a pre-funded (squatted)
    /// PDA transparently; genuine duplicate calls are caught by the handler's
    /// `CommitmentAlreadyRegistered` guard on `commitment_record.commitment`.
    #[account(
        init_if_needed,
        payer = admin,
        space = CommitmentRecord::LEN,
        seeds = [SEED_COMMITMENT, proposal.key().as_ref(), pending_commitment.commitment.as_ref()],
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
