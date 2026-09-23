import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFundingSteps,
  decodeCreateJob,
  enforceShortfallGuard,
  parseExecution,
  requestExecution,
  getIntermediary,
  planAqueousFunding,
  toWireSteps,
  AQUEOUS_MONAD,
  ShortfallError,
  IntentsError,
  IntentsConfigError,
  type Terms,
  type FetchLike,
  type IntentsConfig,
} from "./intents.ts";
import { USDC_MONAD } from "./x402.ts";

/**
 * These prove the batch is well-formed, the createJob amount is the guaranteed delivery and never
 * the gross figure. The shortfall guard refuses rather than proceeds. Everything runs against an
 * injected fetch, so no network is touched and every branch is reachable. The mutation log at the
 * bottom of the packet records that each check was made to fail before it was trusted.
 */

// approve(address,uint256) and createJob((...)) selectors, computed independently of the module.
const APPROVE_SELECTOR = "0x095ea7b3";
const CREATE_JOB_SELECTOR = "0x4eaad653";

const AGENT = "0x1111111111111111111111111111111111111111";
const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;
const SALT = ("0x" + "cd".repeat(32)) as `0x${string}`;
const WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

function terms(over: Partial<Terms> = {}): Terms {
  return {
    agent: AGENT,
    token: USDC_MONAD as `0x${string}`,
    amount: 87125n,
    pricePerUnit: 0n,
    deadline: 4102444800n,
    termsHash: HASH,
    salt: SALT,
    ...over,
  };
}

function stubFetch(status: number, body: unknown, calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

function cfg(over: Partial<IntentsConfig> = {}): IntentsConfig {
  return { apiKey: "key-test", ...over };
}

/** A round-2 style response: post-fee amounts, a fee step appended by the service. */
function priced(minAmountOut: string, networkFee = "7150") {
  return {
    result: {
      status: "CREATED",
      details: { intermediaryAddress: "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E", networkFee },
      quote: { amountIn: "1270000", amountOut: "88150", minAmountOut, depositAddress: "0xdead" },
      steps: [
        { to: USDC_MONAD, functionSignature: "approve(address,uint256)", parameters: ["x", minAmountOut], value: "0" },
        { to: AQUEOUS_MONAD, functionSignature: "createJob((address,address,uint128,uint128,uint64,bytes32,bytes32))", parameters: [[]], value: "0" },
        { to: USDC_MONAD, functionSignature: "transfer(address,uint256)", parameters: ["0xfee", networkFee], value: "0", metadata: { name: "Fee Transfer" } },
      ],
    },
  };
}

/* ----------------------------------------------------------- the step batch */

test("the batch is exactly two steps (approve then createJob) with no fee step from us", () => {
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].functionSignature, "approve(address,uint256)");
  assert.equal(steps[1].functionSignature, "createJob((address,address,uint128,uint128,uint64,bytes32,bytes32))");
  assert.equal(steps[0].metadata, undefined);
  assert.equal(steps[1].metadata, undefined);
});

test("step 0 approves the Aqueous escrow on USDC with the right selector", () => {
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  assert.equal(steps[0].to, USDC_MONAD);
  assert.equal(steps[0].selector, APPROVE_SELECTOR);
  assert.ok(steps[0].data.startsWith(APPROVE_SELECTOR));
  assert.deepEqual(steps[0].parameters, [AQUEOUS_MONAD, "87125"]);
  assert.equal(steps[0].value, "0");
});

test("step 1 calls createJob on Aqueous with the right selector", () => {
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  assert.equal(steps[1].to, AQUEOUS_MONAD);
  assert.equal(steps[1].selector, CREATE_JOB_SELECTOR);
  assert.ok(steps[1].data.startsWith(CREATE_JOB_SELECTOR));
  assert.equal(steps[1].value, "0");
});

