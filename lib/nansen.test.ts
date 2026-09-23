/**
 * The Nansen client, tested against the injected transport, no network and no key.
 *
 * The load-bearing tests are the honesty ones: an empty answer is `unlabeled` not a negative, a
 * failed lookup is `unknown` not a label. A non-200 is an error rather than a body quietly
 * treated as data. Those three are exactly the ways a wallet-intelligence integration lies without
 * meaning to, so each has a test that fails if the client starts doing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callNansen,
  classifyLabels,
  enrichWallet,
  fetchRelatedWallets,
  normalizeCategory,
  type NansenAuth,
  type NansenHttpRequest,
  type NansenHttpResponse,
  type NansenTransport,
} from "./nansen.ts";

/** A transport that answers from a queue and records every request it was handed. */
function scripted(responses: NansenHttpResponse[]): { transport: NansenTransport; seen: NansenHttpRequest[] } {
  const seen: NansenHttpRequest[] = [];
  const queue = [...responses];
  const transport: NansenTransport = async (req) => {
    seen.push(req);
    const r = queue.shift();
    if (!r) throw new Error("transport ran out of scripted responses");
    return r;
  };
  return { transport, seen };
}

const json = (status: number, body: unknown): NansenHttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  bodyText: JSON.stringify(body),
});

const apikey: NansenAuth = { mode: "apikey", apiKey: "test-key" };

/* ------------------------------------------------------------------ classification */

test("no labels is unlabeled, never a category and never a negative", () => {
  const c = classifyLabels([]);
  assert.equal(c.status, "unlabeled");
  assert.equal(c.category, null);
  assert.deepEqual(c.labels, []);
});

test("rows that carry no readable label are still unlabeled, not invented into one", () => {
  const c = classifyLabels([{ category: "defi" }, { label: "   " }]);
  assert.equal(c.status, "unlabeled");
  assert.equal(c.category, null);
});

test("the most telling category wins when several are present", () => {
  const c = classifyLabels([
    { label: "Uniswap LP", category: "defi" },
    { label: "Binance 14", category: "cefi" },
    { label: "Smart Trader", category: "smart_money" },
  ]);
  assert.equal(c.status, "labeled");
  assert.equal(c.category, "smart_money");
  assert.deepEqual(c.labels, ["Uniswap LP", "Binance 14", "Smart Trader"]);
});

test("others normalises to other and a label with no category falls back to it", () => {
  assert.equal(normalizeCategory("others"), "other");
  assert.equal(normalizeCategory(undefined), "other");
  const c = classifyLabels([{ label: "Fund X" }]);
  assert.equal(c.status, "labeled");
  assert.equal(c.category, "other");
});

/* ------------------------------------------------------------------ the apikey path */

test("apikey mode sends the lowercase apikey header and parses a 200", async () => {
  const { transport, seen } = scripted([json(200, { data: [{ label: "Coinbase 1", category: "cefi" }] })]);
  const res = await enrichWallet("0xABCDEF", "monad", apikey, transport);
  assert.equal(seen[0]!.headers.apikey, "test-key");
  assert.equal(seen[0]!.url, "https://api.nansen.ai/api/v1/profiler/address/labels");
  assert.equal(res.address, "0xabcdef", "address is stored lowercased");
  assert.equal(res.status, "labeled");
  assert.equal(res.category, "cefi");
  assert.equal(res.authMode, "apikey");
});

test("a missing apikey refuses rather than making an unauthenticated call", async () => {
  const { transport, seen } = scripted([]);
  const res = await callNansen("/api/v1/profiler/address/labels", {}, { mode: "apikey", apiKey: "" }, transport);
  assert.equal(res.ok, false);
  assert.equal(seen.length, 0, "no request went out");
});

/* ------------------------------------------------------------------ the x402 path */

test("x402 pays on a 402 and retries with the PAYMENT-SIGNATURE header", async () => {
  const { transport, seen } = scripted([
    { status: 402, headers: { "www-authenticate": "x402" }, bodyText: JSON.stringify({ accepts: [{ network: "eip155:143" }] }) },
    json(200, { data: [{ address: "0xdead", relation: "funder", transaction_hash: "0x1", block_timestamp: "t", order: 1, chain: "monad" }] }),
  ]);
  let challengeSeen = false;
  const auth: NansenAuth = {
    mode: "x402",
    payerAddress: "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    pay: async (ch) => {
      challengeSeen = ch.status === 402;
      return "base64-signed-payment";
    },
  };
  const res = await fetchRelatedWallets("0xabc", "monad", auth, transport);
  assert.ok(challengeSeen, "the payer was handed the 402 challenge");
  assert.equal(seen.length, 2, "one unpaid attempt then one paid retry");
  assert.equal(seen[0]!.headers["x-payer-address"], "0xDB6c6340342e71A63cD11Ebac2185204b7777777");
  assert.equal(seen[1]!.headers["payment-signature"], "base64-signed-payment");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.paid, true);
});

test("x402 with a payer that cannot sign is an error, never an unpaid retry", async () => {
  const { transport, seen } = scripted([
    { status: 402, headers: {}, bodyText: "{}" },
  ]);
  const auth: NansenAuth = { mode: "x402", pay: async () => { throw new Error("no funds"); } };
  const res = await fetchRelatedWallets("0xabc", "monad", auth, transport);
  assert.equal(res.ok, false);
  assert.equal(seen.length, 1, "it did not retry without paying");
  if (!res.ok) assert.match(res.reason, /x402 payment could not be produced/);
});

/* ------------------------------------------------------------------ errors are never swallowed */

test("a lookup that fails is unknown, not unlabeled and not a category", async () => {
  const { transport } = scripted([json(500, { message: "internal error" })]);
  const res = await enrichWallet("0xabc", "monad", apikey, transport);
  assert.equal(res.status, "unknown", "our failure to look is unknown");
  assert.notEqual(res.status, "unlabeled");
  assert.equal(res.category, null);
  assert.equal(res.httpStatus, 500);
  assert.match(res.reason, /HTTP 500/);
});

test("a 429 rate limit is surfaced as an error, not treated as no labels", async () => {
  const { transport } = scripted([json(429, { message: "rate limited" })]);
  const res = await callNansen("/api/v1/profiler/address/labels", { address: "0xabc", chain: "monad" }, apikey, transport);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.httpStatus, 429);
});

test("a 200 that is not JSON is an error rather than a fabricated empty answer", async () => {
  const { transport } = scripted([{ status: 200, headers: {}, bodyText: "<html>maintenance</html>" }]);
  const res = await enrichWallet("0xabc", "monad", apikey, transport);
  assert.equal(res.status, "unknown");
  assert.match(res.reason, /not JSON/);
});

test("Nansen answering with an empty data array is unlabeled, which the page shows as unknown", async () => {
  const { transport } = scripted([json(200, { data: [] })]);
  const res = await enrichWallet("0xabc", "monad", apikey, transport);
  assert.equal(res.status, "unlabeled");
  assert.equal(res.category, null);
  assert.equal(res.labelCount, 0);
});
