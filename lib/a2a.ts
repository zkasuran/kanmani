/** Reading an A2A message (a2a-protocol.org, message/send) into an agent call. Pure. */

export type A2APart = { kind?: string; text?: string; data?: Record<string, unknown> };

/** agentId and options from an A2A message: a data part, a JSON text part or a number in text. */
export function inputFromParts(parts: A2APart[] | undefined): { agentId?: number; maxAgeBlocks?: number } {
  const out: { agentId?: number; maxAgeBlocks?: number } = {};
  for (const p of parts ?? []) {
    let d: Record<string, unknown> | null = null;
    if (p.kind === "data" && p.data && typeof p.data === "object") d = p.data;
    else if (typeof p.text === "string") {
      try {
        const j = JSON.parse(p.text);
        if (j && typeof j === "object") d = j as Record<string, unknown>;
      } catch {
        const m = p.text.match(/\b(\d{1,9})\b/);
        if (m && out.agentId === undefined) out.agentId = Number(m[1]);
      }
    }
    if (d) {
      if (d.agentId !== undefined) out.agentId = Number(d.agentId);
      if (d.maxAgeBlocks !== undefined) out.maxAgeBlocks = Number(d.maxAgeBlocks);
    }
  }
  return out;
}

