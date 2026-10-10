/**
 * Accepting a Leash payment, so a leashed agent can buy from Sentinel inside its spend limit.
 *
 * Leash (https://github.com/iamrobertmoore/leash) answers "may this agent spend this much with this
 * seller". Kanmani answers "does this seller's record hold up". A leashed agent that checks a seller
 * before paying it, inside its leash, shows both halves in one flow. The missing piece was on our
 * side: every priced route here took x402, which is an EIP-3009 authorization signed by the payer. A
 * LeashAccount cannot produce one. It has no ERC-1271 and no EIP-3009. It pays by direct transfer
 * through `pay(seller, amount, ref)` and emits a receipt.
 *
 * So this module accepts the receipt instead of a signature. The payment has already happened on
 * chain by the time the request arrives, and the request carries its transaction hash.
 *
 * ## What is checked, and why each check is here
 *
 * A transaction hash is not a payment. Anything a stranger sends has to be re-derived rather than
 * believed, so all nine of these are checked and a request that fails any one of them is refused:
 *
 *  1. `x-leash-agent` parses as an address, and the nonce is length-bounded.
 *  2. `x-leash-proof` is a signature over `leash:<resource>:<nonce>` recovering to that agent, so a
 *     passer-by cannot replay somebody else's headers and spend their payment.
 *  3. The receipt exists and its status is success.
 *  4. The block it was mined in is recent, which bounds how long one receipt stays usable.
 *  5. The `Paid` log was emitted by `accountOf(agent)` read from the hub. Without this, any contract
 *     could emit a `Paid` event with our address in it and the decode would pass.
 *  6. `agent` in the event is the agent in the header.
 *  7. `seller` in the event is our own payee, not somebody else's.
 *  8. `token` is one we accept. Not the network default, see below.
 *  9. `amount` is at least the price, and `ref` equals the ref we derived for this exact resource
 *     and nonce, so a payment for one request cannot buy a different one.
 *
 * Then the hash is held single-use for the lifetime of the process, so one payment buys one answer.
 *
 * ## We accept USDC only, deliberately
 *
 * `leashGate` in the `leash-monad` package defaults to `acceptTokens = [usdc, testUsd]` on every
 * network, mainnet included. Read from chain 143 on 2026-10-10, `testUsd`
 * `0x4adf40e6e5113339635e6dc54ff638e7b63bbea3` ("tUSD", 6 decimals) has an unpermissioned
 * `mint(address,uint256)`: two unrelated addresses both estimate it at 64,026 gas, and the only limit
 * is a per-call ceiling of exactly 100.000000 tUSD above which it reverts `TooMuch()`
 * (`0xd887771b`). Its whole supply is 1,700 tUSD. So a seller that keeps the default accepts a token
 * any caller can mint for free. This list is USDC on Monad mainnet and nothing else.
 *
 * ## Why this is written here rather than imported
 *
 * `leash-monad` is at 0.1.5 and does exactly this job, and reusing it was offered. The checks above
 * are about 150 lines against an ABI that is already public, and adding a days-old package to the
 * dependency tree of a build that handles payments costs more than it saves. The header names, the
 * ref derivation and the proof message are byte-identical to the package, so their agent's
 * `fetchWithLeash` works against this route with nothing changed on their side.
 */

import { createPublicClient, decodeEventLog, formatUnits, getAddress, http, isAddress, keccak256, parseUnits, toHex, verifyMessage } from "viem";
import { viemChain } from "./chains.ts";
import { PAY_TO, USDC_MONAD } from "./x402.ts";

/** The Leash hub on Monad mainnet. Verified live: 4,009 bytes of code, `check` answers. */
export const LEASH_HUB = (process.env.LEASH_HUB ?? "0x64a489074dd6a4b3b977e5f635a178366a8c12c3") as `0x${string}`;

/** USDC on Monad mainnet, and nothing else. See the note above about the network's test dollar. */
export const LEASH_ACCEPTED_TOKENS: readonly `0x${string}`[] = [USDC_MONAD as `0x${string}`];

/** How old a payment may be and still buy a response. Bounds the window a stolen receipt is useful in. */
export const MAX_PAYMENT_AGE_S = 300;

/** A nonce is attacker-controlled and only ever hashed, so it gets a ceiling like every other input. */
export const MAX_NONCE_LEN = 128;

/** USDC decimals on Monad, read off the token rather than assumed. */
const DECIMALS = 6;

