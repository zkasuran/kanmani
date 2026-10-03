/**
 * The re-derive source on a Sentinel or Assay answer has to actually reproduce the answer.
 *
 * A broker's judge graded our replies as unsupported claims because it could not confirm the
 * figures. The fix was to hand it a pinned URL and the values it must find there. That only helps if
 * the URL really returns those values, so this asks both agents for an answer, follows the URL each
 * one gives and checks every expected field against what the SLA route computes for the same window.
 *
 * The SLA route is a thin envelope over `claimTruthWindow`, so this parses the agent and window out
 * of the URL and runs that same query. No server is needed. It does need the index, so it skips
 * without a database like the other store-backed tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assay, sentinel } from "./agents.ts";
import { claimTruthWindow } from "./queries.ts";

const hasDb = Boolean(process.env.ENVIO_PG_PASSWORD || process.env.FOVEA_DATABASE_URL);
const skip = hasDb ? false : "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

/** An agent with a decided sample, so the expected counts are not all zero. */
const AGENT = 10261;

/** What GET <url> would return under data, computed the way the route computes it. */
async function followed(url: string) {
  const u = new URL(url);
  const agentId = u.pathname.split("/").pop()!;
  const from = BigInt(u.searchParams.get("fromBlock") ?? "0");
  const to = BigInt(u.searchParams.get("toBlock") ?? "0");
  return { data: (await claimTruthWindow(agentId, from, to)).rows as unknown as Record<string, unknown> };
}

for (const [name, ask] of [
  ["sentinel", () => sentinel(AGENT, 10_000)],
  ["assay", () => assay(AGENT)],
] as const) {
  test(`${name}: following rederive.url returns exactly the counts in rederive.expect`, { skip }, async () => {
    const answer = await ask();
    const r = answer.rederive;
    assert.ok(r, `${name} returned no rederive source`);
    assert.match(r.url, /^https:\/\/kanmani\.xyz\/api\/sla\/\d+\?fromBlock=0&toBlock=\d+$/);
    assert.ok(answer.reproduce.includes(r.url), "reproduce names the same pinned URL");
    const body = await followed(r.url);
    for (const [field, want] of Object.entries(r.expect)) {
      assert.equal(body.data[field], want, `${field}: the URL returns ${body.data[field]}, the answer expected ${want}`);
    }
  });
}

test("the sample size an answer reports is the one its source confirms", { skip }, async () => {
  const a = await assay(AGENT);
  assert.ok(a.rederive);
  assert.equal(a.sampleSize, a.rederive.expect.sampleSize);
});
