/**
 * Fund an Aqueous escrow job from another chain, without bridging first.
 *
 * A buyer holding funds on Base, Arbitrum, Solana or any supported chain funds a Monad escrow job
 * without switching wallets, acquiring Monad USDC or sending a bridge transaction by hand. Aurora
 * Intents Connect moves the source asset, delivers it to an intermediary account on Monad that the
 * source wallet owns through a Chain Signature, then runs destination steps we supply. Those steps
 * are `approve(Aqueous, amount)` on USDC then `createJob(Terms)` on Aqueous, so the intermediary is
 * the job's buyer of record. That is correct because the user owns the intermediary.
 *
 * ## Confirmed against Aurora's live docs and the live API on 2026-09-23
 *
 * Read from https://docs.intents.aurora.dev/llms-full.txt and probed against the live API:
 *
 *  - Base URL `https://intents-connect-api.aurora.dev/api/v1`. Quote and plan both come from
 *    `POST /executions/{wallet}`: `dry: true` returns a quote and a preview, `dry: false` creates
 *    the execution. Verified live: a POST with no key returns `401 {"error":"missing or invalid
 *    api token"}`, so `x-api-key` is required on this endpoint every round, dry or not.
 *  - A step is `{ to, functionSignature, parameters, value }` plus an optional `metadata`. The
 *    docs example is `approve(address,uint256)` then `supply(address,uint256,address,uint16)`.
 *  - The response nests under `result`. `result.quote.minAmountOut` is the worst-case delivered
 *    amount. `result.details.networkFee` is the gas fee the service carves out. And
 *    `result.details.intermediaryAddress` is the account the funds land in and the steps run from.
 *  - The service appends its own fee-transfer step to the echoed `result.steps`. We never add it.
 *  - Monad is supported as source and destination. Verified live from `GET /supported_tokens`
 *    (no key needed): Monad USDC is assetId `nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx`,
 *    6 decimals, contract `0x754704bc059f8c67012fed69bc8a327a5aafb603` on chain 143.
 *
 * ## The shortfall guard
 *
 * Aqueous.createJob pulls exactly `Terms.amount` with `transferFrom` and reverts unless the escrow
 * receives exactly that (its fee-on-transfer guard, `_requireExactlyReceived`). So `Terms.amount`
 * has to equal the guaranteed delivered amount. The docs say it plainly: before signing, compare
 * `result.quote.minAmountOut` with the amount baked into the steps, they should be equal. If the
 * returned value is lower the batch will not have enough token to cover the call. We refuse to
 * proceed when `minAmountOut` is below the amount baked into `createJob`.
 *
 * A revert here is safe rather than a loss. On a revert the delivered assets stay in the
 * intermediary, which the source wallet owns. Recovery is a separate user-authorized withdrawal
 * with Intents Connect covering gas. So a short or wrong amount reverts and the funds are
 * recoverable, they are not lost.
 *
 * `fetch` is injected, so the tests drive every branch with no network of their own.
 */
import { base58 } from "@scure/base";
import {
  encodeFunctionData,
  decodeFunctionData,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
} from "viem";
import { USDC_MONAD } from "./x402.ts";

/**
 * Aqueous on Monad mainnet. Verified live on chain 143 on 2026-09-23: `claimWindow()` returns
 * `0x3f480` (259200). The `createJob` selector `0x4eaad653` plus `authNonceFor` `0x9dbe8a6c` are
 * both in the deployed bytecode. This is the escrow, not the testnet TestUSDC that once shared the
 * address on chain 10143.
 */
export const AQUEOUS_MONAD = "0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32";

/** Monad USDC destination assetId, read live from `/api/v1/supported_tokens` on 2026-09-23. */
export const MONAD_USDC_ASSET_ID = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";

/** The one address the caller supplies. Everything else on Monad is derived or read from chain. */
export const INTENTS_BASE_URL = "https://intents-connect-api.aurora.dev/api/v1";

