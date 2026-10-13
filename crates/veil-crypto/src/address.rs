use serde::Serialize;
use zcash_address::{
    unified::{self, Container, Receiver},
    ConversionError, TryFromAddress, ZcashAddress,
};
use zcash_protocol::consensus::NetworkType;

use crate::VeilCryptoError;

/// Public classification of a Zcash address. No keys, no amounts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AddressInfo {
    pub network: String,
    pub kind: String,
    pub has_orchard: bool,
    pub has_sapling: bool,
    pub shielded: bool,
}

#[derive(Clone, Debug)]
struct VeilReceiver {
    network: NetworkType,
    has_orchard: bool,
    has_sapling: bool,
    transparent_only: bool,
}

impl TryFromAddress for VeilReceiver {
    type Error = ();

    fn try_from_unified(
        net: NetworkType,
        ua: unified::Address,
    ) -> Result<Self, ConversionError<Self::Error>> {
        let items = ua.items();
        Ok(Self {
            network: net,
            has_orchard: items.iter().any(|r| matches!(r, Receiver::Orchard(_))),
            has_sapling: items.iter().any(|r| matches!(r, Receiver::Sapling(_))),
            transparent_only: false,
        })
    }

    fn try_from_sapling(net: NetworkType, _data: [u8; 43]) -> Result<Self, ConversionError<Self::Error>> {
        Ok(Self {
            network: net,
            has_orchard: false,
            has_sapling: true,
            transparent_only: false,
        })
    }

    fn try_from_transparent_p2pkh(
        net: NetworkType,
        _data: [u8; 20],
    ) -> Result<Self, ConversionError<Self::Error>> {
        Ok(Self {
            network: net,
            has_orchard: false,
            has_sapling: false,
            transparent_only: true,
        })
    }

    fn try_from_transparent_p2sh(
        net: NetworkType,
        _data: [u8; 20],
    ) -> Result<Self, ConversionError<Self::Error>> {
        Ok(Self {
            network: net,
            has_orchard: false,
            has_sapling: false,
            transparent_only: true,
        })
    }
}

fn network_name(net: NetworkType) -> String {
    match net {
        NetworkType::Main => "main".to_string(),
        NetworkType::Test => "test".to_string(),
        NetworkType::Regtest => "regtest".to_string(),
    }
}

/// Parse a Zcash address and require a shielded receiver for Veil.
pub fn classify_address(raw: &str) -> Result<AddressInfo, VeilCryptoError> {
    let parsed: ZcashAddress = raw.trim().parse().map_err(|_| VeilCryptoError::InvalidAddress)?;
    let recv: VeilReceiver = parsed.convert().map_err(|_| VeilCryptoError::InvalidAddress)?;
    if recv.transparent_only {
        return Err(VeilCryptoError::TransparentAddress);
    }
    if !recv.has_orchard && !recv.has_sapling {
        return Err(VeilCryptoError::MissingOrchard);
    }
    if !recv.has_orchard {
        return Err(VeilCryptoError::MissingOrchard);
    }
    Ok(AddressInfo {
        network: network_name(recv.network),
        kind: "unified".to_string(),
        has_orchard: recv.has_orchard,
        has_sapling: recv.has_sapling,
        shielded: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_address::unified::Encoding;

    #[test]
    fn rejects_garbage() {
        assert!(classify_address("not-an-address").is_err());
        assert!(classify_address("zs107b32c10ecfe5ace").is_err());
    }

    #[test]
    fn accepts_orchard_unified_testnet() {
        let ua = unified::Address::try_from_items(vec![Receiver::Orchard([7u8; 43])]).unwrap();
        let encoded = ua.encode(&NetworkType::Test);
        let info = classify_address(&encoded).unwrap();
        assert_eq!(info.network, "test");
        assert!(info.has_orchard);
        assert!(info.shielded);
    }
}