const HUB_ABI = [
  {
    name: "check",
    type: "function",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "agent" },
      { type: "address", name: "seller" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [
      { type: "uint8", name: "status" },
      { type: "uint256", name: "remainingToday" },
      { type: "uint64", name: "expiry" },
      { type: "uint256", name: "agentId" },
      { type: "address", name: "account" },
    ],
  },
  {
    name: "accountOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

const PAID_ABI = [
  {
    name: "Paid",
    type: "event",
    inputs: [
      { type: "address", name: "agent", indexed: true },
      { type: "address", name: "seller", indexed: true },
      { type: "address", name: "token" },
      { type: "uint256", name: "amount" },
      { type: "bytes32", name: "ref" },
      { type: "uint256", name: "remainingToday" },
    ],
  },
] as const;

/** The hub's status enum, in its own order. Index 0 is the only one that serves a request. */
export const LEASH_STATUS = ["OK", "UNKNOWN_AGENT", "REVOKED", "EXPIRED", "SELLER_NOT_ALLOWED", "OVER_CAP"] as const;
export type LeashStatus = (typeof LEASH_STATUS)[number];

const STATUS_REASON: Record<LeashStatus, string> = {
  OK: "This payment would go through right now.",
  UNKNOWN_AGENT: "The hub has no leash for this agent address.",
  REVOKED: "This agent's leash has been revoked by its owner.",
  EXPIRED: "This agent's leash has expired.",
  SELLER_NOT_ALLOWED: "This agent's leash does not allow paying this seller.",
  OVER_CAP: "This payment is over what the agent may still spend today.",
};

/**
 * The reference both sides derive, binding a payment to one seller, one resource and one nonce.
 *
 * Byte-identical to `paymentRef` in `leash-monad`, so an agent using that package pays a ref this
 * route recognises. The seller is lowercased before hashing because the package lowercases it, and a
 * checksummed address would hash to something else.
 */
export const leashPaymentRef = (seller: string, resource: string, nonce: string): `0x${string}` =>
  keccak256(toHex(`leash:${seller.toLowerCase()}:${resource}:${nonce}`));

/** The message an agent signs to prove it holds the key named in `x-leash-agent`. */
export const leashProofMessage = (resource: string, nonce: string): string => `leash:${resource}:${nonce}`;

export type LeashRequest = { agent: string; nonce: string; proof: string; payment: string | null };

/**
 * Read the Leash headers off a request, or null when this is not a Leash call.
 *
 * Null means "carry on to x402". Only the presence of `x-leash-agent` switches paths, so an x402
 * client that happens to send a stray header is unaffected.
 */
export function leashRequest(headers: Headers): LeashRequest | null {
  const agent = headers.get("x-leash-agent");
  if (!agent) return null;
  return {
    agent,
    nonce: headers.get("x-leash-nonce") ?? "",
    proof: headers.get("x-leash-proof") ?? "",
    payment: headers.get("x-leash-payment"),
  };
}

/** Atomic units to the dollar string `pay()` expects, so a client can pass our price straight back. */
export const leashPriceUsd = (priceAtomic: string): string => formatUnits(BigInt(priceAtomic), DECIMALS);

export type LeashVerdict = {
  status: LeashStatus;
  ok: boolean;
  remainingToday: string;
  expiry: number;
  erc8004Id: string;
  account: string | null;
  reason: string;
};

function client() {
  const chain = viemChain(143);
  if (!chain) throw new Error("no chain config for 143");
  return createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) });
}

/** Ask the hub the seller's question: if this agent pays me this much, does the leash allow it? */
export async function checkLeash(agent: string, amountAtomic: string, seller: string = PAY_TO): Promise<LeashVerdict> {
  const r = await client().readContract({
    address: LEASH_HUB,
    abi: HUB_ABI,
    functionName: "check",
    args: [getAddress(agent), getAddress(seller), BigInt(amountAtomic)],
  });
  const status = LEASH_STATUS[Number(r[0])] ?? "UNKNOWN_AGENT";
  return {
    status,
    ok: status === "OK",
    remainingToday: formatUnits(r[1], DECIMALS),
    expiry: Number(r[2]),
    erc8004Id: r[3].toString(),
    account: r[4] === "0x0000000000000000000000000000000000000000" ? null : r[4],
    reason: STATUS_REASON[status],
  };
}

/**
 * The chain reads this module needs, as an interface rather than a concrete client.
 *
 * A seam, so every one of the nine checks below can be made to fail in a test. Without it the only
 * way to exercise "the Paid log came from a contract that is not this agent's account" would be to
 * deploy a hostile contract on mainnet, so the checks would ship unproven. Production passes nothing
 * and gets the real viem client.
 */
export type LeashReads = {
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string; blockNumber: bigint; logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[] } | null>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint } | null>;
  accountOf(agent: `0x${string}`): Promise<string | null>;
  agentId(agent: `0x${string}`, seller: `0x${string}`): Promise<string>;
};