/** ERC-20 approve, the first destination step. `amount` is `uint256` in the ABI. */
export const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/** The `Terms` struct exactly as `contracts/src/Aqueous.sol` declares it. Field order matters. */
const TERMS_COMPONENTS = [
  { name: "agent", type: "address" },
  { name: "token", type: "address" },
  { name: "amount", type: "uint128" },
  { name: "pricePerUnit", type: "uint128" },
  { name: "deadline", type: "uint64" },
  { name: "termsHash", type: "bytes32" },
  { name: "salt", type: "bytes32" },
] as const;

/** Aqueous.createJob(Terms), the second destination step. */
export const AQUEOUS_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [{ name: "t", type: "tuple", components: TERMS_COMPONENTS }],
    outputs: [{ name: "jobId", type: "bytes32" }],
  },
] as const satisfies Abi;

/** The job terms, matching the on-chain struct. All amounts are base units, never scaled here. */
export type Terms = {
  agent: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  pricePerUnit: bigint;
  deadline: bigint;
  termsHash: `0x${string}`;
  salt: `0x${string}`;
};

/** A parameter as Intents Connect wants it: a base-unit string or a nested array for a tuple. */
export type IntentsParam = string | IntentsParam[];

/** A destination step in the exact shape the API consumes. `metadata` is the service's, never ours. */
export type IntentsStep = {
  to: string;
  functionSignature: string;
  parameters: IntentsParam[];
  value: string;
  metadata?: Record<string, unknown>;
};

/**
 * A built step plus the proof it is well-formed. `data` and `selector` are derived with viem from
 * the real ABI, so a wrong parameter throws at build time rather than reverting on chain. They are
 * for our own checks and are not sent to the API, which takes `functionSignature` and `parameters`.
 */
export type BuiltStep = IntentsStep & {
  data: `0x${string}`;
  selector: `0x${string}`;
};

/** Thrown for a caller mistake that can be fixed, never for an API outcome. */
export class IntentsConfigError extends Error {}
/** Thrown when the API is unreachable or its answer cannot be trusted. We fail closed. */
export class IntentsError extends Error {}
/** Thrown when the guaranteed delivery is below the amount baked into createJob. */
export class ShortfallError extends Error {
  readonly minAmountOut: bigint;
  readonly needed: bigint;
  constructor(minAmountOut: bigint, needed: bigint) {
    super(`guaranteed delivery ${minAmountOut} is below the ${needed} createJob needs`);
    this.name = "ShortfallError";
    this.minAmountOut = minAmountOut;
    this.needed = needed;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function selectorOf(abi: Abi, name: string): { signature: string; selector: `0x${string}` } {
  const item = abi.find((e): e is AbiFunction => e.type === "function" && e.name === name);
  if (!item) throw new IntentsConfigError(`abi has no function ${name}`);
  const signature = toFunctionSignature(item);
  return { signature, selector: toFunctionSelector(signature) };
}

/**
 * Build the two destination steps that fund an Aqueous job: approve then createJob.
 *
 * `amount` is the guaranteed delivered amount, the post-fee `minAmountOut` from the quote, in USDC
 * base units. `Terms.amount` must equal it, because Aqueous pulls exactly `Terms.amount` and reverts
 * on anything short. The token in `Terms` must be the USDC being bridged, so the escrow holds the
 * asset that actually arrived. Both are asserted here rather than trusted.
 *
 * The approve amount equals `amount` too. The intermediary approves Aqueous for exactly what
 * createJob will pull, so no stale allowance is left behind on a shared account.
 */
export function buildFundingSteps(params: {
  amount: bigint;
  terms: Terms;
  usdc?: string;
  aqueous?: string;
}): { steps: BuiltStep[]; amount: bigint } {
  const usdc = params.usdc ?? USDC_MONAD;
  const aqueous = params.aqueous ?? AQUEOUS_MONAD;
  const { amount, terms } = params;

  if (!ADDRESS_RE.test(usdc)) throw new IntentsConfigError("usdc must be a 0x address");
  if (!ADDRESS_RE.test(aqueous)) throw new IntentsConfigError("aqueous must be a 0x address");
  if (!ADDRESS_RE.test(terms.agent)) throw new IntentsConfigError("terms.agent must be a 0x address");
  if (!ADDRESS_RE.test(terms.token)) throw new IntentsConfigError("terms.token must be a 0x address");
  if (!BYTES32_RE.test(terms.termsHash)) throw new IntentsConfigError("terms.termsHash must be bytes32");
  if (!BYTES32_RE.test(terms.salt)) throw new IntentsConfigError("terms.salt must be bytes32");
  if (amount <= 0n) throw new IntentsConfigError("amount must be positive");
  if (amount > (1n << 128n) - 1n) throw new IntentsConfigError("amount does not fit uint128");

  // The whole point of the guard, enforced at construction so a mismatch cannot reach the wire.
  if (terms.amount !== amount) {
    throw new IntentsConfigError(
      `terms.amount ${terms.amount} must equal the guaranteed delivered amount ${amount}`,
    );
  }
  if (terms.token.toLowerCase() !== usdc.toLowerCase()) {
    throw new IntentsConfigError("terms.token must be the USDC being bridged");
  }

  const approve = selectorOf(USDC_ABI, "approve");
  const createJob = selectorOf(AQUEOUS_ABI, "createJob");

  // encodeFunctionData throws if an arg does not fit its ABI type, so a bad Terms never gets built.
  const approveData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: "approve",
    args: [aqueous as `0x${string}`, amount],
  });
  const createJobData = encodeFunctionData({
    abi: AQUEOUS_ABI,
    functionName: "createJob",
    args: [terms],
  });

