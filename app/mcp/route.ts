import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { SITE } from "@/lib/api.ts";
import { evidenceCheck, isFailure, registrationCheck } from "@/lib/build-server.ts";
import { skillMd } from "@/lib/build-guide.ts";
import { countEvent, countMcpClient } from "@/lib/usage-live.ts";
import { mcpClientName } from "@/lib/usage-classify.ts";
import { GET as agentRoute } from "@/app/api/agent/[id]/route.ts";
import { GET as accountRoute } from "@/app/api/account/[address]/route.ts";
import { GET as claimsRoute } from "@/app/api/claims/route.ts";

export const dynamic = "force-dynamic";

/**
 * Kanmani as an MCP server: streamable HTTP, stateless, no auth.
 *
 * Add it to any MCP client (Claude Code, Codex, Cursor, Windsurf, VS Code, Gemini CLI, Goose, Hermes,
 * OpenAI Agents SDK, LangChain/LangGraph adapters, CrewAI, Mastra, Vercel AI SDK...) with the URL
 * `https://kanmani.xyz/mcp`.
 *
 * Every tool is a read or a pure check. None signs, stores or sends anything. The tools call the same
 * functions as the HTTP API, so an agent over MCP and a script over curl get the same answers.
 *
 * Stateless: a new server and transport per request, no session ids, JSON responses rather than SSE.
 * That fits one Next route and means nothing about a caller is kept between calls.
 */
function server() {
  const s = new McpServer({ name: "kanmani", version: "1.0.0" }, { instructions: `Build and verify ERC-8004 agents on Monad. Start with check_registration, sign the returned transaction with the agent's own key (never share it), then check evidence documents with check_evidence before publishing. Full guide: ${SITE}/skill.md` });

  const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
  const fail = (m: string) => ({ content: [{ type: "text" as const, text: m }], isError: true });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

  s.registerTool(
    "check_registration",
    {
      title: "Check an ERC-8004 registration and get the transaction",
      description:
        "Validate an agent registration draft and return its problems, what each field implies, the document and agentURI as they will be committed plus the exact register() calldata (or setAgentURI() when agentId is given) for the Monad identity registry. With sender, also says whether that address can pay the gas. Signs nothing: the agent's own key must send the transaction, because the sender becomes the owner.",
      inputSchema: {
        draft: z
          .object({
            name: z.string().describe("required"),
            description: z.string().optional(),
            url: z.string().optional().describe("the operator's site"),
            skills: z.array(z.object({ id: z.string(), endpoint: z.string(), x402: z.boolean().optional() })).optional(),
            refuses: z.array(z.string()).optional().describe("what this agent will not do"),
          })
          .describe("the registration document fields"),
        kind: z.enum(["data", "https"]).optional().describe('"data" (default) puts the document on chain so it cannot go dead'),
        hostedAt: z.string().optional().describe("only for kind https"),
        agentId: z.string().optional().describe("only when repointing an agent the sender owns"),
        sender: z.string().optional().describe("address that will send, to check it can pay gas"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const r = await registrationCheck({ ...args, chainId: 143 });
      return isFailure(r) ? fail(r.error) : text(r);
    },
  );

  s.registerTool(
    "check_evidence",
    {
      title: "Check an evidence document before publishing it",
      description:
        "Run an ERC-8004 reputation evidence document through Kanmani's verifier and get the outcome it will receive once published: true, false, noClaim or unknown, with the reason. A false is also searched for on other chains, so a wrong network field comes back as one fix. Pass the document itself; URLs are not fetched.",
      inputSchema: {
        document: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("the evidence JSON object, a JSON string or a data: URI"),
      },
      annotations: readOnly,
    },
    async ({ document }) => {
      try {
        const r = await evidenceCheck({ document });
        return isFailure(r) ? fail(r.error) : text(r);
      } catch (e) {
        return fail(`The check did not complete: ${(e as Error).message.slice(0, 200)}`);
      }
    },
  );

  // The HTTP route handlers themselves, called in process: MCP and HTTP cannot disagree and no request
  // leaves the server.
  const via = async (res: Promise<Response>) => {
    const r = await res;
    const body = await r.json().catch(() => null);
    return r.ok ? text(body) : fail(`HTTP ${r.status}: ${JSON.stringify(body).slice(0, 400)}`);
  };
  const fake = (path: string) => new Request(`${SITE}${path}`);

  s.registerTool(
    "get_agent",
    { title: "Look up an agent", description: "What Kanmani measures about one ERC-8004 agent on Monad: its registration, rung, claims checked, bond. unknown fields are null, never zero.", inputSchema: { agentId: z.string().regex(/^\d+$/) }, annotations: readOnly },
    ({ agentId }) => via(agentRoute(fake(`/api/agent/${agentId}`), { params: Promise.resolve({ id: agentId }) })),
  );
  s.registerTool(
    "get_account",
    { title: "Agents and balances for an address", description: "Every agent an address owns on Monad, with live bond state, plus its MON and USDC balances.", inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }, annotations: readOnly },
    ({ address }) => via(accountRoute(fake(`/api/account/${address}`), { params: Promise.resolve({ address }) })),
  );
  s.registerTool(
    "list_claims",
    {
      title: "List checked claims",
      description: "Payment claims Kanmani has checked, filterable. Use outcome=false with agentId to see why an agent's evidence fails.",
      inputSchema: { outcome: z.enum(["true", "false", "noClaim", "unknown"]).optional(), agentId: z.string().regex(/^\d+$/).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    ({ outcome, agentId, limit }) => {
      const q = new URLSearchParams();
      if (outcome) q.set("outcome", outcome);
      if (agentId) q.set("agent", agentId);
      q.set("limit", String(limit ?? 20));
      return via(claimsRoute(fake(`/api/claims?${q}`)));
    },
  );

  s.registerResource("build-guide", `${SITE}/skill.md`, { title: "How to build an ERC-8004 agent with Kanmani", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: skillMd(SITE) }],
  }));
  return s;
}

async function handle(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const s = server();
  await s.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: nothing survives the request.
    void s.close();
  }
}

export async function POST(req: Request) {
  // Count what the call was, from a copy of the body: the announced client on initialize, the tool on
  // tools/call. Never the arguments, never the caller.
  try {
    const b = (await req.clone().json()) as unknown;
    for (const m of Array.isArray(b) ? b : [b]) {
      const msg = m as { method?: string; params?: { name?: string; clientInfo?: { name?: unknown } } };
      if (msg?.method === "initialize") {
        const n = mcpClientName(msg.params?.clientInfo?.name);
        if (n) countMcpClient(n);
      } else if (msg?.method === "tools/call" && typeof msg.params?.name === "string") {
        countEvent(`mcp:tool:${msg.params.name}`);
      }
    }
  } catch {
    /* not JSON: the transport answers it */
  }
  return handle(req);
}

/** A browser or a curl GET gets a description rather than a protocol error. */
export async function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) return handle(req);
  return new Response(
    JSON.stringify({ mcp: true, transport: "streamable-http", url: `${SITE}/mcp`, auth: "none", tools: ["check_registration", "check_evidence", "get_agent", "get_account", "list_claims"], guide: `${SITE}/skill.md` }, null, 2),
    { headers: { "content-type": "application/json" } },
  );
}

export async function DELETE(req: Request) {
  return handle(req);
}
