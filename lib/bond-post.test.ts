import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, erc20Abi } from "viem";

import { canPost, humanBlocks, planBond, releaseCalldata, SCLERA_ADDRESS, SCLERA_WRITE_ABI, suggestFloor, USDC_MONAD_ADDRESS, usdcToAtomic } from "./bond-post.ts";

const good = { agentId: "10256", amountUsdc: "0.01", minTruthRatePct: "80", windowBlocks: "216000", minSampleSize: "5" };

test("USDC parses to six-decimal atomic units without floats", () => {
  assert.equal(usdcToAtomic("0.01"), 10_000n);
  assert.equal(usdcToAtomic("1"), 1_000_000n);
  assert.equal(usdcToAtomic("0.000001"), 1n);
  for (const bad of ["", "-1", "0.0000001", "1e3", "abc", "1,5"]) assert.equal(usdcToAtomic(bad), null, bad);
});

test("a valid draft gives an exact approve then the postBond the contract expects", () => {
  const r = planBond(good);
  assert.ok(r.ok);
  if (!r.ok) return;
  const a = decodeFunctionData({ abi: erc20Abi, data: r.plan.approve.data });
  assert.equal(r.plan.approve.to, USDC_MONAD_ADDRESS);
  assert.equal(a.functionName, "approve");
  assert.deepEqual(a.args, [SCLERA_ADDRESS, 10_000n], "approval is for exactly the amount, never unlimited");
  const p = decodeFunctionData({ abi: SCLERA_WRITE_ABI, data: r.plan.post.data });
  assert.equal(r.plan.post.to, SCLERA_ADDRESS);
  assert.deepEqual(p.args, [10256n, USDC_MONAD_ADDRESS, 10_000n, 8000, 216_000n, 5]);
  assert.equal(r.plan.windowHuman, "16 hours");
});

test("every contract revert is refused in the form first", () => {
  const cases: [Partial<typeof good>, RegExp][] = [
    [{ agentId: "0" }, /agent id/],
    [{ amountUsdc: "0" }, /more than zero/],
    [{ minTruthRatePct: "100.01" }, /floor/],
    [{ minTruthRatePct: "80.123" }, /floor/],
    [{ windowBlocks: "0" }, /window/],
    [{ minSampleSize: "0" }, /minimum sample/],
  ];
  for (const [patch, re] of cases) {
    const r = planBond({ ...good, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) assert.ok(r.errors.some((e) => re.test(e)), JSON.stringify(r.errors));
  }
  assert.ok(planBond({ ...good, minTruthRatePct: "0" }).ok, "0% is legal on chain, even if it can never slash");
  assert.ok(planBond({ ...good, minTruthRatePct: "100" }).ok);
});

test("only the owner may post, one active bond at a time, and an unreadable chain decides nothing", () => {
  const me = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
  assert.deepEqual(canPost({ sender: me, owner: me.toLowerCase(), state: "none" }), { ok: true });
  assert.match((canPost({ sender: me, owner: "0x0000000000000000000000000000000000000001", state: "none" }) as { reason: string }).reason, /Only its owner/);
  assert.match((canPost({ sender: me, owner: me, state: "active" }) as { reason: string }).reason, /already has an active bond/);
  // Sclera version 2: a released or slashed bond may be followed by a new one, as postBond allows.
  for (const s of ["released", "slashed"] as const) {
    assert.deepEqual(canPost({ sender: me, owner: me, state: s }), { ok: true }, s);
  }
  const u = canPost({ sender: me, owner: null, state: "none" });
  assert.equal(u.ok, false);
  assert.equal((u as { unknown?: true }).unknown, true);
});

test("release encodes the agent id", () => {
  assert.deepEqual(decodeFunctionData({ abi: SCLERA_WRITE_ABI, data: releaseCalldata(10252n) }).args, [10252n]);
});

test("the suggested floor follows Assay's rule and refuses where Assay refuses", () => {
  assert.equal(suggestFloor(9000, 20).floorPct, "85.00");
  assert.equal(suggestFloor(238, 42).floorPct, null);
  assert.equal(suggestFloor(9000, 4).floorPct, null);
  assert.equal(suggestFloor(null, 0).floorPct, null);
});

test("window lengths read in human units", () => {
  assert.equal(humanBlocks(13_534n), "60 minutes");
  assert.equal(humanBlocks(2_273_684n), "7 days");
});
