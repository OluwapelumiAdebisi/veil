import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { MemoryStore } from "./store.ts";

test("local prover is not written into coordinator bid records", async () => {
  const store = new MemoryStore();
  const app = createApp(store);
  const listed = await app.request("/auctions");
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), []);
  assert.equal(store.listBids("A123").length, 0);
});
