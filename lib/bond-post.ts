/**
 * Posting and releasing a Sclera bond from a browser, as pure functions.
 *
 * Sclera version 2 (`0xB4d641f0…FE3f`, chain 143) holds a bond an agent's owner posts against its own
 * claim-truth rate. The rules below mirror `postBond` in contracts/src/ScleraV2.sol line for line, so a form
 * refuses exactly what the contract would revert on, before any gas is spent:
 *
 *   agentId != 0, amount != 0, minTruthRateBps <= 10000, windowBlocks != 0, minSampleSize != 0,
 *   no ACTIVE bond for this agent, msg.sender == ownerOf(agentId).
 *
 * Two facts a poster must see before signing, because neither can be undone:
 *
 *   - A slash is burned. It goes to 0x...dEaD, not to the operator or the attestor, so nobody in the
 *     decision path is paid by one. A new bond can follow a released or slashed one.
 *   - The amount leaves the wallet for the whole window. It comes back only through `release`. Even then
 *     only if no verdict slashed it first.
 *
 * Posting is two transactions: approve Sclera for exactly the amount on the token, then postBond.
 * The approval is exact, never unlimited, so a leftover allowance cannot be spent later.
 */
import { encodeFunctionData, erc20Abi } from "viem";

export const SCLERA_ADDRESS = "0xB4d641f016f53C683c409F271eE85e136041FE3f" as const;
/** Version 1, which still holds Kanmani's own earlier bonds. Read-only here: nothing new is posted to it. */
export const SCLERA_V1_ADDRESS = "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf" as const;
export const USDC_MONAD_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;
export const MONAD_BLOCK_MS = 266;

export const SCLERA_WRITE_ABI = [
  {
    type: "function",
    name: "postBond",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "minTruthRateBps", type: "uint16" },
      { name: "windowBlocks", type: "uint64" },
      { name: "minSampleSize", type: "uint32" },
    ],
    outputs: [],
  },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }], outputs: [] },
] as const;

/** Presets the form offers. Our own bonds used a day's worth (216,000 blocks is about 16 hours). */
export const WINDOW_PRESETS = [
  { label: "about 1 hour", blocks: 13_534n },
  { label: "about 16 hours", blocks: 216_000n },
  { label: "about 1 week", blocks: 2_273_684n },
] as const;

export type BondDraft = {
  agentId: string;
  /** Human USDC, e.g. "0.01". Parsed to 6-decimal atomic units without floating point. */
  amountUsdc: string;
  minTruthRatePct: string;
  windowBlocks: string;
  minSampleSize: string;
};

export type BondPlan = {
  agentId: bigint;
  amountAtomic: bigint;
  minTruthRateBps: number;
  windowBlocks: bigint;
  minSampleSize: number;
  approve: { to: `0x${string}`; data: `0x${string}` };
  post: { to: `0x${string}`; data: `0x${string}` };
  /** Plain-language window length at the measured block time. */
  windowHuman: string;
};

