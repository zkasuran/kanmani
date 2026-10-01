/** Reading an A2A message (a2a-protocol.org, message/send) into an agent call. Pure. */

export type A2APart = { kind?: string; text?: string; data?: Record<string, unknown> };

/** agentId and options from an A2A message: a data part, a JSON text part or a number in text. */
export function inputFromParts(parts: A2APart[] | undefined): { agentId?: number; maxAgeBlocks?: number; agent?: string } {
  const out: { agentId?: number; maxAgeBlocks?: number; agent?: string } = {};
  for (const p of parts ?? []) {
    let d: Record<string, unknown> | null = null;
    if (p.kind === "data" && p.data && typeof p.data === "object") d = p.data;
    else if (typeof p.text === "string") {
      try {
        const j = JSON.parse(p.text);
        if (j && typeof j === "object") d = j as Record<string, unknown>;
      } catch {
        // An ERC-8004 reference in prose carries its chain. Without this, "agent eip155:8453:0x..:42"
        // read its first number, the chain id, as the agent id.
        const ref = p.text.match(/eip155:\d+:0x[0-9a-fA-F]{40}[:#/]\d+/);
        if (ref && out.agent === undefined) out.agent = ref[0];
        else {
          const m = p.text.match(/\b(\d{1,9})\b/);
          if (m && out.agentId === undefined) out.agentId = Number(m[1]);
        }
      }
    }
    if (d) {
      if (d.agentId !== undefined) out.agentId = Number(d.agentId);
      if (d.maxAgeBlocks !== undefined) out.maxAgeBlocks = Number(d.maxAgeBlocks);
    }
  }
  return out;
}


/**
 * The whole call from an A2A message for agents whose input is not just an agentId: the first data
 * part (or JSON text part) as the input object. The agentId fields above still apply for the core
 * agents, which accept a bare number in plain text.
 */
export function objectFromParts(parts: A2APart[] | undefined): Record<string, unknown> {
  for (const p of parts ?? []) {
    if (p.kind === "data" && p.data && typeof p.data === "object") return p.data;
    if (typeof p.text === "string") {
      try {
        const j = JSON.parse(p.text);
        if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
      } catch {}
    }
  }
  return {};
}
