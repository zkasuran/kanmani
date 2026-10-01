/**
 * Which agent a caller means, on which chain, before anything is priced.
 *
 * Sentinel and Assay took a bare `agentId` and measured Monad's agent with that number. ERC-8004 ids
 * are per chain, so a broker asking about its own agent on Base would have been answered about a
 * different agent that happens to share the number on Monad, then charged for it. Found 2026-10-01
 * when Taifoon said its first paid jobs would name agents registered on Base.
 *
 * So a reference carries its chain. Accepted forms, most explicit first:
 *   { "agent": "eip155:8453:0x8004A169...:42" }          the ERC-8004 agent reference
 *   { "agentRegistry": "eip155:8453:0x8004A169...", "agentId": 42 }
 *   { "chainId": 8453, "agentId": 42 }
 *   { "agentId": 42 }                                     means Monad, the chain these agents measure
 *
 * Only Monad is measured here. Any other chain is refused before the payment is asked for, so a
 * caller never pays to hear "we do not index that". An id not in the Monad index is refused the same
 * way instead of being answered `unknown` at full price.
 */
export const MEASURED_CHAIN = 143;

export type AgentRef = { chainId: number; agentId: number };

export class AgentRefError extends Error {
  readonly input = true;
  /** true when the reference was well formed but names an agent or chain we do not measure. */
  readonly notMeasured: boolean;
  constructor(message: string, notMeasured: boolean) {
    super(message);
    this.name = "AgentRefError";
    this.notMeasured = notMeasured;
  }
}

const CAIP_AGENT = /^eip155:(\d+):(0x[0-9a-fA-F]{40})[:#/](\d+)$/;
const CAIP_REGISTRY = /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/;

const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Parse the reference. Throws an AgentRefError the route answers as 400, nothing charged. */
export function parseAgentRef(input: Record<string, unknown>, example: string): AgentRef {
  if (typeof input.agent === "string") {
    const m = CAIP_AGENT.exec(input.agent.trim());
    if (!m) throw new AgentRefError(`agent must look like eip155:<chainId>:<registry>:<agentId>. Send ${example}`, false);
    return { chainId: Number(m[1]), agentId: Number(m[3]) };
  }
  let chainId = MEASURED_CHAIN;
  if (typeof input.agentRegistry === "string") {
    const m = CAIP_REGISTRY.exec(input.agentRegistry.trim());
    if (!m) throw new AgentRefError(`agentRegistry must look like eip155:<chainId>:<registry>. Send ${example}`, false);
    chainId = Number(m[1]);
  } else if (input.chainId !== undefined) {
    const c = posInt(input.chainId);
    if (c === null) throw new AgentRefError(`chainId must be a positive integer. Send ${example}`, false);
    chainId = c;
  }
  const agentId = posInt(input.agentId);
  if (agentId === null) throw new AgentRefError(`agentId must be a positive integer. Send ${example}`, false);
  return { chainId, agentId };
}

/**
 * Parse, then check the agent is one we measure. `exists` is injected so the rule is testable
 * without a database.
 */
export async function resolveAgentRef(
  input: Record<string, unknown>,
  example: string,
  exists: (agentId: number) => Promise<boolean>,
): Promise<AgentRef> {
  const ref = parseAgentRef(input, example);
  if (ref.chainId !== MEASURED_CHAIN) {
    throw new AgentRefError(
      `agent ${ref.agentId} on chain ${ref.chainId} is not measured here. This agent measures ERC-8004 agents on Monad (chain 143) only, so it cannot answer about this one and has not charged you. ERC-8004 ids are per chain: Monad's agent ${ref.agentId} is a different agent.`,
      true,
    );
  }
  if (!(await exists(ref.agentId))) {
    throw new AgentRefError(
      `agent ${ref.agentId} is not in our Monad index, so there is nothing to measure and nothing was charged. If it is registered on another chain, send its reference as eip155:<chainId>:<registry>:<agentId>.`,
      true,
    );
  }
  return ref;
}
