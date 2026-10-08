import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appWithClock,
  buildBins,
  json,
  note,
  openAuction,
  placeBid,
  reconfirmAll,
} from "./test-helpers.ts";

test("winner settles inside the window without revealing the bid", async () => {
  buildBins();
  const now = { value: Date.now() };
  const app = appWithClock(now);
  await openAuction(app, { settlementWindow: 600 });
  const bob = await placeBid(app, { amount: 7_000_000, note: note(0x22) });
  const alice = await placeBid(app, { amount: 5_000_000, note: note(0x11) });
  await json(app, "/auctions/A123/close", { method: "POST" });
  await reconfirmAll(app, [bob, alice]);
  const winner = await json(app, "/auctions/A123/select-winner", { method: "POST" });
  assert.equal(winner.status, 200);
  assert.equal(winner.body.winnerBidId, bob.bidId);
  assert.equal(winner.body.status, "SETTLEMENT_WINDOW");

  const settled = await json(app, "/auctions/A123/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txid: "shielded-tx-bob" }),
  });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.status, "SETTLED");
  assert.equal(settled.body.settlementTxid, "shielded-tx-bob");
  assert.equal(JSON.stringify(settled.body).includes("7000000"), false);
});

test("expired window forfeits the bond and reruns argmax", async () => {
  buildBins();
  const now = { value: Date.now() };
  const app = appWithClock(now);
  await openAuction(app, { settlementWindow: 10 });
  const bob = await placeBid(app, { amount: 7_000_000, note: note(0x22) });
  const charlie = await placeBid(app, { amount: 6_000_000, note: note(0x33) });
  const alice = await placeBid(app, { amount: 5_000_000, note: note(0x11) });
  await json(app, "/auctions/A123/close", { method: "POST" });
  await reconfirmAll(app, [bob, charlie, alice]);

  const first = await json(app, "/auctions/A123/select-winner", { method: "POST" });
  assert.equal(first.body.winnerBidId, bob.bidId);

  const tooSoon = await json(app, "/auctions/A123/default", { method: "POST" });
  assert.equal(tooSoon.status, 409);

  now.value += 11_000;
  const next = await json(app, "/auctions/A123/default", { method: "POST" });
  assert.equal(next.status, 200);
  assert.equal(next.body.winnerBidId, charlie.bidId);
  assert.equal(next.body.status, "SETTLEMENT_WINDOW");
  assert.deepEqual(next.body.defaultedBidIds, [bob.bidId]);
  assert.equal(JSON.stringify(next.body).includes("7000000"), false);

  const listed = await json(app, "/auctions/A123/bids");
  const bobRow = listed.body.find((b: { bidId: string }) => b.bidId === bob.bidId);
  assert.equal(bobRow.status, "DEFAULTED");

  const settled = await json(app, "/auctions/A123/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txid: "shielded-tx-charlie" }),
  });
  assert.equal(settled.body.status, "SETTLED");
  assert.equal(settled.body.winnerBidId, charlie.bidId);
});
