/**
 * The server halves of the build kit: the parts that read the chain. Shared by the HTTP routes and
 * the MCP server so both return identical answers. Pure checks stay in lib/build.ts.
 */
import { createPublicClient, http } from "viem";
import { adviceFor, checkRegistration, evidenceInput, parseRegistrationInput, type RegistrationReport } from "./build.ts";
import { viemChain } from "./chains.ts";
import { check } from "./check.ts";
import { explain, findTransaction } from "./findtx.ts";
import { formatNative, gasCheck } from "./gas.ts";

export type Failure = { error: string; status: number; errors?: string[] };

export async function registrationCheck(body: unknown): Promise<(RegistrationReport & { gas: Record<string, unknown> | null; canSend: boolean | null }) | Failure> {
  const p = parseRegistrationInput(body);
  if (!p.ok) return { error: p.errors.join("; "), errors: p.errors, status: 400 };
  const report = checkRegistration(p.value);
  let gas: Record<string, unknown> | null = null;
  if (p.value.sender && report.transaction) {
    const chain = viemChain(p.value.chainId);
    if (chain) {
      const c = createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) });
      const [have, units, price] = await Promise.all([
        c.getBalance({ address: p.value.sender }).catch(() => null),
        c.estimateGas({ account: p.value.sender, to: report.transaction.to, data: report.transaction.data }).catch(() => null),
        c.getGasPrice().catch(() => null),
      ]);
      const g = gasCheck(have, units, price, units === null ? "the registry would not estimate this call from that sender" : "could not read the chain");
      const sym = chain.nativeCurrency.symbol;
      gas =
        g.state === "unknown"
          ? { state: "unknown", reason: g.reason }
          : {
              state: g.state,
              have: `${formatNative(g.haveWei)} ${sym}`,
              need: `${formatNative(g.needWei)} ${sym}`,
              ...(g.state === "short"
                ? { short: `${formatNative(g.shortWei)} ${sym}`, fix: `Send at least ${formatNative(g.shortWei)} ${sym} to ${p.value.sender}. Nobody else can pay this gas: the sender becomes the owner.` }
                : {}),
            };
    }
  }
  // `ready` is about the document; `canSend` adds the sender's gas. Unknown gas is not a no: the chain
  // decides, so canSend is null rather than false when it could not be read or no sender was given.
  const canSend = !report.ready ? false : gas === null || gas.state === "unknown" ? null : gas.state === "enough";
  return { ...report, gas, canSend };
}

export async function evidenceCheck(body: unknown) {
  const input = evidenceInput(body);
  if ("error" in input) return { error: input.error, status: 400 } as Failure;
  const result = await check({ uri: input.dataUri });
  const v = result.verdict;
  let elsewhere: string | null = null;
  let foundOnChain: { chain: string; chainId: number; block: number } | null = null;
  if (v.outcome === "false" && v.declaredTx && /^0x[0-9a-fA-F]{64}$/.test(v.declaredTx)) {
    const r = await findTransaction(v.declaredTx, v.declaredNetwork === "monad" ? 143 : null).catch(() => null);
    if (r?.found) {
      foundOnChain = { chain: r.found.key, chainId: r.found.chainId, block: r.found.blockNumber };
      elsewhere = explain(r);
    }
  }
  return {
    outcome: v.outcome ?? "unknown",
    rung: v.rung,
    reason: v.reason,
    declaredNetwork: v.declaredNetwork ?? null,
    declaredTx: v.declaredTx ?? null,
    mapping: v.mapping ?? null,
    foundOnChain,
    advice: adviceFor(v, elsewhere),
    note: "Judged exactly as a published document would be. The `intact` rung needs the on-chain hash, so it is decided only after publishing.",
    checkedAtBlock: v.checkedAtBlock ? Number(v.checkedAtBlock) : null,
    coverage: result.coverage,
  };
}

export const isFailure = (x: unknown): x is Failure => typeof x === "object" && x !== null && "error" in x && "status" in x;