  const steps: BuiltStep[] = [
    {
      to: usdc,
      functionSignature: approve.signature,
      parameters: [aqueous, amount.toString()],
      value: "0",
      selector: approve.selector,
      data: approveData,
    },
    {
      to: aqueous,
      functionSignature: createJob.signature,
      // A tuple travels as a nested array in ABI field order, values as base-unit strings.
      parameters: [
        [
          terms.agent,
          terms.token,
          amount.toString(),
          terms.pricePerUnit.toString(),
          terms.deadline.toString(),
          terms.termsHash,
          terms.salt,
        ],
      ],
      value: "0",
      selector: createJob.selector,
      data: createJobData,
    },
  ];

  return { steps, amount };
}

/** Decode a createJob step's calldata back into Terms. Lets a caller re-read what it is about to send. */
export function decodeCreateJob(data: `0x${string}`): Terms {
  const { functionName, args } = decodeFunctionData({ abi: AQUEOUS_ABI, data });
  if (functionName !== "createJob") throw new IntentsConfigError(`not createJob calldata: ${functionName}`);
  return args[0] as Terms;
}

/**
 * The guard, on its own so it can be tested and called directly. Refuses when the guaranteed
 * delivery is below what createJob will pull. Equal is fine, lower is a refusal, never a proceed.
 */
export function enforceShortfallGuard(input: { minAmountOut: bigint; needed: bigint }): void {
  if (input.minAmountOut < input.needed) {
    throw new ShortfallError(input.minAmountOut, input.needed);
  }
}

/** A `fetch` shaped to what this module needs, so tests pass a fake and touch no network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: "error";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type IntentsConfig = {
  /** The x-api-key for POST /executions. Generated at studio.aurora.dev. Required to create or quote. */
  apiKey: string;
  /** Defaults to the Aurora host. Must be https and on the allowlist. */
  baseUrl?: string;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
};

/** Hosts this client will talk to. Pinning the host is the core of the SSRF guard. */
const ALLOWED_HOSTS = new Set(["intents-connect-api.aurora.dev"]);

function assertBase(baseUrl: string | undefined): string {
  const base = baseUrl ?? INTENTS_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new IntentsConfigError(`baseUrl is not a URL: ${base}`);
  }
  if (parsed.protocol !== "https:") throw new IntentsConfigError("baseUrl must be https");
  if (!ALLOWED_HOSTS.has(parsed.host)) throw new IntentsConfigError(`host ${parsed.host} is not allowlisted`);
  // Keep the path so /api/v1 survives, drop a trailing slash so joins are clean.
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

/** What we read out of an execution response, parsed and typed. Kept pure so tests pin the mapping. */
export type ExecutionQuote = {
  minAmountOut: bigint;
  networkFee: bigint | null;
  intermediary: string | null;
  depositAddress: string | null;
  id: string | null;
  status: string | null;
  /** The echoed steps, our two plus the service's appended fee transfer. */
  steps: IntentsStep[];
  raw: unknown;
};

