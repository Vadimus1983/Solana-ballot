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

    #[msg("Verification key is already initialized and cannot be replaced")]
    VkAlreadyInitialized,

    #[msg("Proposal is not yet finalized")]
    NotFinalized,

    #[msg("All vote accounts must be closed before the proposal can be closed")]
    VoteAccountsNotClosed,

    #[msg("All commitment accounts must be closed before the proposal can be closed")]
    CommitmentAccountsNotClosed,

    #[msg("Voting window has not yet expired — call open_voting or wait for voting_end")]
    VotingWindowNotExpired,

    #[msg("Commitment must be a non-zero BN254 field element (0 < commitment < p)")]
    InvalidCommitment,

    #[msg("Verification key contains an invalid curve point or out-of-range field element")]
    InvalidVerificationKey,

    #[msg("refund_to must match the address recorded in the VoteRecord, or equal closer when no address was designated")]
    InvalidRefundTo,

    #[msg("This commitment has already been registered for this proposal")]
    CommitmentAlreadyRegistered,

    #[msg("This voter identity has already been registered for this proposal")]
    VoterAlreadyRegistered,

    #[msg("Merkle root not found in proposal root history — proof is too old or root was fabricated")]
    UnknownMerkleRoot,
}