const MAX_U128 = (1n << 128n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_U32 = 2 ** 32 - 1;

/** "0.01" -> 10000n. Six decimals, strings only, refuses more places than the token has. */
export function usdcToAtomic(v: string): bigint | null {
  const t = v.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"));
}

export function humanBlocks(blocks: bigint): string {
  const s = Number(blocks) * (MONAD_BLOCK_MS / 1000);
  if (s < 90) return `${Math.round(s)} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 172_800) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86_400)} days`;
}

/** Validate a draft against the contract's own reverts. Every error names the field and the rule. */
export function planBond(d: BondDraft, token: `0x${string}` = USDC_MONAD_ADDRESS, sclera: `0x${string}` = SCLERA_ADDRESS): { ok: true; plan: BondPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const id = /^\d+$/.test(d.agentId.trim()) ? BigInt(d.agentId.trim()) : null;
  if (id === null || id === 0n) errors.push("agent id: a positive whole number (the contract rejects 0)");

  const amount = usdcToAtomic(d.amountUsdc);
  if (amount === null) errors.push("amount: a USDC amount with at most 6 decimals, like 0.01");
  else if (amount === 0n) errors.push("amount: must be more than zero (the contract rejects 0)");
  else if (amount > MAX_U128) errors.push("amount: too large");

  const pct = Number(d.minTruthRatePct);
  const bps = Number.isFinite(pct) ? Math.round(pct * 100) : NaN;
  if (!/^\d+(\.\d{1,2})?$/.test(d.minTruthRatePct.trim()) || !(bps >= 0 && bps <= 10_000)) {
    errors.push("floor: a percentage from 0 to 100 with at most 2 decimals");
  }

  const win = /^\d+$/.test(d.windowBlocks.trim()) ? BigInt(d.windowBlocks.trim()) : null;
  if (win === null || win === 0n) errors.push("window: a positive number of blocks (the contract rejects 0)");
  else if (win > MAX_U64) errors.push("window: too large");

  const sample = /^\d+$/.test(d.minSampleSize.trim()) ? Number(d.minSampleSize.trim()) : NaN;
  if (!(sample >= 1 && sample <= MAX_U32)) errors.push("minimum sample: at least 1 (the contract rejects 0)");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      agentId: id!,
      amountAtomic: amount!,
      minTruthRateBps: bps,
      windowBlocks: win!,
      minSampleSize: sample,
      approve: { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [sclera, amount!] }) },
      post: {
        to: sclera,
        data: encodeFunctionData({ abi: SCLERA_WRITE_ABI, functionName: "postBond", args: [id!, token, amount!, bps, win!, sample] }),
      },
      windowHuman: humanBlocks(win!),
    },
  };
}

export function releaseCalldata(agentId: bigint): `0x${string}` {
  return encodeFunctionData({ abi: SCLERA_WRITE_ABI, functionName: "release", args: [agentId] });
}

/**
 * Why this address may or may not post a bond for this agent, before any gas is spent.
 * `owner` and `state` are read from chain by the caller; null means the read failed.
 */
export function canPost(o: { sender: string; owner: string | null; state: "none" | "active" | "slashed" | "released" | null }):
  | { ok: true }
  | { ok: false; reason: string; unknown?: true } {
  if (o.owner === null || o.state === null) return { ok: false, unknown: true, reason: "Could not read the registry or the bond contract, so nothing is decided. Try again." };
  if (o.owner.toLowerCase() !== o.sender.toLowerCase()) return { ok: false, reason: `This agent is owned by ${o.owner}. Only its owner can bond it.` };
  if (o.state === "active") {
    return { ok: false, reason: "This agent already has an active bond. A new one can be posted once it is released or slashed." };
  }
  return { ok: true };
}

/**
 * A suggested floor from the agent's measured claim-truth rate, by the same rule Kanmani's Assay sells:
 * five points under the measured rate. No suggestion below a sample of 5 or a floor of 1%.
 * A suggestion only. The poster decides.
 */
export function suggestFloor(rateBps: number | null, sampleSize: number): { floorPct: string | null; why: string } {
  if (rateBps === null || sampleSize < 5) return { floorPct: null, why: `Only ${sampleSize} decided claim${sampleSize === 1 ? "" : "s"} so far. Below 5 there is no measured rate worth pricing, so choose a floor you can keep.` };
  const floor = Math.min(10_000, rateBps - 500);
  if (floor < 100) return { floorPct: null, why: `Measured claim truth is ${(rateBps / 100).toFixed(1)}%. Any floor below that cannot slash and any above it slashes on the next measurement.` };
  return { floorPct: (floor / 100).toFixed(2), why: `Measured claim truth is ${(rateBps / 100).toFixed(1)}% over ${sampleSize} claims. Five points under that leaves room for one bad week.` };
}
