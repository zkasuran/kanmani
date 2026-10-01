/**
 * Recover a short landing or an expired fund (flagship item 3.3).
 *
 * A delivery that came in below the job amount makes `createJob` revert, and a deadline that passes
 * before the steps run never fires them. Both leave USDC sitting at the intermediary account, which the
 * source wallet owns (Chris Gutkowski, Aurora, 2026-09-29, and the intermediary deep dive: "these assets
 * remain under the control of the source wallet", "the user does not need to acquire the destination gas
 * to recover their assets"). There is no automatic refund and no claim call. Recovery is a user-authorized
 * steps-only execution that runs from the balance already there, with Aurora sponsoring the gas.
 *
 * Two one-click recoveries, both steps-only executions:
 *   re-fund  approve(Aqueous, bal) + createJob(Terms sized to bal), so the escrow pulls exactly what
 *            arrived and the shortfall guard holds by construction (it reuses `buildFundingSteps`).
 *   withdraw a single transfer(recipient, bal) on Monad USDC, Aurora paying the gas.
 *
 * The classify and build functions are pure and unit-tested. The HTTP call and its parse live in
 * `lib/intents.ts` beside the forward client (`requestStepsExecution`, `parseStepsExecution`), reused here.
 */
import { encodeFunctionData, toFunctionSelector, toFunctionSignature, type Abi, type AbiFunction } from "viem";
import { buildFundingSteps, IntentsConfigError, type BuiltStep, type Terms } from "./intents.ts";
import { USDC_MONAD } from "./x402.ts";

export { requestStepsExecution, parseStepsExecution, type StepsExecution } from "./intents.ts";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** ERC-20 transfer, the one step a withdrawal needs. */
export const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

function selectorOf(abi: Abi, name: string): { signature: string; selector: `0x${string}` } {
  const item = abi.find((e): e is AbiFunction => e.type === "function" && e.name === name);
  if (!item) throw new IntentsConfigError(`abi has no function ${name}`);
  const signature = toFunctionSignature(item);
  return { signature, selector: toFunctionSelector(signature) };
}

export type FundingClass = "funded" | "short" | "expired" | "recoverable" | "empty";

/**
 * Classify where a fund stands, from its status plus the live intermediary balance.
 *
 *   funded       the job was created (SUCCESS). Nothing to recover.
 *   empty        no balance at the intermediary. Nothing to recover.
 *   expired      past the deadline (or EXPIRED) with a balance still there. Recover with steps-only.
 *   short        a balance below what the job needs, so createJob reverted. Recover with steps-only.
 *   recoverable  a balance that would cover the job, sitting unrun. Recover with steps-only.
 *
 * `expired` is checked before `short` because the deadline is the clearer signal and the recovery copy
 * differs: an expired fund speaks to the deadline, a short one to the delivery. Both recover the same way.
 */
export function classifyFunding(a: {
  status?: string | null;
  neededAmount: bigint;
  intermediaryBalance: bigint;
  deadline?: bigint | null;
  now?: bigint;
}): FundingClass {
  const now = a.now ?? BigInt(Math.floor(Date.now() / 1000));
  if (a.status === "SUCCESS") return "funded";
  if (a.intermediaryBalance <= 0n) return "empty";
  if (a.status === "EXPIRED" || (a.deadline != null && now > a.deadline)) return "expired";
  if (a.intermediaryBalance < a.neededAmount) return "short";
  return "recoverable";
}

/**
 * Re-fund: build approve + createJob sized to the balance that actually arrived. Reuses the forward
 * builder, so the escrow's exact-amount guard is satisfied by construction and a Terms whose amount
 * does not equal the balance is refused there rather than reverting on chain.
 */
export function buildRefundSteps(a: {
  balance: bigint;
  terms: Terms;
  usdc?: string;
  aqueous?: string;
}): { steps: BuiltStep[]; amount: bigint } {
  const terms: Terms = { ...a.terms, amount: a.balance };
  return buildFundingSteps({ amount: a.balance, terms, usdc: a.usdc, aqueous: a.aqueous });
}

/** Withdraw: one transfer(recipient, balance) on Monad USDC. Encoded with viem, so a bad arg throws at build time. */
export function buildWithdrawStep(a: { balance: bigint; recipient: string; usdc?: string }): BuiltStep {
  const usdc = a.usdc ?? USDC_MONAD;
  if (!ADDRESS_RE.test(usdc)) throw new IntentsConfigError("usdc must be a 0x address");
  if (!ADDRESS_RE.test(a.recipient)) throw new IntentsConfigError("recipient must be a 0x address");
  if (a.balance <= 0n) throw new IntentsConfigError("balance must be positive");
  if (a.balance > (1n << 256n) - 1n) throw new IntentsConfigError("balance does not fit uint256");

  const transfer = selectorOf(TRANSFER_ABI, "transfer");
  const data = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: "transfer",
    args: [a.recipient as `0x${string}`, a.balance],
  });
  return {
    to: usdc,
    functionSignature: transfer.signature,
    parameters: [a.recipient, a.balance.toString()],
    value: "0",
    selector: transfer.selector,
    data,
  };
}