function reads(): LeashReads {
  const c = client();
  return {
    getTransactionReceipt: (a) => c.getTransactionReceipt(a).catch(() => null) as ReturnType<LeashReads["getTransactionReceipt"]>,
    getBlock: (a) => c.getBlock(a).catch(() => null) as ReturnType<LeashReads["getBlock"]>,
    accountOf: (agent) =>
      c.readContract({ address: LEASH_HUB, abi: HUB_ABI, functionName: "accountOf", args: [agent] }).catch(() => null),
    agentId: (agent, seller) =>
      c
        .readContract({ address: LEASH_HUB, abi: HUB_ABI, functionName: "check", args: [agent, seller, 0n] })
        .then((r) => r[3].toString())
        .catch(() => "0"),
  };
}

/**
 * A refusal, with the status to answer it with.
 *
 * 402 means pay or pay again, 403 means the leash itself said no, and 503 means we could not read
 * Monad. The three are kept apart for the same reason lib/x402 separates them: a caller told "your
 * payment is invalid" when our RPC was down would go and pay a second time for nothing.
 */
export type LeashRefusal = { ok: false; status: 402 | 403 | 503; body: Record<string, unknown> };
export type LeashAccepted = {
  ok: true;
  agent: string;
  tx: `0x${string}`;
  ref: `0x${string}`;
  paidAtomic: string;
  paidUsd: string;
  token: string;
  remainingToday: string;
  blockNumber: number;
  erc8004Id: string;
};

/**
 * The whole acceptance path for one request.
 *
 * On refusal it returns the status and the body to send, including the ref the agent must pay, so a
 * client that follows the 402 can pay and retry without being told anything twice.
 */
export async function verifyLeashPayment(args: {
  req: LeashRequest;
  resource: string;
  priceAtomic: string;
  seller?: string;
  /** Test seam. Production passes nothing and gets the live Monad client. */
  reads?: LeashReads;
}): Promise<LeashAccepted | LeashRefusal> {
  const { req, resource, priceAtomic } = args;
  const seller = args.seller ?? PAY_TO;
  const chain = args.reads ?? reads();
  const priceUsd = leashPriceUsd(priceAtomic);

  if (!isAddress(req.agent)) {
    return { ok: false, status: 403, body: { error: "bad_agent", reason: "x-leash-agent is not an address." } };
  }
  const agent = getAddress(req.agent);

  if (!req.nonce || req.nonce.length > MAX_NONCE_LEN) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "payment_required",
        price: priceUsd,
        payTo: seller,
        network: 143,
        howTo: `Send x-leash-agent, x-leash-nonce (at most ${MAX_NONCE_LEN} characters) and x-leash-proof, an agent signature over 'leash:<resource>:<nonce>'.`,
      },
    };
  }

  if (!req.proof) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "payment_required",
        price: priceUsd,
        payTo: seller,
        network: 143,
        howTo: "Send x-leash-proof, an agent signature over 'leash:<resource>:<nonce>'.",
      },
    };
  }

  const proven = await verifyMessage({
    address: agent,
    message: leashProofMessage(resource, req.nonce),
    signature: req.proof as `0x${string}`,
  }).catch(() => false);
  if (!proven) {
    return { ok: false, status: 403, body: { error: "bad_proof", reason: "The signature does not match x-leash-agent." } };
  }

  const ref = leashPaymentRef(seller, resource, req.nonce);

  // No receipt yet. Answer with the live leash verdict beside the price, so the agent learns whether
  // paying would even be allowed before it sends a transaction.
  if (!req.payment) {
    const verdict = await checkLeash(agent, priceAtomic, seller).catch(
      (): LeashVerdict => ({
        status: "UNKNOWN_AGENT",
        ok: false,
        remainingToday: "0",
        expiry: 0,
        erc8004Id: "0",
        account: null,
        reason: "The hub could not be read just now, so the leash is unknown rather than refused.",
      }),
    );
    return {
      ok: false,
      status: verdict.ok ? 402 : 403,
      body: {
        error: verdict.ok ? "payment_required" : "leash_refused",
        price: priceUsd,
        payTo: seller,
        ref,
        network: 143,
        leash: verdict,
        howTo: `Call pay(${seller}, ${priceAtomic}, ${ref}) on your Leash account, then retry with x-leash-payment set to the transaction hash.`,
      },
    };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(req.payment)) {
    return { ok: false, status: 402, body: { error: "bad_payment", ref, reason: "x-leash-payment is not a transaction hash." } };
  }
  const tx = req.payment.toLowerCase() as `0x${string}`;

  const receipt = await chain.getTransactionReceipt({ hash: tx });
  if (!receipt || receipt.status !== "success") {
    return { ok: false, status: 402, body: { error: "payment_not_found", ref, reason: "That transaction is not a successful payment on Monad mainnet." } };
  }

  const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
  if (!block) {
    return { ok: false, status: 503, body: { error: "chain_unreadable", ref, reason: "We could not read the block that payment was mined in. Nothing was charged." } };
  }
  const ageS = Math.floor(Date.now() / 1000) - Number(block.timestamp);
  if (ageS > MAX_PAYMENT_AGE_S) {
    return {
      ok: false,
      status: 402,
      body: { error: "payment_expired", ref, ageSeconds: ageS, maxAgeSeconds: MAX_PAYMENT_AGE_S, reason: "That payment is too old to use. Pay for this request." },
    };
  }

  // The account the hub says belongs to this agent. A Paid event from anywhere else is not a payment,
  // whatever it decodes to.
  const account = await chain.accountOf(agent);
  if (!account || account === "0x0000000000000000000000000000000000000000") {
    return { ok: false, status: 403, body: { error: "unknown_agent", ref, reason: "The hub has no Leash account for this agent address." } };
  }

  const need = BigInt(priceAtomic);
  const accepted = LEASH_ACCEPTED_TOKENS.map((t) => t.toLowerCase());

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== account.toLowerCase()) continue;
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      // topics is readonly on the seam type and decodeEventLog wants a mutable tuple. Copied rather
      // than cast through unknown, so the shape is still checked.
      ev = decodeEventLog({ abi: PAID_ABI, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] }) as typeof ev;
    } catch {
      continue;
    }
    if (ev.eventName !== "Paid") continue;
    const a = ev.args as unknown as { agent: string; seller: string; token: string; amount: bigint; ref: string; remainingToday: bigint };

    if (a.agent.toLowerCase() !== agent.toLowerCase()) continue;
    if (a.seller.toLowerCase() !== seller.toLowerCase()) continue;
    if (a.ref !== ref) continue;

    if (!accepted.includes(a.token.toLowerCase())) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "token_not_accepted",
          ref,
          token: a.token,
          accepts: LEASH_ACCEPTED_TOKENS,
          reason: "That payment was in a token this seller does not accept. USDC on Monad mainnet only.",
        },
      };
    }
    if (a.amount < need) {
      return {
        ok: false,
        status: 402,
        body: { error: "underpaid", ref, paid: formatUnits(a.amount, DECIMALS), price: priceUsd, reason: "That payment is less than the price." },
      };
    }

    const id = await chain.agentId(agent, getAddress(seller));

    return {
      ok: true,
      agent,
      tx,
      ref,
      paidAtomic: a.amount.toString(),
      paidUsd: formatUnits(a.amount, DECIMALS),
      token: a.token,
      remainingToday: formatUnits(a.remainingToday, DECIMALS),
      blockNumber: Number(receipt.blockNumber),
      erc8004Id: id,
    };
  }

  return {
    ok: false,
    status: 402,
    body: {
      error: "payment_mismatch",
      ref,
      reason: "That transaction has no Paid event from your Leash account to this seller with this ref. The ref binds a payment to one request.",
    },
  };
}

