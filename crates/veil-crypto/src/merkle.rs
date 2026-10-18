use incrementalmerkletree::{frontier::Frontier, Hashable, Level};
use orchard::note::ExtractedNoteCommitment;
use orchard::tree::{Anchor, MerkleHashOrchard, MerklePath};
use orchard::NOTE_COMMITMENT_TREE_DEPTH;
use serde::{Deserialize, Serialize};

use crate::error::VeilCryptoError;

pub const ORCHARD_DEPTH: usize = NOTE_COMMITMENT_TREE_DEPTH;

/// Authentication path from a public Orchard `cmx` to a public anchor.
/// Position is a V1 leak (same class as accumulator interval leaves).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardMerklePath {
    pub position: u32,
    #[serde(with = "crate::hexutil::hex32_list_serde")]
    pub auth_path: Vec<[u8; 32]>,
}

#[derive(Clone, Debug)]
pub struct OrchardMembership {
    pub anchor: [u8; 32],
    pub path: OrchardMerklePath,
}

/// Local Orchard note-commitment tree. Same MerkleCRH as the chain tree.
/// A wallet/lightwalletd supplies the equivalent path against a chain anchor.
#[derive(Clone, Debug, Default)]
pub struct OrchardNoteTree {
    leaves: Vec<MerkleHashOrchard>,
}

impl OrchardNoteTree {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn singleton(cmx: [u8; 32]) -> Result<OrchardMembership, VeilCryptoError> {
        let mut tree = Self::new();
        let position = tree.append(cmx)?;
        tree.membership(position)
    }

    pub fn append(&mut self, cmx: [u8; 32]) -> Result<u32, VeilCryptoError> {
        let leaf = parse_hash(&cmx)?;
        let position = u32::try_from(self.leaves.len()).map_err(|_| VeilCryptoError::MalformedProof)?;
        self.leaves.push(leaf);
        Ok(position)
    }

    pub fn root(&self) -> [u8; 32] {
        let mut frontier = Frontier::<MerkleHashOrchard, { NOTE_COMMITMENT_TREE_DEPTH as u8 }>::empty();
        for leaf in &self.leaves {
            let _ = frontier.append(*leaf);
        }
        Anchor::from(frontier.root()).to_bytes()
    }

    pub fn membership(&self, position: u32) -> Result<OrchardMembership, VeilCryptoError> {
        let path = auth_path(&self.leaves, position)?;
        let cmx = parse_cmx(&self.leaves[position as usize].to_bytes())?;
        let anchor = path.root(cmx).to_bytes();
        Ok(OrchardMembership {
            anchor,
            path: OrchardMerklePath {
                position,
                auth_path: path.auth_path().iter().map(MerkleHashOrchard::to_bytes).collect(),
            },
        })
    }
}

pub fn verify_orchard_membership(
    cmx: &[u8; 32],
    path: &OrchardMerklePath,
    anchor: &[u8; 32],
) -> Result<(), VeilCryptoError> {
    if path.auth_path.len() != ORCHARD_DEPTH {
        return Err(VeilCryptoError::MalformedProof);
    }
    let cmx = parse_cmx(cmx)?;
    let expected = parse_anchor(anchor)?;
    let mut hashes = [MerkleHashOrchard::empty_leaf(); ORCHARD_DEPTH];
    for (slot, bytes) in hashes.iter_mut().zip(path.auth_path.iter()) {
        *slot = parse_hash(bytes)?;
    }
    let computed = MerklePath::from_parts(path.position, hashes).root(cmx);
    if computed == expected {
        Ok(())
    } else {
        Err(VeilCryptoError::NoteNotInTree)
    }
}

fn auth_path(leaves: &[MerkleHashOrchard], position: u32) -> Result<MerklePath, VeilCryptoError> {
    let index = position as usize;
    if leaves.is_empty() || index >= leaves.len() {
        return Err(VeilCryptoError::NoteNotInTree);
    }
    let mut layer = leaves.to_vec();
    let mut pos = index;
    let mut siblings = Vec::with_capacity(ORCHARD_DEPTH);
    for level in 0..ORCHARD_DEPTH {
        let sibling_index = pos ^ 1;
        let sibling = layer
            .get(sibling_index)
            .copied()
            .unwrap_or_else(|| MerkleHashOrchard::empty_root(Level::from(level as u8)));
        siblings.push(sibling);
        let mut next = Vec::with_capacity(layer.len().div_ceil(2));
        let empty = MerkleHashOrchard::empty_root(Level::from(level as u8));
        for chunk in layer.chunks(2) {
            let left = chunk[0];
            let right = chunk.get(1).copied().unwrap_or(empty);
            next.push(MerkleHashOrchard::combine(Level::from(level as u8), &left, &right));
        }
        layer = next;
        pos /= 2;
    }
    let auth_path: [MerkleHashOrchard; ORCHARD_DEPTH] = siblings
        .try_into()
        .map_err(|_| VeilCryptoError::MalformedProof)?;
    Ok(MerklePath::from_parts(position, auth_path))
}

fn parse_hash(bytes: &[u8; 32]) -> Result<MerkleHashOrchard, VeilCryptoError> {
    Option::from(MerkleHashOrchard::from_bytes(bytes)).ok_or(VeilCryptoError::MalformedProof)
}

fn parse_cmx(bytes: &[u8; 32]) -> Result<ExtractedNoteCommitment, VeilCryptoError> {
    Option::from(ExtractedNoteCommitment::from_bytes(bytes)).ok_or(VeilCryptoError::InvalidNote)
}

fn parse_anchor(bytes: &[u8; 32]) -> Result<Anchor, VeilCryptoError> {
    Option::from(Anchor::from_bytes(*bytes)).ok_or(VeilCryptoError::MalformedProof)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::FundingNote;

    #[test]
    fn singleton_matches_frontier_root() {
        let note = FundingNote::new(10, [1u8; 32], [2u8; 32]);
        let cmx = note.commitment().unwrap();
        let membership = OrchardNoteTree::singleton(cmx).unwrap();
        let mut tree = OrchardNoteTree::new();
        tree.append(cmx).unwrap();
        assert_eq!(membership.anchor, tree.root());
        verify_orchard_membership(&cmx, &membership.path, &membership.anchor).unwrap();
    }

    #[test]
    fn leaf_among_peers_verifies_and_missing_leaf_fails() {
        let a = FundingNote::new(10, [1u8; 32], [2u8; 32]).commitment().unwrap();
        let b = FundingNote::new(11, [3u8; 32], [4u8; 32]).commitment().unwrap();
        let c = FundingNote::new(12, [5u8; 32], [6u8; 32]).commitment().unwrap();
        let mut tree = OrchardNoteTree::new();
        tree.append(a).unwrap();
        let pos = tree.append(b).unwrap();
        tree.append(c).unwrap();
        let membership = tree.membership(pos).unwrap();
        verify_orchard_membership(&b, &membership.path, &membership.anchor).unwrap();
        assert!(verify_orchard_membership(&a, &membership.path, &membership.anchor).is_err());
        let mut bad_anchor = membership.anchor;
        bad_anchor[0] ^= 1;
        assert!(matches!(
            verify_orchard_membership(&b, &membership.path, &bad_anchor),
            Err(VeilCryptoError::NoteNotInTree)
        ));
    }
}
