import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { proveLocal, splitBid } from "./crypto.ts";
import type { Clock } from "./clock.ts";
import { MemoryStore } from "./store.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function buildBins() {
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

export async function json(app: ReturnType<typeof createApp>, pathName: string, init?: RequestInit) {
  const res = await app.request(pathName, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { error: text } };
  }
}

export function note(byte: number) {
  return {
    value: 10_000_000,
    rho: byte.toString(16).padStart(2, "0").repeat(32),
    nk: (byte + 1).toString(16).padStart(2, "0").repeat(32),
  };
}

export type Placed = {
  bidId: string;
  amount: number;
  note: ReturnType<typeof note>;
  bidNonce: string;
};

export async function openAuction(
  app: ReturnType<typeof createApp>,
  extra: Record<string, unknown> = {},
) {
  return json(app, "/auctions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      auctionId: "A123",
      seller: "zseller",
      minimumBid: 1_000_000,
      bondAmount: 500_000,
      endTime: new Date(Date.now() + 60_000).toISOString(),
      ...extra,
    }),
  });
}

export async function placeBid(
  app: ReturnType<typeof createApp>,
  player: { amount: number; note: ReturnType<typeof note> },
): Promise<Placed> {
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
  if (submitted.status !== 201) {
    throw new Error(`bid failed: ${JSON.stringify(submitted.body)}`);
  }
  const shares = await splitBid("A123", player.amount, bid_nonce);
  for (const share of shares) {
    await json(app, `/committee/${share.index}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auctionId: "A123",
        bidId: submitted.body.bidId,
        share,
      }),
    });
  }
  return {
    bidId: submitted.body.bidId,
    amount: player.amount,
    note: player.note,
    bidNonce: bid_nonce,
  };
}

export async function reconfirmAll(
  app: ReturnType<typeof createApp>,
  placed: Placed[],
  spentNullifiers: string[] = [],
) {
  for (const player of placed) {
    const { proof } = await proveLocal({
      auction_id: "A123",
      bid_amount: player.amount,
      minimum_bid: 1_000_000,
      bond_requirement: 500_000,
      note: player.note,
      spent_nullifiers: spentNullifiers,
      bid_nonce: player.bidNonce,
    });
    const re = await json(app, `/auctions/A123/bids/${player.bidId}/reconfirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    if (re.status !== 200) {
      throw new Error(`reconfirm failed: ${JSON.stringify(re.body)}`);
    }
  }
}

export function appWithClock(now: { value: number }) {
  const clock: Clock = { now: () => now.value };
  return createApp(new MemoryStore(), clock);
}
