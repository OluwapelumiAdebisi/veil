use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::value::NoteValue;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::error::VeilCryptoError;
use crate::accumulator::{SENTINEL_MAX, SENTINEL_MIN};

/// Local Orchard funding note. `rho` / `nk` are seed material the bidder keeps;
/// they are never sent to Veil. The on-circuit commitment is a real Orchard `cmx`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundingNote {
    pub value: u64,
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub rho: [u8; 32],
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub nk: [u8; 32],
}

/// Compatibility alias used by the prove CLI and existing tests.
pub type ToyNote = FundingNote;
pub type ToyNoteWitness = FundingNoteWitness;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundingNoteWitness {
    pub note: FundingNote,
    #[serde(with = "crate::hexutil::hex32_serde")]
    pub commitment: [u8; 32],
}

impl FundingNote {
    pub fn new(value: u64, rho: [u8; 32], nk: [u8; 32]) -> Self {
        Self { value, rho, nk }
    }

    pub fn orchard_note(&self) -> Result<Note, VeilCryptoError> {
        let sk = spending_key_from_seed(&self.nk)?;
        let fvk = FullViewingKey::from(&sk);
        let recipient = fvk.address_at(0u32, Scope::External);
        let rho = rho_from_seed(&self.rho)?;
        let rseed = rseed_from_seed(&self.nk, &self.rho, &rho)?;
        let value = NoteValue::from_raw(self.value);
        Option::from(Note::from_parts(
            recipient,
            value,
            rho,
            rseed,
            NoteVersion::V2,
        ))
        .ok_or(VeilCryptoError::InvalidNote)
    }

    pub fn commitment(&self) -> Result<[u8; 32], VeilCryptoError> {
        let note = self.orchard_note()?;
        let cmx = ExtractedNoteCommitment::from(note.commitment());
        Ok(cmx.to_bytes())
    }

    pub fn orchard_nullifier(&self) -> Result<[u8; 32], VeilCryptoError> {
        let sk = spending_key_from_seed(&self.nk)?;
        let fvk = FullViewingKey::from(&sk);
        let note = self.orchard_note()?;
        Ok(note.nullifier(&fvk).to_bytes())
    }

    /// Veil application nullifier derived from the Orchard nf. Not stored as the
    /// chain nullifier; coordinator only sees a Pedersen commitment to this value.
    pub fn toy_nullifier(&self) -> Result<u64, VeilCryptoError> {
        let nf = self.orchard_nullifier()?;
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-APP-NF-V1");
        hasher.update(&nf);
        let hash = hasher.finalize();
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&hash.as_bytes()[..8]);
        let mut out = u64::from_le_bytes(buf);
        if out == SENTINEL_MIN {
            out = 1;
        }
        if out == SENTINEL_MAX {
            out = SENTINEL_MAX - 1;
        }
        Ok(out)
    }

    pub fn witness(&self) -> Result<FundingNoteWitness, VeilCryptoError> {
        Ok(FundingNoteWitness {
            note: self.clone(),
            commitment: self.commitment()?,
        })
    }
}

fn spending_key_from_seed(seed: &[u8; 32]) -> Result<SpendingKey, VeilCryptoError> {
    for i in 0u32..1024 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-ORCHARD-SK");
        hasher.update(seed);
        hasher.update(&i.to_le_bytes());
        let hash = hasher.finalize();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(hash.as_bytes());
        if let Some(sk) = Option::from(SpendingKey::from_bytes(bytes)) {
            return Ok(sk);
        }
    }
    Err(VeilCryptoError::InvalidNote)
}

fn rho_from_seed(seed: &[u8; 32]) -> Result<Rho, VeilCryptoError> {
    for i in 0u32..1024 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-ORCHARD-RHO");
        hasher.update(seed);
        hasher.update(&i.to_le_bytes());
        let hash = hasher.finalize();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(hash.as_bytes());
        if let Some(rho) = Option::from(Rho::from_bytes(&bytes)) {
            return Ok(rho);
        }
    }
    Err(VeilCryptoError::InvalidNote)
}

fn rseed_from_seed(nk: &[u8; 32], rho_seed: &[u8; 32], rho: &Rho) -> Result<RandomSeed, VeilCryptoError> {
    for i in 0u32..1024 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-ORCHARD-RSEED");
        hasher.update(nk);
        hasher.update(rho_seed);
        hasher.update(&i.to_le_bytes());
        let hash = hasher.finalize();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(hash.as_bytes());
        if let Some(rseed) = Option::from(RandomSeed::from_bytes(bytes, rho)) {
            // Reject the all-zero seed even if esk is valid.
            if bool::from(bytes.ct_eq(&[0u8; 32])) {
                continue;
            }
            return Ok(rseed);
        }
    }
    Err(VeilCryptoError::InvalidNote)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orchard_commitment_binds_value() {
        let a = FundingNote::new(10, [1u8; 32], [2u8; 32]);
        let b = FundingNote::new(11, [1u8; 32], [2u8; 32]);
        assert_ne!(a.commitment().unwrap(), b.commitment().unwrap());
        assert_eq!(a.witness().unwrap().commitment, a.commitment().unwrap());
    }

    #[test]
    fn orchard_nullifier_is_32_bytes_and_hidden_from_app_nf() {
        let note = FundingNote::new(50, [9u8; 32], [8u8; 32]);
        let chain_nf = note.orchard_nullifier().unwrap();
        let app_nf = note.toy_nullifier().unwrap();
        assert_eq!(chain_nf.len(), 32);
        assert_ne!(&chain_nf[..8], &app_nf.to_le_bytes());
    }
}
