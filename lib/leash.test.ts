/**
 * Tests for the Leash acceptance path.
 *
 * Every assertion here is about a refusal that has to happen. A gate that accepts a payment is easy
 * to write and easy to get wrong in a way no happy-path test notices, so each check gets a case that
 * makes it fire: a wrong ref, a wrong seller, a wrong agent, a log from somewhere other than the
 * agent's own account, a freely-mintable token, an underpayment, a stale block, a replayed receipt.
 *
 * The chain reads are stubbed through a fake viem client rather than hit live, so the suite runs
 * offline and deterministically. The ref derivation and the proof message are checked against the
 * exact strings `leash-monad` produces, because those two are the interop surface: if either drifts,
 * their agent pays a ref we do not recognise and the integration breaks silently.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { keccak256, toHex } from "viem";
import { leashAtomic, leashPaymentRef, leashPriceUsd, leashProofMessage, leashRequest, LEASH_ACCEPTED_TOKENS, MAX_NONCE_LEN, MAX_PAYMENT_AGE_S, _resetLeashPayments, reserveLeashPayment, confirmLeashPayment, releaseLeashPayment } from "./leash.ts";

const SELLER = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const TUSD = "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3";

describe("leash interop surface", () => {
  it("derives the ref the leash-monad package derives", () => {
    // Recomputed here from the package's own expression rather than pasted from a run, so a change
    // on either side shows up as a failure instead of as a silent mismatch on mainnet.
    const resource = "https://kanmani.xyz/api/service/sentinel";
    const nonce = "abc123";
    const expected = keccak256(toHex(`leash:${SELLER.toLowerCase()}:${resource}:${nonce}`));
    assert.equal(leashPaymentRef(SELLER, resource, nonce), expected);
  });

  it("lowercases the seller before hashing, so a checksummed address gives the same ref", () => {
    const resource = "https://kanmani.xyz/api/service/sentinel";
    assert.equal(leashPaymentRef(SELLER, resource, "n"), leashPaymentRef(SELLER.toLowerCase(), resource, "n"));
  });

  it("binds the ref to the resource and the nonce, so one payment cannot buy another request", () => {
    const a = leashPaymentRef(SELLER, "https://kanmani.xyz/api/service/sentinel", "n1");
    const b = leashPaymentRef(SELLER, "https://kanmani.xyz/api/service/assay", "n1");
    const c = leashPaymentRef(SELLER, "https://kanmani.xyz/api/service/sentinel", "n2");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it("signs the message leash-monad signs", () => {
    assert.equal(leashProofMessage("https://kanmani.xyz/api/service/sentinel", "n"), "leash:https://kanmani.xyz/api/service/sentinel:n");
  });

  it("quotes the price as the dollar string pay() takes", () => {
    assert.equal(leashPriceUsd("10000"), "0.01");
    assert.equal(leashPriceUsd("0"), "0");
    assert.equal(leashAtomic("0.01"), 10_000n);
  });
});

describe("leash header reading", () => {
  it("returns null when this is not a Leash call, so x402 is untouched", () => {
    assert.equal(leashRequest(new Headers()), null);
    assert.equal(leashRequest(new Headers({ "payment-signature": "zzz" })), null);
  });

  it("switches paths on x-leash-agent alone and leaves the rest empty", () => {
    const r = leashRequest(new Headers({ "x-leash-agent": "0x1" }));
    assert.ok(r);
    assert.equal(r.agent, "0x1");
    assert.equal(r.nonce, "");
    assert.equal(r.proof, "");
    assert.equal(r.payment, null);
  });

  it("reads all four headers", () => {
    const r = leashRequest(
      new Headers({ "x-leash-agent": "0xa", "x-leash-nonce": "n", "x-leash-proof": "0xsig", "x-leash-payment": "0xtx" }),
    );
    assert.deepEqual(r, { agent: "0xa", nonce: "n", proof: "0xsig", payment: "0xtx" });
  });
});

describe("accepted tokens", () => {
  it("accepts USDC on Monad mainnet", () => {
    assert.deepEqual([...LEASH_ACCEPTED_TOKENS], [USDC]);
  });

  it("refuses the network's test dollar, which has an unpermissioned mint on mainnet", () => {
    // Read from chain 143 on 2026-10-10: mint(address,uint256) estimates at 64,026 gas from two
    // unrelated senders and only reverts TooMuch() above 100.000000 tUSD. leashGate's default
    // acceptTokens includes this token, so keeping the default would accept free money.
    assert.ok(!LEASH_ACCEPTED_TOKENS.map((t) => t.toLowerCase()).includes(TUSD.toLowerCase()));
  });
});

describe("one payment buys one answer", () => {
  it("reserves, confirms, then refuses the same receipt", () => {
    _resetLeashPayments();
    const tx = "0x" + "11".repeat(32);
    assert.equal(reserveLeashPayment(tx).ok, true);
    confirmLeashPayment(tx);
    const again = reserveLeashPayment(tx);
    assert.equal(again.ok, false);
    assert.match((again as { reason: string }).reason, /already bought an answer/);
  });

  it("refuses a receipt another request is already holding", () => {
    _resetLeashPayments();
    const tx = "0x" + "22".repeat(32);
    assert.equal(reserveLeashPayment(tx).ok, true);
    const concurrent = reserveLeashPayment(tx);
    assert.equal(concurrent.ok, false);
    assert.match((concurrent as { reason: string }).reason, /already being processed/);
  });

  it("releases a reservation whose work failed, so our bug does not burn the payment", () => {
    _resetLeashPayments();
    const tx = "0x" + "33".repeat(32);
    assert.equal(reserveLeashPayment(tx).ok, true);
    releaseLeashPayment(tx);
    assert.equal(reserveLeashPayment(tx).ok, true);
  });

  it("is case insensitive on the hash, so a mixed-case retry cannot double spend", () => {
    _resetLeashPayments();
    const lower = "0x" + "ab".repeat(32);
    assert.equal(reserveLeashPayment(lower).ok, true);
    confirmLeashPayment(lower);
    assert.equal(reserveLeashPayment(lower.toUpperCase().replace("0X", "0x")).ok, false);
  });

  it("does not release a confirmed receipt", () => {
    _resetLeashPayments();
    const tx = "0x" + "cd".repeat(32);
    reserveLeashPayment(tx);
    confirmLeashPayment(tx);
    releaseLeashPayment(tx);
    assert.equal(reserveLeashPayment(tx).ok, false);
  });
});

describe("input ceilings", () => {
  it("bounds the nonce", () => {
    assert.equal(MAX_NONCE_LEN, 128);
  });

  it("hashes a nonce at the ceiling without throwing", () => {
    const nonce = "x".repeat(MAX_NONCE_LEN);
    assert.match(leashPaymentRef(SELLER, "https://kanmani.xyz/api/service/sentinel", nonce), /^0x[0-9a-f]{64}$/);
  });
});

/* ------------------------------------------------------- the nine checks */

