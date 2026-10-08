import assert from "node:assert/strict";
import { test } from "node:test";
import { findForbiddenKeys } from "./invariant.ts";

test("allows public bid payload", () => {
  const hits = findForbiddenKeys({
    proof: {
      public: {
        auction_id: "A123",
        bid_commitment: { compressed: "aa" },
        bid_tag: "bb",
      },
      range_proof: "cc",
    },
  });
  assert.deepEqual(hits, []);
});

test("rejects bid amount anywhere in the tree", () => {
  const hits = findForbiddenKeys({
    proof: { public: { bid_amount: 7 } },
  });
  assert.deepEqual(hits, ["proof.public.bid_amount"]);
});
