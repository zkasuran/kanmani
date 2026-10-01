import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_QUOTE_CHAINS, sourceByKey, scaleAmount, assertSourcesLive, type FundSource } from "./fund-sources.ts";

/** The multi-source chain set and the decimals-safe scaler, plus the drift guard over /supported_tokens. */

test("the source set has at least four chains and at least one non-EVM", () => {
  assert.ok(SOURCE_QUOTE_CHAINS.length >= 4, "need at least four source chains");
  assert.ok(SOURCE_QUOTE_CHAINS.some((s) => s.evm === false), "need at least one non-EVM source");
  assert.ok(SOURCE_QUOTE_CHAINS.some((s) => s.key === "solana" && s.evm === false), "Solana is the primary non-EVM pick");
});

test("every default source is 6-decimal, so the BNB 18-decimal trap cannot sneak in", () => {
  for (const s of SOURCE_QUOTE_CHAINS) assert.equal(s.decimals, 6, s.key);
});

test("sourceByKey resolves a known key and misses an unknown one", () => {
  assert.equal(sourceByKey("base")?.label, "Base");
  assert.equal(sourceByKey("bitcoin"), undefined);
});

test("scaleAmount scales by the asset's own decimals and rejects over-precise input", () => {
  assert.equal(scaleAmount("0.12", 6), 120000n);
  assert.equal(scaleAmount("1", 6), 1_000_000n);
  assert.equal(scaleAmount("0.12", 18), 120000000000000000n);
  assert.equal(scaleAmount("100", 6), 100_000_000n);
  assert.throws(() => scaleAmount("0.1234567", 6));
  assert.throws(() => scaleAmount("abc", 6));
});

function stubTokens(ids: string[]): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => ({ result: ids.map((id) => ({ assetId: id, symbol: "USDC" })) }) })) as unknown as typeof fetch;
}

test("assertSourcesLive passes when every assetId is present in the live list", async () => {
  const all = SOURCE_QUOTE_CHAINS.map((s: FundSource) => s.assetId);
  await assert.doesNotReject(() => assertSourcesLive(stubTokens(all), "https://intents-connect-api.aurora.dev/api/v1"));
});

test("assertSourcesLive throws, naming the drifted chain, when an assetId is missing", async () => {
  const all = SOURCE_QUOTE_CHAINS.map((s: FundSource) => s.assetId).filter((id) => !id.includes("sol-"));
  await assert.rejects(
    () => assertSourcesLive(stubTokens(all), "https://intents-connect-api.aurora.dev/api/v1"),
    /drifted.*solana/,
  );
});
