use anchor_lang::prelude::*;
use crate::constants::*;

/// On-chain storage for the Groth16 prepared verifying key.
///
/// Populated by the admin via the `store_vk` instruction after running the
/// trusted setup ceremony for the combined ZK circuit. Once stored, `cast_vote`
/// uses this key to verify every incoming proof.
///
/// # Groth16 prepared verifying key layout
///
/// A Groth16 VK for a circuit with `n` public inputs consists of:
/// - `vk_alpha_g1`  — G1 point (64 bytes)
/// - `vk_beta_g2`   — G2 point (128 bytes)
/// - `vk_gamma_g2`  — G2 point (128 bytes)
/// - `vk_delta_g2`  — G2 point (128 bytes)
/// - `vk_ic`        — n+1 G1 points (one constant term + one per public input)
///
/// For our combined circuit [`NUM_PUBLIC_INPUTS`] = 4:
///   public inputs: nullifier, proposal_id, merkle_root, vote_commitment
///   vk_ic size: 5 × 64 = 320 bytes
///
/// # Compatibility note
///
/// The byte format expected by `groth16-solana` uses uncompressed BN254 points
/// in big-endian byte order, matching the output of arkworks when serialized
/// for Solana. Conversion from arkworks to this format is done off-chain by the
/// trusted setup tooling.
#[account]
pub struct VerificationKeyAccount {
    /// Admin who uploaded this VK — only they can replace it
    pub admin: Pubkey,

    /// Whether the VK has been initialized with real data.
    /// If false, `cast_vote` logs a warning and skips verification
    /// (development mode only — must be true in production).
    pub is_initialized: bool,

    /// G1 point: vk_alpha
    pub vk_alpha_g1: [u8; PROOF_A_SIZE],

    /// G2 point: vk_beta
    pub vk_beta_g2: [u8; PROOF_B_SIZE],

    /// G2 point: vk_gamma
    pub vk_gamma_g2: [u8; PROOF_B_SIZE],

    /// G2 point: vk_delta
    pub vk_delta_g2: [u8; PROOF_B_SIZE],

    /// IC points: vk_ic[0] is the constant term, vk_ic[1..=NUM_PUBLIC_INPUTS]
    /// correspond to nullifier, proposal_id, merkle_root, vote_commitment.
    pub vk_ic: [[u8; PROOF_A_SIZE]; NUM_PUBLIC_INPUTS + 1],

    /// PDA bump
    pub bump: u8,
}

impl VerificationKeyAccount {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR
        + PUBKEY_SIZE                                          // admin
        + 1                                                    // is_initialized
        + PROOF_A_SIZE                                         // vk_alpha_g1
        + PROOF_B_SIZE                                         // vk_beta_g2
        + PROOF_B_SIZE                                         // vk_gamma_g2
        + PROOF_B_SIZE                                         // vk_delta_g2
        + (NUM_PUBLIC_INPUTS + 1) * PROOF_A_SIZE               // vk_ic (5 × 64 = 320)
        + 1;                                                   // bump
}
