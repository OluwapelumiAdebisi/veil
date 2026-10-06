use bulletproofs::{BulletproofGens, RangeProof};
use curve25519_dalek_ng::scalar::Scalar;
use merlin::Transcript;
use serde::{Deserialize, Serialize};

use crate::commit::{
    bid_commitment, domain_blinding, funding_commitment, pedersen_gens, Commitment, DOMAIN_BID,
    DOMAIN_FUNDING, NONCE_LEN,
};
use crate::error::VeilCryptoError;
use crate::note::ToyNote;
use crate::tag::{derive_bid_tag, BidTag};

const RANGE_BITS: usize = 64;
const RANGE_VALUES: usize = 2;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicInputs {
    pub auction_id: String,
    pub bid_commitment: Commitment,
    pub funding_commitment: Commitment,
    pub bid_tag: BidTag,
    pub note_commitment: [u8; 32],
    pub minimum_bid: u64,
    pub bond_requirement: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EligibilityProof {
    pub public: PublicInputs,
    range_proof: Vec<u8>,
}

/// Private bidder material. Never sent to Veil.
#[derive(Clone, Debug)]
pub struct BidWitness {
    pub note: ToyNote,
    pub bid_amount: u64,
    pub bid_nonce: [u8; NONCE_LEN],
    pub funding_nonce: [u8; NONCE_LEN],
    pub public: PublicInputs,
    pub proof: EligibilityProof,
}

pub fn create_bid_witness(
    note: ToyNote,
    auction_id: &str,
    bid_amount: u64,
    bid_nonce: [u8; NONCE_LEN],
    funding_nonce: [u8; NONCE_LEN],
    minimum_bid: u64,
    bond_requirement: u64,
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

    let bid_c = bid_commitment(auction_id, bid_amount, &bid_nonce);
    let funding_c = funding_commitment(auction_id, note.value, &funding_nonce);
    let bid_tag = derive_bid_tag(&note.nk, &note.rho, auction_id);
    let note_commitment = note.commitment();

    let public = PublicInputs {
        auction_id: auction_id.to_string(),
        bid_commitment: bid_c,
        funding_commitment: funding_c,
        bid_tag,
        note_commitment,
        minimum_bid,
        bond_requirement,
    };

    let range_proof = prove_ranges(&public, bid_amount, note.value, &bid_nonce, &funding_nonce)?;
    let proof = EligibilityProof {
        public: public.clone(),
        range_proof,
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

    let gens = pedersen_gens();
    let c_bid = public
        .bid_commitment
        .point()
        .decompress()
        .ok_or(VeilCryptoError::MalformedProof)?;
    let c_funding = public
        .funding_commitment
        .point()
        .decompress()
        .ok_or(VeilCryptoError::MalformedProof)?;

    let c_bid_minus_min = c_bid - (gens.B * Scalar::from(public.minimum_bid));
    let c_funding_minus_bid = c_funding - c_bid;

    let range_proof =
        RangeProof::from_bytes(&proof.range_proof).map_err(|_| VeilCryptoError::MalformedProof)?;

    let bp_gens = BulletproofGens::new(RANGE_BITS, RANGE_VALUES);
    let mut transcript = statement_transcript(public);
    let commitments = [
        c_bid_minus_min.compress(),
        c_funding_minus_bid.compress(),
    ];

    range_proof
        .verify_multiple(
            &bp_gens,
            &gens,
            &mut transcript,
            &commitments,
            RANGE_BITS,
        )
        .map_err(|_| VeilCryptoError::InvalidRangeProof)?;

    Ok(())
}

fn prove_ranges(
    public: &PublicInputs,
    bid_amount: u64,
    funding: u64,
    bid_nonce: &[u8; NONCE_LEN],
    funding_nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, VeilCryptoError> {
    let r_bid = domain_blinding(DOMAIN_BID, &public.auction_id, bid_nonce);
    let r_funding = domain_blinding(DOMAIN_FUNDING, &public.auction_id, funding_nonce);

    let values = [bid_amount - public.minimum_bid, funding - bid_amount];
    let blinds = [r_bid, r_funding - r_bid];

    let bp_gens = BulletproofGens::new(RANGE_BITS, RANGE_VALUES);
    let pc_gens = pedersen_gens();
    let mut transcript = statement_transcript(public);

    let (proof, _commitments) = RangeProof::prove_multiple(
        &bp_gens,
        &pc_gens,
        &mut transcript,
        &values[..],
        &blinds[..],
        RANGE_BITS,
    )
    .map_err(|_| VeilCryptoError::InvalidRangeProof)?;

    Ok(proof.to_bytes())
}

fn statement_transcript(public: &PublicInputs) -> Transcript {
    let mut t = Transcript::new(b"VEIL-ELIGIBILITY-V1");
    t.append_message(b"auction_id", public.auction_id.as_bytes());
    t.append_message(b"bid_commitment", &public.bid_commitment.compressed);
    t.append_message(b"funding_commitment", &public.funding_commitment.compressed);
    t.append_message(b"bid_tag", &public.bid_tag.0);
    t.append_message(b"note_commitment", &public.note_commitment);
    t.append_u64(b"minimum_bid", public.minimum_bid);
    t.append_u64(b"bond_requirement", public.bond_requirement);
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit::verify_bid_commitment;
    use crate::tag::verify_bid_tag;
    use rand::RngCore;

    fn demo_note(value: u64) -> ToyNote {
        let mut rho = [0u8; 32];
        let mut nk = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut rho);
        rand::thread_rng().fill_bytes(&mut nk);
        ToyNote::new(value, rho, nk)
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
}
