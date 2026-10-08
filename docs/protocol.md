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

The circuit / toy proof must show:

1. Valid note and membership (toy: note commitment)
2. Ownership of spending secrets (toy: tag PRF key)
3. `funding >= bid`
4. `bid >= minimum`
5. Commitment opens to the hidden bid
6. Tag = PRF(nk, "VEIL-BID" || rho || auction_id)
7. Fixed public bond condition
8. Hidden toy nullifier is not in the published accumulator (interval + Merkle paths; adjacent public leaves are a V1 leak)

## Auction flow

`CREATED → OPEN → CLOSING → ELIGIBILITY_CHECK → MPC_WINNER_SELECTION → PROVISIONAL_WINNER → SETTLEMENT_WINDOW → SETTLED | DEFAULTED → NEXT_WINNER`

First-price. Fixed bond (independent of bid). Close-time re-eligibility against a fresh nullifier root. Failed settlement forfeits the bond and reruns argmax.

## Crypto crate (now)

`veil-crypto` implements domain-separated Pedersen commitments, HMAC bid tags, a toy note, and Bulletproofs range proofs for `bid - min` and `funding - bid`.

Next: replace the toy note with Orchard witnesses and Halo 2.
