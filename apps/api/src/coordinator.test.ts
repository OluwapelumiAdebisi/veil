import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { proveLocal } from "./crypto.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function buildCrypto() {
  const targetDir = path.join(repoRoot, "target");
  const result = spawnSync("cargo", ["build", "-p", "veil-crypto", "--bin", "veil-crypto"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
      CARGO_TARGET_DIR: targetDir,
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "cargo build failed");
  }
}

async function json(app: ReturnType<typeof createApp>, pathName: string, init?: RequestInit) {
  const res = await app.request(pathName, init);
  return { status: res.status, body: await res.json() };
}

test("accepts a private bid and never stores the amount", async () => {
  buildCrypto();
  const app = createApp();
  const endTime = new Date(Date.now() + 60_000).toISOString();
  const created = await json(app, "/auctions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      auctionId: "A123",
      seller: "zseller",
      minimumBid: 1_000_000,
      bondAmount: 500_000,
      endTime,
    }),
  });
  assert.equal(created.status, 201);

  const { proof } = await proveLocal({
    auction_id: "A123",
    bid_amount: 7_000_000,
    minimum_bid: 1_000_000,
    bond_requirement: 500_000,
    note: {
      value: 10_000_000,
      rho: "11".repeat(32),
      nk: "22".repeat(32),
    },
  });

  const submitted = await json(app, "/auctions/A123/bids", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof }),
  });
  assert.equal(submitted.status, 201);
  const listed = await json(app, "/auctions/A123/bids");
  const payload = JSON.stringify(listed.body);
  assert.equal(payload.includes("7000000"), false);
  assert.equal(payload.includes("10000000"), false);
  assert.equal(listed.body[0].bidTag, proof.public.bid_tag);

  const leaked = await json(app, "/auctions/A123/bids", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof, bid_amount: 7_000_000 }),
  });
  assert.equal(leaked.status, 400);
});
