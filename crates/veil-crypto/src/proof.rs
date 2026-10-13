use serde::{Deserialize, Serialize};

use crate::accumulator::{
    verify_non_membership_root, NonMembershipWitness, NullifierAccumulator,
};
use crate::circuit::{prove_eligibility, statement_fp, verify_eligibility};
use crate::commit::{bid_commitment, commit, funding_commitment, Commitment, DOMAIN_NF, NONCE_LEN};
use crate::error::VeilCryptoError;
use crate::note::FundingNote;
use crate::tag::{derive_bid_tag, BidTag};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicInputs {
    pub auction_id: String,
    pub bid_commitment: Commitment,
    pub funding_commitment: Commitment,
    pub bid_tag: BidTag,
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub note_commitment: [u8; 32],
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub nullifier_root: [u8; 32],
    pub nf_commitment: Commitment,
    #[serde(with = "crate::hexutil::u64_string")]
    pub interval_left: u64,
    #[serde(with = "crate::hexutil::u64_string")]
    pub interval_right: u64,
    pub minimum_bid: u64,
    pub bond_requirement: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EligibilityProof {
    pub public: PublicInputs,
    #[serde(with = "crate::hexutil::hex_vec_serde")]
    pub range_proof: Vec<u8>,
    pub non_membership: NonMembershipWitness,
}

/// Private bidder material. Never sent to Veil.
#[derive(Clone, Debug)]
pub struct BidWitness {
    pub note: FundingNote,
    pub bid_amount: u64,
    pub bid_nonce: [u8; NONCE_LEN],
    pub funding_nonce: [u8; NONCE_LEN],
    pub public: PublicInputs,
    pub proof: EligibilityProof,
}

pub fn create_bid_witness(
    note: FundingNote,
    auction_id: &str,
    bid_amount: u64,
    bid_nonce: [u8; NONCE_LEN],
    funding_nonce: [u8; NONCE_LEN],
    minimum_bid: u64,
    bond_requirement: u64,
) -> Result<BidWitness, VeilCryptoError> {
    create_bid_witness_for(
        note,
        auction_id,
        bid_amount,
        bid_nonce,
        funding_nonce,
        [0u8; NONCE_LEN],
        minimum_bid,
        bond_requirement,
        &NullifierAccumulator::default(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_bid_witness_for(
    note: FundingNote,
    auction_id: &str,
    bid_amount: u64,
    bid_nonce: [u8; NONCE_LEN],
    funding_nonce: [u8; NONCE_LEN],
    nf_nonce: [u8; NONCE_LEN],
    minimum_bid: u64,
    bond_requirement: u64,
    accumulator: &NullifierAccumulator,
) -> Result<BidWitness, VeilCryptoError> {
    if bid_amount < minimum_bid {
        return Err(VeilCryptoError::BidBelowMinimum);
    }
    if note.value < bid_amount {
        return Err(VeilCryptoError::InsufficientFunds);
    }
    if note.value < bond_requirement {
        return Err(VeilCryptoError::BondRequirement);
    }

    let nf = note.toy_nullifier()?;
    let non_membership = accumulator.prove_non_membership(nf)?;
    let bid_c = bid_commitment(auction_id, bid_amount, &bid_nonce);
    let funding_c = funding_commitment(auction_id, note.value, &funding_nonce);
    let nf_c = commit(DOMAIN_NF, auction_id, nf, &nf_nonce);
    let bid_tag = derive_bid_tag(&note.nk, &note.rho, auction_id);
    let note_commitment = note.commitment()?;

    let public = PublicInputs {
        auction_id: auction_id.to_string(),
        bid_commitment: bid_c,
        funding_commitment: funding_c,
        bid_tag,
        note_commitment,
        nullifier_root: accumulator.root(),
        nf_commitment: nf_c,
        interval_left: non_membership.left,
        interval_right: non_membership.right,
        minimum_bid,
        bond_requirement,
    };

    let range_proof = prove_eligibility(
        statement_digest(&public),
        public.minimum_bid,
        public.bond_requirement,
        public.interval_left,
        public.interval_right,
        bid_amount,
        note.value,
        nf,
    )?;
    let proof = EligibilityProof {
        public: public.clone(),
        range_proof,
        non_membership,
    };

    Ok(BidWitness {
        note,
        bid_amount,
        bid_nonce,
        funding_nonce,
        public,
        proof,
    })
}

pub fn verify_eligibility_proof(proof: &EligibilityProof) -> Result<(), VeilCryptoError> {
    let public = &proof.public;
    if public.minimum_bid > u64::MAX / 2 {
        return Err(VeilCryptoError::BidBelowMinimum);
    }
    if proof.non_membership.left != public.interval_left
        || proof.non_membership.right != public.interval_right
    {
        return Err(VeilCryptoError::InvalidAccumulator);
    }
    verify_non_membership_root(&public.nullifier_root, &proof.non_membership)?;
    if public
        .bid_commitment
        .point()
        .decompress()
        .is_none()
        || public
            .funding_commitment
            .point()
            .decompress()
            .is_none()
        || public.nf_commitment.point().decompress().is_none()
    {
        return Err(VeilCryptoError::MalformedProof);
    }

    verify_eligibility(
        statement_digest(public),
        public.minimum_bid,
        public.bond_requirement,
        public.interval_left,
        public.interval_right,
        &proof.range_proof,
    )
}

fn statement_digest(public: &PublicInputs) -> pasta_curves::pallas::Base {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(public.auction_id.as_bytes());
    preimage.extend_from_slice(&public.bid_commitment.compressed);
    preimage.extend_from_slice(&public.funding_commitment.compressed);
    preimage.extend_from_slice(&public.bid_tag.0);
    preimage.extend_from_slice(&public.note_commitment);
    preimage.extend_from_slice(&public.nullifier_root);
    preimage.extend_from_slice(&public.nf_commitment.compressed);
    preimage.extend_from_slice(&public.interval_left.to_le_bytes());
    preimage.extend_from_slice(&public.interval_right.to_le_bytes());
    preimage.extend_from_slice(&public.minimum_bid.to_le_bytes());
    preimage.extend_from_slice(&public.bond_requirement.to_le_bytes());
    statement_fp(&preimage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit::verify_bid_commitment;
    use crate::tag::verify_bid_tag;
    use rand::RngCore;

    fn demo_note(value: u64) -> FundingNote {
        let mut rho = [0u8; 32];
        let mut nk = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut rho);
        rand::thread_rng().fill_bytes(&mut nk);
        FundingNote::new(value, rho, nk)
    }

    fn random_nonce() -> [u8; 32] {
        let mut n = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut n);
        n
    }

    #[test]
    fn funded_bid_verifies_without_revealing_amount() {
        let note = demo_note(10_000_000);
        let witness = create_bid_witness(
            note.clone(),
            "A123",
            7_000_000,
            random_nonce(),
            random_nonce(),
            1_000_000,
            500_000,
        )
        .unwrap();

        verify_eligibility_proof(&witness.proof).unwrap();

        let json = serde_json::to_string(&witness.proof.public).unwrap();
        assert!(!json.contains("7000000"), "public inputs must not embed the bid");
        assert!(!json.contains("10000000"), "public inputs must not embed funding");

        assert!(verify_bid_commitment(
            "A123",
            witness.bid_amount,
            &witness.bid_nonce,
            &witness.public.bid_commitment
        ));
        verify_bid_tag(&note.nk, &note.rho, "A123", &witness.public.bid_tag).unwrap();
    }

    #[test]
    fn underfunded_bid_is_rejected() {
        let note = demo_note(3);
        let err = create_bid_witness(note, "A123", 7, random_nonce(), random_nonce(), 1, 0).unwrap_err();
        assert!(matches!(err, VeilCryptoError::InsufficientFunds));
    }

    #[test]
    fn below_minimum_is_rejected() {
        let note = demo_note(100);
        let err = create_bid_witness(note, "A123", 2, random_nonce(), random_nonce(), 10, 0).unwrap_err();
        assert!(matches!(err, VeilCryptoError::BidBelowMinimum));
    }

    #[test]
    fn verifier_accepts_valid_and_rejects_tampered_min() {
        let note = demo_note(50);
        let mut witness =
            create_bid_witness(note, "A123", 20, random_nonce(), random_nonce(), 5, 1).unwrap();
        verify_eligibility_proof(&witness.proof).unwrap();
        witness.proof.public.minimum_bid = 40;
        assert!(verify_eligibility_proof(&witness.proof).is_err());
    }

    #[test]
    fn spent_funding_note_fails_close_time_proof() {
        let note = demo_note(50);
        let mut acc = NullifierAccumulator::default();
        acc.insert(note.toy_nullifier().unwrap()).unwrap();
        let err = create_bid_witness_for(
            note,
            "A123",
            20,
            random_nonce(),
            random_nonce(),
            random_nonce(),
            5,
            1,
            &acc,
        )
        .unwrap_err();
        assert!(matches!(err, VeilCryptoError::NullifierSpent));
    }
}
