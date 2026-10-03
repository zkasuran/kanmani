import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quoteFunding,
  createFunding,
  readFundingStatus,
  getExecution,
  parseSigningPayload,
  parseExecutionList,
  submitFundingSignature,
  ShortfallError,
  IntentsError,
  IntentsConfigError,
  type FetchLike,
  type IntentsConfig,
} from "./intents.ts";

/**
 * The /api/fund/* orchestration layer, driven through the same injected-fetch seam the forward client
 * uses, so no network is touched and every branch is reachable. These prove the quote reports a short
 * delivery instead of throwing, the create refuses a doomed execution, the key reaches only Aurora and
 * never a response, and the status read is keyless and filtered by id. In a separate file from
 * `intents.test.ts` so the two suites never collide on a merge.
 *
 * Mutation log (each check was made to fail once before it was trusted, then reverted):
 *   - dropped the `shortfall` comparison in quoteFunding: the shortfall test went green on a short
 *     quote, confirming the assertion bites. Reverted.
 *   - let the id filter in parseExecutionList match the first item: the 404 test still passed but the
 *     wrong-id test returned docA, confirming the filter is load-bearing. Reverted.
 *   - added apiKey to the FundCreateResult projection: the no-secret test failed as it must. Reverted.
 */

const AGENT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const INTERMEDIARY = "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E";
const ID = "e5abf7ce-0000-4000-8000-000000000001";
const OTHER_ID = "e5abf7ce-0000-4000-8000-000000000002";

function stubFetch(status: number, body: unknown, calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

function cfg(over: Partial<IntentsConfig> = {}): IntentsConfig {
  return { apiKey: "key-test", ...over };
}

/** A dry/create quote response: post-fee amounts, the fee step the service appends. */
function priced(minAmountOut: string, networkFee = "7150") {
  return {
    result: {
      status: "CREATED",
      details: { intermediaryAddress: INTERMEDIARY, networkFee },
      quote: { amountIn: "1270000", amountOut: "88150", minAmountOut, depositAddress: "0xdead" },
      steps: [],
    },
  };
}

/** A create response that also carries the signing payload, both field names present. */
function created(minAmountOut: string) {
  const b = priced(minAmountOut) as {
    result: { id?: string; details: Record<string, unknown>; quote: Record<string, unknown> };
  };
  b.result.id = ID;
  b.result.details.messageToSign = "SIGN-ME-755-chars";
  b.result.details.payload = { payload_json: "CANONICAL-PAYLOAD-JSON", payload_bytes_base64: "AA==", standard: "erc191" };
  b.result.details.signingStandard = "erc191";
  return b;
}

/** A by-wallet list response: result is the array of executionDocs. */
function listBody(docs: unknown[]) {
  return { result: { items: docs } };
}

function doc(id: string, status: string) {
  return {
    id,
    status,
    quote: { minAmountOut: "87125", depositAddress: "0xdead", destinationAsset: "nep245:…:143_x", deadline: "4102444800" },
    details: { intermediaryAddress: INTERMEDIARY, networkFee: "7150", messageSigned: true },
  };
}

const base = { wallet: WALLET, originAsset: "nep141:base-usdc.omft.near", amount: "1270000", agent: AGENT };

/* ------------------------------------------------------------------ quoteFunding */

test("quoteFunding returns the delivery, fee and intermediary with shortfall false when it covers the job", async () => {
  const r = await quoteFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, priced("87125")) }));
  assert.equal(r.minAmountOut, 87125n);
  assert.equal(r.networkFee, 7150n);
  assert.equal(r.intermediary, INTERMEDIARY);
  assert.equal(r.needed, 87125n);
  assert.equal(r.shortfall, false);
});

test("quoteFunding reports a short quote and never throws", async () => {
  const r = await quoteFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, priced("80000")) }));
  assert.equal(r.minAmountOut, 80000n);
  assert.equal(r.needed, 87125n);
  assert.equal(r.shortfall, true);
});

test("quoteFunding with no jobAmount sizes needed to the delivery, so it is never short", async () => {
  const r = await quoteFunding({ ...base }, cfg({ fetchImpl: stubFetch(200, priced("87125")) }));
  assert.equal(r.needed, 87125n);
  assert.equal(r.shortfall, false);
});

/* ------------------------------------------------------------------ createFunding */

test("createFunding returns the id, deposit address and signing payload, preferring payload_json", async () => {
  const r = await createFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, created("87125")) }));
  assert.equal(r.id, ID);
  assert.equal(r.wallet, WALLET);
  assert.equal(r.depositAddress, "0xdead");
  assert.equal(r.intermediary, INTERMEDIARY);
  assert.equal(r.needed, 87125n);
  assert.equal(r.payloadJson, "CANONICAL-PAYLOAD-JSON");
  assert.equal(r.messageToSign, "SIGN-ME-755-chars");
  assert.equal(r.signingStandard, "erc191");
});

test("createFunding refuses a doomed execution with ShortfallError before creating anything", async () => {
  await assert.rejects(
    () => createFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, created("80000")) })),
    ShortfallError,
  );
});

test("neither projection carries a secret or the raw body", async () => {
  const q = await quoteFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, priced("87125")) }));
  const c = await createFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, created("87125")) }));
  for (const key of ["apiKey", "x-api-key", "raw"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(q, key), false, `quote leaked ${key}`);
    assert.equal(Object.prototype.hasOwnProperty.call(c, key), false, `create leaked ${key}`);
  }
});

