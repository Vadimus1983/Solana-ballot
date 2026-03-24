use anchor_lang::prelude::*;
use constants::{HASH_SIZE, PROOF_A_SIZE, PROOF_B_SIZE};

pub mod constants;
pub mod merkle;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::{
    initialize::*, create_proposal::*, register_commitment::*, register_voter::*,
    open_voting::*, store_vk::*, cast_vote::*, close_voting::*, reveal_vote::*,
    finalize_tally::*, close_vote_accounts::*, close_commitment_record::*,
    close_proposal::*, expire_proposal::*,
};

declare_id!("2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ");

#[program]
pub mod solana_ballot {
    use super::*;

    /// One-time program initialization called by the deployer.
    /// No accounts are created — serves as a deployment smoke test.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Creates a new voting proposal.
    /// Only the admin who calls this can manage the proposal lifecycle.
    ///
    /// # Parameters
    /// - `title`        — Short label for the proposal (max 128 chars). First 32 bytes used as PDA seed.
    /// - `description`  — Full description of what is being voted on (max 256 chars).
    /// - `voting_start` — Unix timestamp when voters can start casting votes.
    /// - `voting_end`   — Unix timestamp after which no more votes are accepted.
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        description: String,
        voting_start: i64,
        voting_end: i64,
    ) -> Result<()> {
        instructions::create_proposal::handler(ctx, title, description, voting_start, voting_end)
    }

    /// Step 1 of the two-phase voter registration protocol.
    ///
    /// The voter calls this instruction (signed by their own wallet) to deposit
    /// their Poseidon commitment `C = Poseidon(secret_key, randomness)` into a
    /// `PendingCommitmentRecord` PDA seeded by `(proposal, voter_pubkey)`.
    ///
    /// Because the PDA address is derived from the voter's public key, the admin
    /// cannot substitute a different commitment in step 2 (`register_voter`):
    /// they must pass exactly this PDA, which holds exactly what the voter signed.
    ///
    /// # Parameters
    /// - `commitment` — 32-byte Poseidon hash of the voter's secret key and randomness.
    pub fn register_commitment(
        ctx: Context<RegisterCommitment>,
        commitment: [u8; HASH_SIZE],
    ) -> Result<()> {
        instructions::register_commitment::handler(ctx, commitment)
    }

    /// Step 2 of the two-phase voter registration protocol.
    ///
    /// The admin calls this instruction to insert the voter's commitment (read
    /// from `PendingCommitmentRecord`) into the eligibility Merkle tree.
    /// The `PendingCommitmentRecord` is closed atomically, returning rent to the voter.
    ///
    /// No `commitment` parameter — the commitment is read from the account the voter
    /// created in `register_commitment`. This prevents admin substitution.
    ///
    /// Voters must register before voting opens — they cannot register retroactively.
    pub fn register_voter(ctx: Context<RegisterVoter>) -> Result<()> {
        instructions::register_voter::handler(ctx)
    }

    /// Stores the Groth16 verifying key on-chain for a specific proposal.
    ///
    /// Must be called once by the program authority before `open_voting`.
    /// The VK is scoped per-proposal (seeded by the proposal's on-chain address)
    /// so a compromised or incorrectly generated key affects only that one election.
    /// Circuit upgrades are handled by deploying a new proposal with a new VK;
    /// no program redeployment is required.
    ///
    /// # Parameters
    ///
    /// - `vk_alpha_g1` — G1 point: vk.alpha (64 bytes, big-endian uncompressed BN254)
    /// - `vk_beta_g2`  — G2 point: vk.beta  (128 bytes)
    /// - `vk_gamma_g2` — G2 point: vk.gamma (128 bytes)
    /// - `vk_delta_g2` — G2 point: vk.delta (128 bytes)
    /// - `vk_ic`       — IC points: constant term + one per public input (5 × 64 bytes)
    #[allow(clippy::too_many_arguments)]
    pub fn store_vk(
        ctx: Context<StoreVk>,
        vk_alpha_g1: [u8; PROOF_A_SIZE],
        vk_beta_g2: [u8; PROOF_B_SIZE],
        vk_gamma_g2: [u8; PROOF_B_SIZE],
        vk_delta_g2: [u8; PROOF_B_SIZE],
        vk_ic: [[u8; PROOF_A_SIZE]; 5],
    ) -> Result<()> {
        instructions::store_vk::handler(ctx, vk_alpha_g1, vk_beta_g2, vk_gamma_g2, vk_delta_g2, vk_ic)
    }

    /// Opens voting for a proposal, transitioning it from Registration → Voting.
    ///
    /// After this call, voters can submit ZK proofs via `cast_vote`.
    /// The Merkle root is frozen at this point — no further voter registrations
    /// are accepted, ensuring the eligibility tree is fixed for all proofs.
    ///
    /// # Guards
    /// - Caller must be the proposal admin.
    /// - Proposal must be in `Registration` status.
    /// - Current time must be within the configured voting window.
    /// - At least one voter must be registered.
    pub fn open_voting(ctx: Context<OpenVoting>) -> Result<()> {
        instructions::open_voting::handler(ctx)
    }

    /// Casts a private vote using a ZK proof.
    /// The voter proves eligibility and ballot validity without revealing their identity or vote.
    /// A nullifier is stored on-chain to prevent the same voter from voting twice.
    ///
    /// # Parameters
    /// - `proof`           — Groth16 proof components concatenated:
    ///                       `proof_a (64 B) || proof_b (128 B) || proof_c (64 B)` = 256 bytes.
    ///                       Passed as `Vec<u8>` so Borsh heap-allocates the bytes, keeping
    ///                       the dispatcher's BPF stack frame within Solana's 4096-byte limit.
    /// - `nullifier`       — Public unique value derived from `Poseidon(secret_key, proposal_id)`.
    ///                       Stored on-chain to prevent double voting.
    /// - `vote_commitment` — `Poseidon(vote, randomness)` — hides the vote until reveal phase.
    ///
    /// Rent recovery: the voter's Solana signing key (`voter` account) is automatically
    /// stored as the refund destination. `close_vote_accounts` will route the
    /// NullifierRecord + VoteRecord rent back to that address — MEV bots cannot
    /// redirect it. Voters who want to avoid linking their Solana identity to their
    /// nullifier should use a fresh ephemeral Solana keypair for this call; the ZK
    /// proof is fully independent of the Solana signing key.
    ///
    /// Note: `merkle_root` is read from `proposal.merkle_root`, not supplied by the client.
    /// A proof generated against a stale root will fail on-chain verification.
    pub fn cast_vote(
        ctx: Context<CastVote>,
        proof: Vec<u8>,
        nullifier: [u8; HASH_SIZE],
        vote_commitment: [u8; HASH_SIZE],
        refund_to: Pubkey,
    ) -> Result<()> {
        instructions::cast_vote::handler(ctx, proof, nullifier, vote_commitment, refund_to)
    }

    /// Closes the voting period. No more votes can be cast after this.
    /// Transitions the proposal from Voting → Closed.
    ///
    /// Permissionless — callable by any account once `voting_end` has passed.
    /// This prevents the admin from blocking finalization by disappearing after
    /// the election period ends. The time-lock (`voting_has_ended`) ensures the
    /// window cannot be closed early.
    pub fn close_voting(ctx: Context<CloseVoting>) -> Result<()> {
        instructions::close_voting::handler(ctx)
    }

    /// Reveals a previously cast vote after voting has closed.
    /// The voter provides their plaintext vote and randomness.
    /// The program verifies `Poseidon(vote, randomness) == stored vote_commitment`.
    /// Once verified, the vote is counted toward the tally.
    ///
    /// # Parameters
    /// - `vote`       — The plaintext vote: 0 (no) or 1 (yes).
    /// - `randomness` — The 32-byte randomness used when computing the vote commitment.
    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        vote: u8,
        randomness: [u8; HASH_SIZE],
    ) -> Result<()> {
        instructions::reveal_vote::handler(ctx, vote, randomness)
    }

    /// Finalizes the tally and marks the proposal as complete.
    /// Emits a `ProposalFinalized` event with the final yes/no counts.
    /// Transitions the proposal from Closed → Finalized.
    ///
    /// Permissionless — any account may finalize once all votes are revealed
    /// or the reveal grace period has expired. This mirrors the design of
    /// `close_voting`: the admin cannot block finalization by disappearing
    /// after the election ends.
    pub fn finalize_tally(ctx: Context<FinalizeTally>) -> Result<()> {
        instructions::finalize_tally::handler(ctx)
    }

    /// Closes one NullifierRecord + VoteRecord pair for a finalized proposal,
    /// returning the rent-exempt lamports to the caller.
    /// Permissionless — any account may reclaim rent after finalization.
    pub fn close_vote_accounts(ctx: Context<CloseVoteAccounts>) -> Result<()> {
        instructions::close_vote_accounts::handler(ctx)
    }

    /// Closes a single CommitmentRecord PDA for a finalized proposal,
    /// returning the rent-exempt lamports to the caller.
    /// Permissionless — any account may reclaim rent after finalization.
    /// The commitment value is read from the account itself; no parameter needed.
    pub fn close_commitment_record(ctx: Context<CloseCommitmentRecord>) -> Result<()> {
        instructions::close_commitment_record::handler(ctx)
    }

    /// Closes a finalized Proposal account, returning rent to the admin.
    /// All vote accounts and commitment records must be closed first via
    /// `close_vote_accounts` and `close_commitment_record`.
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        instructions::close_proposal::handler(ctx)
    }

    /// Transitions a Registration proposal to Expired after its voting window
    /// elapses without the admin calling open_voting.
    ///
    /// Permissionless — any account may call this once `voting_end` has passed.
    /// After expiry, `close_commitment_record` and `close_proposal` reclaim all rent.
    pub fn expire_proposal(ctx: Context<ExpireProposal>) -> Result<()> {
        instructions::expire_proposal::handler(ctx)
    }
}
