# Veil

Privacy-first sealed-bid auctions on Zcash.

A bidder proves *I submitted a valid bid, I control sufficient funds, and my bid is eligible* without revealing bid amount, funding amount, wallet secrets, or other auction activity.

This repository is the Zecathon V1 implementation of that protocol. Cryptography lives in Rust. Application APIs will live in TypeScript.

## Current milestone

`crates/veil-crypto` — local bid commitments, bid tags, and a toy eligibility proof.

The verifier sees public inputs and **VALID / INVALID**. It does not see the bid.

```bash
source "$HOME/.cargo/env"
cargo test -p veil-crypto
```

Toy notes and Bulletproofs range proofs stand in for Orchard + Halo 2. That swap is the next crypto milestone.

## Layout

```
veil/
├── apps/            # Next.js web + Node API (later)
├── crates/          # Rust crypto, zcash, mpc, prover
├── services/        # indexer + MPC committee (later)
├── database/
├── infrastructure/
├── docs/protocol.md
└── tests/
```

## Explicit V1 limits

Funding is not locked at bid time. Settlement is a race the winner must win. The MPC committee is a trust assumption. Veil never custodians funds.

Repository: https://github.com/OluwapelumiAdebisi/veil
