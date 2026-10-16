/**
 * OpenAPI 3.1 for the public API plus the A2A agent card.
 *
 * OpenAPI is what agent frameworks (OpenAI Agents SDK, LangChain, CrewAI, Semantic Kernel, Dify), GPT
 * Actions and no-code tools (n8n, Zapier, Make, Pipedream) import to call an HTTP API as tools. Every
 * `operationId` is written as a tool name a model can pick.
 *
 * Paths and parameters here are the ones the routes actually read. lib/openapi.test.ts parses this
 * spec and checks every path maps to a route file, so a route cannot be added or removed silently.
 */
import { IDENTITY_REGISTRY } from "./registration.ts";

const OUTCOMES = ["true", "false", "noClaim", "unknown"];

const envelope = (data: Record<string, unknown>) => ({
  type: "object",
  properties: {
    version: { type: "integer" },
    chain: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
    checkedAt: { type: "string", format: "date-time" },
    checkedAtBlock: { type: ["integer", "null"] },
    reproduce: { type: "string", description: "The command that re-derives this answer." },
    data,
  },
});

const problem = { $ref: "#/components/schemas/Problem" };
const jsonBody = (schema: unknown) => ({ required: true, content: { "application/json": { schema } } });
const ok = (description: string, schema: unknown) => ({ description, content: { "application/json": { schema } } });

