use anchor_lang::prelude::*;

#[error_code]
pub enum BallotError {
    #[msg("Only the admin can perform this action")]
    Unauthorized,

    #[msg("Voting is not open for this proposal")]
    VotingNotOpen,

    #[msg("Voting is still open")]
    VotingStillOpen,

    #[msg("Voting has already been closed")]
    VotingAlreadyClosed,

    #[msg("Proposal is already finalized")]
    AlreadyFinalized,

    #[msg("This nullifier has already been used")]
    NullifierAlreadyUsed,

    #[msg("Invalid ZK proof")]
    InvalidProof,

    #[msg("Merkle root mismatch")]
    MerkleRootMismatch,

    #[msg("Vote has already been revealed")]
    AlreadyRevealed,

    #[msg("Vote commitment does not match")]
    CommitmentMismatch,

    #[msg("Title too long, max 128 characters")]
    TitleTooLong,

    #[msg("Description too long, max 256 characters")]
    DescriptionTooLong,

    #[msg("Invalid voting period")]
    InvalidVotingPeriod,

    #[msg("Proposal is not in Registration phase")]
    NotInRegistration,

    #[msg("Poseidon hash computation failed")]
    HashError,

    #[msg("Merkle tree is full — maximum voters reached")]
    TreeFull,

    #[msg("Verification key not initialized — call store_vk first")]
    VkNotInitialized,
}
