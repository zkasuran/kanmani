/**
 * The ERC-8004 registration draft for each of our agents, from the catalog. One function, so every
 * document is built the same way and reads the same to every tool.
 *
 * What each document must avoid, because the registry is full of it:
 *   - a hosted document that later 404s      -> data: URI, on chain
 *   - one document shared by many agents     -> every document is unique: its own name, service and id
 *   - a skill with no endpoint                -> every service has an endpoint that answers
 *   - an endpoint in a format brokers reject -> A2A service points at a real agent card
 *   - x402 declared, nothing answering 402   -> declared only on paid agents, checked by Linter
 *   - no way back from document to agent     -> registrations names the agent id and registry
 *   - trust claimed without saying which     -> supportedTrust states the models actually in use
 */
import { cardUrl, CATALOG, IDENTITY_REGISTRY_CAIP10, serviceUrl, type CatalogEntry } from "./agent-catalog.ts";
import type { RegistrationDraft } from "./registration.ts";

export const KANMANI_AGENT_ID = 10252;

/**
 * Trust models these agents actually support. `reputation`: their claims can be checked by the
 * ERC-8004 reputation registry and by Kanmani. `crypto-economic` only where a Sclera bond is posted.
 */
function trustFor(c: { agentId: number | null }, bonded: ReadonlySet<number>): string[] {
  return c.agentId !== null && bonded.has(c.agentId) ? ["reputation", "crypto-economic"] : ["reputation"];
}

export function agentDraft(site: string, c: CatalogEntry, bonded: ReadonlySet<number> = new Set()): RegistrationDraft {
  const paid = c.priceAtomic !== "0";
  const price = paid ? `Priced by usage with x402 upto on Monad: you sign a ${Number(c.priceAtomic) / 1e6} USDC ceiling and pay for what the call used.` : "Free.";
  return {
    name: `Kanmani ${c.name}`,
    description: `${c.sells} ${c.why} ${price} Call it over A2A message/send or plain HTTP POST at ${serviceUrl(site, c.slug)}; GET there returns the input and an example. Operated by Kanmani (kanmani.xyz) from 0xDB6c…7777.`,
    url: `${site}/hire`,
    image: `${site}/brand/mark-512.png`,
    skills: [{ id: c.skillId, endpoint: cardUrl(site, c.slug), x402: paid, protocol: "A2A", version: "0.3.0" }],
    refuses: ["custody of anyone's funds", "answering with a guess where the chain says unknown"],
    ...(c.agentId ? { registrations: [{ agentId: c.agentId, agentRegistry: IDENTITY_REGISTRY_CAIP10 }] } : {}),
    supportedTrust: trustFor(c, bonded),
    active: true,
  };
}

/** Kanmani itself, agent 10252: the verifier, its MCP server and its API. */
export function kanmaniDraft(site: string): RegistrationDraft {
  return {
    name: "Kanmani",
    description:
      "Checks whether the payment an ERC-8004 evidence document describes actually happened, by reading the cited transaction on the chain the document names. Free checks for building agents (registration and evidence), twelve hireable agents at kanmani.xyz/hire, an MCP server and an open API. unknown is never reported as false.",
    url: site,
    image: `${site}/brand/mark-512.png`,
    skills: [
      { id: "build-and-verify", endpoint: `${site}/mcp`, x402: false, protocol: "MCP", version: "2025-06-18" },
      { id: "verify-payment-claim", endpoint: `${site}/api/verify`, x402: true, protocol: "x402" },
      { id: "api", endpoint: `${site}/openapi.json`, x402: false, protocol: "OpenAPI", version: "3.1.0" },
    ],
    refuses: ["Returning false for a document we failed to fetch.", "Ranking agents by a score that is not published.", "Stating intent. A verdict describes what was observed."],
    registrations: [{ agentId: KANMANI_AGENT_ID, agentRegistry: IDENTITY_REGISTRY_CAIP10 }],
    supportedTrust: ["reputation"],
    active: true,
  };
}

/** Every registration we operate, for the spec's endpoint-domain verification file. */
export function allRegistrations() {
  return [
    { agentId: KANMANI_AGENT_ID, agentRegistry: IDENTITY_REGISTRY_CAIP10 },
    ...CATALOG.filter((c) => c.agentId !== null).map((c) => ({ agentId: c.agentId as number, agentRegistry: IDENTITY_REGISTRY_CAIP10 })),
  ];
}
