use anchor_lang::prelude::*;
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::PendingCommitmentRecord;
use crate::error::BallotError;
use crate::constants::*;

/// Voter-only step of the two-phase registration protocol.
///
/// The voter calls this instruction (signing with their own wallet) to record
/// their Poseidon commitment `C = Poseidon(secret_key, randomness)` in a
/// `PendingCommitmentRecord` PDA seeded by `(proposal, voter_pubkey)`.
///
/// Because the PDA address depends on the voter's public key, it is impossible
/// for the admin to substitute a different commitment during the subsequent
/// `register_voter` call: the admin must pass exactly the PDA that was created
/// by this voter's signing key, which contains exactly the commitment the voter
/// deposited here.
///
/// The admin then calls `register_voter`, which reads the commitment from this
/// account, inserts it into the eligibility Merkle tree, and closes this account
/// (returning the rent-exempt lamports to the voter).
pub fn handler(ctx: Context<RegisterCommitment>, commitment: [u8; HASH_SIZE]) -> Result<()> {
    require!(
        ctx.accounts.proposal.status == ProposalStatus::Registration,
        BallotError::NotInRegistration
    );

    // Reject zero and out-of-range commitments early (same checks as register_voter).
    require!(
        commitment != [0u8; HASH_SIZE] && commitment < BN254_PRIME,
        BallotError::InvalidCommitment
    );

    // init_if_needed defence: a zeroed commitment field means the account is
    // freshly allocated (either on first call or after a squatting recovery).
    // A non-zero value means the voter already submitted a pending commitment.
    require!(
        ctx.accounts.pending_commitment.commitment == [0u8; HASH_SIZE],
        BallotError::CommitmentAlreadyRegistered
    );

    ctx.accounts.pending_commitment.commitment = commitment;
    ctx.accounts.pending_commitment.bump = ctx.bumps.pending_commitment;

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterCommitment<'info> {
    /// The voter submitting their commitment. Must sign so the PDA is
    /// cryptographically bound to this wallet's public key.
    #[account(mut)]
    pub voter: Signer<'info>,

    /// Proposal must be in Registration phase.
    /// Heap-boxed to keep the BPF stack frame within Solana's 4 096-byte limit.
    #[account(
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, Proposal>>,

    /// Stores the voter's commitment until the admin calls `register_voter`.
    /// `init_if_needed` recovers squatted PDAs; genuine re-submissions are caught
    /// by the handler's `CommitmentAlreadyRegistered` guard above.
    /// Seeded by `(proposal, voter)` — embeds the voter's identity in the PDA.
    #[account(
        init_if_needed,
        payer = voter,
        space = PendingCommitmentRecord::LEN,
        seeds = [SEED_PENDING_COMMITMENT, proposal.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub pending_commitment: Account<'info, PendingCommitmentRecord>,

    pub system_program: Program<'info, System>,
}
