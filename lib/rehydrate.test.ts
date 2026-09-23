import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  agentIdFromWord,
  couldNotCheck,
  deliveryKeyFor,
  describeWebhook,
  handleAlchemyWebhook,
  IDENTITY_REGISTRY,
  liveAppendVerdict,
  liveClaimDelivery,
  liveEnsureSchema,
  liveFinishDelivery,
  liveRecentDeliveries,
  METADATA_UPDATE_TOPIC,
  parseDelivery,
  refuseUnsupportedOutcome,
  reverifyAgent,
  selectAgents,
  SIGNATURE_HEADER,
  URI_UPDATED_TOPIC,
  verifySignature,
  type AppendRow,
  type ClaimTarget,
  type DeliveryRow,
  type Deps,
  type WebhookLog,
} from "./rehydrate.ts";
import { check } from "./check.ts";
import type { CheckResult } from "./check.ts";

/**
 * The self-healing trigger, tested as an attacker would reach it.
 *
 * This is an unauthenticated public endpoint that writes to the verdict store, so the tests that
 * matter are the refusals rather than the happy path. Four properties carry the whole thing and
 * each has a test that has been checked against a deliberately broken copy of the code:
 *
 *  1. A signature that does not verify writes nothing.
 *  2. A retry appends nothing.
 *  3. A re-check that failed is `unknown`, never `false`.
 *  4. A delivery that did no work says so rather than answering 200 in silence.
 *
 * The database tests skip with a loud reason when Postgres is absent. A test that reports green
 * without touching a database is worse than one that was never written.
 */

const KEY = "test-signing-key-not-a-real-one";
const OTHER_KEY = "a-different-signing-key";

function sign(raw: string, key = KEY): string {
  return createHmac("sha256", key).update(raw, "utf8").digest("hex");
}

function word(n: number | bigint): string {
  return `0x${BigInt(n).toString(16).padStart(64, "0")}`;
}

function metadataUpdateLog(agentId: number | bigint, address: string = IDENTITY_REGISTRY) {
  // _tokenId is NOT indexed on ERC-4906, so the agent id rides in data.
  return {
    topics: [METADATA_UPDATE_TOPIC],
    data: word(agentId),
    index: 0,
    account: { address },
    transaction: { hash: "0x" + "ab".repeat(32) },
  };
}

function uriUpdatedLog(agentId: number, address: string = IDENTITY_REGISTRY) {
  // URIUpdated DOES index agentId, so it is topics[1] and data holds the encoded string.
  return {
    topics: [URI_UPDATED_TOPIC, word(agentId), `0x${"11".repeat(32)}`],
    data: `0x${word(32).slice(2)}${word(4).slice(2)}${"68747470".padEnd(64, "0")}`,
    index: 1,
    account: { address },
    transaction: { hash: "0x" + "cd".repeat(32) },
  };
}

function graphqlBody(id: string, logs: unknown[]) {
  return {
    webhookId: "wh_test",
    id,
    createdAt: "2026-09-23T09:00:00.000Z",
    type: "GRAPHQL",
    event: { data: { block: { number: 106470718, logs } }, sequenceNumber: "1" },
  };
}

function addressActivityBody(id: string, logs: unknown[]) {
  return {
    webhookId: "wh_test",
    id,
    createdAt: "2026-09-23T09:00:00.000Z",
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "MONAD_MAINNET",
      activity: logs.map((l) => ({ category: "token", log: l })),
    },
  };
}

/** A POST the way Alchemy sends one. `signature: null` omits the header entirely. */
function post(body: unknown, opts: { key?: string | null; signature?: string } = {}): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== undefined) headers[SIGNATURE_HEADER] = opts.signature;
  else if (opts.key !== null) headers[SIGNATURE_HEADER] = sign(raw, opts.key ?? KEY);
  return new Request("https://kanmani.xyz/api/webhooks/alchemy", { method: "POST", body: raw, headers });
}

/** The logs a body really yields, so nothing here tests a shape the parser would not produce. */
function logsOf(body: unknown): WebhookLog[] {
  const p = parseDelivery(body);
  assert.equal(p.ok, true, "this body was meant to parse");
  return p.ok ? p.delivery.logs : [];
}

/** A verdict shaped the way `judge` returns one, so the orchestration is exercised, not mocked. */
function ladderResult(over: Partial<CheckResult["verdict"]> = {}): CheckResult {
  return {
    verdict: {
      rung: "true",
      outcome: "true",
      reason: "cited transaction is on Monad at block 106470718",
      checkedAt: "2026-09-23T09:00:01.000Z",
      checkedAtBlock: "106470718",
      declaredNetwork: "monad",
      declaredTx: `0x${"12".repeat(32)}`,
      mapping: "execution-market.v1",
      hashMatches: true,
      computedHash: `0x${"34".repeat(32)}`,
      foundOnChain: { chain: "Monad", chainId: 143, blockNumber: "106470000" },
      ...over,
    },
    hashWasSupplied: true,
    bytesRead: 652,
    mediaType: "application/json",
    source: "http",
    coverage: [],
    reproduce: "node --experimental-strip-types verifier/src/cli/locate.ts monad 0x12",
  };
}

