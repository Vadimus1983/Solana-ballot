use anchor_lang::prelude::*;
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

    // ── Parse optional VK ─────────────────────────────────────────────────────
    //
    // The VK account is an UncheckedAccount so cast_vote works even before
    // `store_vk` has been called (development mode).
    //
    // Attempt to deserialize: succeeds only if the account has been initialized
    // with the correct Anchor discriminator. If the account is absent, empty, or
    // has the wrong discriminator, `vk_opt` is None and verification is skipped.
    let vk_opt: Option<VerificationKeyAccount> = {
        let data = ctx.accounts.vk_account.try_borrow_data()?;
        if data.len() >= VerificationKeyAccount::LEN {
            let mut slice: &[u8] = &data;
            VerificationKeyAccount::try_deserialize(&mut slice).ok()
        } else {
            None
        }
    };

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
    // If the VK account was absent or uninitialized, `vk_opt` is None and
    // verification is skipped — development mode only.

    let proposal_id = proposal.id;       // capture before mutable borrow below
    let merkle_root = proposal.merkle_root;

    match vk_opt.as_ref().filter(|vk| vk.is_initialized) {
        Some(vk) => {
            // Verification in a separate #[inline(never)] frame to stay within
            // Solana's 4096-byte BPF stack limit.
            verify_groth16(
                proof_a, proof_b, proof_c,
                &nullifier, &proposal_id, &merkle_root, &vote_commitment,
                vk,
            )?;
        }
        None => {
            // In production builds (compiled without the `dev` feature) the absence
            // of an initialised VK is a hard error — votes cannot be cast without
            // a valid verifying key.  The `dev` feature enables the bypass so that
            // `anchor test` works without a real Groth16 trusted-setup ceremony.
            #[cfg(feature = "dev")]
            msg!("WARNING: VK not initialized — proof verification skipped (dev feature flag). \
                  Build with --no-default-features for production.");
            #[cfg(not(feature = "dev"))]
            return err!(BallotError::VkNotInitialized);
        }
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
    vote_record.vote = 0;
    vote_record.bump = ctx.bumps.vote_record;

    proposal.vote_count += 1;

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

    /// CHECK: Groth16 VK PDA. The PDA derivation is validated by the seeds
    /// constraint. The account data is parsed manually in the handler:
    ///   - If initialized (`store_vk` has been called): real Groth16 verification runs.
    ///   - If absent or uninitialized: verification is skipped (development mode).
    #[account(seeds = [SEED_VK], bump)]
    pub vk_account: UncheckedAccount<'info>,

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
