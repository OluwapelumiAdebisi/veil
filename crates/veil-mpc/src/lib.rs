//! 2-of-3 Shamir sharing of a hidden bid. Any two committee members can
//! reconstruct; a single share cannot. The public output of argmax is only
//! the winning bid id.

use curve25519_dalek_ng::ristretto::RistrettoPoint;
use curve25519_dalek_ng::scalar::Scalar;
use curve25519_dalek_ng::traits::Identity;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use veil_crypto::{bid_blinding, pedersen_gens, Commitment, VeilCryptoError, NONCE_LEN};

pub const COMMITTEE_N: u8 = 3;
pub const THRESHOLD: u8 = 2;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BidShare {
    pub index: u8,
    #[serde(with = "hex_scalar")]
    pub value: [u8; 32],
    #[serde(with = "hex_scalar")]
    pub blinding: [u8; 32],
}

mod hex_scalar {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let v = hex::decode(s).map_err(serde::de::Error::custom)?;
        v.try_into().map_err(|_| serde::de::Error::custom("expected 32 bytes"))
    }
}

pub fn split_bid(
    auction_id: &str,
    bid_amount: u64,
    bid_nonce: &[u8; NONCE_LEN],
) -> Result<[BidShare; 3], VeilCryptoError> {
    let secret = Scalar::from(bid_amount);
    let r = bid_blinding(auction_id, bid_nonce);
    let value_shares = shamir_split(secret);
    let blind_shares = shamir_split(r);
    Ok([
        BidShare {
            index: 1,
            value: value_shares[0].1.to_bytes(),
            blinding: blind_shares[0].1.to_bytes(),
        },
        BidShare {
            index: 2,
            value: value_shares[1].1.to_bytes(),
            blinding: blind_shares[1].1.to_bytes(),
        },
        BidShare {
            index: 3,
            value: value_shares[2].1.to_bytes(),
            blinding: blind_shares[2].1.to_bytes(),
        },
    ])
}

pub fn reconstruct_bid(shares: &[BidShare]) -> Result<u64, VeilCryptoError> {
    if shares.len() < THRESHOLD as usize {
        return Err(VeilCryptoError::InsufficientShares);
    }
    let pts: Vec<(Scalar, Scalar)> = shares
        .iter()
        .map(|s| {
            (
                Scalar::from(s.index as u64),
                Scalar::from_bytes_mod_order(s.value),
            )
        })
        .collect();
    let secret = lagrange_at_zero(&pts);
    scalar_to_u64(secret)
}