/**
 * Turn a raw response body into a typed quote or throw.
 *
 * A missing `minAmountOut` is fatal, because the guard cannot run without it and guessing would be
 * the fail-open bug this whole project exists to expose. If gas estimation failed the service omits
 * `networkFee`. The docs say to treat that quote as unusable, so we surface it as null and let the
 * caller refuse rather than bake a gross figure.
 */
export function parseExecution(body: unknown): ExecutionQuote {
  const result = (body as { result?: unknown })?.result as
    | { quote?: Record<string, unknown>; details?: Record<string, unknown>; steps?: unknown; id?: unknown; status?: unknown }
    | undefined;
  if (!result || typeof result !== "object") throw new IntentsError("response had no result object");

  const quote = result.quote ?? {};
  const min = quote.minAmountOut;
  if (typeof min !== "string" || !/^\d+$/.test(min)) {
    throw new IntentsError("response carried no numeric quote.minAmountOut");
  }

  const details = result.details ?? {};
  const feeRaw = details.networkFee;
  const networkFee = typeof feeRaw === "string" && /^\d+$/.test(feeRaw) ? BigInt(feeRaw) : null;

  return {
    minAmountOut: BigInt(min),
    networkFee,
    intermediary: typeof details.intermediaryAddress === "string" ? details.intermediaryAddress : null,
    depositAddress: typeof quote.depositAddress === "string" ? quote.depositAddress : null,
    id: typeof result.id === "string" ? result.id : null,
    status: typeof result.status === "string" ? result.status : null,
    steps: Array.isArray(result.steps) ? (result.steps as IntentsStep[]) : [],
    raw: body,
  };
}

/** The source-side of the quote the API asks for. Destination defaults to Monad USDC. */
export type QuoteSpec = {
  /** The assetId the buyer holds, from `/supported_tokens`. */
  originAsset: string;
  /** Source amount, base units for the origin asset. */
  amount: string;
  /** Destination assetId. Defaults to Monad USDC. */
  destinationAsset?: string;
  /** Slippage in basis points. Defaults to 100 (1%). */
  slippageTolerance?: number;
  swapType?: string;
  deadline?: string;
};

/** Drop the verification aids so only what the API consumes goes on the wire. */
export function toWireSteps(steps: BuiltStep[]): IntentsStep[] {
  return steps.map((s) => ({
    to: s.to,
    functionSignature: s.functionSignature,
    parameters: s.parameters,
    value: s.value,
  }));
}

/**
 * Ask the service for a quote and a preview of the batch. `dry` true prices it without creating
 * anything, which is the read-only path this client uses. Throws `IntentsError` on any transport
 * failure, a non-2xx status or a body without a usable quote, so a caller cannot mistake an
 * unreachable API for a cleared one.
 */