type Harness = {
  deps: Deps;
  appended: AppendRow[];
  ledger: Map<string, DeliveryRow>;
  ladderCalls: string[];
};

/**
 * Deps with no database and no network.
 *
 * The in-memory ledger reproduces exactly what the SQL does: a key held by a finished delivery is
 * refused, a key held by a failed one is re-claimable. If those two diverged, the idempotency tests
 * would be checking a fiction, so the shape is kept deliberately close to `liveClaimDelivery`.
 */
function harness(over: Partial<Deps> = {}, claims: ClaimTarget[] = []): Harness {
  const appended: AppendRow[] = [];
  const ledger = new Map<string, DeliveryRow>();
  const ladderCalls: string[] = [];
  let nextId = 1;

  const deps: Deps = {
    now: () => new Date("2026-09-23T09:00:00.000Z"),
    signingKey: KEY,
    ensureSchema: async () => {},
    claimDelivery: async (input) => {
      const prior = ledger.get(input.key);
      if (prior && prior.status !== "failed") return { claimed: false, prior };
      ledger.set(input.key, {
        deliveryKey: input.key,
        keyedOn: input.keyedOn,
        webhookId: input.webhookId,
        eventType: input.eventType,
        status: "running",
        agentIds: [],
        claimsChecked: 0,
        verdictsAppended: 0,
        changed: 0,
        note: "accepted",
        receivedAt: input.receivedAt,
        finishedAt: null,
      });
      return { claimed: true };
    },
    finishDelivery: async (key, f) => {
      const row = ledger.get(key);
      if (row) ledger.set(key, { ...row, ...f });
    },
    recentDeliveries: async () => [...ledger.values()],
    agentExists: async () => true,
    claimsForAgent: async () => claims,
    runLadder: async (uri) => {
      ladderCalls.push(uri);
      return ladderResult();
    },
    appendVerdict: async (row) => {
      appended.push(row);
      return nextId++;
    },
    ...over,
  };

  return { deps, appended, ledger, ladderCalls };
}

const claim = (id: string, outcome: ClaimTarget["outcome"] = "false"): ClaimTarget => ({
  id,
  feedbackUri: `https://example.test/${id}.json`,
  feedbackHash: `0x${"56".repeat(32)}`,
  outcome,
});

/* ------------------------------------------------------------- the event, read off the ABI */

test("the topic hashes are the ones the chain actually emits", () => {
  // indexer/config.yaml recorded these off block 103,845,082 by matching every topic0 with
  // `cast keccak`. MetadataUpdate is ERC-4906 and is absent from the ERC-8004 draft, so it is the
  // one most likely to be wrong from memory. Pinned here so a rename cannot pass quietly.
  assert.equal(METADATA_UPDATE_TOPIC.slice(0, 10), "0xf8e1a15a");
  assert.equal(
    METADATA_UPDATE_TOPIC,
    "0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7",
  );
  assert.equal(URI_UPDATED_TOPIC.slice(0, 10), "0x3a2c7fff");
});

test("MetadataUpdate reads the agent id from data and URIUpdated reads it from topics[1]", () => {
  // These two are the opposite way round and getting them the same way round would read a string
  // offset as an agent id. 10182 exists on Monad, 32 is the ABI head of the URIUpdated string.
  const s = selectAgents(logsOf(graphqlBody("d1", [metadataUpdateLog(10182), uriUpdatedLog(10247)])));
  assert.deepEqual(
    s.matched.map((m) => [m.event, m.agentId]),
    [
      ["MetadataUpdate", 10182],
      ["URIUpdated", 10247],
    ],
  );
  assert.deepEqual(s.agentIds, [10182, 10247]);
});

test("a log from another contract is refused by name, never trusted", () => {
  // The dashboard configuration is not visible from here, so the contract is checked rather than
  // assumed. The Reputation Registry is the realistic mistake.
  const s = selectAgents(
    logsOf(graphqlBody("d1", [metadataUpdateLog(10182, "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63")])),
  );
  assert.deepEqual(s.agentIds, []);
  assert.equal(s.refused.length, 1);
  assert.match(s.refused[0]!.reason, /not the Identity Registry/);
});

