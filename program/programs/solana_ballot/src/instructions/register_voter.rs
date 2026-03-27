use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::root_history::RootHistoryAccount;
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

    // Record the new root in the ring buffer so cast_vote can accept proofs
    // generated against any root from the last ROOT_HISTORY_SIZE registrations.
    {
        let mut rh = ctx.accounts.root_history_account.load_mut()?;
        let idx = (rh.root_history_index as usize) % ROOT_HISTORY_SIZE;
        rh.root_history[idx] = new_root;
        rh.root_history_index = rh.root_history_index.wrapping_add(1);
    }

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
    /// `SystemAccount` enforces owner == System Program, making the implicit
    /// PDA-seed binding explicit and preventing rent from flowing to a
    /// program-owned account via the `close = voter` constraint on
    /// `pending_commitment`.
    #[account(mut)]
    pub voter: SystemAccount<'info>,

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
    ///
    /// Squatting defence: if an attacker pre-funds this PDA address (a system
    /// account with lamports but no program data), `init_if_needed` calls
    /// `allocate`+`assign`, zeroing all data. The zero-commitment guard then
    /// evaluates correctly against the freshly zeroed account. An attacker
    /// cannot pre-write program-owned data without invoking this program, and
    /// any such prior write would have set `commitment` to a non-zero value,
    /// causing the `CommitmentAlreadyRegistered` check to fire.
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
    ///
    /// Squatting defence: same reasoning as `commitment_record` above. A pre-funded
    /// system account is recovered by `init_if_needed` (data zeroed), leaving
    /// `is_initialized = false`. A previously program-written account would have
    /// `is_initialized = true`, correctly triggering `VoterAlreadyRegistered`.
    #[account(
        init_if_needed,
        payer = admin,
        space = VoterRecord::LEN,
        seeds = [SEED_VOTER, proposal.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub voter_record: Account<'info, VoterRecord>,

    /// Root history ring buffer for this proposal. Updated on each leaf insertion
    /// so cast_vote can accept proofs generated against any recent root.
    #[account(
        mut,
        seeds = [SEED_ROOT_HISTORY, proposal.key().as_ref()],
        bump = root_history_account.load()?.bump,
    )]
    pub root_history_account: AccountLoader<'info, RootHistoryAccount>,

    pub system_program: Program<'info, System>,
}
