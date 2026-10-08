# Veil

Privacy-first sealed-bid auctions on Zcash.

A bidder proves *I submitted a valid bid, I control sufficient funds, and my bid is eligible* without revealing bid amount, funding amount, wallet secrets, or other auction activity.

This repository is the Zecathon V1 implementation of that protocol. Cryptography lives in Rust. Application APIs will live in TypeScript.

## Current milestone

1. `crates/veil-crypto` — hidden bids, toy eligibility, and a nullifier accumulator.
2. `crates/veil-mpc` — 2-of-3 Shamir shares and private argmax (winner id only).
3. `apps/api` — close, reconfirm, private winner selection, settlement window, default / next winner.
4. `apps/web` — sealed-bid marketplace (list lots, bid privately, seller close/settle).

```bash
source "$HOME/.cargo/env"
cargo test
cargo build -p veil-crypto --bin veil-crypto
cargo build -p veil-mpc --bin veil-mpc
cd apps/api && npm install && npm test && npm start
# another terminal
cd apps/web && npm install && npm run dev
```

Open `http://127.0.0.1:3000`. Browse lots, list an item, and place a sealed bid. Amounts stay on the bidder’s device; the coordinator only stores tags, commitments, and status.

Toy notes and Bulletproofs stand in for Orchard + Halo 2.

## Layout

```
veil/
├── apps/            # Node coordinator API + Next.js marketplace
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
