/**
 * The audit gate accepts one advisory on two paths and nothing else. Each case below tries to widen it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED, evaluate } from "../scripts/audit-gate.mjs";

const URL_ = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5";
const PATHS = ["node_modules/@x402/core/node_modules/zod", "node_modules/@x402/evm/node_modules/zod"];

/** What `npm audit --omit=dev --json` printed on 24 October 2026 once our own zod was at 4.6.6. */
const baseline = () => ({
  vulnerabilities: {
    "@x402/core": { severity: "high", isDirect: true, via: ["zod"], nodes: ["node_modules/@x402/core"] },
    "@x402/evm": { severity: "high", isDirect: true, via: ["@x402/core", "zod"], nodes: ["node_modules/@x402/evm"] },
    zod: { severity: "high", isDirect: false, via: [{ source: 1243066, name: "zod", url: URL_, range: "<4.6.6" }], nodes: [...PATHS] },
  },
});

test("the audit as it stands is accepted and each finding is reported as allowed", () => {
  const r = evaluate(baseline());
  assert.equal(r.ok, true);
  assert.deepEqual(r.accepted.map((a) => a.name).sort(), ["@x402/core", "@x402/evm", "zod"]);
});

test("an empty audit passes", () => {
  assert.equal(evaluate({ vulnerabilities: {} }).ok, true);
  assert.equal(evaluate({}).ok, true);
});

test("the same advisory in our own zod copy is refused", () => {
  const a = baseline();
  a.vulnerabilities.zod.nodes.push("node_modules/zod");
  const r = evaluate(a);
  assert.equal(r.ok, false);
  assert.match(r.unexpected[0]!.why!, /path the allowance does not cover/);
});

test("a third nested copy of zod is refused", () => {
  const a = baseline();
  a.vulnerabilities.zod.nodes.push("node_modules/some-other/node_modules/zod");
  assert.equal(evaluate(a).ok, false);
});

test("a different advisory on zod is refused", () => {
  const a = baseline();
  a.vulnerabilities.zod.via = [{ source: 1, name: "zod", url: "https://github.com/advisories/GHSA-0000-0000-0000", range: "<9" }] as never;
  const r = evaluate(a);
  assert.equal(r.ok, false);
  assert.match(r.unexpected[0]!.why!, /not the allowed one/);
});

test("a second advisory beside the allowed one on zod is refused", () => {
  const a = baseline();
  (a.vulnerabilities.zod.via as unknown[]).push({ source: 2, name: "zod", url: "https://github.com/advisories/GHSA-1111-1111-1111", range: "<9" });
  assert.equal(evaluate(a).ok, false);
});

test("an unrelated package at high is refused", () => {
  const a = baseline() as { vulnerabilities: Record<string, unknown> };
  a.vulnerabilities.next = { severity: "critical", isDirect: true, via: [{ source: 9, name: "next", url: "https://github.com/advisories/GHSA-2464-fhr4-w9xw", range: "<16.4.1" }], nodes: ["node_modules/next"] };
  const r = evaluate(a);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unexpected.map((u) => u.name), ["next"]);
});

test("an allowed dependent flagged for another reason is refused", () => {
  const a = baseline();
  a.vulnerabilities["@x402/evm"].via = ["@x402/core", "zod", "viem"] as never;
  assert.equal(evaluate(a).ok, false);
});

test("an allowed dependent flagged by an advisory of its own is refused", () => {
  const a = baseline();
  a.vulnerabilities["@x402/core"].via = [{ source: 5, name: "@x402/core", url: "https://github.com/advisories/GHSA-2222-2222-2222", range: "*" }] as never;
  assert.equal(evaluate(a).ok, false);
});

test("a moderate finding does not count at the high threshold, but does at moderate", () => {
  const a = { vulnerabilities: { "left-pad": { severity: "moderate", isDirect: true, via: [{ source: 3, name: "left-pad", url: "x", range: "*" }], nodes: ["node_modules/left-pad"] } } };
  assert.equal(evaluate(a).ok, true);
  assert.equal(evaluate(a, 2).ok, false);
});

test("the allowance names one advisory and exactly the two paths it was checked on", () => {
  assert.equal(ALLOWED.length, 1);
  assert.equal(ALLOWED[0]!.advisory, "GHSA-mrhx-c7xc-m3w5");
  assert.deepEqual([...ALLOWED[0]!.nodes].sort(), [...PATHS].sort());
});
