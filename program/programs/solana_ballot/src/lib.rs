use anchor_lang::prelude::*;
use constants::{HASH_SIZE, PROOF_A_SIZE, PROOF_B_SIZE, PROOF_C_SIZE};

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::{
    initialize::*, create_proposal::*, register_voter::*, open_voting::*,
    cast_vote::*, close_voting::*, reveal_vote::*, finalize_tally::*,
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

    /// Registers an eligible voter by adding their commitment to the Merkle tree.
    /// Must be called by the admin during the Registration phase.
    /// The commitment is `Poseidon(secret_key, randomness)` computed off-chain by the voter.
    /// Voters must register before voting opens — they cannot register retroactively.
    ///
    /// # Parameters
    /// - `commitment` — 32-byte Poseidon hash of the voter's secret key and randomness.
    ///                  This is the voter's leaf in the eligibility Merkle tree.
    pub fn register_voter(
        ctx: Context<RegisterVoter>,
        commitment: [u8; HASH_SIZE],
    ) -> Result<()> {
        instructions::register_voter::handler(ctx, commitment)
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
    /// - `proof_a`         — Groth16 proof component A (G1 point, 64 bytes).
    /// - `proof_b`         — Groth16 proof component B (G2 point, 128 bytes).
    /// - `proof_c`         — Groth16 proof component C (G1 point, 64 bytes).
    /// - `nullifier`       — Public unique value derived from `Poseidon(secret_key, proposal_id)`.
    ///                       Stored on-chain to prevent double voting.
    /// - `vote_commitment` — `Poseidon(vote, randomness)` — hides the vote until reveal phase.
    /// - `merkle_root`     — The Merkle root the proof was generated against.
    ///                       Must match the current on-chain root.
    pub fn cast_vote(
        ctx: Context<CastVote>,
        proof_a: [u8; PROOF_A_SIZE],
        proof_b: [u8; PROOF_B_SIZE],
        proof_c: [u8; PROOF_C_SIZE],
        nullifier: [u8; HASH_SIZE],
        vote_commitment: [u8; HASH_SIZE],
        merkle_root: [u8; HASH_SIZE],
    ) -> Result<()> {
        instructions::cast_vote::handler(
            ctx, proof_a, proof_b, proof_c,
            nullifier, vote_commitment, merkle_root,
        )
    }

    /// Closes the voting period. No more votes can be cast after this.
    /// Transitions the proposal from Voting → Closed.
    /// Can only be called by the admin.
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
    /// Can only be called by the admin after voting is closed.
    pub fn finalize_tally(ctx: Context<FinalizeTally>) -> Result<()> {
        instructions::finalize_tally::handler(ctx)
    }
}
