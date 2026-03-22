use anchor_lang::prelude::*;
#[cfg(not(feature = "dev"))]
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::vote::{VoteRecord, NullifierRecord};
use crate::state::vk::VerificationKeyAccount;
use crate::error::BallotError;
use crate::constants::*;

/// Groth16 proof verification in a separate stack frame.
///
/// Marked `#[inline(never)]` to ensure the compiler allocates a separate stack
/// frame for this function. The Groth16Verifyingkey and public_inputs together
/// would push cast_vote's frame over Solana's 4096-byte BPF stack limit.
///
/// Only called in production builds; gated with `#[cfg(not(feature = "dev"))]`
/// at the call site to suppress dead-code warnings in dev.
#[cfg(not(feature = "dev"))]
#[inline(never)]
fn verify_groth16(
    proof_a: &[u8; PROOF_A_SIZE],
    proof_b: &[u8; PROOF_B_SIZE],
    proof_c: &[u8; PROOF_C_SIZE],
    nullifier: &[u8; HASH_SIZE],
    proposal_id: &[u8; HASH_SIZE],
    merkle_root: &[u8; HASH_SIZE],
    vote_commitment: &[u8; HASH_SIZE],
    vk: &VerificationKeyAccount,
) -> Result<()> {
    let pvk = Groth16Verifyingkey {
        nr_pubinputs: NUM_PUBLIC_INPUTS,
        vk_alpha_g1: vk.vk_alpha_g1,
        vk_beta_g2: vk.vk_beta_g2,
        vk_gamme_g2: vk.vk_gamma_g2,
        vk_delta_g2: vk.vk_delta_g2,
        vk_ic: &vk.vk_ic,
    };

    // Public inputs in the order allocated in the combined circuit:
    // nullifier, proposal_id, merkle_root, vote_commitment
    let public_inputs: [[u8; HASH_SIZE]; NUM_PUBLIC_INPUTS] = [
        *nullifier,
        *proposal_id,
        *merkle_root,
        *vote_commitment,
    ];

    let mut verifier = Groth16Verifier::new(proof_a, proof_b, proof_c, &public_inputs, &pvk)
        .map_err(|_| error!(BallotError::InvalidProof))?;

    verifier.verify().map_err(|_| error!(BallotError::InvalidProof))
}

