//! Veil cryptographic primitives (V1 toy model).
//!
//! Real Orchard/Halo 2 circuits come later. This crate proves the protocol
//! heart: a hidden bid can be committed and shown to be funded without the
//! verifier learning the bid amount.

pub mod accumulator;
pub mod commit;
pub mod error;
pub mod hexutil;
pub mod note;
pub mod proof;
pub mod tag;

pub use accumulator::{NonMembershipWitness, NullifierAccumulator};
pub use commit::{
    bid_blinding, bid_commitment, funding_commitment, pedersen_gens, verify_bid_commitment,
    verify_funding_commitment, Commitment, DOMAIN_BID, DOMAIN_FUNDING, NONCE_LEN,
};
pub use error::VeilCryptoError;
pub use note::{ToyNote, ToyNoteWitness};
pub use proof::{
    create_bid_witness, create_bid_witness_for, verify_eligibility_proof, BidWitness,
    EligibilityProof, PublicInputs,
};
pub use tag::{derive_bid_tag, verify_bid_tag, BidTag, TAG_DST};
