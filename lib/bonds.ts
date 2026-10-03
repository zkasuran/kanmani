/**
 * Read a bond's CURRENT state straight from Sclera.
 *
 * ## Why this reads the contract instead of an index
 *
 * Sclera is deliberately not in the indexer and adding it would not fix the thing that matters. A
 * bond's window matures by a block number passing, which emits nothing. An index built only from
 * `BondPosted` would therefore keep showing "Active" for a bond whose window closed hours ago, which is
 * a stale published claim: the exact failure this project measures in other people's records.
 *
 * So current state comes from `bonds(agentId)`, which cannot be out of date because it IS the state.
 * Event history is a separate job and is listed as an open gap rather than faked from a single read.
 *
 * ## The cost, stated plainly
 *
 * One RPC call per agent page. That is acceptable because the pages are already `force-dynamic` and a
 * bond is the one number on the page where being right matters more than being fast. A cached bond
 * state is worse than no bond state.
 */

import { createPublicClient, http } from "viem";

import { viemChain } from "./chains.ts";
import RAW from "../shared/erc8004-chains.json" with { type: "json" };

const SCLERA = (RAW as { ourContracts: { sclera: { address: string; chainId: number } } }).ourContracts.sclera;

/** Mirrors `struct Bond` field for field, in declaration order. */
const BONDS_ABI = [
  {
    type: "function",
    name: "bonds",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "postedAt", type: "uint64" },
      { name: "state", type: "uint8" },
      { name: "token", type: "address" },
      { name: "windowBlocks", type: "uint64" },
      { name: "amount", type: "uint128" },
      { name: "minTruthRateBps", type: "uint16" },
      { name: "minSampleSize", type: "uint32" },
      { name: "lastNonce", type: "uint64" },
    ],
  },
] as const;

/** Contract enum. 0 means no bond was ever posted, which is not the same as one that ended. */
export const BOND_STATE = ["none", "active", "slashed", "released"] as const;
export type BondState = (typeof BOND_STATE)[number];

export type Bond = {
  agentId: number;
  state: BondState;
  /** Atomic units of `token`. Zero after a release, which is why state is read alongside it. */
  amountAtomic: string;
  token: string;
  /** The floor a measured claim-truth rate must hold to avoid a slash. */
  minTruthRateBps: number;
  minSampleSize: number;
  postedAtBlock: string;
  windowBlocks: string;
  /** Null until the head block is known, so a caller is never handed a guessed maturity. */
  maturesAtBlock: string | null;
  matured: boolean | null;
  /** The address that posted it, which the contract requires to be the agent owner. */
  postedBy: string;
  address: string;
};

function client() {
  // Null would mean the chain fell out of the registry, which is a configuration fault rather than a
  // missing bond, so it throws and the caller reports "could not look" instead of "unbonded".
  const chain = viemChain(SCLERA.chainId);
  if (!chain) throw new Error(`chain ${SCLERA.chainId} is not in the registry`);
  return createPublicClient({ chain, transport: http() });
}

/**
 * One bond or null when none was ever posted.
 *
 * Returns null rather than throwing on an RPC failure, because a page that cannot reach the chain must
 * say it does not know instead of implying the agent is unbonded. `unknown` is never `false` here
 * either, which is why the caller gets `null` for "could not look" and a `state` of `"none"` only when
 * the contract itself says so.
 */
export async function bondFor(agentId: number): Promise<Bond | null> {
  try {
    const c = client();
    const [r, head] = await Promise.all([
      c.readContract({
        address: SCLERA.address as `0x${string}`,
        abi: BONDS_ABI,
        functionName: "bonds",
        args: [BigInt(agentId)],
      }),
      c.getBlockNumber().catch(() => null),
    ]);

    const [agent, postedAt, state, token, windowBlocks, amount, minTruthRateBps, minSampleSize] = r as unknown as [
      string,
      bigint,
      number,
      string,
      bigint,
      bigint,
      number,
      number,
      bigint,
    ];

    if (state === 0) return null;

    const matures = postedAt + windowBlocks;
    return {
      agentId,
      state: BOND_STATE[state] ?? "none",
      amountAtomic: amount.toString(),
      token,
      minTruthRateBps,
      minSampleSize,
      postedAtBlock: postedAt.toString(),
      windowBlocks: windowBlocks.toString(),
      maturesAtBlock: matures.toString(),
      matured: head === null ? null : head >= matures,
      postedBy: agent,
      address: SCLERA.address,
    };
  } catch {
    return null;
  }
}

/** Several agents at once, for a page that lists them. Failures come back absent, never as "unbonded". */
export async function bondsFor(agentIds: readonly number[]): Promise<Map<number, Bond>> {
  const out = new Map<number, Bond>();
  const found = await Promise.all(agentIds.map((id) => bondFor(id)));
  for (const b of found) if (b) out.set(b.agentId, b);
  return out;
}

/** 6dp USDC for display. Kept here so a page never divides by a magic number inline. */
export function usdc(atomic: string): string {
  // BigInt maths, never Number(atomic)/1e6: a float loses precision above about nine billion USDC
  // and would misprint a large bond. Display only, but a project about correct numbers should not
  // round its own.
  let v: bigint;
  try {
    v = BigInt(atomic);
  } catch {
    return "0.00";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 1_000_000n;
  const whole = (v / base).toLocaleString("en-US");
  const raw = (v % base).toString().padStart(6, "0");
  const trimmed = raw.replace(/0+$/, "");
  const frac = trimmed.length < 2 ? raw.slice(0, 2) : trimmed;
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