test("an agent id past a safe integer is refused rather than truncated", () => {
  assert.equal(agentIdFromWord(word(10182)), 10182);
  assert.equal(agentIdFromWord(word(0)), null, "agent 0 does not exist");
  assert.equal(agentIdFromWord(word(2n ** 60n)), null, "would land on a different agent via Number()");
  assert.equal(agentIdFromWord("0xnothex"), null);
  const s = selectAgents(logsOf(graphqlBody("d1", [metadataUpdateLog(2n ** 60n)])));
  assert.deepEqual(s.agentIds, []);
  assert.match(s.refused[0]!.reason, /no readable agent id/);
});

test("both Alchemy payload shapes are read", () => {
  const a = parseDelivery(graphqlBody("d1", [metadataUpdateLog(10182)]));
  const b = parseDelivery(addressActivityBody("d2", [
    { address: IDENTITY_REGISTRY, topics: [METADATA_UPDATE_TOPIC], data: word(10182), transactionHash: "0xaa" },
  ]));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.delivery.logs.length, 1);
    assert.equal(b.delivery.logs.length, 1);
    assert.equal(selectAgents(a.delivery.logs).agentIds[0], 10182);
    assert.equal(selectAgents(b.delivery.logs).agentIds[0], 10182);
  }
});

/* ------------------------------------------------------------- signatures */

test("a signature over the raw body verifies and one over re-serialised JSON does not", () => {
  // The reason the handler reads req.text() first. Re-serialising changes key order plus
  // whitespace, so a digest taken after a parse is a digest of different bytes.
  const raw = '{"id":"d1",  "type":"GRAPHQL"}';
  assert.equal(verifySignature(raw, sign(raw), KEY), true);
  assert.equal(verifySignature(raw, sign(JSON.stringify(JSON.parse(raw))), KEY), false);
});

test("a wrong key, a tampered body and a malformed header all fail without throwing", () => {
  const raw = '{"id":"d1"}';
  assert.equal(verifySignature(raw, sign(raw, OTHER_KEY), KEY), false);
  assert.equal(verifySignature(raw + " ", sign(raw), KEY), false);
  // A short header is the case that makes a naive timingSafeEqual throw rather than return false.
  assert.equal(verifySignature(raw, "abc", KEY), false);
  assert.equal(verifySignature(raw, "", KEY), false);
  assert.equal(verifySignature(raw, null, KEY), false);
  // Right length, wrong digest. This is the input a constant-time compare exists for.
  assert.equal(verifySignature(raw, "f".repeat(64), KEY), false);
});

test("the compare is constant time, asserted against the source because behaviour cannot show it", () => {
  /**
   * `timingSafeEqual` and `===` agree on every input, so no behavioural test can tell them apart.
   * Swapping one for the other is therefore a silent regression: a byte-at-a-time compare against a
   * secret-derived digest leaks how much of a guess was right, which is enough to find the rest.
   *
   * So this reads the module and asserts the call is still there. It is deliberately brittle to a
   * refactor of that one line, which is the only way this class of change gets noticed at all.
   * Alchemy's own samples use plain equality, so drifting back to it would even look correct.
   */
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rehydrate.ts"), "utf8");
  const start = src.indexOf("export function verifySignature");
  assert.notEqual(start, -1, "verifySignature must still be the one place a signature is compared");
  const body = src.slice(start, src.indexOf("\n}", start));

  assert.match(body, /return timingSafeEqual\(given, expected\);/, "the HMAC compare must stay constant time");
  // The two shapes a drift back to plain equality actually takes. Alchemy's own samples are written
  // the second way, so it would even look like following the docs.
  assert.ok(!/return\s+given\s*(===|!==|\.equals\()/.test(body), "no plain compare of the two buffers");
  assert.ok(!/digest\("hex"\)\s*(===|!==)/.test(body), "no plain compare of the digest");
});

test("a tampered signature writes nothing at all", async () => {
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)]), { key: OTHER_KEY }), h.deps);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { title: string };
  assert.match(body.title, /Signature does not verify/);
  assert.equal(h.appended.length, 0, "a rejected delivery must not touch the verdict store");
  assert.equal(h.ledger.size, 0, "and must not claim a delivery key either");
});

test("a missing signature header is a 401, not a skipped check", async () => {
  const h = harness();
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)]), { key: null }), h.deps);
  assert.equal(res.status, 401);
  assert.equal(h.appended.length, 0);
});

test("with no signing key configured the endpoint refuses every request", async () => {
  // The dangerous default is to skip verification when the key is absent, which would leave the
  // verdict store writable by anyone who found the URL.
  const h = harness({ signingKey: null });
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)])), h.deps);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { envVar: string; detail: string };
  assert.equal(body.envVar, "ALCHEMY_WEBHOOK_SIGNING_KEY");
  assert.match(body.detail, /refuses every request/);
  assert.equal(h.appended.length, 0);
});