test("Terms is encoded correctly: the createJob calldata decodes back to the same struct", () => {
  const t = terms();
  const { steps } = buildFundingSteps({ amount: 87125n, terms: t });
  const decoded = decodeCreateJob(steps[1].data);
  assert.equal(decoded.agent.toLowerCase(), t.agent.toLowerCase());
  assert.equal(decoded.token.toLowerCase(), t.token.toLowerCase());
  assert.equal(decoded.amount, 87125n);
  assert.equal(decoded.pricePerUnit, 0n);
  assert.equal(decoded.deadline, t.deadline);
  assert.equal(decoded.termsHash, t.termsHash);
  assert.equal(decoded.salt, t.salt);
});

test("the amount baked into createJob equals the guaranteed delivered amount, not the gross", () => {
  // 94275 is the gross quote, 87125 is the post-fee guarantee. The job must be funded at 87125.
  const { steps, amount } = buildFundingSteps({ amount: 87125n, terms: terms({ amount: 87125n }) });
  assert.equal(amount, 87125n);
  assert.equal(decodeCreateJob(steps[1].data).amount, 87125n);
  assert.equal((steps[1].parameters[0] as string[])[2], "87125");
});

test("baking the gross amount into Terms while funding the post-fee amount is refused", () => {
  // This is the gross-before-fee mistake: 94275 gross into Terms, 87125 actually delivered.
  assert.throws(() => buildFundingSteps({ amount: 87125n, terms: terms({ amount: 94275n }) }), IntentsConfigError);
});

test("a Terms token that is not the bridged USDC is refused", () => {
  assert.throws(
    () => buildFundingSteps({ amount: 87125n, terms: terms({ token: AGENT }) }),
    IntentsConfigError,
  );
});

test("bad addresses, a zero amount and an over-uint128 amount are all config errors", () => {
  assert.throws(() => buildFundingSteps({ amount: 87125n, terms: terms({ agent: "nope" as `0x${string}` }) }), IntentsConfigError);
  assert.throws(() => buildFundingSteps({ amount: 0n, terms: terms({ amount: 0n }) }), IntentsConfigError);
  const tooBig = 1n << 128n;
  assert.throws(() => buildFundingSteps({ amount: tooBig, terms: terms({ amount: tooBig }) }), IntentsConfigError);
});

/* --------------------------------------------------------- the shortfall guard */

test("the guard refuses when the guaranteed delivery is below what createJob pulls", () => {
  assert.throws(() => enforceShortfallGuard({ minAmountOut: 87124n, needed: 87125n }), ShortfallError);
});

test("the guard passes on an exact match and on a surplus", () => {
  assert.doesNotThrow(() => enforceShortfallGuard({ minAmountOut: 87125n, needed: 87125n }));
  assert.doesNotThrow(() => enforceShortfallGuard({ minAmountOut: 90000n, needed: 87125n }));
});

/* --------------------------------------------------------------- parseExecution */

test("parseExecution reads minAmountOut, the fee and the intermediary", () => {
  const q = parseExecution(priced("87125"));
  assert.equal(q.minAmountOut, 87125n);
  assert.equal(q.networkFee, 7150n);
  assert.equal(q.intermediary, "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E");
  assert.equal(q.steps.length, 3);
});

test("parseExecution treats a missing networkFee as null, so the caller can refuse an unpriced quote", () => {
  const body = { result: { quote: { minAmountOut: "94275" }, details: {} } };
  assert.equal(parseExecution(body).networkFee, null);
});

test("parseExecution throws when there is no result or no numeric minAmountOut", () => {
  assert.throws(() => parseExecution({}), IntentsError);
  assert.throws(() => parseExecution({ result: { quote: {} } }), IntentsError);
  assert.throws(() => parseExecution({ result: { quote: { minAmountOut: "not a number" } } }), IntentsError);
});

/* ------------------------------------------------------------- requestExecution */

