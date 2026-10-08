use curve25519_dalek_ng::ristretto::CompressedRistretto;
use curve25519_dalek_ng::scalar::Scalar;
use bulletproofs::PedersenGens;
use serde::{Deserialize, Serialize};

pub const DOMAIN_BID: &[u8] = b"VEIL-BID-V1";
pub const DOMAIN_FUNDING: &[u8] = b"VEIL-FUNDING-V1";
pub const DOMAIN_NF: &[u8] = b"VEIL-NF-V1";
pub const NONCE_LEN: usize = 32;

/// Public Pedersen commitment. The opening (value, blinding) stays private.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Commitment {
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub compressed: [u8; 32],
}

impl Commitment {
    pub fn from_point(point: CompressedRistretto) -> Self {
        Self {
            compressed: point.to_bytes(),
        }
    }

    pub fn point(&self) -> CompressedRistretto {
        CompressedRistretto(self.compressed)
    }
}

pub fn pedersen_gens() -> PedersenGens {
    PedersenGens::default()
}

fn scalar_from_bytes(bytes: &[u8; 32]) -> Scalar {
    Scalar::from_bytes_mod_order(*bytes)
}

/// C = value * G + blinding * H, bound to a domain string and auction id via
/// extra blinding derived from those public labels so openings cannot be
/// replayed across auctions.
pub fn commit(
    domain: &[u8],
    auction_id: &str,
    value: u64,
    nonce: &[u8; NONCE_LEN],
) -> Commitment {
    let gens = pedersen_gens();
    let blinding = domain_blinding(domain, auction_id, nonce);
    let point = gens.commit(Scalar::from(value), blinding);
    Commitment::from_point(point.compress())
}

pub fn bid_commitment(auction_id: &str, bid: u64, nonce: &[u8; NONCE_LEN]) -> Commitment {
    commit(DOMAIN_BID, auction_id, bid, nonce)
}

pub fn funding_commitment(
    auction_id: &str,
    funding: u64,
    nonce: &[u8; NONCE_LEN],
) -> Commitment {
    commit(DOMAIN_FUNDING, auction_id, funding, nonce)
}

pub fn verify_commitment(
    domain: &[u8],
    auction_id: &str,
    value: u64,
    nonce: &[u8; NONCE_LEN],
    expected: &Commitment,
) -> bool {
    commit(domain, auction_id, value, nonce) == *expected
}

pub fn verify_bid_commitment(
    auction_id: &str,
    bid: u64,
    nonce: &[u8; NONCE_LEN],
    expected: &Commitment,
) -> bool {
    verify_commitment(DOMAIN_BID, auction_id, bid, nonce, expected)
}

pub fn verify_funding_commitment(
    auction_id: &str,
    funding: u64,
    nonce: &[u8; NONCE_LEN],
    expected: &Commitment,
) -> bool {
    verify_commitment(DOMAIN_FUNDING, auction_id, funding, nonce, expected)
}

pub fn bid_blinding(auction_id: &str, nonce: &[u8; NONCE_LEN]) -> Scalar {
    domain_blinding(DOMAIN_BID, auction_id, nonce)
}

pub fn domain_blinding(domain: &[u8], auction_id: &str, nonce: &[u8; NONCE_LEN]) -> Scalar {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VEIL-PEDERSEN-BLIND");
    hasher.update(&(domain.len() as u64).to_le_bytes());
    hasher.update(domain);
    hasher.update(&(auction_id.len() as u64).to_le_bytes());
    hasher.update(auction_id.as_bytes());
    hasher.update(nonce);
    let hash = hasher.finalize();
    let mut wide = [0u8; 32];
    wide.copy_from_slice(hash.as_bytes());
    scalar_from_bytes(&wide)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn commit_and_verify() {
        let mut nonce = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut nonce);
        let c = bid_commitment("A123", 7_000_000, &nonce);
        assert!(verify_bid_commitment("A123", 7_000_000, &nonce, &c));
        assert!(!verify_bid_commitment("A123", 6_000_000, &nonce, &c));
        assert!(!verify_bid_commitment("B999", 7_000_000, &nonce, &c));
    }

    #[test]
    fn hiding_same_value_different_nonce() {
        let mut n1 = [0u8; 32];
        let mut n2 = [1u8; 32];
        rand::thread_rng().fill_bytes(&mut n1);
        rand::thread_rng().fill_bytes(&mut n2);
        let a = bid_commitment("A123", 5, &n1);
        let b = bid_commitment("A123", 5, &n2);
        assert_ne!(a, b);
    }
}