/* ------------------------------------------------------------- the happy path */

test("a valid delivery re-runs the ladder and appends a verdict per claim", async () => {
  const h = harness({}, [claim("143_10182_0xabc_1", "false"), claim("143_10182_0xabc_2", "unknown")]);
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)])), h.deps);

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: {
      status: string;
      claimsChecked: number;
      verdictsAppended: number;
      changed: number;
      agents: { agentId: number; claims: { before: string | null; after: string; changed: boolean }[] }[];
    };
  };

  assert.equal(body.data.status, "reverified");
  assert.equal(body.data.claimsChecked, 2);
  assert.equal(body.data.verdictsAppended, 2);
  assert.equal(body.data.changed, 2, "false -> true and unknown -> true both moved");
  assert.equal(body.data.agents[0]!.agentId, 10182);
  assert.deepEqual(
    body.data.agents[0]!.claims.map((c) => [c.before, c.after]),
    [
      ["false", "true"],
      ["unknown", "true"],
    ],
  );

  // The point of the whole thing: new rows, never an update. Both carry the ladder's own fields.
  assert.equal(h.appended.length, 2);
  assert.equal(h.appended[0]!.outcome, "true");
  assert.equal(h.appended[0]!.checkedAtBlock, "106470718");
  assert.equal(h.appended[0]!.mapping, "execution-market.v1");
  assert.deepEqual(h.ladderCalls, [
    "https://example.test/143_10182_0xabc_1.json",
    "https://example.test/143_10182_0xabc_2.json",
  ]);
  assert.equal(h.ledger.get("alchemy:d1")!.status, "done");
});

test("the response points at the claim feed rather than asking to be believed", async () => {
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)])), h.deps);
  const body = (await res.json()) as { reproduce: string; checkedAt: string; version: number };
  assert.equal(body.version, 1);
  assert.ok(body.checkedAt.endsWith("Z"));
  assert.match(body.reproduce, /api\/claims/);
  assert.match(body.reproduce, /10182/);
});

/* ------------------------------------------------------------- idempotency */

test("a replayed delivery appends nothing and says which attempt it was", async () => {
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  const req = () => post(graphqlBody("delivery-abc", [metadataUpdateLog(10182)]));

  const first = await handleAlchemyWebhook(req(), h.deps);
  assert.equal(first.status, 200);
  assert.equal(h.appended.length, 1);

  const second = await handleAlchemyWebhook(req(), h.deps);
  assert.equal(second.status, 200);
  const body = (await second.json()) as { data: { status: string; verdictsAppended: number; prior: { verdictsAppended: number } } };
  assert.equal(body.data.status, "replayed");
  assert.equal(body.data.verdictsAppended, 0);
  assert.equal(body.data.prior.verdictsAppended, 1);
  assert.equal(h.appended.length, 1, "a retry must not double-append a verdict");
});

test("two different deliveries about the same agent are both processed", async () => {
  // The guard is per delivery, not per agent. Two real metadata updates in a row must both run.
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)])), h.deps);
  await handleAlchemyWebhook(post(graphqlBody("d2", [metadataUpdateLog(10182)])), h.deps);
  assert.equal(h.appended.length, 2);
});

test("a payload with no delivery id is keyed on a hash of its raw bytes", () => {
  const body = graphqlBody("", [metadataUpdateLog(10182)]);
  const raw = JSON.stringify(body);
  const parsed = parseDelivery(body);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const k = deliveryKeyFor(parsed.delivery, raw);
  assert.equal(k.keyedOn, "body-sha256");
  assert.match(k.key, /^sha256:[0-9a-f]{64}$/);
  // Recorded as the weaker choice rather than presented as the same thing as an id.
  const withId = deliveryKeyFor({ ...parsed.delivery, id: "d9" }, raw);
  assert.equal(withId.keyedOn, "alchemy-id");
  assert.equal(withId.key, "alchemy:d9");
});

test("a delivery whose first attempt failed is processed on retry", async () => {
  // The other half of the guard. A key that stayed claimed after a failure would drop the delivery
  // for good, which is the failure mode the ledger exists to prevent.
  let attempt = 0;
  const h = harness(
    {
      runLadder: async () => {
        attempt++;
        if (attempt === 1) throw new Error("RPC timed out");
        return ladderResult();
      },
      appendVerdict: async () => {
        throw new Error("database went away");
      },
    },
    [claim("143_10182_0xabc_1")],
  );

  const first = await handleAlchemyWebhook(post(graphqlBody("d-retry", [metadataUpdateLog(10182)])), h.deps);
  assert.equal(first.status, 500);
  assert.equal(h.ledger.get("alchemy:d-retry")!.status, "failed");

  const appended: AppendRow[] = [];
  const second = await handleAlchemyWebhook(post(graphqlBody("d-retry", [metadataUpdateLog(10182)])), {
    ...h.deps,
    appendVerdict: async (row) => {
      appended.push(row);
      return 99;
    },
  });
  assert.equal(second.status, 200);
  assert.equal(appended.length, 1, "the retry of a failed delivery does the work");
});