test("requestExecution posts to the pinned host and path with the api key and the dry flag", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  await requestExecution(
    { wallet: WALLET, quote: { originAsset: "nep141:sol.omft.near", amount: "1270000" }, steps: toWireSteps(steps), dry: true },
    cfg({ fetchImpl: stubFetch(200, priced("87125"), calls) }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://intents-connect-api.aurora.dev/api/v1/executions/${WALLET}`);
  const init = calls[0].init!;
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["x-api-key"], "key-test");
  const sent = JSON.parse(init.body!);
  assert.equal(sent.dry, true);
  assert.equal(sent.type, "evm");
  assert.equal(sent.quote.destinationAsset, "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx");
  // The wire steps carry only what the API consumes, never our verification aids.
  assert.equal(sent.steps.length, 2);
  assert.equal(sent.steps[0].data, undefined);
  assert.equal(sent.steps[0].selector, undefined);
});

test("a non-2xx, a thrown fetch and a non-json body are all IntentsError, never a silent pass", async () => {
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  const wire = toWireSteps(steps);
  const q = { originAsset: "nep141:sol.omft.near", amount: "1270000" };
  await assert.rejects(
    () => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: stubFetch(401, { error: "missing or invalid api token" }) })),
    IntentsError,
  );
  const boom: FetchLike = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(() => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: boom })), IntentsError);
  const notJson: FetchLike = async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } });
  await assert.rejects(() => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: notJson })), IntentsError);
});

test("requestExecution guards the host, the scheme, the key and the wallet (SSRF and config)", async () => {
  const { steps } = buildFundingSteps({ amount: 87125n, terms: terms() });
  const wire = toWireSteps(steps);
  const q = { originAsset: "nep141:sol.omft.near", amount: "1270000" };
  const f = stubFetch(200, priced("87125"));
  await assert.rejects(() => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: f, baseUrl: "http://intents-connect-api.aurora.dev/api/v1" })), IntentsConfigError);
  await assert.rejects(() => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: f, baseUrl: "https://evil.example.com/api/v1" })), IntentsConfigError);
  await assert.rejects(() => requestExecution({ wallet: WALLET, quote: q, steps: wire, dry: true }, cfg({ fetchImpl: f, apiKey: "" })), IntentsConfigError);
  await assert.rejects(() => requestExecution({ wallet: "not-an-address", quote: q, steps: wire, dry: true }, cfg({ fetchImpl: f })), IntentsConfigError);
});

/* --------------------------------------------------------------- getIntermediary */

test("getIntermediary returns the evm account and needs no api key", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  const f = stubFetch(200, { result: { evm: "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E" } }, calls);
  const evm = await getIntermediary(WALLET, { fetchImpl: f });
  assert.equal(evm, "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E");
  assert.equal(calls[0].init!.headers["x-api-key"], undefined);
  assert.match(calls[0].url!, /\/executions\/.*\/intermediary$/);
});

test("getIntermediary throws when the response carries no evm address", async () => {
  await assert.rejects(() => getIntermediary(WALLET, { fetchImpl: stubFetch(200, { result: {} }) }), IntentsError);
});

/* ------------------------------------------------------------ planAqueousFunding */

test("planAqueousFunding returns a plan when the delivery covers the createJob amount", async () => {
  const plan = await planAqueousFunding(
    { wallet: WALLET, quote: { originAsset: "nep141:sol.omft.near", amount: "1270000" }, terms: terms({ amount: 87125n }) },
    cfg({ fetchImpl: stubFetch(200, priced("87125")) }),
  );
  assert.equal(plan.amount, 87125n);
  assert.equal(plan.quote.minAmountOut, 87125n);
  assert.equal(plan.built.length, 2);
});

test("planAqueousFunding refuses with ShortfallError when the delivery is short", async () => {
  await assert.rejects(
    () =>
      planAqueousFunding(
        { wallet: WALLET, quote: { originAsset: "nep141:sol.omft.near", amount: "1270000" }, terms: terms({ amount: 87125n }) },
        cfg({ fetchImpl: stubFetch(200, priced("80000")) }),
      ),
    ShortfallError,
  );
});

