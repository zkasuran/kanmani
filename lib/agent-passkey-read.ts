/**
 * Server read of AgentPasskey.keyOf, for the API. `unknown` when the chain cannot be read, never
 * "unbound": not being able to look is not the same as there being nothing there.
 */
import { createPublicClient, http } from "viem";
import { viemChain } from "./chains.ts";
import { AGENT_PASSKEY_ABI, AGENT_PASSKEY_ADDRESS } from "./agent-passkey.ts";

export type PasskeyBinding =
  | { state: "bound"; qx: string; qy: string; boundAtBlock: string; contract: string; precompile: "0x0100" }
  | { state: "none"; contract: string }
  | { state: "unknown"; contract: string };

export async function passkeyBinding(agentId: number): Promise<PasskeyBinding> {
  const chain = viemChain(143);
  if (!chain) return { state: "unknown", contract: AGENT_PASSKEY_ADDRESS };
  try {
    const c = createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) });
    const [bound, qx, qy, at] = await c.readContract({ address: AGENT_PASSKEY_ADDRESS, abi: AGENT_PASSKEY_ABI, functionName: "keyOf", args: [BigInt(agentId)] });
    if (!bound) return { state: "none", contract: AGENT_PASSKEY_ADDRESS };
    const h = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}`;
    return { state: "bound", qx: h(qx), qy: h(qy), boundAtBlock: at.toString(), contract: AGENT_PASSKEY_ADDRESS, precompile: "0x0100" };
  } catch {
    return { state: "unknown", contract: AGENT_PASSKEY_ADDRESS };
  }
}