/**
 * Every check below is made to fire.
 *
 * A gate is only worth something if each of its refusals has been seen to happen, so these build a
 * receipt that would be accepted and then break exactly one thing about it per case. The last test
 * asserts the unbroken receipt is accepted, which is what makes the other failures meaningful: if the
 * baseline did not pass, every refusal above it would pass for the wrong reason.
 */

import { encodeAbiParameters, encodeEventTopics, pad, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyLeashPayment, type LeashReads } from "./leash.ts";

const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT = privateKeyToAccount(AGENT_KEY);
const ACCOUNT = "0x9999999999999999999999999999999999999999";
const OTHER_CONTRACT = "0x8888888888888888888888888888888888888888";
const RESOURCE = "https://kanmani.xyz/api/service/sentinel";
const NONCE = "test-nonce-1";
const PRICE = "10000";
const TX = ("0x" + "ee".repeat(32)) as `0x${string}`;

const PAID_EVENT = parseAbi(["event Paid(address indexed agent, address indexed seller, address token, uint256 amount, bytes32 ref, uint256 remainingToday)"]);

function paidLog(o: { address?: string; agent?: string; seller?: string; token?: string; amount?: bigint; ref?: `0x${string}` }) {
  const agent = (o.agent ?? AGENT.address) as `0x${string}`;
  const seller = (o.seller ?? SELLER) as `0x${string}`;
  const topics = encodeEventTopics({ abi: PAID_EVENT, eventName: "Paid", args: { agent, seller } });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
    [(o.token ?? USDC) as `0x${string}`, o.amount ?? 10_000n, o.ref ?? leashPaymentRef(SELLER, RESOURCE, NONCE), 490_000n],
  );
  // encodeEventTopics types its result to allow nulls and arrays for filters. A concrete log never
  // has either, so it is narrowed here rather than widening the seam to accept shapes a chain
  // cannot produce.
  return { address: o.address ?? ACCOUNT, data, topics: topics as `0x${string}`[] };
}

