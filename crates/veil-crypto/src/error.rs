use thiserror::Error;

#[derive(Debug, Error)]
pub enum VeilCryptoError {
    #[error("commitment opening does not match")]
    CommitmentMismatch,
    #[error("bid tag does not match")]
    TagMismatch,
    #[error("bid is below the auction minimum")]
    BidBelowMinimum,
    #[error("funding is below the bid")]
    InsufficientFunds,
    #[error("bond condition is not met")]
    BondRequirement,
    #[error("range proof failed")]
    InvalidRangeProof,
    #[error("malformed proof bytes")]
    MalformedProof,
    #[error("note commitment does not match the witness")]
    InvalidNote,
    #[error("nullifier was already spent")]
    NullifierSpent,
    #[error("nullifier accumulator proof is invalid")]
    InvalidAccumulator,
    #[error("not enough shares to reconstruct")]
    InsufficientShares,
    #[error("share does not match the bid commitment")]
    InconsistentShares,
}