export async function requestExecution(
  params: { wallet: string; quote: QuoteSpec; steps: IntentsStep[]; dry: boolean },
  cfg: IntentsConfig,
): Promise<ExecutionQuote> {
  const base = assertBase(cfg.baseUrl);
  if (!cfg.apiKey) throw new IntentsConfigError("apiKey is required for POST /executions");
  if (!ADDRESS_RE.test(params.wallet)) throw new IntentsConfigError("wallet must be a 0x address");

  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);

  const body = JSON.stringify({
    version: "1.0",
    type: "evm",
    quote: {
      originAsset: params.quote.originAsset,
      amount: params.quote.amount,
      destinationAsset: params.quote.destinationAsset ?? MONAD_USDC_ASSET_ID,
      slippageTolerance: params.quote.slippageTolerance ?? 100,
      swapType: params.quote.swapType ?? "EXACT_INPUT",
      ...(params.quote.deadline ? { deadline: params.quote.deadline } : {}),
    },
    steps: params.steps,
    dry: params.dry,
  });

  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await doFetch(`${base}/executions/${params.wallet}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    throw new IntentsError(`request failed: ${errText(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new IntentsError(`http ${res.status}`);
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new IntentsError("response was not json");
  }
  return parseExecution(parsed);
}

/**
 * The intermediary account for a wallet: the Monad address the bridged funds land in and the steps
 * run from, so it is the job's buyer of record. The source wallet owns it through Chain Signature.
 * No key is needed for this read.
 */
export async function getIntermediary(wallet: string, cfg: Pick<IntentsConfig, "baseUrl" | "fetchImpl" | "timeoutMs">): Promise<string> {
  const base = assertBase(cfg.baseUrl);
  if (!ADDRESS_RE.test(wallet)) throw new IntentsConfigError("wallet must be a 0x address");
  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await doFetch(`${base}/executions/${wallet}/intermediary`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    throw new IntentsError(`request failed: ${errText(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new IntentsError(`http ${res.status}`);
  const body = (await res.json()) as { result?: { evm?: unknown } };
  const evm = body?.result?.evm;
  if (typeof evm !== "string" || !ADDRESS_RE.test(evm)) throw new IntentsError("no intermediary evm address in response");
  return evm;
}

/**
 * The whole safe path in one call: build the batch for the amount the caller wants to fund, ask the
 * service to price it, then refuse unless the guaranteed delivery covers the createJob amount.
 *
 * `terms.amount` is the amount to fund, so it is also what createJob pulls and what the guard checks
 * the delivery against. Returns the built steps and the priced quote when the guard passes. Throws
 * `ShortfallError` when it does not. It never returns a plan the escrow would revert on.
 */
export async function planAqueousFunding(
  params: { wallet: string; quote: QuoteSpec; terms: Terms; usdc?: string; aqueous?: string },
  cfg: IntentsConfig,
): Promise<{ built: BuiltStep[]; amount: bigint; quote: ExecutionQuote }> {
  const { steps, amount } = buildFundingSteps({
    amount: params.terms.amount,
    terms: params.terms,
    usdc: params.usdc,
    aqueous: params.aqueous,
  });
  const quote = await requestExecution(
    { wallet: params.wallet, quote: params.quote, steps: toWireSteps(steps), dry: true },
    cfg,
  );
  enforceShortfallGuard({ minAmountOut: quote.minAmountOut, needed: amount });
  return { built: steps, amount, quote };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.name === "AbortError" ? "timeout" : err.message;
  return String(err);
}





/* ------------------------------------------------------------------ signing the execution */

/**
 * The destination steps run only after the wallet signs the execution's messageToSign. Aurora's
 * guidance (mentor answer of 2026-09-29 plus developer-guides/submit-signing): sign right after create,
 * before depositing, so the batch runs by itself the moment the bridge lands.
 *
 * Format: EIP-191 personal_sign over the exact string, the 65-byte signature with v normalised to 0/1,
 * base58 encoded and prefixed `secp256k1:`. Posted to /executions/{wallet}/submit.
 */

/** messageToSign from a create or status response, wherever the service nested it. */
export function findMessageToSign(raw: unknown, depth = 0): string | null {
  if (!raw || typeof raw !== "object" || depth > 6) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.messageToSign === "string" && o.messageToSign.length > 0) return o.messageToSign;
  for (const v of Object.values(o)) {
    const f = findMessageToSign(v, depth + 1);
    if (f) return f;
  }
  return null;
}

/** 0x r||s||v (v 27/28 or 0/1) -> `secp256k1:<base58 of r||s||v01>`. */
export function toIntentsSignature(hex: `0x${string}`): string {
  const b = Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
  if (b.length !== 65) throw new Error(`signature is ${b.length} bytes, expected 65`);
  const v = b[64]!;
  b[64] = v >= 27 ? v - 27 : v;
  if (b[64]! > 1) throw new Error(`recovery id ${v} is not 0, 1, 27 or 28`);
  return `secp256k1:${base58.encode(b)}`;
}

export async function submitSignature(
  a: { wallet: string; executionId: string; signature: string },
  cfg: { apiKey: string; baseUrl?: string; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const r = await fetch(`${cfg.baseUrl ?? INTENTS_BASE_URL}/executions/${a.wallet}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
    body: JSON.stringify({ executionId: a.executionId, signature: a.signature }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}
