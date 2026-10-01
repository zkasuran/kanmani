import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFunding,
  buildRefundSteps,
  buildWithdrawStep,
  requestStepsExecution,
  parseStepsExecution,
} from "./intents-recover.ts";
import { decodeCreateJob, MONAD_USDC_ASSET_ID, IntentsConfigError, IntentsError, type Terms, type FetchLike, type IntentsConfig } from "./intents.ts";
import { USDC_MONAD } from "./x402.ts";

/**
 * Short-landing and expiry recovery, pure logic plus the steps-only HTTP call on an injected fetch.
 *
 * Mutation log (each guard made to fail once, then reverted): dropped the `balance < needed` compare in
 * classifyFunding and the short test went green on a covered balance; dropped the originAsset-absent
 * assertion in T6 and it still passed with an originAsset present, confirming it was not biting, so it
 * was tightened to assert the key is absent.
 */

const AGENT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const RECIPIENT = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const TRANSFER_SELECTOR = "0xa9059cbb";

function terms(amount: bigint): Terms {
  return {
    agent: AGENT,
    token: USDC_MONAD as `0x${string}`,
    amount,
    pricePerUnit: 0n,
    deadline: 4102444800n,
    termsHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    salt: ("0x" + "cd".repeat(32)) as `0x${string}`,
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

/* ------------------------------------------------------------------ classifyFunding */

test("classifyFunding returns short when a balance below the job's need is sitting unrun", () => {
  assert.equal(
    classifyFunding({ status: "OPERATION_FAILED", neededAmount: 87125n, intermediaryBalance: 80000n, deadline: 9_999_999_999n, now: 1n }),
    "short",
  );
});

test("classifyFunding returns expired past the deadline with funds still there", () => {
  assert.equal(
    classifyFunding({ status: "CREATED", neededAmount: 87125n, intermediaryBalance: 87125n, deadline: 100n, now: 200n }),
    "expired",
  );
  assert.equal(
    classifyFunding({ status: "EXPIRED", neededAmount: 87125n, intermediaryBalance: 50000n, deadline: null, now: 200n }),
    "expired",
  );
});

test("classifyFunding returns funded, empty or recoverable for the non-recovery cases", () => {
  assert.equal(classifyFunding({ status: "SUCCESS", neededAmount: 87125n, intermediaryBalance: 0n }), "funded");
  assert.equal(classifyFunding({ status: "OPERATION_FAILED", neededAmount: 87125n, intermediaryBalance: 0n }), "empty");
  assert.equal(
    classifyFunding({ status: "OPERATION_FAILED", neededAmount: 87125n, intermediaryBalance: 90000n, deadline: 9_999_999_999n, now: 1n }),
    "recoverable",
  );
});

/* ------------------------------------------------------------------ buildRefundSteps */

test("buildRefundSteps sizes the job to the real balance and the calldata decodes back to it", () => {
  const { steps, amount } = buildRefundSteps({ balance: 80000n, terms: terms(87125n) });
  assert.equal(amount, 80000n);
  assert.equal(steps.length, 2);
  assert.equal(decodeCreateJob(steps[1].data).amount, 80000n);
  assert.equal((steps[0].parameters as string[])[1], "80000");
});

/* ------------------------------------------------------------------ buildWithdrawStep */

test("buildWithdrawStep emits one transfer on Monad USDC for the full balance", () => {
  const step = buildWithdrawStep({ balance: 80000n, recipient: RECIPIENT });
  assert.equal(step.to, USDC_MONAD);
  assert.equal(step.functionSignature, "transfer(address,uint256)");
  assert.equal(step.selector, TRANSFER_SELECTOR);
  assert.ok(step.data.startsWith(TRANSFER_SELECTOR));
  assert.deepEqual(step.parameters, [RECIPIENT, "80000"]);
  assert.equal(step.value, "0");
});

test("buildWithdrawStep refuses a bad recipient and a zero balance", () => {
  assert.throws(() => buildWithdrawStep({ balance: 80000n, recipient: "nope" }), IntentsConfigError);
  assert.throws(() => buildWithdrawStep({ balance: 0n, recipient: RECIPIENT }), IntentsConfigError);
});

/* ------------------------------------------------------------------ requestStepsExecution */

test("requestStepsExecution POSTs to /steps with no originAsset, carrying dry and the Monad destination", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  const step = buildWithdrawStep({ balance: 80000n, recipient: RECIPIENT });
  await requestStepsExecution(
    { wallet: WALLET, steps: [{ to: step.to, functionSignature: step.functionSignature, parameters: step.parameters, value: step.value }], dry: true },
    cfg({ fetchImpl: stubFetch(200, { result: { id: "e5abf7ce-0000-4000-8000-000000000001", status: "CREATED", details: {} } }, calls) }),
  );
  assert.equal(calls[0].url, `https://intents-connect-api.aurora.dev/api/v1/executions/${WALLET}/steps`);
  const sent = JSON.parse(calls[0].init!.body!) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(sent, "originAsset"), false);
  assert.equal(sent.dry, true);
  assert.equal(sent.destinationAsset, MONAD_USDC_ASSET_ID);
  assert.equal(calls[0].init!.headers["x-api-key"], "key-test");
});

test("requestStepsExecution guards the host, the scheme, the key and the wallet", async () => {
  const f = stubFetch(200, { result: { id: "x", status: "CREATED" } });
  const step = [{ to: USDC_MONAD, functionSignature: "transfer(address,uint256)", parameters: [RECIPIENT, "1"], value: "0" }];
  await assert.rejects(() => requestStepsExecution({ wallet: WALLET, steps: step, dry: true }, cfg({ fetchImpl: f, baseUrl: "http://intents-connect-api.aurora.dev/api/v1" })), IntentsConfigError);
  await assert.rejects(() => requestStepsExecution({ wallet: WALLET, steps: step, dry: true }, cfg({ fetchImpl: f, baseUrl: "https://evil.example.com/api/v1" })), IntentsConfigError);
  await assert.rejects(() => requestStepsExecution({ wallet: WALLET, steps: step, dry: true }, cfg({ fetchImpl: f, apiKey: "" })), IntentsConfigError);
  await assert.rejects(() => requestStepsExecution({ wallet: "nope", steps: step, dry: true }, cfg({ fetchImpl: f })), IntentsConfigError);
  const boom: FetchLike = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(() => requestStepsExecution({ wallet: WALLET, steps: step, dry: true }, cfg({ fetchImpl: boom })), IntentsError);
});

/* ------------------------------------------------------------------ parseStepsExecution */

test("parseStepsExecution reads id, status and the signing payload, handling a missing message", () => {
  const r = parseStepsExecution({
    result: { id: "abc", status: "CREATED", details: { messageToSign: "SIGN", intermediaryAddress: "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E", networkFee: "7150" } },
  });
  assert.equal(r.id, "abc");
  assert.equal(r.status, "CREATED");
  assert.equal(r.messageToSign, "SIGN");
  assert.equal(r.networkFee, 7150n);
  const bare = parseStepsExecution({ result: { id: "abc", status: "OPERATION_PENDING", details: {} } });
  assert.equal(bare.messageToSign, null);
  assert.throws(() => parseStepsExecution({}), IntentsError);
});
