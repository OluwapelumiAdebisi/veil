use serde::{Deserialize, Serialize};

/// Stand-in for an Orchard note. Replaced with real Zcash witnesses later.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToyNote {
    pub value: u64,
    pub rho: [u8; 32],
    pub nk: [u8; 32],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToyNoteWitness {
    pub note: ToyNote,
    pub commitment: [u8; 32],
}

impl ToyNote {
    pub fn new(value: u64, rho: [u8; 32], nk: [u8; 32]) -> Self {
        Self { value, rho, nk }
    }

    pub fn commitment(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-TOY-NOTE-V1");
        hasher.update(&self.value.to_le_bytes());
        hasher.update(&self.rho);
        hasher.update(&self.nk);
        *hasher.finalize().as_bytes()
    }

    pub fn witness(&self) -> ToyNoteWitness {
        ToyNoteWitness {
            note: self.clone(),
            commitment: self.commitment(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_commitment_binds_value() {
        let a = ToyNote::new(10, [1u8; 32], [2u8; 32]);
        let b = ToyNote::new(11, [1u8; 32], [2u8; 32]);
        assert_ne!(a.commitment(), b.commitment());
        assert_eq!(a.witness().commitment, a.commitment());
    }
}
