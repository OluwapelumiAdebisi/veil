use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::VeilCryptoError;

type HmacSha256 = Hmac<Sha256>;

pub const TAG_DST: &[u8] = b"VEIL-BID";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct BidTag(#[serde(with = "crate::hexutil::hex32_serde")] pub [u8; 32]);

/// tag = PRF(nk, "VEIL-BID" || rho || auction_scope)
pub fn derive_bid_tag(nk: &[u8; 32], rho: &[u8; 32], auction_scope: &str) -> BidTag {
    let mut mac = HmacSha256::new_from_slice(nk).expect("HMAC-SHA256 accepts 32-byte keys");
    mac.update(TAG_DST);
    mac.update(rho);
    mac.update(auction_scope.as_bytes());
    let out = mac.finalize().into_bytes();
    let mut tag = [0u8; 32];
    tag.copy_from_slice(&out);
    BidTag(tag)
}

pub fn verify_bid_tag(
    nk: &[u8; 32],
    rho: &[u8; 32],
    auction_scope: &str,
    expected: &BidTag,
) -> Result<(), VeilCryptoError> {
    let got = derive_bid_tag(nk, rho, auction_scope);
    if got == *expected {
        Ok(())
    } else {
        Err(VeilCryptoError::TagMismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_and_verify_tag() {
        let nk = [7u8; 32];
        let rho = [9u8; 32];
        let tag = derive_bid_tag(&nk, &rho, "A123");
        verify_bid_tag(&nk, &rho, "A123", &tag).unwrap();
        assert!(verify_bid_tag(&nk, &rho, "A124", &tag).is_err());
    }

    #[test]
    fn same_note_different_auctions_uncorrelated() {
        let nk = [3u8; 32];
        let rho = [4u8; 32];
        let a = derive_bid_tag(&nk, &rho, "Auction-A");
        let b = derive_bid_tag(&nk, &rho, "Auction-B");
        assert_ne!(a, b);
    }
}
