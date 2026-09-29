import assert from "node:assert/strict";
import test from "node:test";

import { formatNative, gasCheck } from "./gas.ts";

const GWEI = 10n ** 9n;

test("enough when the balance covers the estimate with the margin", () => {
  const c = gasCheck(10n ** 18n, 200_000n, 100n * GWEI);
  assert.equal(c.state, "enough");
  if (c.state === "enough") assert.equal(c.needWei, 30_000_000n * GWEI);
});

test("short says by how much, including the margin", () => {
  const c = gasCheck(0n, 200_000n, 100n * GWEI);
  assert.equal(c.state, "short");
  if (c.state === "short") assert.equal(c.shortWei, 30_000_000n * GWEI);
  const edge = gasCheck(20_000_000n * GWEI, 200_000n, 100n * GWEI);
  assert.equal(edge.state, "short", "the bare estimate without margin is not enough");
});

test("an unreadable balance, estimate or price is unknown, never enough or short", () => {
  assert.equal(gasCheck(null, 1n, 1n).state, "unknown");
  assert.equal(gasCheck(1n, null, 1n).state, "unknown");
  assert.equal(gasCheck(1n, 1n, null).state, "unknown");
  assert.equal(gasCheck(-1n, 1n, 1n).state, "unknown");
});

test("the margin rounds up so the need is never understated", () => {
  const c = gasCheck(0n, 1n, 1n);
  assert.equal(c.state, "short");
  if (c.state === "short") assert.equal(c.needWei, 2n);
});

test("native amounts are cut rather than rounded and a tiny amount is never shown as zero", () => {
  assert.equal(formatNative(13_840_797_218_000_000_000n), "13.840797");
  assert.equal(formatNative(10n ** 18n), "1");
  assert.equal(formatNative(0n), "0");
  assert.equal(formatNative(1_999_999_999_999_999n, 2), "0.0019");
  assert.equal(formatNative(3_000n), "0.000000000000003");
});
