# Veil

Privacy-first sealed-bid auctions on Zcash.

A bidder proves *I submitted a valid bid, I control sufficient funds, and my bid is eligible* without revealing bid amount, funding amount, wallet secrets, or other auction activity.

This repository is the Zecathon V1 implementation of that protocol. Cryptography lives in Rust. Application APIs will live in TypeScript.

## Current milestone

1. `crates/veil-crypto` — hidden bids, Orchard notes, Halo 2 eligibility, and a nullifier accumulator.
2. `crates/veil-mpc` — 2-of-3 Shamir shares and private argmax (winner id only).
3. `apps/api` — close, reconfirm, private winner selection, settlement window, default / next winner.
4. `apps/web` — sealed-bid marketplace (list lots, bid privately, seller close/settle).
5. Zcash settlement — txids are verified on **testnet** (CipherScan) by default, or on a local `zcashd` if `ZCASH_RPC_URL` is up (`./scripts/zcash-regtest.sh`).
6. Unified Addresses — seller and Zodl-linked addresses must include an Orchard receiver (`veil-crypto address`).
7. Orchard + Halo 2 — funding notes are real Orchard notes; eligibility ranges are a Halo 2 proof. Merkle membership of `cmx` in the chain tree is still outstanding.

```bash
source "$HOME/.cargo/env"
cargo test
cargo build -p veil-crypto --bin veil-crypto
cargo build -p veil-mpc --bin veil-mpc
cd apps/api && npm install && npm test && npm start
# another terminal
cd apps/web && npm install && npm run dev
# optional: real shielded settlement
./scripts/zcash-regtest.sh
```

Open `http://127.0.0.1:3000`. Browse lots, list an item, and place a sealed bid. Amounts stay on the bidder’s device; the coordinator only stores tags, commitments, and status.

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
