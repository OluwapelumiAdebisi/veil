import { Hono } from "hono";
import type { Context } from "hono";
import { findForbiddenKeys } from "./invariant.ts";
import { MemoryStore } from "./store.ts";
import { verifyProof } from "./crypto.ts";
import type { CreateAuctionBody, EligibilityProof } from "./types.ts";

export function createApp(store = new MemoryStore()) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/auctions", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return body.response;
    }
    const forbidden = findForbiddenKeys(body.value);
    if (forbidden.length) {
      return c.json({ error: "forbidden fields", fields: forbidden }, 400);
    }
    const input = body.value as CreateAuctionBody;
    if (!input.seller || input.minimumBid == null || input.bondAmount == null || !input.endTime) {
      return c.json({ error: "seller, minimumBid, bondAmount, and endTime are required" }, 400);
    }
    const auctionId = input.auctionId ?? crypto.randomUUID();
    if (store.getAuction(auctionId)) {
      return c.json({ error: "auction already exists" }, 409);
    }
    const now = new Date().toISOString();
    const auction = {
      auctionId,
      seller: input.seller,
      minimumBid: input.minimumBid,
      bondAmount: input.bondAmount,
      startTime: input.startTime ?? now,
      endTime: input.endTime,
      settlementWindow: input.settlementWindow ?? 600,
      pricingRule: "FIRST_PRICE" as const,
      status: "OPEN" as const,
    };
    store.putAuction(auction);
    return c.json(auction, 201);
  });

  app.get("/auctions/:id", (c) => {
    const auction = store.getAuction(c.req.param("id"));
    if (!auction) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(auction);
  });

  app.post("/auctions/:id/bids", async (c) => {
    const auction = store.getAuction(c.req.param("id"));
    if (!auction) {
      return c.json({ error: "not found" }, 404);
    }
    if (auction.status !== "OPEN") {
      return c.json({ error: "auction is not accepting bids" }, 409);
    }
    if (Date.parse(auction.endTime) <= Date.now()) {
      auction.status = "CLOSING";
      return c.json({ error: "auction is not accepting bids" }, 409);
    }

    const body = await readJson(c);
    if (!body.ok) {
      return body.response;
    }
    const forbidden = findForbiddenKeys(body.value);
    if (forbidden.length) {
      return c.json({ error: "forbidden fields", fields: forbidden }, 400);
    }

    const proof = (body.value as { proof?: EligibilityProof }).proof ?? (body.value as EligibilityProof);
    if (!proof?.public || !proof.range_proof) {
      return c.json({ error: "eligibility proof is required" }, 400);
    }
    if (proof.public.auction_id !== auction.auctionId) {
      return c.json({ error: "auction id mismatch" }, 400);
    }
    if (proof.public.minimum_bid !== auction.minimumBid) {
      return c.json({ error: "minimum bid mismatch" }, 400);
    }
    if (proof.public.bond_requirement !== auction.bondAmount) {
      return c.json({ error: "bond mismatch" }, 400);
    }
    if (store.hasTag(auction.auctionId, proof.public.bid_tag)) {
      return c.json({ error: "bid tag already used" }, 409);
    }

    const verified = await verifyProof(proof);
    if (!verified.valid) {
      return c.json({ error: "invalid proof", detail: verified.error }, 400);
    }

    const bid = {
      bidId: crypto.randomUUID(),
      auctionId: auction.auctionId,
      bidCommitment: proof.public.bid_commitment.compressed,
      fundingCommitment: proof.public.funding_commitment.compressed,
      bidTag: proof.public.bid_tag,
      noteCommitment: proof.public.note_commitment,
      eligibilityProof: proof,
      status: "ACCEPTED" as const,
      createdAt: new Date().toISOString(),
    };
    store.addBid(bid);
    return c.json(publicBid(bid), 201);
  });

  app.get("/auctions/:id/bids", (c) => {
    const auction = store.getAuction(c.req.param("id"));
    if (!auction) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(store.listBids(auction.auctionId).map(publicBid));
  });

  return app;
}

function publicBid(bid: {
  bidId: string;
  auctionId: string;
  bidCommitment: string;
  fundingCommitment: string;
  bidTag: string;
  noteCommitment: string;
  status: string;
  createdAt: string;
}) {
  return {
    bidId: bid.bidId,
    auctionId: bid.auctionId,
    bidCommitment: bid.bidCommitment,
    fundingCommitment: bid.fundingCommitment,
    bidTag: bid.bidTag,
    noteCommitment: bid.noteCommitment,
    status: bid.status,
    createdAt: bid.createdAt,
  };
}

async function readJson(c: Context) {
  try {
    return { ok: true as const, value: await c.req.json() };
  } catch {
    return { ok: false as const, response: c.json({ error: "invalid json" }, 400) };
  }
}