test("a delivery still marked running is answered 409 rather than raced", async () => {
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  h.deps.claimDelivery = async (input) => ({
    claimed: false,
    prior: {
      deliveryKey: input.key,
      keyedOn: input.keyedOn,
      webhookId: input.webhookId,
      eventType: input.eventType,
      status: "running",
      agentIds: [10182],
      claimsChecked: 0,
      verdictsAppended: 0,
      changed: 0,
      note: "accepted",
      receivedAt: input.receivedAt,
      finishedAt: null,
    },
  });
  const res = await handleAlchemyWebhook(post(graphqlBody("d1", [metadataUpdateLog(10182)])), h.deps);
  assert.equal(res.status, 409);
  assert.equal(h.appended.length, 0);
});

/* ------------------------------------------------------------- malformed and wrong-event */

test("a malformed payload is refused after the signature verifies", async () => {
  const h = harness();

  // Signed correctly, not JSON.
  const raw = "not json at all";
  const bad = new Request("https://kanmani.xyz/api/webhooks/alchemy", {
    method: "POST",
    body: raw,
    headers: { [SIGNATURE_HEADER]: sign(raw) },
  });
  const r1 = await handleAlchemyWebhook(bad, h.deps);
  assert.equal(r1.status, 400);
  assert.match(((await r1.json()) as { title: string }).title, /not JSON/);

  // JSON, right signature, wrong shape. Each of these is a distinct way the body can be hostile.
  for (const body of [
    42,
    "a string",
    null,
    [],
    { type: "GRAPHQL" },
    { type: "GRAPHQL", event: 7 },
    { event: { data: { block: { logs: [] } } } },
    { type: "GRAPHQL", event: { data: { block: {} } } },
  ]) {
    const res = await handleAlchemyWebhook(post(body), h.deps);
    assert.equal(res.status, 400, `${JSON.stringify(body)} must be refused`);
  }
  assert.equal(h.appended.length, 0);
  assert.equal(h.ledger.size, 0, "nothing malformed reaches the ledger");
});

test("a log whose fields are the wrong type is skipped rather than coerced", () => {
  // Each entry below is a distinct way a hostile body can be shaped. The parser drops the ones it
  // cannot read and `selectAgents` refuses the rest, so no agent id comes out of any of them.
  const logs = logsOf(
    graphqlBody("d1", [
      { account: { address: 7 }, topics: [METADATA_UPDATE_TOPIC], data: word(1) },
      { account: { address: IDENTITY_REGISTRY }, topics: "not-an-array", data: word(1) },
      { account: { address: IDENTITY_REGISTRY }, topics: [METADATA_UPDATE_TOPIC], data: { evil: true } },
      { account: { address: IDENTITY_REGISTRY }, topics: [{ nested: METADATA_UPDATE_TOPIC }], data: word(1) },
      { account: null, topics: [METADATA_UPDATE_TOPIC], data: word(1) },
      "not an object",
      null,
      [],
    ]),
  );
  const s = selectAgents(logs);
  assert.deepEqual(s.agentIds, [], "no agent id can be read out of any of these");
  assert.equal(s.matched.length, 0);
});

test("a delivery carrying no event we act on is 200, with the reason each log was passed over", async () => {
  // A no-op is the right answer here. Answering 200 in silence is not, because it cannot be told
  // apart from a broken endpoint.
  const h = harness({}, [claim("143_10182_0xabc_1")]);
  const transfer = {
    topics: [`0x${"dd".repeat(32)}`, word(1), word(2), word(10182)],
    data: "0x",
    account: { address: IDENTITY_REGISTRY },
    transaction: { hash: "0xef" },
  };
  const res = await handleAlchemyWebhook(post(graphqlBody("d-transfer", [transfer])), h.deps);

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: { status: string; verdictsAppended: number; refused: { reason: string }[]; watching: { events: { name: string }[] } };
  };
  assert.equal(body.data.status, "ignored");
  assert.equal(body.data.verdictsAppended, 0);
  assert.equal(body.data.refused.length, 1);
  assert.match(body.data.refused[0]!.reason, /not MetadataUpdate or URIUpdated/);
  assert.deepEqual(body.data.watching.events.map((e) => e.name), ["MetadataUpdate", "URIUpdated"]);

  assert.equal(h.appended.length, 0, "a wrong-event delivery must not append a verdict");
  // Recorded, so a webhook pointed at the wrong event shows as rows rather than as silence.
  assert.equal(h.ledger.get("alchemy:d-transfer")!.status, "ignored");
});

