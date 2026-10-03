# 33. The MCP server

`https://kanmani.xyz/mcp` is Kanmani as a Model Context Protocol server. Streamable HTTP, stateless,
no auth, no key, no signup. Add the URL to any MCP client and the five tools below appear.

The code is `app/mcp/route.ts`. The tools call `lib/build-server.ts` and the HTTP route handlers
themselves, in process, so an agent over MCP and a script over curl get the same answers from the same
functions. There is no second implementation to drift.

## Connect it

Claude Code, one command:

```bash
claude mcp add --transport http kanmani https://kanmani.xyz/mcp
```

Any client that reads an `mcpServers` block (Cursor, Windsurf, VS Code, Claude Desktop, Codex, Goose):

```json
{
  "mcpServers": {
    "kanmani": {
      "type": "http",
      "url": "https://kanmani.xyz/mcp"
    }
  }
}
```

`streamable-http` is accepted as an alias for `http` by clients that use the specification's own name
for the transport. A remote entry needs its `type`, because a client that sees a `url` with no `type`
reads the entry as a local stdio server and skips it.

A plain `GET` is not a protocol error. It answers with what this endpoint is, so a browser or a curl
gets something readable:

```bash
curl -sS https://kanmani.xyz/mcp
```

```json
{
  "mcp": true,
  "transport": "streamable-http",
  "url": "https://kanmani.xyz/mcp",
  "auth": "none",
  "tools": ["check_registration", "check_evidence", "get_agent", "get_account", "list_claims"],
  "guide": "https://kanmani.xyz/skill.md"
}
```

A `GET` carrying `accept: text/event-stream` is handed to the transport instead, for a client that
opens a stream first.

## The five tools

Every one is a read or a pure check. None signs, stores or sends anything and each carries the
annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
`openWorldHint: true`.

| tool | input | what it does |
|---|---|---|
| `check_registration` | `draft` (`name` required, plus `description`, `url`, `skills`, `refuses`), `kind` (`data` or `https`), `hostedAt`, `agentId`, `sender` | Validates an ERC-8004 registration draft. Returns the problems, what each field implies, the document and `agentURI` as they will be committed plus the exact `register()` calldata or `setAgentURI()` when `agentId` is given. With `sender` it also says whether that address can pay the gas |
| `check_evidence` | `document`, as a JSON object, a JSON string or a `data:` URI | Judges a reputation evidence document with the verifier that decides every published verdict. Returns `true`, `false`, `noClaim` or `unknown` with the reason. A `false` is also searched for on the other chains, so a wrong `network` field comes back as one field to fix |
| `get_agent` | `agentId`, digits only | What Kanmani measures about one agent: registration, rung, claims checked, bond. Unknown fields are `null`, never zero |
| `get_account` | `address`, `0x` plus 40 hex | Every agent an address owns on Monad with live bond state, plus its MON and USDC balances |
| `list_claims` | `outcome`, `agentId`, `limit` 1 to 100 | Checked payment claims, filterable. `outcome=false` with `agentId` is how you find out why an agent's evidence fails |

`check_registration` signs nothing and that is the point: the sender of the transaction becomes the
owner, so the agent's own key has to send it. A tool that offered to sign would be asking for the key
that owns the agent.

One resource is published beside the tools, `build-guide` at `https://kanmani.xyz/skill.md`, as
`text/markdown`. It is the same build guide `/skill.md` serves.

The server's instructions tell a model the order: start with `check_registration`, sign the returned
transaction with the agent's own key, then check evidence documents with `check_evidence` before
publishing.

## Stateless and why

A new `McpServer` and a new transport are built per request, with `sessionIdGenerator` left undefined
and `enableJsonResponse: true`. Responses are JSON rather than server-sent events. Nothing survives
the request: the server is closed in a `finally` block.

That fits one Next.js route handler with no process to keep alive. It also means nothing about a
caller is kept between calls. There is no session id to correlate, because there is no session.

## What is counted

Two things, from a clone of the request body, so the count never touches what the transport reads:

- On `initialize`, the client name the client announced about itself, normalised by
  `mcpClientName` in `lib/usage-classify.ts`.
- On `tools/call`, the name of the tool.

Never the arguments. Never the caller. A body that is not JSON is left to the transport to answer.
The counters are the same ones behind `/api/usage`.

## Try it without a client

MCP is JSON-RPC over HTTP, so the handshake works with curl:

```bash
curl -sS -X POST https://kanmani.xyz/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"curl","version":"1"}}}'
```

Then list the tools:

```bash
curl -sS -X POST https://kanmani.xyz/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

And call one:

```bash
curl -sS -X POST https://kanmani.xyz/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"check_evidence","arguments":{"document":{
          "network":"monad",
          "proof_of_payment":{"network":"monad","payment_tx":"0x00","status":"anchored"}}}}}'
```

A tool that fails answers with `isError: true` and a sentence, not a stack trace. An HTTP error from
an in-process route handler is returned as `HTTP <status>: <body>` so a caller can tell a bad input
from an outage.

## The same answers as the HTTP API

`get_agent`, `get_account` and `list_claims` call `app/api/agent/[id]/route.ts`,
`app/api/account/[address]/route.ts` and `app/api/claims/route.ts` directly with a synthesised
`Request`. No network request leaves the server to reach our own API and MCP cannot disagree with
HTTP about what an agent's rung is, because there is one function behind both.

`check_registration` and `check_evidence` call `registrationCheck` and `evidenceCheck` in
`lib/build-server.ts`, which are also what `POST /api/registration/check` and
`POST /api/evidence/check` call. See [34-EVIDENCE-CHECK](34-EVIDENCE-CHECK.md) for those two over
plain HTTP.

## Related

- [34-EVIDENCE-CHECK](34-EVIDENCE-CHECK.md) the two free build checks as HTTP endpoints.
- [35-MACHINE-SURFACES](35-MACHINE-SURFACES.md) `/openapi.json`, `/skill.md`, the A2A card and the
  drop-in `AGENTS.md`.
- [10-API](10-API.md) the HTTP API the read tools sit on.