pub fn shares_match_commitment(
    commitment: &Commitment,
    shares: &[BidShare],
) -> Result<(), VeilCryptoError> {
    if shares.len() < THRESHOLD as usize {
        return Err(VeilCryptoError::InsufficientShares);
    }
    let gens = pedersen_gens();
    let expected = commitment
        .point()
        .decompress()
        .ok_or(VeilCryptoError::MalformedProof)?;
    let pts: Vec<(Scalar, RistrettoPoint)> = shares
        .iter()
        .map(|s| {
            let v = Scalar::from_bytes_mod_order(s.value);
            let r = Scalar::from_bytes_mod_order(s.blinding);
            (Scalar::from(s.index as u64), gens.commit(v, r))
        })
        .collect();
    let recovered = lagrange_points_at_zero(&pts);
    if recovered.compress() == expected.compress() {
        Ok(())
    } else {
        Err(VeilCryptoError::InconsistentShares)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArgmaxBid {
    pub bid_id: String,
    pub bid_commitment: Commitment,
    pub shares: Vec<BidShare>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArgmaxOutput {
    pub winner_bid_id: String,
}

pub fn private_argmax(bids: &[ArgmaxBid]) -> Result<ArgmaxOutput, VeilCryptoError> {
    let mut best: Option<(u64, String)> = None;
    for bid in bids {
        shares_match_commitment(&bid.bid_commitment, &bid.shares)?;
        let value = reconstruct_bid(&bid.shares)?;
        match &best {
            None => best = Some((value, bid.bid_id.clone())),
            Some((cur, cur_id)) => {
                if value > *cur || (value == *cur && bid.bid_id < *cur_id) {
                    best = Some((value, bid.bid_id.clone()));
                }
            }
        }
    }
    let winner_bid_id = best
        .ok_or(VeilCryptoError::MalformedProof)?
        .1;
    Ok(ArgmaxOutput { winner_bid_id })
}

fn shamir_split(secret: Scalar) -> [(u8, Scalar); 3] {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let slope = Scalar::from_bytes_mod_order(bytes);
    [
        (1, secret + slope * Scalar::from(1u64)),
        (2, secret + slope * Scalar::from(2u64)),
        (3, secret + slope * Scalar::from(3u64)),
    ]
}

fn lagrange_at_zero(points: &[(Scalar, Scalar)]) -> Scalar {
    let mut acc = Scalar::from(0u64);
    for (i, (x_i, y_i)) in points.iter().enumerate() {
        let mut num = Scalar::from(1u64);
        let mut den = Scalar::from(1u64);
        for (j, (x_j, _)) in points.iter().enumerate() {
            if i == j {
                continue;
            }
            num *= -*x_j;
            den *= *x_i - *x_j;
        }
        acc += *y_i * num * den.invert();
    }
    acc
}

fn lagrange_points_at_zero(points: &[(Scalar, RistrettoPoint)]) -> RistrettoPoint {
    let mut acc = RistrettoPoint::identity();
    for (i, (x_i, y_i)) in points.iter().enumerate() {
        let mut num = Scalar::from(1u64);
        let mut den = Scalar::from(1u64);
        for (j, (x_j, _)) in points.iter().enumerate() {
            if i == j {
                continue;
            }
            num *= -*x_j;
            den *= *x_i - *x_j;
        }
        acc += *y_i * (num * den.invert());
    }
    acc
}

fn scalar_to_u64(scalar: Scalar) -> Result<u64, VeilCryptoError> {
    let bytes = scalar.to_bytes();
    if bytes[8..].iter().any(|b| *b != 0) {
        return Err(VeilCryptoError::MalformedProof);
    }
    Ok(u64::from_le_bytes(bytes[..8].try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use veil_crypto::bid_commitment;

    #[test]
    fn two_shares_open_bid_one_does_not() {
        let nonce = [7u8; 32];
        let shares = split_bid("A123", 6_000_000, &nonce).unwrap();
        let c = bid_commitment("A123", 6_000_000, &nonce);
        assert_eq!(reconstruct_bid(&shares[0..2]).unwrap(), 6_000_000);
        assert!(reconstruct_bid(&shares[0..1]).is_err());
        shares_match_commitment(&c, &shares[0..2]).unwrap();
    }

    #[test]
    fn argmax_returns_only_winner_id() {
        let n1 = [1u8; 32];
        let n2 = [2u8; 32];
        let n3 = [3u8; 32];
        let alice = split_bid("A123", 5, &n1).unwrap();
        let bob = split_bid("A123", 7, &n2).unwrap();
        let charlie = split_bid("A123", 6, &n3).unwrap();
        let out = private_argmax(&[
            ArgmaxBid {
                bid_id: "alice".into(),
                bid_commitment: bid_commitment("A123", 5, &n1),
                shares: alice[0..2].to_vec(),
            },
            ArgmaxBid {
                bid_id: "bob".into(),
                bid_commitment: bid_commitment("A123", 7, &n2),
                shares: bob[0..2].to_vec(),
            },
            ArgmaxBid {
                bid_id: "charlie".into(),
                bid_commitment: bid_commitment("A123", 6, &n3),
                shares: charlie[0..2].to_vec(),
            },
        ])
        .unwrap();
        assert_eq!(out.winner_bid_id, "bob");
        let json = serde_json::to_string(&out).unwrap();
        assert!(!json.contains("bid_amount"));
        assert!(!json.contains("5000000"));
    }
}
