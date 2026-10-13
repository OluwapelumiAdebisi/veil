# Veil protocol (V1)

Status: architecture locked for Zecathon MVP.

Core principle: the market is verifiable; participant activity is private.

## Thesis

Veil is a sealed-bid auction protocol on Zcash. Eligibility is proven in zero knowledge. Winner selection is private MPC. Settlement is a shielded Zcash payment the coordinator does not custody.

## Actors

- **Bidder** — wallet, commitments, proofs, MPC shares, settlement tx
- **Seller** — creates the auction, receives the winning payment
- **Veil coordinator** — auction state, proof verification, tags, nullifiers, MPC trigger, deadlines. Does not custody funds.
- **MPC committee** — V1 is 2-of-3. Explicit trust assumption.
- **Zcash** — shielded notes, consensus, actual value transfer

## Invariant

The Veil database must never contain `bid_amount`, `funding_amount`, private keys, seeds, note plaintext, or the real Zcash nullifier.

## Bid statement

Public: `auction_id`, `C_bid`, `C_funding`, `bid_tag`, `anchor`, `nullifier_root`, eligibility proof.

Private: note, value, `rho`, `nk`, bid, nonces.

The circuit must show:

1. Valid Orchard note (`cmx` from `orchard::Note`)
2. Ownership of spending secrets (tag PRF over local seed material)
3. `funding >= bid`
4. `bid >= minimum`
5. Commitment opens to the hidden bid (Pedersen; Halo 2 binds ranges to the public statement)
6. Tag = PRF(nk, "VEIL-BID" || rho || auction_id)
7. Fixed public bond condition
8. Hidden Veil application nullifier is not in the published accumulator (interval + Merkle paths; adjacent public leaves are a V1 leak). The real Zcash nf is never stored.

## Auction flow

`CREATED → OPEN → CLOSING → ELIGIBILITY_CHECK → MPC_WINNER_SELECTION → PROVISIONAL_WINNER → SETTLEMENT_WINDOW → SETTLED | DEFAULTED → NEXT_WINNER`

First-price. Fixed bond (independent of bid). Close-time re-eligibility against a fresh nullifier root. Settlement is a short window; a missed payment defaults the winner, forfeits the bond, and reruns argmax.

## Crypto crate (now)

`veil-crypto` implements domain-separated Pedersen commitments, HMAC bid tags, Orchard funding notes, and a Halo 2 eligibility circuit for `bid >= min`, `funding >= bid`, `funding >= bond`, and the nullifier interval.

Settlement (now): the coordinator looks up the submitted txid on a Zcash node or testnet explorer. The lot is SETTLED only if the tx is confirmed and shielded (Orchard or Sapling). Amounts are not stored.

Wallet (Zodl): Veil does not inject `window.ethereum` and does not hold keys. Connect is a Unified Address from Zodl Receive (QR scan). Settlement is a ZIP-321 payment request the winner scans in Zodl, then Veil verifies the txid. Encrypted memo carries the auction id. Follow the Zcash Payment API path (shielded z-addrs / UAs), not the Bitcoin-compatible t-addr path.

Addresses: seller and linked Zodl addresses must parse as ZIP-316 Unified Addresses with an Orchard receiver (`veil-crypto address`). Transparent-only addresses are rejected.

Next: Orchard Merkle membership (note witness from lightwalletd) so `cmx` is proven in the commitment tree, not only constructed locally.
