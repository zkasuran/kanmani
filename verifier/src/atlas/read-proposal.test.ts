/**
 * Tool arguments are checked, not cast.
 *
 * The first real Qwen 3.8 Max run failed six turns in a row on a correct mapping, because the model sent
 * `claim` as a JSON-encoded string and the old code read paths off that string. These pin the fix with
 * the exact argument shape that run produced, plus the shapes that must still be refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readProposal } from "./induce.ts";
import { compileMapping } from "./compile.ts";
import { parseDocument } from "../ladder/parse.ts";

const DOC = new Uint8Array(readFileSync(new URL("../ladder/fixtures/tab-settlement-feedback.json", import.meta.url)));
const asQwenSentIt = {
  name: "tab-settlement-feedback.v1",
  note: "n",
  matchKeys: ["type", "settlement.txHash"],
  claim: JSON.stringify({ networkPath: "chainId", txHashPath: "settlement.txHash" }),
  predicted: { network: 143, txHash: "0x863e9ae50961b38e7bf12e7ae14e7384bc543725ea51c8acdd9dc8bf9f817497" },
};

test("a claim sent as a JSON string is decoded, so the mapping extracts what Qwen predicted", () => {
  const p = readProposal(asQwenSentIt);
  assert.ok(p);
  const out = parseDocument(DOC, [compileMapping(p, "2026-10-04")], "application/json");
  assert.equal(out.kind, "claim");
  if (out.kind === "claim") {
    assert.equal(out.claim.network, 143);
    assert.equal(out.claim.txHash, asQwenSentIt.predicted.txHash);
  }
});

test("a claim object is accepted as it is", () => {
  const p = readProposal({ ...asQwenSentIt, claim: { networkPath: "chainId", txHashPath: "settlement.txHash" } });
  assert.deepEqual(p?.claim, { networkPath: "chainId", txHashPath: "settlement.txHash" });
});

test("a null claim stays a noClaim proposal", () => {
  assert.equal(readProposal({ ...asQwenSentIt, claim: null })?.claim, null);
});

test("malformed arguments are refused rather than compiled", () => {
  for (const bad of [
    null, "x", [], {},
    { ...asQwenSentIt, name: "" },
    { ...asQwenSentIt, matchKeys: "type" },
    { ...asQwenSentIt, matchKeys: [1] },
    { ...asQwenSentIt, claim: "{not json" },
    { ...asQwenSentIt, claim: "[1,2]" },
    { ...asQwenSentIt, claim: { networkPath: 7 } },
    { ...asQwenSentIt, claim: { txHashPath: "" } },
  ]) {
    assert.equal(readProposal(bad), null, JSON.stringify(bad));
  }
});
