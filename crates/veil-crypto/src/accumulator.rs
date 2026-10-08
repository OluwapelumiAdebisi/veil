use serde::{Deserialize, Serialize};

use crate::error::VeilCryptoError;
use crate::note::ToyNote;

pub const SENTINEL_MIN: u64 = 0;
pub const SENTINEL_MAX: u64 = u64::MAX;

/// Sorted Merkle accumulator of observed (toy) nullifiers.
///
/// Chain nullifiers are public indexer data. A bid must not include the
/// bidder's own nullifier; non-membership is proven against this root.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NullifierAccumulator {
    values: Vec<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NonMembershipWitness {
    #[serde(with = "crate::hexutil::u64_string")]
    pub left: u64,
    #[serde(with = "crate::hexutil::u64_string")]
    pub right: u64,
    pub left_index: u32,
    pub right_index: u32,
    #[serde(with = "crate::hexutil::hex32_list_serde")]
    pub left_siblings: Vec<[u8; 32]>,
    #[serde(with = "crate::hexutil::hex32_list_serde")]
    pub right_siblings: Vec<[u8; 32]>,
}

impl Default for NullifierAccumulator {
    fn default() -> Self {
        Self {
            values: vec![SENTINEL_MIN, SENTINEL_MAX],
        }
    }
}

impl NullifierAccumulator {
    pub fn from_observed(nullifiers: &[u64]) -> Result<Self, VeilCryptoError> {
        let mut acc = Self::default();
        for nf in nullifiers {
            acc.insert(*nf)?;
        }
        Ok(acc)
    }

    pub fn insert(&mut self, nf: u64) -> Result<(), VeilCryptoError> {
        if nf == SENTINEL_MIN || nf == SENTINEL_MAX {
            return Err(VeilCryptoError::InvalidAccumulator);
        }
        if let Err(idx) = self.values.binary_search(&nf) {
            self.values.insert(idx, nf);
        }
        Ok(())
    }

    pub fn observed(&self) -> Vec<u64> {
        self.values
            .iter()
            .copied()
            .filter(|v| *v != SENTINEL_MIN && *v != SENTINEL_MAX)
            .collect()
    }

    pub fn contains_spent(&self, nf: u64) -> bool {
        nf != SENTINEL_MIN && nf != SENTINEL_MAX && self.values.binary_search(&nf).is_ok()
    }

    pub fn root(&self) -> [u8; 32] {
        merkle_root(&leaf_hashes(&self.padded_values()))
    }

    pub fn prove_non_membership(
        &self,
        nf: u64,
    ) -> Result<NonMembershipWitness, VeilCryptoError> {
        if self.contains_spent(nf) {
            return Err(VeilCryptoError::NullifierSpent);
        }
        let idx = self
            .values
            .binary_search(&nf)
            .unwrap_err();
        if idx == 0 || idx >= self.values.len() {
            return Err(VeilCryptoError::InvalidAccumulator);
        }
        let left_index = (idx - 1) as u32;
        let right_index = idx as u32;
        let padded = self.padded_values();
        let leaves = leaf_hashes(&padded);
        Ok(NonMembershipWitness {
            left: self.values[idx - 1],
            right: self.values[idx],
            left_index,
            right_index,
            left_siblings: merkle_proof(&leaves, idx - 1),
            right_siblings: merkle_proof(&leaves, idx),
        })
    }

    pub fn verify_non_membership(
        &self,
        witness: &NonMembershipWitness,
    ) -> Result<(), VeilCryptoError> {
        verify_non_membership_root(&self.root(), witness)
    }

    fn padded_values(&self) -> Vec<u64> {
        let mut v = self.values.clone();
        let mut n = v.len().next_power_of_two();
        if n == 0 {
            n = 1;
        }
        let last = *v.last().unwrap();
        while v.len() < n {
            v.push(last);
        }
        v
    }
}

impl ToyNote {
    /// Toy application nullifier. Not a Zcash nf; never placed on a bid record.
    pub fn toy_nullifier(&self) -> u64 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"VEIL-TOY-NF-V1");
        hasher.update(&self.nk);
        hasher.update(&self.rho);
        let hash = hasher.finalize();
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&hash.as_bytes()[..8]);
        let mut nf = u64::from_le_bytes(buf);
        if nf == SENTINEL_MIN {
            nf = 1;
        }
        if nf == SENTINEL_MAX {
            nf = SENTINEL_MAX - 1;
        }
        nf
    }
}

pub fn verify_non_membership_root(
    root: &[u8; 32],
    witness: &NonMembershipWitness,
) -> Result<(), VeilCryptoError> {
    if witness.right_index != witness.left_index + 1 || witness.left >= witness.right {
        return Err(VeilCryptoError::InvalidAccumulator);
    }
    let left_ok = merkle_root_from_proof(
        leaf_hash(witness.left),
        witness.left_index as usize,
        &witness.left_siblings,
    ) == *root;
    let right_ok = merkle_root_from_proof(
        leaf_hash(witness.right),
        witness.right_index as usize,
        &witness.right_siblings,
    ) == *root;
    if left_ok && right_ok {
        Ok(())
    } else {
        Err(VeilCryptoError::InvalidAccumulator)
    }
}

fn leaf_hash(value: u64) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VEIL-ACC-LEAF");
    hasher.update(&value.to_le_bytes());
    *hasher.finalize().as_bytes()
}

fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VEIL-ACC-NODE");
    hasher.update(left);
    hasher.update(right);
    *hasher.finalize().as_bytes()
}

fn leaf_hashes(values: &[u64]) -> Vec<[u8; 32]> {
    values.iter().copied().map(leaf_hash).collect()
}

fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    let mut layer = leaves.to_vec();
    while layer.len() > 1 {
        let mut next = Vec::new();
        for chunk in layer.chunks(2) {
            next.push(node_hash(&chunk[0], &chunk[1]));
        }
        layer = next;
    }
    layer[0]
}

fn merkle_proof(leaves: &[[u8; 32]], mut index: usize) -> Vec<[u8; 32]> {
    let mut layer = leaves.to_vec();
    let mut siblings = Vec::new();
    while layer.len() > 1 {
        let sibling = if index % 2 == 0 { index + 1 } else { index - 1 };
        siblings.push(layer[sibling]);
        let mut next = Vec::new();
        for chunk in layer.chunks(2) {
            next.push(node_hash(&chunk[0], &chunk[1]));
        }
        layer = next;
        index /= 2;
    }
    siblings
}

fn merkle_root_from_proof(mut node: [u8; 32], mut index: usize, siblings: &[[u8; 32]]) -> [u8; 32] {
    for sibling in siblings {
        node = if index % 2 == 0 {
            node_hash(&node, sibling)
        } else {
            node_hash(sibling, &node)
        };
        index /= 2;
    }
    node
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spent_nullifier_cannot_prove_non_membership() {
        let mut acc = NullifierAccumulator::default();
        let note = ToyNote::new(10, [1u8; 32], [2u8; 32]);
        let nf = note.toy_nullifier();
        acc.insert(nf).unwrap();
        assert!(matches!(
            acc.prove_non_membership(nf),
            Err(VeilCryptoError::NullifierSpent)
        ));
    }

    #[test]
    fn empty_accumulator_allows_any_note() {
        let acc = NullifierAccumulator::default();
        let note = ToyNote::new(10, [9u8; 32], [8u8; 32]);
        let w = acc.prove_non_membership(note.toy_nullifier()).unwrap();
        acc.verify_non_membership(&w).unwrap();
    }
}
