/**
 * Which ERC-8004 agents on Monad have a market on ADEXTO, read from ADEXTO's own surfaces.
 *
 * ADEXTO (adexto.xyz, a separate project, not ours) lets an agent open a token market bound to its
 * ERC-8004 id: `deployTrinity` refuses unless `ownerOf(agentId)` is the caller and the factory then
 * answers `agentIdOf(token)`. We show that binding on our agent pages and in `/api/agent/<id>`, so a
 * buyer who is about to trade an agent's market can read that agent's claim-truth record first.
 *
 * Two sources, each checked against the other rather than trusted alone:
 *   1. the market list from ADEXTO's MCP server (`list_markets`), for which tokens exist on chain 143;
 *   2. `agentIdOf(token)` on both Monad factories, read from the chain, for which agent each binds.
 * A token the list names but no factory binds is left out. Nothing here is typed by hand.
 *
 * It fails quiet. If ADEXTO or the chain cannot be read, an agent simply shows no market. A missing
 * market is never displayed as a fact about the agent.
 */
import { createPublicClient, http, type Address } from "viem";
import { viemChain } from "./chains.ts";

export const ADEXTO_MCP = "https://adexto.xyz/api/mcp";
/** Both factory generations on Monad, from ADEXTO's README deployments table. Earlier markets keep the old one. */
export const ADEXTO_FACTORIES_143: Address[] = [
  "0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056", // AdextoFactory 1.0.0, current
  "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3", // AdextoFactory 0.11.0, superseded
];

export type AdextoMarket = { agentId: number; symbol: string; name: string; token: Address; curve: Address; url: string };

type Reader = {
  agentIdOf(factory: Address, token: Address): Promise<bigint | null>;
  symbol(token: Address): Promise<string | null>;
  name(token: Address): Promise<string | null>;
};
type Listed = { token: Address; curve: Address };

const ABI = [
  { type: "function", name: "agentIdOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

function chainReader(): Reader {
  const chain = viemChain(143);
  if (!chain) throw new Error("chain 143 is not in the registry");
  const c = createPublicClient({ chain, transport: http() });
  return {
    agentIdOf: (f, t) => c.readContract({ address: f, abi: ABI, functionName: "agentIdOf", args: [t] }).catch(() => null),
    symbol: (t) => c.readContract({ address: t, abi: ABI, functionName: "symbol" }).catch(() => null),
    name: (t) => c.readContract({ address: t, abi: ABI, functionName: "name" }).catch(() => null),
  };
}

/** The Monad markets ADEXTO lists, from its MCP `list_markets`. Streamable HTTP may answer as SSE. */
export async function listMonadMarkets(fetcher: typeof fetch = fetch): Promise<Listed[]> {
  const r = await fetcher(ADEXTO_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_markets", arguments: {} } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`ADEXTO list_markets HTTP ${r.status}`);
  const raw = await r.text();
  const line = raw.split("\n").map((l) => l.replace(/^data: /, "").trim()).find((l) => l.startsWith("{"));
  if (!line) throw new Error("ADEXTO list_markets: no JSON-RPC body");
  const text = JSON.parse(line)?.result?.content?.[0]?.text;
  const parsed = JSON.parse(text);
  const markets: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.markets ?? []);
  const isAddr = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
  return markets
    .filter((m): m is { chainId: number; token: Address; curve: Address } => {
      const x = m as { chainId?: unknown; token?: unknown; curve?: unknown };
      return x.chainId === 143 && isAddr(x.token) && isAddr(x.curve);
    })
    .map((m) => ({ token: m.token, curve: m.curve }));
}

/** Join the list with the chain: a market counts only where a Monad factory says which agent it binds. */
export async function resolveMarkets(listed: Listed[], reader: Reader): Promise<AdextoMarket[]> {
  const out: AdextoMarket[] = [];
  for (const m of listed) {
    let agentId: bigint | null = null;
    for (const f of ADEXTO_FACTORIES_143) {
      const id = await reader.agentIdOf(f, m.token);
      if (id !== null && id > 0n) {
        agentId = id;
        break;
      }
    }
    if (agentId === null) continue;
    const [symbol, name] = await Promise.all([reader.symbol(m.token), reader.name(m.token)]);
    if (!symbol) continue;
    out.push({
      agentId: Number(agentId),
      symbol,
      name: name ?? symbol,
      token: m.token,
      curve: m.curve,
      url: `https://adexto.xyz/token/${encodeURIComponent(symbol.toLowerCase())}?chain=143`,
    });
  }
  return out;
}

let cache: { at: number; markets: AdextoMarket[] } | null = null;
const TTL_MS = 10 * 60_000;

/** Every ADEXTO market bound to an agent on Monad, cached for ten minutes. Empty on any failure. */
export async function adextoMarkets(): Promise<AdextoMarket[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.markets;
  try {
    const markets = await resolveMarkets(await listMonadMarkets(), chainReader());
    cache = { at: Date.now(), markets };
    return markets;
  } catch {
    return cache?.markets ?? [];
  }
}

export async function adextoMarketsFor(agentId: number): Promise<AdextoMarket[]> {
  return (await adextoMarkets()).filter((m) => m.agentId === agentId);
}
