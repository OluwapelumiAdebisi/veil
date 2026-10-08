# Veil

Privacy-first sealed-bid auctions on Zcash.

A bidder proves *I submitted a valid bid, I control sufficient funds, and my bid is eligible* without revealing bid amount, funding amount, wallet secrets, or other auction activity.

This repository is the Zecathon V1 implementation of that protocol. Cryptography lives in Rust. Application APIs will live in TypeScript.

## Current milestone

1. `crates/veil-crypto` — hidden bid commitments, bid tags, and a toy eligibility proof.
2. `apps/api` — coordinator that accepts proofs and **refuses** bid amounts, funding amounts, and wallet secrets.

```bash
source "$HOME/.cargo/env"
cargo test -p veil-crypto
cargo build -p veil-crypto --bin veil-crypto
cd apps/api && npm install && npm test
```

Toy notes and Bulletproofs stand in for Orchard + Halo 2.

## Layout

```
veil/
├── apps/            # Node coordinator API; Next.js web later
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
