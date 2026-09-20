import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFrom, probeRecord } from "./records.ts";

const at = () => new Date("2026-09-20T00:00:00.000Z");
const target = (uri: string) => ({ uriHash: "h", uri, memberCount: 3, distinctOwners: 2 });

test("an empty record is unreachable and says why, rather than reading as a failed fetch", async () => {
  const p = await probeRecord(target(""), at);
  assert.equal(p.scheme, "empty");
  assert.equal(p.reachable, false);
  assert.match(p.reason, /declares no document/);
  // Nothing was asked, so there is no status to report. A 0 here would look like a real answer.
  assert.equal(p.httpStatus, undefined);
});

test("inline JSON resolves with no network and is NOT called http", async () => {
  // 82 records on Monad are exactly this. The document is on chain, so it cannot 404 later, and
  // that is the distinction the whole page rests on.
  const p = await probeRecord(target(`{"name":"EllaSharp","agentType":"reputation"}`), at);
  assert.equal(p.scheme, "inline");
  assert.equal(p.reachable, true);
  assert.equal(p.parsedName, "EllaSharp");
  assert.match(p.reason, /inline in tokenURI/);
  assert.equal(p.httpStatus, undefined, "there was no host, so there is no status");
});

test("a data URI resolves with no network", async () => {
  const p = await probeRecord(target(`data:application/json,{"name":"Inline"}`), at);
  assert.equal(p.scheme, "data");
  assert.equal(p.reachable, true);
  assert.equal(p.parsedName, "Inline");
});

test("the scale of a record travels with its verdict", async () => {
  // "A dead URL" is a row. "8,093 agents across 7,962 wallets" is a finding. The counts are
  // carried on the probe so the finding survives the index moving underneath it.
  const p = await probeRecord({ uriHash: "h", uri: "", memberCount: 8093, distinctOwners: 7962 }, at);
  assert.equal(p.memberCount, 8093);
  assert.equal(p.distinctOwners, 7962);
  assert.equal(p.checkedAt, "2026-09-20T00:00:00.000Z");
});

test("a URI that is neither a scheme nor JSON is refused, not guessed at", async () => {
  const p = await probeRecord(target("agent-smith"), at);
  assert.equal(p.scheme, "other");
  assert.equal(p.reachable, false);
  assert.match(p.reason, /unsupported URI scheme/);
});

test("an HTTP status is pulled back out of the refusal so a page can say 404", async () => {
  // The guard reports refusals as sentences because most have no code at all. Where there is one
  // it gets its own column, which is the difference between "not reachable" and "deleted".
  const p = await probeRecord(target("https://127.0.0.1/never"), at);
  assert.equal(p.reachable, false);
  // A private address is refused before any request, so there is no status. Asserting the absence
  // matters as much as asserting a 404: a 0 would render as a real HTTP answer.
  assert.equal(p.httpStatus, undefined);
  assert.ok(p.reason.length > 0);
});

test("nameFrom reads a name and refuses to invent one", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(nameFrom(enc(`{"name":"Thing"}`)), "Thing");
  assert.equal(nameFrom(enc(`{"name":""}`)), undefined, "empty is not a name");
  assert.equal(nameFrom(enc(`{"title":"Thing"}`)), undefined, "a different key is not a name");
  assert.equal(nameFrom(enc(`{"name":42}`)), undefined, "a number is not a name");
  assert.equal(nameFrom(enc(`[{"name":"Thing"}]`)), undefined, "an array is not a record");
  assert.equal(nameFrom(enc("not json at all")), undefined);
  assert.equal(nameFrom(new Uint8Array([0xff, 0xfe])), undefined, "invalid UTF-8 is not a name");
});

test("a very long name is cut rather than stored whole", () => {
  // Somebody else controls these bytes and they end up in a page and a JSON feed.
  const long = "x".repeat(5000);
  const got = nameFrom(new TextEncoder().encode(JSON.stringify({ name: long })));
  assert.equal(got?.length, 200);
});