test("an event for an agent the index has not reached is a loud 503, not a quiet 200", async () => {
  const h = harness({ agentExists: async () => false });
  const res = await handleAlchemyWebhook(post(graphqlBody("d-unknown", [metadataUpdateLog(99999)])), h.deps);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { detail: string; retryable: boolean };
  assert.match(body.detail, /our lag rather than a fact about the agent/);
  assert.equal(body.retryable, true);
  // Failed rather than done, so the retry after Retina catches up is processed.
  assert.equal(h.ledger.get("alchemy:d-unknown")!.status, "failed");
  assert.equal(h.appended.length, 0);
});

test("an indexed agent with no document to check is stated plainly, never as a failure", async () => {
  const h = harness({}, []);
  const res = await handleAlchemyWebhook(post(graphqlBody("d-nodocs", [metadataUpdateLog(10182)])), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { status: string; verdictsAppended: number } };
  assert.equal(body.data.status, "nothing-to-recheck");
  assert.equal(body.data.verdictsAppended, 0);
  assert.equal(h.ledger.get("alchemy:d-nodocs")!.status, "done");
});

/* ------------------------------------------------------------- unknown is never false */

test("a re-check that threw appends unknown, never false", async () => {
  const h = harness({ runLadder: async () => { throw new Error("connect ETIMEDOUT 203.0.113.9:443"); } }, [
    claim("143_10182_0xabc_1", "true"),
  ]);
  const res = await handleAlchemyWebhook(post(graphqlBody("d-throw", [metadataUpdateLog(10182)])), h.deps);

  assert.equal(res.status, 200);
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0]!.outcome, "unknown", "our own timeout is not evidence about somebody else");
  assert.equal(h.appended[0]!.rung, "declared");
  assert.match(h.appended[0]!.reason, /re-check did not complete/);
  assert.equal(h.appended[0]!.checkedAtBlock, undefined);
});

test("couldNotCheck has no branch that returns false", () => {
  for (const reason of ["timeout", "", "false", "outcome=false"]) {
    assert.equal(couldNotCheck(reason, "2026-09-23T09:00:00.000Z").outcome, "unknown");
  }
});

test("a false the ladder could not support is refused and recorded as unknown", () => {
  // `judge` produces `false` in exactly one place: the parsed rung, after a chain read that
  // returned a head block. A false from anywhere else did not come from the ladder.
  assert.equal(refuseUnsupportedOutcome({ outcome: "false", rung: "parsed", checkedAtBlock: "106470718" }), null);
  assert.match(refuseUnsupportedOutcome({ outcome: "false", rung: "parsed" })!, /needs the block/);
  assert.match(refuseUnsupportedOutcome({ outcome: "false", rung: "declared", checkedAtBlock: "1" })!, /parsed rung/);
  // Everything that is not a false passes untouched. unknown is not a weaker false.
  assert.equal(refuseUnsupportedOutcome({ outcome: "unknown", rung: "declared" }), null);
  assert.equal(refuseUnsupportedOutcome({ outcome: "true", rung: "true", checkedAtBlock: "1" }), null);
  assert.equal(refuseUnsupportedOutcome({ outcome: "noClaim", rung: "parsed" }), null);
});

test("a false without a block never reaches the store", async () => {
  const h = harness(
    { runLadder: async () => ladderResult({ rung: "parsed", outcome: "false", checkedAtBlock: undefined }) },
    [claim("143_10182_0xabc_1", "true")],
  );
  await reverifyAgent(10182, h.deps);
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0]!.outcome, "unknown");
  assert.match(h.appended[0]!.reason, /needs the block it was read at/);
});

test("a real false, with its block, is appended as a false", async () => {
  // The refusal above must not have turned every negative into unknown. Prove the check can pass.
  const h = harness(
    {
      runLadder: async () =>
        ladderResult({
          rung: "parsed",
          outcome: "false",
          reason: "no transaction with this hash on Monad at block 106470718",
          foundOnChain: undefined,
        }),
    },
    [claim("143_10182_0xabc_1", "unknown")],
  );
  await reverifyAgent(10182, h.deps);
  assert.equal(h.appended[0]!.outcome, "false");
  assert.equal(h.appended[0]!.checkedAtBlock, "106470718");
});

/* ------------------------------------------------------------- the SSRF guard, through the real path */