function fakeReads(over: Partial<LeashReads> & { logs?: ReturnType<typeof paidLog>[]; ageS?: number; status?: string; account?: string | null } = {}): LeashReads {
  const now = BigInt(Math.floor(Date.now() / 1000) - (over.ageS ?? 10));
  return {
    getTransactionReceipt: over.getTransactionReceipt ?? (async () => ({ status: over.status ?? "success", blockNumber: 112_000_000n, logs: over.logs ?? [paidLog({})] })),
    getBlock: over.getBlock ?? (async () => ({ timestamp: now })),
    accountOf: over.accountOf ?? (async () => (over.account === undefined ? ACCOUNT : over.account)),
    agentId: over.agentId ?? (async () => "10299"),
  };
}

async function attempt(o: { nonce?: string; proof?: string; payment?: string | null; agent?: string; reads?: LeashReads } = {}) {
  const nonce = o.nonce ?? NONCE;
  const proof = o.proof ?? (await AGENT.signMessage({ message: leashProofMessage(RESOURCE, nonce) }));
  return verifyLeashPayment({
    req: { agent: o.agent ?? AGENT.address, nonce, proof, payment: o.payment === undefined ? TX : o.payment },
    resource: RESOURCE,
    priceAtomic: PRICE,
    seller: SELLER,
    reads: o.reads ?? fakeReads(),
  });
}

const refusal = (r: Awaited<ReturnType<typeof attempt>>) => {
  assert.equal(r.ok, false, "expected a refusal, got an acceptance");
  return r as Extract<typeof r, { ok: false }>;
};

