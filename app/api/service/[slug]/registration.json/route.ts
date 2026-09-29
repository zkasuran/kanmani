import { createPublicClient, http } from "viem";
import { json, problem, SITE } from "@/lib/api.ts";
import { bySlug, CATALOG } from "@/lib/agent-catalog.ts";
import { agentDraft, kanmaniDraft } from "@/lib/agent-drafts.ts";
import { agentUri, buildRecord, IDENTITY_ABI, IDENTITY_REGISTRY } from "@/lib/registration.ts";
import { bondsFor } from "@/lib/bonds.ts";
import { viemChain } from "@/lib/chains.ts";

export const dynamic = "force-dynamic";

/**
 * The ERC-8004 document this agent should carry and whether it carries it. `kanmani` is agent 10252.
 * `onChainMatches` compares the registry's current agentURI with the one built here, byte for byte.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const c = slug === "kanmani" ? null : bySlug(slug);
  if (slug !== "kanmani" && !c) return problem(404, "No such agent", `Known: kanmani, ${CATALOG.map((x) => x.slug).join(", ")}.`);
  const agentId = c ? c.agentId : 10252;
  const bonds = agentId ? await bondsFor([agentId]).catch(() => new Map()) : new Map();
  const bonded = new Set([...bonds.values()].filter((b) => b.state === "active").map((b) => b.agentId));
  const draft = c ? agentDraft(SITE, c, bonded) : kanmaniDraft(SITE);
  const uri = agentUri(draft, "data");
  let onChain: string | null = null;
  const chain = viemChain(143);
  if (agentId && chain) {
    onChain = await createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) })
      .readContract({ address: IDENTITY_REGISTRY, abi: [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }] as const, functionName: "tokenURI", args: [BigInt(agentId)] })
      .catch(() => null);
  }
  void IDENTITY_ABI;
  return json({ slug, agentId, draft, document: buildRecord(draft), agentURI: uri, onChainMatches: onChain === null ? null : onChain === uri });
}