/**
 * One payment buys one answer.
 *
 * Mirrors the x402 nonce guard in lib/x402: a hash is reserved before the priced work runs, confirmed
 * when the answer is delivered and released when it is not, so a failure on our side never consumes
 * the buyer's payment. In memory on purpose. The age ceiling above is the durable backstop across a
 * restart, since a receipt older than five minutes is refused whatever this map says.
 */
const RESERVATION_TTL_MS = 120_000;
const spent = new Map<string, { state: "inflight" | "consumed"; at: number }>();

export function reserveLeashPayment(tx: string): { ok: true } | { ok: false; reason: string } {
  const key = tx.toLowerCase();
  const now = Date.now();
  const existing = spent.get(key);
  if (existing) {
    if (existing.state === "consumed") return { ok: false, reason: "That payment has already bought an answer. Pay for this request." };
    if (now - existing.at < RESERVATION_TTL_MS) return { ok: false, reason: "That payment is already being processed." };
  }
  spent.set(key, { state: "inflight", at: now });
  if (spent.size > 10_000) {
    for (const [k, v] of spent) if (now - v.at > RESERVATION_TTL_MS * 4) spent.delete(k);
  }
  return { ok: true };
}

export function releaseLeashPayment(tx: string): void {
  const key = tx.toLowerCase();
  const v = spent.get(key);
  if (v && v.state === "inflight") spent.delete(key);
}

export function confirmLeashPayment(tx: string): void {
  spent.set(tx.toLowerCase(), { state: "consumed", at: Date.now() });
}

/** Exported for the tests, so a case can start from a known empty table. */
export function _resetLeashPayments(): void {
  spent.clear();
}

/** Atomic units from a dollar string, used by tests and by anything quoting a price. */
export const leashAtomic = (usd: string): bigint => parseUnits(usd, DECIMALS);