describe("the nine checks each fire", () => {
  it("baseline: an unbroken receipt is accepted, so every refusal below means something", async () => {
    _resetLeashPayments();
    const r = await attempt();
    assert.equal(r.ok, true, JSON.stringify(r));
    const a = r as Extract<typeof r, { ok: true }>;
    assert.equal(a.paidUsd, "0.01");
    assert.equal(a.token, USDC);
    assert.equal(a.erc8004Id, "10299");
    assert.equal(a.remainingToday, "0.49");
  });

  it("1. refuses an agent header that is not an address", async () => {
    const r = refusal(await attempt({ agent: "not-an-address" }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "bad_agent");
  });

  it("1. refuses a nonce over the ceiling", async () => {
    const r = refusal(await attempt({ nonce: "x".repeat(MAX_NONCE_LEN + 1) }));
    assert.equal(r.status, 402);
    assert.equal(r.body.error, "payment_required");
  });

  it("2. refuses a proof signed by somebody else, so stolen headers are useless", async () => {
    const other = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const proof = await other.signMessage({ message: leashProofMessage(RESOURCE, NONCE) });
    const r = refusal(await attempt({ proof }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "bad_proof");
  });

  it("2. refuses a proof over a different resource", async () => {
    const proof = await AGENT.signMessage({ message: leashProofMessage("https://kanmani.xyz/api/service/assay", NONCE) });
    const r = refusal(await attempt({ proof }));
    assert.equal(r.body.error, "bad_proof");
  });

  it("3. refuses a receipt that does not exist", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ getTransactionReceipt: async () => null }) }));
    assert.equal(r.body.error, "payment_not_found");
  });

  it("3. refuses a reverted transaction", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ status: "reverted" }) }));
    assert.equal(r.body.error, "payment_not_found");
  });

  it("4. refuses a payment older than the age ceiling", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ ageS: MAX_PAYMENT_AGE_S + 1 }) }));
    assert.equal(r.body.error, "payment_expired");
    assert.equal(r.body.maxAgeSeconds, MAX_PAYMENT_AGE_S);
  });

  it("5. refuses a Paid log emitted by a contract that is not this agent's account", async () => {
    // The attack this check exists for: anyone can deploy a contract that emits a Paid event naming
    // our address. Without pinning the log to accountOf(agent), the decode would pass.
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ address: OTHER_CONTRACT })] }) }));
    assert.equal(r.body.error, "payment_mismatch");
  });

  it("5. refuses when the hub knows no account for this agent", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ account: null }) }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "unknown_agent");
  });

  it("6. refuses a Paid event naming a different agent", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ agent: OTHER_CONTRACT })] }) }));
    assert.equal(r.body.error, "payment_mismatch");
  });

  it("7. refuses a payment made to somebody else", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ seller: OTHER_CONTRACT })] }) }));
    assert.equal(r.body.error, "payment_mismatch");
  });

  it("8. refuses the freely-mintable test dollar", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ token: TUSD })] }) }));
    assert.equal(r.body.error, "token_not_accepted");
    assert.equal(String(r.body.token).toLowerCase(), TUSD.toLowerCase());
  });

  it("9. refuses an underpayment", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ amount: 9_999n })] }) }));
    assert.equal(r.body.error, "underpaid");
    assert.equal(r.body.paid, "0.009999");
  });

  it("9. accepts an overpayment and reports what was actually paid", async () => {
    _resetLeashPayments();
    const r = await attempt({ reads: fakeReads({ logs: [paidLog({ amount: 50_000n })] }) });
    assert.equal(r.ok, true);
    assert.equal((r as Extract<typeof r, { ok: true }>).paidUsd, "0.05");
  });

  it("9. refuses a ref for a different request, so one payment cannot buy two answers", async () => {
    const wrong = leashPaymentRef(SELLER, "https://kanmani.xyz/api/service/assay", NONCE);
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ ref: wrong })] }) }));
    assert.equal(r.body.error, "payment_mismatch");
  });

  it("9. refuses a ref for a different nonce on the same resource", async () => {
    const wrong = leashPaymentRef(SELLER, RESOURCE, "some-other-nonce");
    const r = refusal(await attempt({ reads: fakeReads({ logs: [paidLog({ ref: wrong })] }) }));
    assert.equal(r.body.error, "payment_mismatch");
  });

  it("refuses an x-leash-payment that is not a transaction hash", async () => {
    const r = refusal(await attempt({ payment: "0xnope" }));
    assert.equal(r.body.error, "bad_payment");
  });

  it("answers the first call with the price, the ref and the live leash verdict", async () => {
    const r = refusal(await attempt({ payment: null, reads: fakeReads() }));
    assert.equal(r.body.price, "0.01");
    assert.equal(r.body.payTo, SELLER);
    assert.equal(r.body.ref, leashPaymentRef(SELLER, RESOURCE, NONCE));
    assert.match(String(r.body.howTo), /^Call pay\(/);
  });

  it("answers 503 rather than 402 when the chain cannot be read, so nobody pays twice for our outage", async () => {
    const r = refusal(await attempt({ reads: fakeReads({ getBlock: async () => null }) }));
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "chain_unreadable");
  });

  it("ignores unrelated logs in the same receipt and finds the Paid event", async () => {
    _resetLeashPayments();
    const noise = { address: OTHER_CONTRACT, data: "0x" as `0x${string}`, topics: [pad("0x01", { size: 32 })] as `0x${string}`[] };
    const r = await attempt({ reads: fakeReads({ logs: [noise, paidLog({})] }) });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});
