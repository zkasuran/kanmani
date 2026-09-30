import assert from "node:assert/strict";
import test from "node:test";
import { firstFunder } from "./nansen.ts";

const ok = (data: unknown[]) => ({ ok: true as const, data: { data } as never, authMode: "apikey" as const, httpStatus: 200, paid: false });

test("the first First Funder relation is taken, lowercased, with its tx", () => {
  const f = firstFunder(ok([
    { address: "0xAAAA000000000000000000000000000000000002", relation: "First Funder", transaction_hash: "0x2", block_timestamp: "t2", order: 2, chain: "monad" },
    { address: "0xAAAA000000000000000000000000000000000001", address_label: "Binance 14", relation: "First Funder", transaction_hash: "0x1", block_timestamp: "t1", order: 1, chain: "monad" },
  ]));
  assert.deepEqual(f, { status: "found", funder: "0xaaaa000000000000000000000000000000000001", funderLabel: "Binance 14", tx: "0x1", fundedAt: "t1" });
});

test("no funder relation is none, a failed call is unknown, never a guess", () => {
  assert.equal(firstFunder(ok([{ address: "0xAAAA000000000000000000000000000000000001", relation: "Deployed Via", transaction_hash: "0x", block_timestamp: "", order: 1, chain: "monad" }])).status, "none");
  assert.equal(firstFunder(ok([])).status, "none");
  assert.equal(firstFunder({ ok: false, reason: "HTTP 403", authMode: "apikey", httpStatus: 403 }).status, "unknown");
  assert.equal(firstFunder(ok([{ address: "not-an-address", relation: "First Funder", transaction_hash: "0x", block_timestamp: "", order: 1, chain: "monad" }])).status, "none");
});
