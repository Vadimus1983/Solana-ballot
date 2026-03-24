use anchor_lang::prelude::*;
use crate::state::vk::VerificationKeyAccount;
use crate::state::program_config::ProgramConfig;
use crate::state::proposal::Proposal;
use crate::error::BallotError;
use crate::constants::*;

/// Stores the Groth16 prepared verifying key for a specific proposal on-chain.
///
/// Gated to the proposal admin via `has_one = admin` on the proposal account.
/// The VK PDA is scoped per-proposal (`seeds = [SEED_VK, proposal.key()]`), so:
///
/// - A compromised or crafted VK only affects the one proposal it was stored for;
///   every other election retains its own independent key (limited blast radius).
/// - Circuit upgrades are handled by deploying new proposals that store a new VK;
///   no program redeployment is required.
/// - Proposals with different circuit parameters (e.g. additional public inputs)
///   can coexist with distinct per-proposal VK accounts.
///
/// Uses `init_if_needed` so that a pre-funded (squatted) PDA — an attacker sending
/// lamports to the deterministic VK address before this instruction is called — does
/// not block initialization. `init_if_needed` calls `allocate`+`assign` when the
/// account already has lamports but no data, recovering it transparently.
///
/// The single-write invariant previously provided by `init` is enforced explicitly:
/// the handler rejects any call where `is_initialized` is already true, preventing
/// mid-election key replacement.
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<StoreVk>,
    vk_alpha_g1: [u8; PROOF_A_SIZE],
    vk_beta_g2: [u8; PROOF_B_SIZE],
    vk_gamma_g2: [u8; PROOF_B_SIZE],
    vk_delta_g2: [u8; PROOF_B_SIZE],
    vk_ic: [[u8; PROOF_A_SIZE]; NUM_PUBLIC_INPUTS + 1],
) -> Result<()> {
    let vk_account = &mut ctx.accounts.vk_account;

    // Enforce single-write: reject if the VK was already stored.
    // This replaces the guarantee previously provided by `init` alone.
    require!(!vk_account.is_initialized, BallotError::VkAlreadyInitialized);

    // Validate that every curve-point component is non-identity and has
    // coordinates that are valid BN254 field elements (< BN254_PRIME).
    // All-zero inputs are the identity point; out-of-range coordinates are
    // never on the curve. Either would cause every cast_vote to fail with
    // InvalidProof, permanently bricking all future elections.
    //
    // Note: this validates field-element range, not full curve membership.
    // Full membership requires solving the curve equation and is deferred to
    // the ZK trusted-setup ceremony. Operators must use a proper MPC ceremony
    // for production deployments.
    require!(validate_g1(&vk_alpha_g1), BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_beta_g2),  BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_gamma_g2), BallotError::InvalidVerificationKey);
    require!(validate_g2(&vk_delta_g2), BallotError::InvalidVerificationKey);
    for ic_elem in &vk_ic {
        require!(validate_g1(ic_elem), BallotError::InvalidVerificationKey);
    }

    vk_account.vk_alpha_g1 = vk_alpha_g1;
    vk_account.vk_beta_g2 = vk_beta_g2;
    vk_account.vk_gamma_g2 = vk_gamma_g2;
    vk_account.vk_delta_g2 = vk_delta_g2;
    vk_account.vk_ic = vk_ic;
    vk_account.is_initialized = true;
    vk_account.bump = ctx.bumps.vk_account;

    msg!("Verification key stored. ZK proof verification is now active.");
    Ok(())
}

/// Returns true if `point` is a non-identity G1 element with both coordinates
/// strictly less than BN254_PRIME (big-endian lexicographic comparison).
fn validate_g1(point: &[u8; PROOF_A_SIZE]) -> bool {
    let x: [u8; 32] = point[..32].try_into().unwrap();
    let y: [u8; 32] = point[32..].try_into().unwrap();
    // Reject the identity (0, 0) and out-of-range coordinates.
    (x != [0u8; 32] || y != [0u8; 32]) && x < BN254_PRIME && y < BN254_PRIME
}

/// Returns true if `point` is a non-identity G2 element with all four Fp2
/// coordinate chunks strictly less than BN254_PRIME.
fn validate_g2(point: &[u8; PROOF_B_SIZE]) -> bool {
    let chunks: [[u8; 32]; 4] = [
        point[..32].try_into().unwrap(),
        point[32..64].try_into().unwrap(),
        point[64..96].try_into().unwrap(),
        point[96..].try_into().unwrap(),
    ];
    // Reject the identity (all chunks zero) and out-of-range coordinates.
    chunks.iter().any(|c| c != &[0u8; 32]) && chunks.iter().all(|c| c < &BN254_PRIME)
}

#[derive(Accounts)]
pub struct StoreVk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Program config created by `initialize`.
    /// Verifies the caller is the program authority — prevents first-caller-wins.
    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
        constraint = program_config.authority == admin.key() @ BallotError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// The proposal this VK is associated with.
    ///
    /// Heap-boxed so the ~1 200-byte Proposal struct is allocated on the heap
    /// rather than the BPF stack, keeping the frame within Solana's 4 096-byte
    /// limit. Anchor's implicit owner + discriminator checks ensure only a
    /// genuine program-owned Proposal account is accepted — any other address
    /// (random keypair, system account, foreign PDA) is rejected before the
    /// handler runs.
    pub proposal: Box<Account<'info, Proposal>>,

    /// Per-proposal VK PDA. Scoped to this proposal so a compromised key
    /// cannot affect any other election.
    /// `init_if_needed` recovers a squatted (pre-funded) PDA without error.
    /// The single-write invariant is enforced by the `is_initialized` check
    /// in the handler, preventing mid-election key replacement.
    #[account(
        init_if_needed,
        payer = admin,
        space = VerificationKeyAccount::LEN,
        seeds = [SEED_VK, proposal.key().as_ref()],
        bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    pub system_program: Program<'info, System>,
}
