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
7. Orchard + Halo 2 — funding notes are real Orchard notes; eligibility ranges are a Halo 2 proof.
8. Orchard Merkle membership — eligibility includes an Orchard auth path so `cmx` opens to a public `anchor` (same MerkleCRH as the chain tree). Pin `orchardAnchor` on an auction to require a shared root; otherwise the local prover builds a tree of the same hash. Live lightwalletd path fetch is still outstanding.

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

## Host the marketplace on Vercel

The Next.js UI belongs on Vercel. The coordinator (`apps/api`) spawns `veil-crypto` / `veil-mpc` and keeps auction state in memory, so it cannot run on Vercel serverless. Host the API on Fly, Railway, or Render with `infrastructure/Dockerfile.api`, then point Vercel at it.

1. In Vercel, **Add New… → Project** (not a Service). Import [OluwapelumiAdebisi/veil](https://github.com/OluwapelumiAdebisi/veil).
2. If the URL contains `framework=services`, cancel and start a Project import instead — or leave it: repo-root `vercel.json` now exposes `apps/web` as the Next.js service.
3. Prefer setting **Root Directory** to `apps/web` and Framework **Next.js**. Deploy once (lots will fail until the API is up).
4. Deploy the API from the repo root:

```bash
docker build -f infrastructure/Dockerfile.api -t veil-api .
```

5. In the Vercel project, add `VEIL_API_ORIGIN` = `https://your-api-host` (no trailing slash). Redeploy.

The browser still calls `/veil/...` on the Vercel domain. Next rewrites those requests to the coordinator. Do not set `NEXT_PUBLIC_VEIL_API` unless you want the browser to talk to the API origin directly.

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
