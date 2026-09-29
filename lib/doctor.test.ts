import assert from "node:assert/strict";
import test from "node:test";
import { diagnose, endpointsIn, lintChallenge } from "./doctor.ts";

const ok = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: true as const, status, ms: 40, headers, body: typeof body === "string" ? body : JSON.stringify(body), truncated: false });
const down = { ok: false as const, reason: "no answer within 8000ms", ms: 8000 };

test("an A2A task answer is hireable; a plain-JSON 400 is not and gets the fix", () => {
  const good = diagnose({ a2a: ok(200, { jsonrpc: "2.0", id: 1, result: { kind: "task", status: { state: "input-required" } } }), mcp: ok(400, "{}"), get: ok(402, "{}") });
  assert.equal(good.hireable, true);
  assert.deepEqual(good.speaks, ["a2a"]);
  const bad = diagnose({ a2a: ok(400, { title: "agentId must be a positive integer" }), mcp: ok(400, "{}"), get: ok(402, "{}") });
  assert.equal(bad.hireable, false);
  assert.match(bad.findings[0]!.fix!, /jsonrpc/);
});

test("an MCP server answering initialize over SSE is recognised", () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"},"capabilities":{"tools":{}}}}\n\n';
  const r = diagnose({ a2a: ok(404, "nope"), mcp: ok(200, sse, { contentType: "text/event-stream" }), get: ok(200, "hi") });
  assert.equal(r.hireable, true);
  assert.deepEqual(r.speaks, ["mcp"]);
});

test("an unreachable endpoint is reported as such, never as hireable", () => {
  const r = diagnose({ a2a: down, mcp: down, get: down });
  assert.equal(r.hireable, false);
  assert.ok(r.findings.every((f) => f.ok !== true));
});

const good402 = { x402Version: 2, resource: { url: "u" }, accepts: [{ scheme: "exact", network: "eip155:143", amount: "10000", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", payTo: "0xDB6c6340342e71A63cD11Ebac2185204b7777777", extra: { name: "USDC", version: "2" } }] };
const supported = { kinds: [{ scheme: "exact", network: "eip155:143" }, { scheme: "upto", network: "eip155:143" }] };

test("a correct v2 challenge on Monad lints clean", () => {
  const r = lintChallenge({ get: ok(402, good402), post: ok(402, good402), supported });
  assert.equal(r.ok, true);
});

test("the mistakes that cost money are each caught", () => {
  const bad = { x402Version: 2, accepts: [{ scheme: "exact", network: "monad", amount: "10000000000000000", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", payTo: "0x12", extra: { name: "USD Coin" } }] };
  const r = lintChallenge({ get: ok(402, bad), post: ok(402, bad), supported });
  const failed = r.findings.filter((f) => f.ok === false).map((f) => f.check);
  for (const c of ["resource", "accepts[0].network", "accepts[0].decimals", "accepts[0].extra.name", "accepts[0].payTo", "accepts[0].facilitator"]) assert.ok(failed.includes(c), `${c} in ${failed}`);
});

test("no 402 at all is one clear failure", () => {
  const r = lintChallenge({ get: ok(200, "free"), post: ok(200, "free"), supported });
  assert.equal(r.challenge, null);
  assert.match(r.findings[0]!.fix!, /402/);
});

test("endpoints are read from skills, services or endpoints, as strings or objects", () => {
  const doc = new TextEncoder().encode(JSON.stringify({ skills: [{ id: "a", endpoint: "https://a.example/x" }], services: [{ name: "b", url: "https://b.example" }], endpoints: ["https://c.example"] }));
  assert.deepEqual(endpointsIn(doc), ["https://a.example/x", "https://b.example", "https://c.example"]);
  assert.deepEqual(endpointsIn(new TextEncoder().encode("not json")), []);
});