test("a document pointing inside our own network is unknown and reaches no socket", async () => {
  // The real `check`, the real resolve, the real guard. Anyone can register an agent whose evidence
  // document points at the cloud metadata endpoint, so this path has to refuse before it connects.
  for (const uri of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:5434/",
    "http://[::1]/x",
    "http://10.0.0.5/x",
    "file:///etc/passwd",
  ]) {
    const r = await check({ uri, feedbackHash: `0x${"00".repeat(32)}` });
    assert.equal(r.verdict.outcome, "unknown", `${uri} must be unknown`);
    assert.equal(r.verdict.rung, "declared");
    assert.equal(r.bytesRead, null);
  }
});

test("the orchestration appends unknown for a blocked document, with the refusal recorded", async () => {
  const h = harness({ runLadder: (uri, hash) => check({ uri, feedbackHash: hash }) }, [
    { id: "143_10182_0xabc_1", feedbackUri: "http://169.254.169.254/latest/meta-data/", feedbackHash: `0x${"00".repeat(32)}`, outcome: "false" },
  ]);
  await reverifyAgent(10182, h.deps);
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0]!.outcome, "unknown");
  assert.match(h.appended[0]!.reason, /link-local|blocked/);
});

/* ------------------------------------------------------------- caps */

test("claims past the delivery budget are counted rather than rounded away", async () => {
  const many = Array.from({ length: 30 }, (_, i) => claim(`143_9_0xabc_${i}`));
  const h = harness({ claimsForAgent: async (_id, limit) => many.slice(0, limit) }, many);
  const res = await handleAlchemyWebhook(post(graphqlBody("d-many", [metadataUpdateLog(9)])), h.deps);
  const body = (await res.json()) as { data: { claimsChecked: number; deferred: number; note: string } };
  assert.equal(body.data.claimsChecked, 25);
  assert.equal(body.data.deferred, 1, "the extra row asked for is what proves there were more");
  assert.match(body.data.note, /were not checked/);
});

/* ------------------------------------------------------------- the GET view */

test("the GET view never reports the signing key itself", async () => {
  const h = harness();
  const res = await describeWebhook(h.deps);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(KEY), "the key must never appear in a response");
  const body = JSON.parse(text) as { data: { signingKeyConfigured: boolean; watching: { contract: string } } };
  assert.equal(body.data.signingKeyConfigured, true);
  assert.equal(body.data.watching.contract, IDENTITY_REGISTRY);

  const off = await describeWebhook(harness({ signingKey: null }).deps);
  const offBody = (await off.json()) as { data: { signingKeyConfigured: boolean } };
  assert.equal(offBody.data.signingKeyConfigured, false);
});

/* ------------------------------------------------------------- against a real Postgres */

/**
 * The ledger and the append path, against the database rather than a fake.
 *
 * The idempotency guard IS a primary key, so testing it in memory proves the shape of the code and
 * not the guarantee. This runs the real DDL, the real `ON CONFLICT` and the real insert in a
 * scratch database created here and dropped afterwards. It refuses to run against the indexer's
 * database, the way the verifier's store tests do, because writing test rows into the live verdict
 * table would put fiction on a public page.
 */
const TEST_DB = "fovea_webhook_test";
const SKIP = "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

function adminConnection(): string | null {
  const env = process.env;
  if (env.FOVEA_DATABASE_URL) return env.FOVEA_DATABASE_URL;
  if (!env.ENVIO_PG_PASSWORD) return null;
  const host = env.ENVIO_PG_HOST ?? "127.0.0.1";
  const port = env.ENVIO_PG_PORT ?? "5434";
  const user = env.ENVIO_PG_USER ?? "postgres";
  const db = env.ENVIO_PG_DATABASE ?? "envio-dev";
  return `postgres://${user}:${encodeURIComponent(env.ENVIO_PG_PASSWORD)}@${host}:${port}/${db}`;
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

const admin = adminConnection();
let scratch: string | null = null;

before(async () => {
  if (!admin) return;
  const client = new pg.Client({ connectionString: withDatabase(admin, "postgres") });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await client.query(`CREATE DATABASE ${TEST_DB}`);
  await client.end();

  scratch = withDatabase(admin, TEST_DB);
  if (new URL(scratch).pathname !== `/${TEST_DB}`) {
    throw new Error(`refusing to write test rows anywhere but ${TEST_DB}`);
  }
  // Every live* function reads its connection through lib/db.ts, so pointing that at the scratch
  // database here is what keeps these tests off the indexer's one. The pool is built lazily on
  // first query and nothing above this line queries.
  process.env.FOVEA_DATABASE_URL = scratch;

  // fovea.verdict belongs to the verifier's schema file, read rather than restated so this test
  // cannot drift from the real table's CHECK constraints.
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, "../verifier/src/store/schema.sql"), "utf8");
  const setup = new pg.Client({ connectionString: scratch });
  await setup.connect();
  await setup.query(schema);
  await setup.end();
});