export function openapi(site: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Kanmani",
      version: "1.0.0",
      summary: "Build, register and verify ERC-8004 agents on Monad.",
      description:
        "Free checks for building an ERC-8004 agent (registration and evidence), plus the verdicts Kanmani records about every agent on Monad. No key is ever taken: registration returns calldata the agent signs itself. `unknown` means undecided and must not be treated as `false`.",
      contact: { url: `${site}/developers` },
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: site }],
    // Explicitly no auth: every endpoint is public. Paid ones use x402 in the request, not a key.
    security: [],
    externalDocs: { description: "Build guide (also an agentskills.io SKILL.md)", url: `${site}/skill.md` },
    tags: [
      { name: "build", description: "Free checks for building an agent" },
      { name: "read", description: "What Kanmani has measured" },
      { name: "paid", description: "x402-priced work" },
    ],
    paths: {
      "/api/registration/check": {
        post: {
          operationId: "check_registration",
          tags: ["build"],
          summary: "Check an agent registration and get the exact transaction to send",
          description: `Validates the draft, returns problems, consequences, the committed document and agentURI plus calldata for register(string) on the identity registry ${IDENTITY_REGISTRY} (chain 143). setAgentURI(uint256,string) instead when agentId is given. With sender it also checks that address can pay gas. The agent's own key must send the transaction: the sender becomes the owner.`,
          requestBody: jsonBody({ $ref: "#/components/schemas/RegistrationInput" }),
          responses: {
            "200": ok("The report. Read data.ready first.", envelope({ $ref: "#/components/schemas/RegistrationReport" })),
            "400": ok("The draft could not be read. detail says which field.", problem),
          },
        },
      },
      "/api/evidence/check": {
        post: {
          operationId: "check_evidence",
          tags: ["build"],
          summary: "Check an evidence document before publishing it",
          description: "Judges the document with the same verifier as every published verdict. A false is searched for on other chains so a wrong network field is named. Send the document itself; URLs are refused, never fetched.",
          requestBody: jsonBody({
            type: "object",
            required: ["document"],
            properties: { document: { oneOf: [{ type: "object" }, { type: "string", description: "JSON text or a data: URI" }] } },
          }),
          responses: {
            "200": ok("The outcome the document will get.", envelope({ $ref: "#/components/schemas/EvidenceReport" })),
            "400": ok("No document or a URL was sent.", problem),
            "503": ok("The check could not complete. Retry.", problem),
          },
        },
      },
      "/api/agent/{id}": {
        get: {
          operationId: "get_agent",
          tags: ["read"],
          summary: "What Kanmani measures about one agent",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^\\d+$" }, description: "ERC-8004 agent id on Monad" }],
          responses: { "200": ok("One agent. Unknown fields are null, never zero.", envelope({ type: "object" })), "404": ok("Not in this index.", problem) },
        },
      },
      "/api/account/{address}": {
        get: {
          operationId: "get_account",
          tags: ["read"],
          summary: "Agents an address owns, with bond state and balances",
          parameters: [{ name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }],
          responses: { "200": ok("Balances are null when unreadable, never 0.", envelope({ type: "object" })), "400": ok("Not an address.", problem) },
        },
      },
      "/api/claims": {
        get: {
          operationId: "list_claims",
          tags: ["read"],
          summary: "Checked payment claims, filterable",
          parameters: [
            { name: "outcome", in: "query", schema: { type: "string", enum: OUTCOMES } },
            { name: "rung", in: "query", schema: { type: "string", enum: ["declared", "resolvable", "intact", "parsed", "true"] } },
            { name: "agent", in: "query", schema: { type: "string", pattern: "^\\d+$" } },
            { name: "network", in: "query", schema: { type: "string" } },
            { name: "mapping", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: { "200": ok("A page of claims.", envelope({ type: "object" })), "400": ok("Bad filter.", problem) },
        },
      },
      "/api/sla/{agentId}": {
        get: {
          operationId: "get_claim_truth_rate",
          tags: ["read"],
          summary: "An agent's claim-truth rate over a block window",
          parameters: [
            { name: "agentId", in: "path", required: true, schema: { type: "string", pattern: "^\\d+$" } },
            { name: "fromBlock", in: "query", schema: { type: "string" } },
            { name: "toBlock", in: "query", schema: { type: "string" } },
            {
              name: "publishers",
              in: "query",
              description: "Optional scope. Comma list of up to 8 wallets. Only feedback published by one of them is sampled. Absent means every publisher.",
              schema: { type: "string" },
            },
            {
              name: "recipient",
              in: "query",
              description: 'Optional scope. A 20-byte address or "agent". Only claims whose payment was claimed to reach that address (or the agent\'s own owner or wallet) are sampled. Absent means any recipient.',
              schema: { type: "string" },
            },
          ],
          responses: { "200": ok("The rate and its sample.", envelope({ type: "object" })) },
        },
      },
      "/api/verify": {
        post: {
          operationId: "verify_hosted_document",
          tags: ["paid"],
          summary: "Check a hosted evidence document (x402, 0.01 USDC)",
          description: "Answers 402 with an x402 challenge. Pay it (exact, USDC on chain 143) and resend with PAYMENT-SIGNATURE.",
          requestBody: jsonBody({ type: "object", properties: { uri: { type: "string" }, id: { type: "string" }, feedbackHash: { type: "string" } } }),
          responses: { "200": ok("Verdict.", envelope({ type: "object" })), "402": { description: "x402 payment required. The body is the challenge." } },
        },
      },
      "/api/service/{slug}": {
        get: {
          operationId: "get_agent_service",
          tags: ["paid"],
          summary: "Kanmani's twelve agents: price, meter and how to pay (see /hire)",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string", enum: ["sentinel", "assay", "locator", "notary", "registrar", "ledger", "twin", "pulse", "doctor", "linter", "bondsman", "scribe"] } }],
          responses: { "402": { description: "The price (upto ceiling or exact) and the reason. Free to read." } },
        },
      },
    },
    components: {
      schemas: {
        Problem: {
          type: "object",
          description: "RFC 9457 problem details",
          properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" } },
        },
        RegistrationInput: {
          type: "object",
          required: ["draft"],
          properties: {
            draft: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                url: { type: "string", description: "the operator's site" },
                skills: {
                  type: "array",
                  maxItems: 32,
                  items: { type: "object", required: ["id", "endpoint"], properties: { id: { type: "string" }, endpoint: { type: "string" }, x402: { type: "boolean" } } },
                },
                refuses: { type: "array", items: { type: "string" }, description: "what this agent will not do" },
              },
            },
            kind: { type: "string", enum: ["data", "https"], default: "data", description: "data puts the document on chain so it cannot go dead" },
            hostedAt: { type: "string", description: "only for kind https" },
            chainId: { type: "integer", enum: [143], default: 143 },
            agentId: { type: "string", pattern: "^\\d+$", description: "only when repointing an agent the sender owns" },
            sender: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "checks this address can pay the gas" },
          },
        },
        RegistrationReport: {
          type: "object",
          properties: {
            ready: { type: "boolean" },
            problems: { type: "array", items: { type: "string" } },
            consequences: { type: "array", items: { type: "object", properties: { label: { type: "string" }, met: { type: "boolean" }, why: { type: "string" } } } },
            document: { type: "object" },
            agentURI: { type: "string" },
            uriBytes: { type: "integer" },
            transaction: {
              type: ["object", "null"],
              properties: { chainId: { type: "integer" }, to: { type: "string" }, function: { type: "string" }, data: { type: "string" }, value: { type: "string" } },
            },
            send: { type: ["object", "null"], properties: { cast: { type: "string" }, viem: { type: "string" } } },
            gas: { type: ["object", "null"], properties: { state: { type: "string", enum: ["enough", "short", "unknown"] }, have: { type: "string" }, need: { type: "string" }, short: { type: "string" }, fix: { type: "string" } } },
            canSend: { type: ["boolean", "null"], description: "ready AND the sender can pay gas. null when no sender was given or gas could not be read." },
            next: { type: "array", items: { type: "string" } },
          },
        },
        EvidenceReport: {
          type: "object",
          properties: {
            outcome: { type: "string", enum: OUTCOMES },
            rung: { type: "string" },
            reason: { type: "string" },
            declaredNetwork: { type: ["string", "null"] },
            declaredTx: { type: ["string", "null"] },
            mapping: { type: ["string", "null"] },
            foundOnChain: { type: ["object", "null"], properties: { chain: { type: "string" }, chainId: { type: "integer" }, block: { type: "integer" } } },
            advice: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

/**
 * The A2A agent card, for discovery only.
 *
 * Kanmani does not speak A2A's message protocol, so the card does not claim an A2A endpoint. Its
 * interfaces are the ones that exist: MCP over streamable HTTP and the HTTP API described by OpenAPI.
 * A card that listed an A2A JSON-RPC URL we do not serve would send a client to a 404 that looks like
 * an outage.
 */
export function agentCard(site: string) {
  return {
    name: "Kanmani",
    description: "Build, register and verify ERC-8004 agents on Monad. Free registration and evidence checks; the verdicts Kanmani records about every Monad agent.",
    version: "1.0.0",
    provider: { organization: "Kanmani", url: site },
    documentationUrl: `${site}/skill.md`,
    supportedInterfaces: [
      { url: `${site}/mcp`, protocolBinding: "MCP-STREAMABLE-HTTP", protocolVersion: "2025-06-18" },
      { url: `${site}/openapi.json`, protocolBinding: "HTTP+OPENAPI", protocolVersion: "3.1.0" },
    ],
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "check-registration",
        name: "Check an ERC-8004 registration",
        description: "Problems, consequences and the exact register() calldata for a draft; optional gas check for a sender.",
        tags: ["erc-8004", "monad", "registration", "build"],
        examples: ["Register an agent called Scout that finds agents worth hiring", "Is this registration ready to send from 0x...?"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
      },
      {
        id: "check-evidence",
        name: "Check an evidence document",
        description: "The outcome a reputation evidence document will get once published plus the fix when it names the wrong network.",
        tags: ["erc-8004", "reputation", "evidence", "verification"],
        examples: ["Will this proof_of_payment check out?"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
      },
      {
        id: "read-verdicts",
        name: "Read recorded verdicts",
        description: "What Kanmani has measured about an agent, an address or the whole Monad registry.",
        tags: ["erc-8004", "monad", "trust"],
        examples: ["What do we know about agent 10256?"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
      },
    ],
  };
}