test("the api key reaches Aurora on quote and create, and is absent on the keyless status read", async () => {
  const qc: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  await quoteFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, priced("87125"), qc) }));
  assert.equal(qc[0].init!.headers["x-api-key"], "key-test");

  const cc: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  await createFunding({ ...base, jobAmount: 87125n }, cfg({ fetchImpl: stubFetch(200, created("87125"), cc) }));
  assert.equal(cc.length, 2); // dry guard quote then the real create
  assert.equal(cc[0].init!.headers["x-api-key"], "key-test");
  assert.equal(cc[1].init!.headers["x-api-key"], "key-test");

  const sc: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  await readFundingStatus({ wallet: WALLET, id: ID }, { fetchImpl: stubFetch(200, listBody([doc(ID, "SUCCESS")]), sc) });
  assert.equal(sc[0].init!.headers["x-api-key"], undefined);
});

/* ------------------------------------------------------------------ status read */

test("readFundingStatus filters the array by id and pulls status and messageSigned through", async () => {
  const item = await readFundingStatus(
    { wallet: WALLET, id: ID },
    { fetchImpl: stubFetch(200, listBody([doc(OTHER_ID, "EXPIRED"), doc(ID, "SUCCESS")])) },
  );
  assert.ok(item);
  assert.equal(item.id, ID);
  assert.equal(item.status, "SUCCESS");
  assert.equal(item.messageSigned, true);
  assert.equal(item.minAmountOut, 87125n);
});

test("readFundingStatus returns null when the wallet has no such execution", async () => {
  const item = await readFundingStatus({ wallet: WALLET, id: ID }, { fetchImpl: stubFetch(200, listBody([])) });
  assert.equal(item, null);
});

test("the status read calls executions/{wallet}?id={id} and sends no key", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  await getExecution({ wallet: WALLET, id: ID }, { fetchImpl: stubFetch(200, listBody([doc(ID, "SUCCESS")]), calls) });
  assert.equal(calls[0].url, `https://intents-connect-api.aurora.dev/api/v1/executions/${WALLET}?id=${ID}`);
  assert.equal(calls[0].init!.headers["x-api-key"], undefined);
  assert.equal(calls[0].init!.method, "GET");
});

test("parseExecutionList also accepts a bare array under result", () => {
  const item = parseExecutionList({ result: [doc(ID, "DEPOSIT_PENDING")] }, ID);
  assert.ok(item);
  assert.equal(item.status, "DEPOSIT_PENDING");
});

/* ------------------------------------------------------------------ SSRF and transport */

test("getExecution fails closed on a non-https base and on a thrown fetch", async () => {
  await assert.rejects(
    () => getExecution({ wallet: WALLET, id: ID }, { baseUrl: "http://intents-connect-api.aurora.dev/api/v1", fetchImpl: stubFetch(200, listBody([])) }),
    IntentsConfigError,
  );
  const boom: FetchLike = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(() => getExecution({ wallet: WALLET, id: ID }, { fetchImpl: boom }), IntentsError);
});

/* ------------------------------------------------------------------ parseSigningPayload */

test("parseSigningPayload surfaces both message forms and the signing standard", () => {
  const p = parseSigningPayload(created("87125"));
  assert.equal(p.payloadJson, "CANONICAL-PAYLOAD-JSON");
  assert.equal(p.messageToSign, "SIGN-ME-755-chars");
  assert.equal(p.signingStandard, "erc191");
});

test("parseSigningPayload falls back to a nested messageToSign and nulls what is absent", () => {
  const p = parseSigningPayload({ result: { x: { messageToSign: "deep" } } });
  assert.equal(p.messageToSign, "deep");
  assert.equal(p.payloadJson, null);
  assert.equal(p.signingStandard, null);
  assert.equal(p.messageSigned, null);
});

/* ------------------------------------------------------------------ submitFundingSignature */

test("submitFundingSignature posts the signature to /submit with the key and validates its shape", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  const sig = "secp256k1:3yZe7d";
  const r = await submitFundingSignature(
    { wallet: WALLET, executionId: ID, signature: sig },
    cfg({ fetchImpl: stubFetch(200, { result: { status: "CREATED", details: { messageSigned: true } } }, calls) }),
  );
  assert.equal(calls[0].url, `https://intents-connect-api.aurora.dev/api/v1/executions/${WALLET}/submit`);
  assert.equal(calls[0].init!.headers["x-api-key"], "key-test");
  assert.deepEqual(JSON.parse(calls[0].init!.body!), { executionId: ID, signature: sig });
  assert.equal(r.status, "CREATED");
  assert.equal(r.messageSigned, true);
});

test("submitFundingSignature refuses a raw-hex signature and a non-uuid id before any call", async () => {
  await assert.rejects(
    () => submitFundingSignature({ wallet: WALLET, executionId: ID, signature: "0xabc" }, cfg({ fetchImpl: stubFetch(200, {}) })),
    IntentsConfigError,
  );
  await assert.rejects(
    () => submitFundingSignature({ wallet: WALLET, executionId: "not-a-uuid", signature: "secp256k1:3yZe7d" }, cfg({ fetchImpl: stubFetch(200, {}) })),
    IntentsConfigError,
  );
});
