/**
 * All twelve agents in one list, for everything that describes them: A2A cards, registration
 * documents, /hire, the well-known registrations file. The route that serves them uses the same
 * sources (lib/agents.ts and lib/agent-extras.ts), so a card cannot describe an agent differently from
 * how it behaves.
 */
import { AGENTS } from "./agents.ts";
import { EXTRAS } from "./agent-extras.ts";
import IDS from "./agent-ids.json" with { type: "json" };

export const IDENTITY_REGISTRY_CAIP10 = "eip155:143:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const X402_A2A_EXTENSION = "https://github.com/google-a2a/a2a-x402/v0.1";

export type CatalogEntry = {
  slug: string;
  name: string;
  sells: string;
  why: string;
  priceAtomic: string;
  skillId: string;
  input: string;
  example: Record<string, unknown>;
  tags: string[];
  agentId: number | null;
};

const CORE_TAGS: Record<string, string[]> = { sentinel: ["due-diligence", "verdict", "freshness"], assay: ["bond", "risk", "pricing"] };

export const CATALOG: CatalogEntry[] = [
  ...Object.values(AGENTS).map((a) => ({
    slug: a.slug,
    name: a.name,
    sells: a.sells,
    why: a.needsMonad,
    priceAtomic: a.priceAtomic,
    skillId: a.skillId,
    input: a.input,
    example: JSON.parse(a.input) as Record<string, unknown>,
    tags: CORE_TAGS[a.slug] ?? [],
    agentId: (IDS as Record<string, number>)[a.slug] ?? null,
  })),
  ...EXTRAS.map((e) => ({
    slug: e.slug,
    name: e.name,
    sells: e.sells,
    why: e.why,
    priceAtomic: e.priceAtomic,
    skillId: e.skillId,
    input: e.input,
    example: e.example,
    tags: e.tags,
    agentId: (IDS as Record<string, number>)[e.slug] ?? null,
  })),
];

export const bySlug = (slug: string) => CATALOG.find((c) => c.slug === slug);
export const serviceUrl = (site: string, slug: string) => `${site}/api/service/${slug}`;
export const cardUrl = (site: string, slug: string) => `${site}/api/service/${slug}/agent-card.json`;

/** An A2A 0.3 agent card for one agent. */
export function a2aCard(site: string, c: CatalogEntry) {
  const paid = c.priceAtomic !== "0";
  return {
    protocolVersion: "0.3.0",
    name: `Kanmani ${c.name}`,
    description: `${c.sells} ${c.why}`,
    url: serviceUrl(site, c.slug),
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: serviceUrl(site, c.slug), transport: "HTTP+JSON" }],
    version: "1.0.0",
    provider: { organization: "Kanmani", url: site },
    documentationUrl: `${site}/hire`,
    iconUrl: `${site}/brand/mark-512.png`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: paid ? [{ uri: X402_A2A_EXTENSION, description: `x402 on Monad (eip155:143): upto with a ${Number(c.priceAtomic) / 1e6} USDC ceiling, or exact.`, required: true }] : [],
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: c.skillId,
        name: c.name,
        description: c.sells,
        tags: c.tags,
        examples: [JSON.stringify(c.example)],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    ...(c.agentId ? { erc8004: { agentId: c.agentId, agentRegistry: IDENTITY_REGISTRY_CAIP10 } } : {}),
  };
}
