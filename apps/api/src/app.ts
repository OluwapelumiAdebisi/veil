import { Hono } from "hono";
import type { Context } from "hono";
import { findForbiddenKeys } from "./invariant.ts";
import { MemoryStore } from "./store.ts";
import { accumulatorRoot, argmaxBids, verifyProof } from "./crypto.ts";
import type { BidShare, CreateAuctionBody, EligibilityProof } from "./types.ts";

export function createApp(store = new MemoryStore()) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/indexer", async (c) => {
    const acc = await accumulatorRoot(store.observed);
    return c.json(acc);
  });

  app.post("/indexer/observed", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return body.response;
    }
    const spent = (body.value as { spent?: string | number }).spent;
    if (spent === undefined || spent === null || spent === "") {
      return c.json({ error: "spent is required" }, 400);
    }
    store.addObserved(String(spent));
    return c.json(await accumulatorRoot(store.observed), 201);
  });

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
    const acc = await accumulatorRoot(store.observed);
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
      nullifierRoot: acc.root,
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
    const acc = await accumulatorRoot(store.observed);
    auction.nullifierRoot = acc.root;
    const checked = await acceptProof(c, store, auction.auctionId, proof, acc.root);
    if (checked.error) {
      return checked.error;
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

  app.post("/auctions/:id/close", async (c) => {
    const auction = store.getAuction(c.req.param("id"));
    if (!auction) {
      return c.json({ error: "not found" }, 404);
    }
    if (auction.status !== "OPEN" && auction.status !== "CLOSING") {
      return c.json({ error: "auction cannot close from this state" }, 409);
    }
    const acc = await accumulatorRoot(store.observed);
    auction.status = "ELIGIBILITY_CHECK";
    auction.closeRoot = acc.root;
    auction.nullifierRoot = acc.root;
    return c.json(auction);
  });

  app.post("/auctions/:id/bids/:bidId/reconfirm", async (c) => {
    const auction = store.getAuction(c.req.param("id"));
    const bid = store.getBid(c.req.param("id"), c.req.param("bidId"));
    if (!auction || !bid) {
      return c.json({ error: "not found" }, 404);
    }
    if (auction.status !== "ELIGIBILITY_CHECK") {
      return c.json({ error: "not in eligibility check" }, 409);
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
    if (proof.public.bid_tag !== bid.bidTag) {
      return c.json({ error: "bid tag mismatch" }, 400);
    }
    if (proof.public.bid_commitment.compressed !== bid.bidCommitment) {
      return c.json({ error: "bid commitment mismatch" }, 400);
    }
    const checked = await acceptProof(c, store, auction.auctionId, proof, auction.closeRoot, false);
    if (checked.error) {
      bid.status = "EXCLUDED";
      return checked.error;
    }
    bid.eligibilityProof = proof;
    bid.status = "RECONFIRMED";
    return c.json(publicBid(bid));
  });

  app.post("/committee/:nodeId/shares", async (c) => {
    const nodeId = Number(c.req.param("nodeId"));
    if (![1, 2, 3].includes(nodeId)) {
      return c.json({ error: "committee node must be 1, 2, or 3" }, 400);
    }
    const body = await readJson(c);
    if (!body.ok) {
      return body.response;
    }
    const forbidden = findForbiddenKeys(body.value);
    if (forbidden.length) {
      return c.json({ error: "forbidden fields", fields: forbidden }, 400);
    }
    const input = body.value as { auctionId?: string; bidId?: string; share?: BidShare };
    if (!input.auctionId || !input.bidId || !input.share) {
      return c.json({ error: "auctionId, bidId, and share are required" }, 400);
    }
    if (input.share.index !== nodeId) {
      return c.json({ error: "share index must match committee node" }, 400);
    }
    if (!store.getBid(input.auctionId, input.bidId)) {
      return c.json({ error: "not found" }, 404);
    }
    store.putShare(nodeId, input.bidId, input.share);
    return c.json({ ok: true, nodeId, bidId: input.bidId });
  });

  app.post("/auctions/:id/select-winner", async (c) => {
    const auction = store.getAuction(c.req.param("id"));
    if (!auction) {
      return c.json({ error: "not found" }, 404);
    }
    if (auction.status !== "ELIGIBILITY_CHECK" && auction.status !== "MPC_WINNER_SELECTION") {
      return c.json({ error: "winner selection is not available" }, 409);
    }
    auction.status = "MPC_WINNER_SELECTION";
    for (const bid of store.listBids(auction.auctionId)) {
      if (bid.status !== "RECONFIRMED") {
        bid.status = "EXCLUDED";
      }
    }
    const eligible = store.listBids(auction.auctionId).filter((b) => b.status === "RECONFIRMED");
    if (!eligible.length) {
      return c.json({ error: "no eligible bids" }, 409);
    }
    const mpcBids = [];
    for (const bid of eligible) {
      const s1 = store.getShare(1, bid.bidId);
      const s2 = store.getShare(2, bid.bidId);
      if (!s1 || !s2) {
        return c.json({ error: "missing committee shares", bidId: bid.bidId }, 409);
      }
      mpcBids.push({
        bid_id: bid.bidId,
        bid_commitment: { compressed: bid.bidCommitment },
        shares: [s1, s2],
      });
    }
    let result: { winner_bid_id: string };
    try {
      result = await argmaxBids(mpcBids);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "argmax failed" }, 400);
    }
    auction.winnerBidId = result.winner_bid_id;
    auction.status = "PROVISIONAL_WINNER";
    return c.json({
      winnerBidId: auction.winnerBidId,
      status: auction.status,
    });
  });

  return app;
}

async function acceptProof(
  c: Context,
  store: MemoryStore,
  auctionId: string,
  proof: EligibilityProof,
  expectedRoot: string | undefined,
  checkTag = true,
) {
  const auction = store.getAuction(auctionId);
  if (!auction) {
    return { error: c.json({ error: "not found" }, 404) };
  }
  if (!proof?.public || !proof.range_proof || !proof.non_membership) {
    return { error: c.json({ error: "eligibility proof is required" }, 400) };
  }
  if (proof.public.auction_id !== auction.auctionId) {
    return { error: c.json({ error: "auction id mismatch" }, 400) };
  }
  if (proof.public.minimum_bid !== auction.minimumBid) {
    return { error: c.json({ error: "minimum bid mismatch" }, 400) };
  }
  if (proof.public.bond_requirement !== auction.bondAmount) {
    return { error: c.json({ error: "bond mismatch" }, 400) };
  }
  if (expectedRoot && proof.public.nullifier_root !== expectedRoot) {
    return { error: c.json({ error: "nullifier root mismatch" }, 400) };
  }
  if (checkTag && store.hasTag(auction.auctionId, proof.public.bid_tag)) {
    return { error: c.json({ error: "bid tag already used" }, 409) };
  }
  const verified = await verifyProof(proof);
  if (!verified.valid) {
    return { error: c.json({ error: "invalid proof", detail: verified.error }, 400) };
  }
  return { error: null };
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
