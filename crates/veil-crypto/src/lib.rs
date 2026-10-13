//! Veil cryptographic primitives.
//!
//! Orchard notes plus a Halo 2 eligibility circuit. Bid amounts stay private.

pub mod accumulator;
pub mod address;
pub mod circuit;
pub mod commit;
pub mod error;
pub mod hexutil;
pub mod note;
pub mod proof;
pub mod tag;

pub use address::{classify_address, AddressInfo};
pub use accumulator::{NonMembershipWitness, NullifierAccumulator};
pub use commit::{
    bid_blinding, bid_commitment, funding_commitment, pedersen_gens, verify_bid_commitment,
    verify_funding_commitment, Commitment, DOMAIN_BID, DOMAIN_FUNDING, NONCE_LEN,
};
pub use error::VeilCryptoError;
pub use note::{FundingNote, FundingNoteWitness, ToyNote, ToyNoteWitness};
pub use proof::{
    create_bid_witness, create_bid_witness_for, verify_eligibility_proof, BidWitness,
    EligibilityProof, PublicInputs,
};
pub use tag::{derive_bid_tag, verify_bid_tag, BidTag, TAG_DST};