after(async () => {
  if (!admin || !scratch) return;
  const pool = (globalThis as { __corneaPool?: pg.Pool }).__corneaPool;
  await pool?.end();
  (globalThis as { __corneaPool?: pg.Pool }).__corneaPool = undefined;
  const client = new pg.Client({ connectionString: withDatabase(admin, "postgres") });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await client.end();
});

test("the delivery key is unique in the database, so a retry cannot win a second insert", { skip: admin ? false : SKIP }, async () => {
  await liveEnsureSchema();
  const input = {
    key: "alchemy:db-1",
    keyedOn: "alchemy-id" as const,
    webhookId: "wh_test",
    eventType: "GRAPHQL",
    receivedAt: new Date("2026-09-23T09:00:00.000Z").toISOString(),
  };

  const first = await liveClaimDelivery(input);
  assert.equal(first.claimed, true);

  // Still running. A concurrent copy must not be handed the key.
  const during = await liveClaimDelivery(input);
  assert.equal(during.claimed, false);
  if (!during.claimed) assert.equal(during.prior.status, "running");

  await liveFinishDelivery(input.key, {
    status: "done",
    agentIds: [10182],
    claimsChecked: 2,
    verdictsAppended: 2,
    changed: 1,
    note: "2 claim(s) re-checked, 1 verdict(s) moved",
    finishedAt: new Date("2026-09-23T09:00:05.000Z").toISOString(),
  });

  const replay = await liveClaimDelivery(input);
  assert.equal(replay.claimed, false);
  if (!replay.claimed) {
    assert.equal(replay.prior.status, "done");
    assert.equal(replay.prior.verdictsAppended, 2);
    assert.deepEqual(replay.prior.agentIds, [10182]);
  }

  // A failed attempt is the one case a retry may re-claim.
  await liveFinishDelivery(input.key, {
    status: "failed",
    agentIds: [],
    claimsChecked: 0,
    verdictsAppended: 0,
    changed: 0,
    note: "RPC timed out",
    finishedAt: new Date("2026-09-23T09:00:06.000Z").toISOString(),
  });
  const afterFailure = await liveClaimDelivery(input);
  assert.equal(afterFailure.claimed, true);

  const recent = await liveRecentDeliveries(5);
  assert.ok(recent.some((r) => r.deliveryKey === input.key));
});

test("a re-check appends a row and never replaces one", { skip: admin ? false : SKIP }, async () => {
  await liveEnsureSchema();
  const feedbackId = "143_10182_0xdb_1";
  const base = {
    feedbackId,
    feedbackUri: "https://example.test/doc.json",
    reason: "the cited transaction was not found on the network this document names",
  };

  const firstId = await liveAppendVerdict({
    ...base,
    rung: "parsed",
    outcome: "false",
    checkedAt: new Date("2026-09-20T10:00:00.000Z").toISOString(),
    checkedAtBlock: "106400000",
  });
  const secondId = await liveAppendVerdict({
    ...base,
    rung: "true",
    outcome: "true",
    reason: "cited transaction is on Monad at block 106470000",
    checkedAt: new Date("2026-09-23T09:00:00.000Z").toISOString(),
    checkedAtBlock: "106470718",
    foundChain: "Monad",
    foundChainId: 143,
    foundBlock: "106470000",
  });
  assert.notEqual(firstId, secondId);

  const pool = new pg.Pool({ connectionString: scratch! });
  try {
    const all = await pool.query(
      "SELECT outcome, automatic FROM fovea.verdict WHERE feedback_id = $1 ORDER BY checked_at ASC",
      [feedbackId],
    );
    assert.deepEqual(all.rows.map((r) => r.outcome), ["false", "true"], "both rows survive, which is the correction trail");
    assert.deepEqual(all.rows.map((r) => r.automatic), [true, true], "a webhook re-check ran on its own");

    // What /status reads. The change is visible without anything else being touched.
    const latest = await pool.query("SELECT outcome FROM fovea.verdict_latest WHERE feedback_id = $1", [feedbackId]);
    assert.equal(latest.rows[0]!.outcome, "true");
  } finally {
    await pool.end();
  }
});

test("the table refuses an outcome the ladder cannot produce", { skip: admin ? false : SKIP }, async () => {
  await liveEnsureSchema();
  await assert.rejects(
    () =>
      liveAppendVerdict({
        feedbackId: "143_10182_0xdb_2",
        feedbackUri: "https://example.test/doc.json",
        rung: "parsed",
        outcome: "probably" as never,
        reason: "x",
        checkedAt: new Date().toISOString(),
      }),
    /violates check constraint/,
    "the CHECK constraint is the last line of defence whichever writer sent the row",
  );
});