/// Cast a private ZK vote.
///
/// # Proof encoding
///
/// `proof` is the three Groth16 components concatenated:
///   `proof_a (64 B) || proof_b (128 B) || proof_c (64 B)` = 256 bytes total.
///
/// Passing as `Vec<u8>` keeps the Anchor dispatcher's BPF stack frame within the
/// 4096-byte limit: Borsh heap-allocates the bytes; only a 24-byte Vec header
/// (ptr + len + cap) lives on the stack instead of 256 bytes.
pub fn handler(
    ctx: Context<CastVote>,
    proof: Vec<u8>,
    nullifier: [u8; HASH_SIZE],
    vote_commitment: [u8; HASH_SIZE],
) -> Result<()> {
    require!(
        proof.len() == PROOF_A_SIZE + PROOF_B_SIZE + PROOF_C_SIZE,
        BallotError::InvalidProof
    );

    let proof_a: &[u8; PROOF_A_SIZE] = proof[..PROOF_A_SIZE]
        .try_into()
        .map_err(|_| error!(BallotError::InvalidProof))?;
    let proof_b: &[u8; PROOF_B_SIZE] = proof[PROOF_A_SIZE..PROOF_A_SIZE + PROOF_B_SIZE]
        .try_into()
        .map_err(|_| error!(BallotError::InvalidProof))?;
    let proof_c: &[u8; PROOF_C_SIZE] = proof[PROOF_A_SIZE + PROOF_B_SIZE..]
        .try_into()
        .map_err(|_| error!(BallotError::InvalidProof))?;

    // nullifier must be a non-zero BN254 field element.
    //
    // In production the Groth16 verifier enforces this implicitly, but
    // explicit validation provides defence-in-depth: a zero or out-of-range
    // nullifier accepted in dev mode (or if the VK check ever regressed)
    // would produce an unreachable NullifierRecord tied to an invalid ZK state.
    require!(
        nullifier != [0u8; HASH_SIZE] && nullifier < BN254_PRIME,
        BallotError::InvalidProof
    );

    // vote_commitment must be a non-zero BN254 field element.
    //
    // Poseidon always outputs a non-zero field element strictly less than
    // BN254_PRIME. An all-zero commitment can never be the output of
    // Poseidon(vote, randomness), so reveal_vote would always fail with
    // CommitmentMismatch — permanently stranding the vote: vote_count is
    // incremented but yes_count + no_count can never reach it, delaying
    // finalization until the 24-hour grace period expires.
    //
    // Out-of-range commitments (≥ BN254_PRIME) are equally unrevealable
    // because the ZK circuit operates in the BN254 scalar field.
    require!(
        vote_commitment != [0u8; HASH_SIZE] && vote_commitment < BN254_PRIME,
        BallotError::InvalidCommitment
    );

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
    // Strict less-than keeps the boundary consistent with open_voting
    // (!voting_has_ended = now < voting_end) and close_voting (now >= voting_end).
    // Using <= would allow a vote and a close in the same slot at now == voting_end,
    // letting transaction ordering within a slot silently drop a valid vote.
    require!(
        clock.unix_timestamp < proposal.voting_end,
        BallotError::VotingNotOpen
    );

    // ── Groth16 proof verification ────────────────────────────────────────────
    //
    // The combined ZK circuit proves simultaneously:
    //   1. nullifier = Poseidon(secret_key, proposal_id)      — no double voting
    //   2. vote_commitment = Poseidon(vote, randomness)        — vote is committed
    //   3. vote ∈ {0, 1}                                       — vote is binary
    //   4. commitment is in the eligibility Merkle tree        — voter is registered
    //
    // Public inputs: [nullifier, proposal_id, merkle_root, vote_commitment]
    //
    // merkle_root is read from the proposal account, not supplied by the client.
    // A proof generated against a stale root will correctly fail verification.
    //
    // `is_initialized` is enforced unconditionally by the account constraint on
    // `vk_account`. In dev mode only the Groth16 math is skipped.

    let proposal_id = proposal.id;       // capture before mutable borrow below
    let merkle_root = proposal.merkle_root;

    // Groth16 math: runs in production; skipped in dev (proof bypass).
    #[cfg(not(feature = "dev"))]
    {
        // Verification in a separate #[inline(never)] frame to stay within
        // Solana's 4096-byte BPF stack limit.
        verify_groth16(
            proof_a, proof_b, proof_c,
            &nullifier, &proposal_id, &merkle_root, &vote_commitment,
            &ctx.accounts.vk_account,
        )?;
    }
    #[cfg(feature = "dev")]
    {
        // Silence unused-variable warnings for names only live in the prod block.
        let _ = (proof_a, proof_b, proof_c, proposal_id, merkle_root);
        msg!("WARNING: Groth16 verification skipped (dev feature flag). \
              Build without --features dev for production.");
    }

    let nullifier_record = &mut ctx.accounts.nullifier_record;
    nullifier_record.proposal_id = proposal.id;
    nullifier_record.nullifier = nullifier;
    nullifier_record.bump = ctx.bumps.nullifier_record;

    let vote_record = &mut ctx.accounts.vote_record;
    vote_record.proposal_id = proposal.id;
    vote_record.vote_commitment = vote_commitment;
    vote_record.nullifier = nullifier;
    vote_record.revealed = false;
    // Use sentinel 0xFF — not a valid vote value (0=No, 1=Yes) — so indexers
    // that read .vote without checking .revealed get an unambiguous signal.
    vote_record.vote = VOTE_UNREVEALED;
    vote_record.bump = ctx.bumps.vote_record;

    proposal.vote_count = proposal.vote_count.saturating_add(1);

    msg!("Vote cast. Total votes: {}", proposal.vote_count);
    Ok(())
}

#[derive(Accounts)]
// `proof` must be listed before `nullifier` so Anchor correctly skips the
// variable-length Vec<u8> before deserializing the nullifier for PDA seeds.
#[instruction(proof: Vec<u8>, nullifier: [u8; HASH_SIZE])]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    /// Verified to be a program-derived Proposal account via seeds + bump.
    /// Prevents a forged account from being passed as the proposal.
    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.admin.as_ref(), proposal.title_seed.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    /// Groth16 VK PDA. Using a typed account with the stored bump avoids
    /// `find_program_address` re-derivation and is consistent with every other
    /// PDA in the program. The `is_initialized` constraint enforces that
    /// `store_vk` was called before any vote is accepted, in both dev and prod.
    #[account(
        seeds = [SEED_VK],
        bump = vk_account.bump,
        constraint = vk_account.is_initialized @ BallotError::VkNotInitialized,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    // Nullifier account — creating it proves nullifier is fresh.
    // If it already exists, init will fail → prevents double voting.
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
