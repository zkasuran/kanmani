/**
 * How to connect Kanmani from each way people build agents.
 *
 * Every snippet below was checked against that tool's own documentation on 2026-09-29. `source`
 * says where. Where a tool does not document something, `note` says so rather than a guessed config:
 * a wrong snippet is worse than none, because the reader blames our server for their tool's error.
 *
 * Grouped by the standard the tool reads rather than by brand, so a tool not listed here still has a
 * route in: anything that speaks MCP uses the MCP URL, anything that imports OpenAPI uses the spec.
 */
export type Recipe = { name: string; kind: "mcp" | "skill" | "agents-md" | "openapi" | "http"; code: string; source: string; note?: string };
export type RecipeGroup = { id: string; title: string; lead: string; recipes: Recipe[] };

const MCP = "https://kanmani.xyz/mcp";

export const RECIPES: RecipeGroup[] = [
  {
    id: "coding-agents",
    title: "coding agents",
    lead: "Add the MCP server so the agent can call the checks as tools. Give it the guide as a skill or AGENTS.md so it follows the rules without being told.",
    recipes: [
      { name: "Claude Code", kind: "mcp", code: `claude mcp add --transport http kanmani ${MCP}\n\n# the guide as a skill\nmkdir -p ~/.claude/skills/kanmani && curl -s https://kanmani.xyz/skill.md > ~/.claude/skills/kanmani/SKILL.md`, source: "docs.anthropic.com/en/docs/claude-code/mcp" },
      { name: "Codex CLI", kind: "mcp", code: `codex mcp add kanmani --url ${MCP}\n\n# the guide, at your repo root\ncurl -s https://kanmani.xyz/build/AGENTS.md >> AGENTS.md`, source: "developers.openai.com/codex/mcp" },
      { name: "Cursor", kind: "mcp", code: `// .cursor/mcp.json\n{ "mcpServers": { "kanmani": { "url": "${MCP}" } } }\n\n# AGENTS.md at the repo root is read automatically`, source: "cursor.com/docs/context/mcp" },
      { name: "Windsurf", kind: "mcp", code: `// mcp_config.json\n{ "mcpServers": { "kanmani": { "serverUrl": "${MCP}" } } }`, source: "docs.windsurf.com/plugins/cascade/mcp" },
      { name: "VS Code (Copilot)", kind: "mcp", code: `// .vscode/mcp.json\n{ "servers": { "kanmani": { "type": "http", "url": "${MCP}" } } }`, source: "code.visualstudio.com/docs/copilot/customization/mcp-servers" },
      { name: "Gemini CLI", kind: "mcp", code: `gemini mcp add --transport http kanmani ${MCP}\n\n// or settings.json. httpUrl is streamable HTTP; url means SSE\n{ "mcpServers": { "kanmani": { "httpUrl": "${MCP}" } } }`, source: "github.com/google-gemini/gemini-cli docs/tools/mcp-server.md" },
      { name: "Goose", kind: "mcp", code: `# ~/.config/goose/config.yaml\nextensions:\n  kanmani:\n    type: streamable_http\n    uri: ${MCP}\n    enabled: true`, source: "goose-docs.ai/docs/getting-started/using-extensions" },
      { name: "Hermes Agent", kind: "mcp", code: `# config.yaml\nmcp_servers:\n  kanmani:\n    url: "${MCP}"\n    enabled: true\n# then /reload-mcp`, source: "NousResearch/hermes-agent docs/reference/mcp-config-reference.md" },
      { name: "Cline", kind: "mcp", code: `{ "mcpServers": { "kanmani": { "type": "streamableHttp", "url": "${MCP}", "disabled": false } } }`, source: "docs.cline.bot/mcp/configuring-mcp-servers", note: "type must be streamableHttp in camelCase. Otherwise Cline falls back to SSE." },
      { name: "Zed", kind: "mcp", code: `// settings.json\n{ "context_servers": { "kanmani": { "url": "${MCP}" } } }`, source: "zed.dev/docs/ai/mcp" },
      { name: "OpenCode", kind: "mcp", code: `// opencode.json\n{ "mcp": { "kanmani": { "type": "remote", "url": "${MCP}", "enabled": true } } }`, source: "opencode.ai/docs/mcp-servers" },
      { name: "Continue", kind: "mcp", code: `# config.yaml\nmcpServers:\n  - name: Kanmani\n    type: streamable-http\n    url: ${MCP}`, source: "docs.continue.dev/customize/deep-dives/mcp" },
      { name: "Amp", kind: "mcp", code: `amp mcp add kanmani ${MCP}`, source: "ampcode.com/docs/customize/mcp" },
      { name: "Aider", kind: "agents-md", code: `curl -s https://kanmani.xyz/build/AGENTS.md > KANMANI.md\naider --read KANMANI.md`, source: "aider.chat/docs/usage/conventions.html", note: "Aider does not document MCP, so it gets the guide as a read-only conventions file and calls the HTTP API." },
      { name: "Anything else", kind: "skill", code: `https://kanmani.xyz/skill.md         agentskills.io SKILL.md\nhttps://kanmani.xyz/build/AGENTS.md  drop-in AGENTS.md\nhttps://kanmani.xyz/llms.txt         for tools that only read llms.txt`, source: "agentskills.io, agents.md, llmstxt.org" },
    ],
  },
  {
    id: "frameworks",
    title: "agent frameworks",
    lead: "Attach the MCP server and the five tools appear in your agent. Or import the OpenAPI spec if your framework prefers HTTP tools.",
    recipes: [
      { name: "OpenAI Agents SDK (Python)", kind: "mcp", code: `from agents import Agent\nfrom agents.mcp import MCPServerStreamableHttp\n\nasync with MCPServerStreamableHttp(name="kanmani", params={"url": "${MCP}"}) as kanmani:\n    agent = Agent(name="builder", mcp_servers=[kanmani])`, source: "openai.github.io/openai-agents-python/mcp" },
      { name: "OpenAI Agents SDK (JS)", kind: "mcp", code: `import { Agent, MCPServerStreamableHttp } from "@openai/agents";\nconst kanmani = new MCPServerStreamableHttp({ url: "${MCP}", name: "kanmani" });\nawait kanmani.connect();\nconst agent = new Agent({ name: "builder", mcpServers: [kanmani] });`, source: "openai.github.io/openai-agents-js/guides/mcp" },
      { name: "LangChain / LangGraph", kind: "mcp", code: `from langchain_mcp_adapters.client import MultiServerMCPClient\n\nclient = MultiServerMCPClient({"kanmani": {"url": "${MCP}", "transport": "streamable_http"}})\ntools = await client.get_tools()`, source: "github.com/langchain-ai/langchain-mcp-adapters" },
      { name: "CrewAI", kind: "mcp", code: `from crewai_tools import MCPServerAdapter\n\nwith MCPServerAdapter({"url": "${MCP}", "transport": "streamable-http"}) as tools:\n    agent = Agent(role="builder", tools=tools, ...)`, source: "docs.crewai.com/mcp/streamable-http" },
      { name: "Vercel AI SDK", kind: "mcp", code: `import { createMCPClient } from "@ai-sdk/mcp";\nconst kanmani = await createMCPClient({ transport: { type: "http", url: "${MCP}" } });\nconst tools = await kanmani.tools();`, source: "ai-sdk.dev/docs/ai-sdk-core/mcp-tools" },
      { name: "Mastra", kind: "mcp", code: `import { MCPClient } from "@mastra/mcp";\nconst mcp = new MCPClient({ servers: { kanmani: { url: new URL("${MCP}") } } });\nconst tools = await mcp.getTools();`, source: "mastra.ai/docs/tools-mcp/mcp-overview" },
      { name: "Google ADK", kind: "mcp", code: `from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams\n\ntoolset = McpToolset(connection_params=StreamableHTTPConnectionParams(url="${MCP}"))`, source: "google.github.io/adk-docs/tools/mcp-tools" },
      { name: "LlamaIndex", kind: "mcp", code: `from llama_index.tools.mcp import BasicMCPClient, McpToolSpec\n\ntools = await McpToolSpec(client=BasicMCPClient("${MCP}")).to_tool_list_async()`, source: "docs.llamaindex.ai (llama-index-tools-mcp)" },
      { name: "Pydantic AI", kind: "mcp", code: `from pydantic_ai import Agent\nfrom pydantic_ai.mcp import MCPToolset\n\nagent = Agent("openai:gpt-5.2", toolsets=[MCPToolset("${MCP}")])`, source: "ai.pydantic.dev/mcp/client" },
      { name: "Any framework with OpenAPI tools", kind: "openapi", code: `https://kanmani.xyz/openapi.json\n# OpenAPI 3.1, every operationId is a tool name:\n# check_registration, check_evidence, get_agent, get_account, list_claims, ...`, source: "validated with swagger-parser and redocly" },
    ],
  },
  {
    id: "no-code",
    title: "no-code and workflow tools",
    lead: "Point the tool at the MCP URL where it supports remote MCP, otherwise at the OpenAPI spec or a plain HTTP request.",
    recipes: [
      { name: "ChatGPT GPT Actions", kind: "openapi", code: `Actions -> Import from URL -> https://kanmani.xyz/openapi.json\nAuthentication: None`, source: "help.openai.com/en/articles/9442513", note: "GPT Actions take OpenAPI, not MCP." },
      { name: "Dify", kind: "mcp", code: `Tools -> MCP -> Add MCP Server (HTTP)\nServer URL: ${MCP}`, source: "docs.dify.ai/en/cloud/use-dify/build/mcp" },
      { name: "Make", kind: "mcp", code: `MCP Client app -> + New MCP Server\nURL: ${MCP}`, source: "apps.make.com/mcp-client" },
      { name: "Zapier", kind: "mcp", code: `MCP Client integration -> server URL: ${MCP}`, source: "help.zapier.com/hc/en-us/articles/38777069364109" },
      { name: "n8n", kind: "http", code: `HTTP Request node\nMethod: POST\nURL: https://kanmani.xyz/api/registration/check\nBody (JSON): { "draft": { "name": "..." }, "sender": "0x..." }`, source: "docs.n8n.io", note: "n8n's MCP Client Tool node documents only an SSE endpoint, so use the HTTP Request node until it documents streamable HTTP." },
      { name: "Flowise", kind: "http", code: `Custom Tool / HTTP request to https://kanmani.xyz/api/registration/check`, source: "docs.flowiseai.com/tutorials/tools-and-mcp", note: "Flowise supports remote MCP but its exact config is not documented, so HTTP is the path we can vouch for." },
    ],
  },
  {
    id: "by-hand",
    title: "by hand, any language",
    lead: "Two free POSTs. You sign the transaction with the agent's own key; nothing here ever takes one.",
    recipes: [
      { name: "curl + Foundry cast", kind: "http", code: `R=$(curl -s -X POST https://kanmani.xyz/api/registration/check \\\n  -H 'content-type: application/json' \\\n  -d '{"draft":{"name":"Scout","description":"Finds agents worth hiring"}}')\n\ncast send 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "$(echo "$R" | jq -r .data.transaction.data)" \\\n  --rpc-url https://rpc.monad.xyz --private-key "$AGENT_PRIVATE_KEY"`, source: "this site, run against the live API" },
      { name: "TypeScript (viem) and Python (web3.py)", kind: "http", code: `Full, runnable examples for both are in https://kanmani.xyz/skill.md, step 2.`, source: "this site" },
      { name: "A browser, no code", kind: "http", code: `https://kanmani.xyz/account#agents\nSign in with a passkey or a wallet, fill the form, send.`, source: "this site" },
    ],
  },
];
