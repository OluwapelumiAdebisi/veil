import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { noteNullifier, proveLocal, splitBid } from "./crypto.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function buildBins() {
  const targetDir = path.join(repoRoot, "target");
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
    CARGO_TARGET_DIR: targetDir,
  };
  for (const args of [
    ["build", "-p", "veil-crypto", "--bin", "veil-crypto"],
    ["build", "-p", "veil-mpc", "--bin", "veil-mpc"],
  ]) {
    const result = spawnSync("cargo", args, { cwd: repoRoot, encoding: "utf8", env });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "cargo build failed");
    }
  }
}

async function json(app: ReturnType<typeof createApp>, pathName: string, init?: RequestInit) {
  const res = await app.request(pathName, init);
  return { status: res.status, body: await res.json() };
}

function note(byte: number) {
  return {
    value: 10_000_000,
    rho: byte.toString(16).padStart(2, "0").repeat(32),
    nk: (byte + 1).toString(16).padStart(2, "0").repeat(32),
  };
}

test("close-time spend drops Bob and MPC outputs Charlie only", async () => {
  buildBins();
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

  const players = [
    { name: "alice", amount: 5_000_000, note: note(0x11) },
    { name: "bob", amount: 7_000_000, note: note(0x22) },
    { name: "charlie", amount: 6_000_000, note: note(0x33) },
  ];
  const placed: Record<string, { bidId: string; amount: number; note: ReturnType<typeof note>; bidNonce: string }> = {};

  for (const player of players) {
    const { proof, bid_nonce } = await proveLocal({
      auction_id: "A123",
      bid_amount: player.amount,
      minimum_bid: 1_000_000,
      bond_requirement: 500_000,
      note: player.note,
    });
    const submitted = await json(app, "/auctions/A123/bids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    assert.equal(submitted.status, 201);
    const shares = await splitBid("A123", player.amount, bid_nonce);
    for (const share of shares) {
      const posted = await json(app, `/committee/${share.index}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auctionId: "A123",
          bidId: submitted.body.bidId,
          share,
        }),
      });
      assert.equal(posted.status, 200);
    }
    placed[player.name] = {
      bidId: submitted.body.bidId,
      amount: player.amount,
      note: player.note,
      bidNonce: bid_nonce,
    };
  }

  const bobNf = await noteNullifier(placed.bob.note);
  const spent = await json(app, "/indexer/observed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spent: bobNf }),
  });
  assert.equal(spent.status, 201);

  const closed = await json(app, "/auctions/A123/close", { method: "POST" });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, "ELIGIBILITY_CHECK");
  const closeRoot = closed.body.closeRoot as string;
  const observed = [bobNf];

  for (const name of ["alice", "charlie"] as const) {
    const { proof } = await proveLocal({
      auction_id: "A123",
      bid_amount: placed[name].amount,
      minimum_bid: 1_000_000,
      bond_requirement: 500_000,
      note: placed[name].note,
      spent_nullifiers: observed,
      bid_nonce: placed[name].bidNonce,
    });
    assert.equal(proof.public.nullifier_root, closeRoot);
    const re = await json(app, `/auctions/A123/bids/${placed[name].bidId}/reconfirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    assert.equal(re.status, 200);
    assert.equal(re.body.status, "RECONFIRMED");
  }

  await assert.rejects(() =>
    proveLocal({
      auction_id: "A123",
      bid_amount: placed.bob.amount,
      minimum_bid: 1_000_000,
      bond_requirement: 500_000,
      note: placed.bob.note,
      spent_nullifiers: observed,
    }),
  );

  const winner = await json(app, "/auctions/A123/select-winner", { method: "POST" });
  assert.equal(winner.status, 200);
  assert.equal(winner.body.winnerBidId, placed.charlie.bidId);
  assert.equal(winner.body.status, "SETTLEMENT_WINDOW");
  const payload = JSON.stringify(winner.body);
  assert.equal(payload.includes("5000000"), false);
  assert.equal(payload.includes("7000000"), false);
  assert.equal(payload.includes("6000000"), false);

  const listed = await json(app, "/auctions/A123/bids");
  const bobRow = listed.body.find((b: { bidId: string }) => b.bidId === placed.bob.bidId);
  assert.equal(bobRow.status, "EXCLUDED");
});
