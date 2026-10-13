import assert from "node:assert/strict";
import { test } from "node:test";
import { ExplorerZcash, inspectSettlementTx } from "./zcash.ts";

test("settlement requires a confirmed shielded transaction", () => {
  assert.equal(inspectSettlementTx(null).ok, false);
  assert.equal(
    inspectSettlementTx({ confirmations: 1, vout: [{ value: 1 }] }).ok,
    false,
  );
  assert.equal(
    inspectSettlementTx({ confirmations: 0, orchard: { actions: [{}] } }).ok,
    false,
  );
  assert.equal(
    inspectSettlementTx({ confirmations: 1, orchard: { actions: [{ encoding: "orchard" }] } }).ok,
    true,
  );
  assert.equal(
    inspectSettlementTx({ confirmations: 2, vShieldedOutput: [{ cv: "00" }] }).ok,
    true,
  );
});

test("inspection does not keep bid or output amounts", () => {
  const result = inspectSettlementTx({
    confirmations: 1,
    orchard: { actions: [{}], valueBalanceZat: 7_000_000 },
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("7000000"), false);
});

test("accepts CipherScan testnet explorer tx shape", () => {
  const result = inspectSettlementTx({
    txid: "98a18d4e96dc3933b08cda336bbfcc1253bb2110fac9b413721a995950ed2cce",
    confirmations: 18973,
    status: "confirmed",
    hasOrchard: true,
    orchardActions: 2,
    valueBalanceOrchardZat: "425001",
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("425001"), false);
});

test("verifies a real Zcash testnet orchard transaction", async () => {
  const zcash = new ExplorerZcash();
  const status = await zcash.status();
  assert.equal(status.ok, true);
  assert.equal(status.chain, "testnet");
  const verified = await zcash.verifyShieldedSettlement(
    "98a18d4e96dc3933b08cda336bbfcc1253bb2110fac9b413721a995950ed2cce",
  );
  assert.equal(verified.ok, true);
  const missing = await zcash.verifyShieldedSettlement("00".repeat(32));
  assert.equal(missing.ok, false);
});
