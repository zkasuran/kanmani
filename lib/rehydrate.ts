/**
 * Self-healing re-verification: the trigger that was missing.
 *
 * The append-only verdict store already supported this. A repaired document was always meant to
 * read as `false -> true` with both timestamps kept, `/status` already lists every verdict that
 * changed and `/claim/<id>` already renders the history. What did not exist was anything to start
 * the re-check, so it had to be started by hand. This file is that trigger.
 *
 * An Alchemy webhook on the Identity Registry fires when an agent's metadata changes. That is the
 * signal the off-chain document may be different from the one we judged. We re-run the same ladder
 * the sweep and the CLI run, then append a new verdict per claim. Nothing is updated in place.
 *
 * ## What this file contains and what it deliberately does not
 *
 * No verification logic. `runLadder` defaults to `check()` in `lib/check.ts`, which resolves the
 * document through the SSRF guard and hands the bytes to the same `judge()` everything else uses.
 * A second ladder "for the webhook, but simpler" is how a site ends up disagreeing with its own
 * tool, so there is not one. Every network read this path triggers goes through
 * `verifier/src/net/fetch.ts` for the same reason.
 *
 * ## The endpoint is public and unauthenticated, so the payload is hostile
 *
 * Every field is checked for type before use and read by literal key. Nothing is indexed by a
 * string that came out of the body. A log from a contract that is not the Identity Registry is
 * refused rather than trusted, because the webhook's configuration is not something this code can
 * see. An agent id that does not fit in a safe integer is refused rather than truncated.
 *
 * ## Confirmed against Alchemy's live documentation on 2026-09-23
 *
 * Read rather than remembered, because the whole value of this endpoint is that it rejects
 * anything it did not sign for:
 *
 *  - The header is `X-Alchemy-Signature`, read lowercase off the request.
 *  - The algorithm is HMAC SHA-256 keyed with the webhook's own signing key, hex encoded.
 *    TypeScript `hmac.digest("hex")`, Python `.hexdigest()`, Go `hex.EncodeToString`.
 *  - The input is the **raw string body**. Alchemy's own sample says "must be raw string body, not
 *    json transformed version of the body", which is why `handleAlchemyWebhook` reads `req.text()`
 *    before anything parses JSON. Re-serialising an object changes key order plus whitespace and
 *    the digest with it.
 *  - Alchemy's samples compare with plain equality (`signature === digest`). We use
 *    `timingSafeEqual` instead. A byte-at-a-time comparison against a secret-derived value leaks
 *    how much of a guess was right, which is enough to find the rest.
 *  - Both payload shapes carry `webhookId`, `id`, `createdAt`, `type` plus `event` at the top
 *    level, where `id` is the id of the delivery. Custom webhooks report `type: "GRAPHQL"` with
 *    logs under `event.data.block.logs`. Address Activity reports `type: "ADDRESS_ACTIVITY"` with
 *    `event.activity[].log` carrying `address`, `topics`, `data`. Both are accepted.
 *
 * ## The event name is read off the vendored ABI, not guessed
 *
 * `indexer/abis/IdentityRegistry.json` declares `MetadataUpdate(uint256 _tokenId)`, which is
 * ERC-4906 and is absent from the ERC-8004 draft. Its `_tokenId` is **not** indexed, so the agent
 * id arrives in `data` rather than in a topic. `URIUpdated(uint256 agentId, string newURI, address
 * updatedBy)` indexes `agentId`, so that one arrives in `topics[1]`. Getting those two the same way
 * round would read a string offset as an agent id. Both topic hashes below are computed from the
 * signature at load rather than pasted. A test pins them to the values
 * `indexer/config.yaml` recorded from the chain.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { keccak256, toHex } from "viem";
import { envelope, json, problem, SITE } from "./api.ts";
import { readBodyText } from "./body.ts";
import { check, type CheckResult } from "./check.ts";
import { CHAIN_ID, q, q1 } from "./db.ts";
import type { Outcome, Rung } from "./queries.ts";

/** The env var holding the webhook's signing key. Read at runtime, never defaulted to a literal. */
export const SIGNING_KEY_ENV = "ALCHEMY_WEBHOOK_SIGNING_KEY";

/** Confirmed on Alchemy's docs 2026-09-23. Read lowercase because headers are case insensitive. */
export const SIGNATURE_HEADER = "x-alchemy-signature";

/**
 * The ERC-8004 Identity Registry on Monad mainnet, copied from `indexer/config.yaml`.
 *
 * A webhook delivery names the contract each log came from. We check it rather than assume the
 * webhook was pointed at the right address, because the dashboard configuration is not visible
 * from here and a log from somewhere else must not move a verdict.
 */
export const IDENTITY_REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

/** ERC-4906. `_tokenId` is not indexed, so the agent id is the first word of `data`. */
export const METADATA_UPDATE_TOPIC = keccak256(toHex("MetadataUpdate(uint256)"));

/** The registry's own URI change. `agentId` is indexed here, so it is `topics[1]`. */
export const URI_UPDATED_TOPIC = keccak256(toHex("URIUpdated(uint256,string,address)"));

/**
 * How many agents one delivery may re-verify and how many of an agent's claims.
 *
 * Both are real limits rather than round numbers. Agent 9 carries 518 claims that point at a
 * document and fetching all of them inside one webhook request would time the delivery out, which
 * would look to Alchemy like a failure and earn a retry that timed out the same way. Whatever does
 * not fit is reported in the response with its count rather than dropped quietly.
 */
export const MAX_AGENTS_PER_DELIVERY = 25;
export const MAX_CLAIMS_PER_AGENT = 25;

/* ------------------------------------------------------------------ signature */

export function signingKeyFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  const k = env[SIGNING_KEY_ENV];
  return typeof k === "string" && k.trim() !== "" ? k : null;
}

/**
 * Check the delivery signature. Hex HMAC SHA-256 over the raw body, compared in constant time.
 *
 * The length test above the compare leaks nothing: a sha256 hex digest is always 64 characters, so
 * a different length is a malformed header rather than a near miss. `timingSafeEqual` throws on
 * mismatched lengths, which is why the test is there at all.
 */
export function verifySignature(rawBody: string, header: string | null, signingKey: string): boolean {
  if (typeof header !== "string") return false;
  const given = Buffer.from(header.trim(), "utf8");
  const expected = Buffer.from(
    createHmac("sha256", signingKey).update(rawBody, "utf8").digest("hex"),
    "utf8",
  );
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/* ------------------------------------------------------------------ payload */

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

/** One log, flattened out of whichever payload shape carried it. */
export type WebhookLog = {
  address: string;
  topics: string[];
  data: string;
  txHash: string | null;
};

export type AlchemyDelivery = {
  /** Alchemy's own id for this delivery. Empty when the payload omitted it. */
  id: string;
  webhookId: string;
  type: string;
  createdAt: string;
  logs: WebhookLog[];
};

export type ParseResult =
  | { ok: true; delivery: AlchemyDelivery }
  | { ok: false; reason: string };

/**
 * Turn a delivery body into the few fields this endpoint acts on.
 *
 * Rebuilt field by field rather than cast, so an unexpected key cannot ride along into anything
 * downstream. A body that is the right JSON but the wrong shape is refused with what was missing,
 * because a webhook that accepts a payload it cannot read is a webhook that returns 200 and does
 * nothing.
 */
export function parseDelivery(body: unknown): ParseResult {
  const top = asObject(body);
  if (!top) return { ok: false, reason: "body is not a JSON object" };

  const type = asString(top.type);
  if (type === null) return { ok: false, reason: "type is missing or not a string" };

  const event = asObject(top.event);
  if (!event) return { ok: false, reason: "event is missing or not an object" };

  const logs: WebhookLog[] = [];

  // Custom webhook, type GRAPHQL. Logs sit under event.data.block.logs and name their contract as
  // account.address rather than as address.
  const data = asObject(event.data);
  const block = data ? asObject(data.block) : null;
  const graphLogs = block ? asArray(block.logs) : null;
  if (graphLogs) {
    for (const raw of graphLogs) {
      const l = asObject(raw);
      if (!l) continue;
      const account = asObject(l.account);
      const address = account ? asString(account.address) : null;
      const topics = asArray(l.topics);
      if (address === null || topics === null) continue;
      const tx = asObject(l.transaction);
      logs.push({
        address,
        topics: topics.filter((t): t is string => typeof t === "string"),
        data: asString(l.data) ?? "0x",
        txHash: tx ? asString(tx.hash) : null,
      });
    }
  }

  // Address Activity. Each entry carries a flat log with address, topics, data.
  const activity = asArray(event.activity);
  if (activity) {
    for (const raw of activity) {
      const a = asObject(raw);
      if (!a) continue;
      const l = asObject(a.log);
      if (!l) continue;
      const address = asString(l.address);
      const topics = asArray(l.topics);
      if (address === null || topics === null) continue;
      logs.push({
        address,
        topics: topics.filter((t): t is string => typeof t === "string"),
        data: asString(l.data) ?? "0x",
        txHash: asString(l.transactionHash),
      });
    }
  }

  if (!graphLogs && !activity) {
    return {
      ok: false,
      reason:
        "event carries neither data.block.logs (a custom webhook) nor activity[] (address activity), " +
        "so there are no logs to read",
    };
  }

  return {
    ok: true,
    delivery: {
      id: asString(top.id) ?? "",
      webhookId: asString(top.webhookId) ?? "",
      type,
      createdAt: asString(top.createdAt) ?? "",
      logs,
    },
  };
}

/** The first 32-byte word of a hex blob. Null when there is not one. */
function firstWord(hex: string): string | null {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  const body = hex.slice(2);
  return body.length >= 64 ? `0x${body.slice(0, 64)}` : null;
}

/**
 * An agent id out of a 32-byte word.
 *
 * Refused rather than truncated when it will not fit in a safe integer. Agent ids on Monad run to
 * five digits, so anything near 2^53 is a crafted value and `Number()` on it would silently land on
 * a different agent.
 */
export function agentIdFromWord(word: string): number | null {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(word)) return null;
  const n = BigInt(word);
  if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(n);
}

export type Matched = {
  event: "MetadataUpdate" | "URIUpdated";
  agentId: number;
  txHash: string | null;
};

export type Selection = {
  matched: Matched[];
  /** Distinct agent ids, in the order first seen. */
  agentIds: number[];
  logsSeen: number;
  /** Logs refused with the reason, kept so a delivery that did nothing can say why. */
  refused: { reason: string; topic: string | null }[];
};

/**
 * Pick the logs worth acting on out of a delivery.
 *
 * Three refusals, each recorded rather than skipped. A log from another contract cannot move a
 * verdict. A topic we do not handle is not an error and is not a reason to act. An agent id that
 * does not parse is refused by name, because a delivery that quietly matched nothing is the failure
 * this endpoint exists to avoid.
 */
export function selectAgents(logs: readonly WebhookLog[]): Selection {
  const matched: Matched[] = [];
  const refused: { reason: string; topic: string | null }[] = [];
  const seen = new Set<number>();
  const agentIds: number[] = [];

  for (const l of logs) {
    const topic0 = l.topics[0] ?? null;
    if (l.address.toLowerCase() !== IDENTITY_REGISTRY) {
      refused.push({ reason: `log is from ${l.address.toLowerCase()}, not the Identity Registry`, topic: topic0 });
      continue;
    }
    if (topic0 === null) {
      refused.push({ reason: "log carries no topics", topic: null });
      continue;
    }

    const t = topic0.toLowerCase();
    let agentId: number | null = null;
    let name: Matched["event"] | null = null;

    if (t === METADATA_UPDATE_TOPIC) {
      // ERC-4906 does not index _tokenId, so the id is the first word of the data blob.
      name = "MetadataUpdate";
      const word = firstWord(l.data);
      agentId = word === null ? null : agentIdFromWord(word);
    } else if (t === URI_UPDATED_TOPIC) {
      // URIUpdated indexes agentId, so it is topics[1] and the data holds the new URI string.
      name = "URIUpdated";
      const word = l.topics[1] ?? null;
      agentId = word === null ? null : agentIdFromWord(word);
    } else {
      refused.push({ reason: "topic is not MetadataUpdate or URIUpdated", topic: t });
      continue;
    }

    if (agentId === null) {
      refused.push({ reason: `${name} log carried no readable agent id`, topic: t });
      continue;
    }

    matched.push({ event: name, agentId, txHash: l.txHash });
    if (!seen.has(agentId)) {
      seen.add(agentId);
      agentIds.push(agentId);
    }
  }

  return { matched, agentIds, logsSeen: logs.length, refused };
}

/* ------------------------------------------------------------------ idempotency */

export type KeyedOn = "alchemy-id" | "body-sha256";

/**
 * The key a retry is recognised by.
 *
 * Alchemy sends its own delivery id as `id`, so that is what we key on. When a payload arrives
 * without one we hash the raw body instead, which is weaker (two genuinely distinct deliveries with
 * identical bytes would collide) and is recorded as the weaker choice rather than presented as the
 * same thing.
 */
export function deliveryKeyFor(delivery: AlchemyDelivery, rawBody: string): { key: string; keyedOn: KeyedOn } {
  if (delivery.id.trim() !== "") {
    return { key: `alchemy:${delivery.id.trim()}`, keyedOn: "alchemy-id" };
  }
  return { key: `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`, keyedOn: "body-sha256" };
}

export type DeliveryStatus = "running" | "done" | "ignored" | "failed";

export type DeliveryRow = {
  deliveryKey: string;
  keyedOn: KeyedOn;
  webhookId: string;
  eventType: string;
  status: DeliveryStatus;
  agentIds: number[];
  claimsChecked: number;
  verdictsAppended: number;
  changed: number;
  note: string;
  receivedAt: string;
  finishedAt: string | null;
};

/**
 * The delivery ledger.
 *
 * `delivery_key` is the primary key, so the idempotency guard is the database's own uniqueness
 * rather than a read followed by a write. Two copies of one retry arriving at the same instant
 * cannot both win an insert.
 *
 * The DDL lives here rather than in `verifier/src/store/schema.sql` because that file belongs to
 * the verifier package and this table belongs to the web surface. Idempotent, run once per process,
 * which is the pattern `VerdictStore.open` already uses.
 */
const DELIVERY_DDL = `
CREATE SCHEMA IF NOT EXISTS fovea;

CREATE TABLE IF NOT EXISTS fovea.webhook_delivery (
  delivery_key      text        PRIMARY KEY,
  keyed_on          text        NOT NULL CHECK (keyed_on IN ('alchemy-id','body-sha256')),
  webhook_id        text        NOT NULL,
  event_type        text        NOT NULL,
  status            text        NOT NULL CHECK (status IN ('running','done','ignored','failed')),
  agent_ids         integer[]   NOT NULL DEFAULT '{}',
  claims_checked    integer     NOT NULL DEFAULT 0,
  verdicts_appended integer     NOT NULL DEFAULT 0,
  changed           integer     NOT NULL DEFAULT 0,
  note              text        NOT NULL,
  received_at       timestamptz NOT NULL,
  finished_at       timestamptz
);

CREATE INDEX IF NOT EXISTS webhook_delivery_received
  ON fovea.webhook_delivery (received_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export function liveEnsureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = q(DELIVERY_DDL).then(() => undefined);
  return schemaReady;
}

function toDeliveryRow(x: Record<string, unknown>): DeliveryRow {
  return {
    deliveryKey: x.delivery_key as string,
    keyedOn: x.keyed_on as KeyedOn,
    webhookId: (x.webhook_id as string) ?? "",
    eventType: (x.event_type as string) ?? "",
    status: x.status as DeliveryStatus,
    agentIds: Array.isArray(x.agent_ids) ? (x.agent_ids as unknown[]).map(Number) : [],
    claimsChecked: Number(x.claims_checked ?? 0),
    verdictsAppended: Number(x.verdicts_appended ?? 0),
    changed: Number(x.changed ?? 0),
    note: (x.note as string) ?? "",
    receivedAt: new Date(x.received_at as string).toISOString(),
    finishedAt: x.finished_at == null ? null : new Date(x.finished_at as string).toISOString(),
  };
}

export type ClaimOutcome =
  | { claimed: true }
  /** Somebody already holds this key. `prior` says what happened the first time. */
  | { claimed: false; prior: DeliveryRow };

/**
 * Claim a delivery key. Report who already holds it when the claim fails.
 *
 * `ON CONFLICT` re-claims a key whose previous attempt **failed** and leaves a `done` or `ignored`
 * one alone. That is the difference between a retry that repairs a dropped delivery and a retry
 * that appends a second copy of a verdict we already recorded. A key still marked `running` is a
 * delivery in flight, so the caller answers 409 rather than racing it.
 */
export async function liveClaimDelivery(input: {
  key: string;
  keyedOn: KeyedOn;
  webhookId: string;
  eventType: string;
  receivedAt: string;
}): Promise<ClaimOutcome> {
  const inserted = await q1<Record<string, unknown>>(
    `INSERT INTO fovea.webhook_delivery
       (delivery_key, keyed_on, webhook_id, event_type, status, note, received_at)
     VALUES ($1,$2,$3,$4,'running','accepted, re-verification running',$5)
     ON CONFLICT (delivery_key) DO UPDATE
       SET status = 'running',
           received_at = $5,
           finished_at = NULL,
           note = 'earlier attempt failed, retried'
       WHERE fovea.webhook_delivery.status = 'failed'
     RETURNING *`,
    [input.key, input.keyedOn, input.webhookId, input.eventType, input.receivedAt],
  );
  if (inserted) return { claimed: true };

  const prior = await q1<Record<string, unknown>>(
    "SELECT * FROM fovea.webhook_delivery WHERE delivery_key = $1",
    [input.key],
  );
  if (!prior) {
    // The insert returned nothing and the row is not there either. Said out loud rather than
    // treated as a fresh delivery, because guessing here is how a retry double-appends.
    throw new Error(`delivery ${input.key} could neither be claimed nor read back`);
  }
  return { claimed: false, prior: toDeliveryRow(prior) };
}

export type DeliveryFinish = {
  status: Exclude<DeliveryStatus, "running">;
  agentIds: number[];
  claimsChecked: number;
  verdictsAppended: number;
  changed: number;
  note: string;
  finishedAt: string;
};

export async function liveFinishDelivery(key: string, f: DeliveryFinish): Promise<void> {
  await q(
    `UPDATE fovea.webhook_delivery
        SET status = $2, agent_ids = $3, claims_checked = $4, verdicts_appended = $5,
            changed = $6, note = $7, finished_at = $8
      WHERE delivery_key = $1`,
    [key, f.status, f.agentIds, f.claimsChecked, f.verdictsAppended, f.changed, f.note, f.finishedAt],
  );
}

export async function liveRecentDeliveries(limit = 20): Promise<DeliveryRow[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT * FROM fovea.webhook_delivery ORDER BY received_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map(toDeliveryRow);
}

/* ------------------------------------------------------------------ the re-check */

export type ClaimTarget = {
  id: string;
  feedbackUri: string;
  feedbackHash: string;
  /** The verdict we hold now, so the response can report what moved. Null means never checked. */
  outcome: Outcome | null;
};

/**
 * The claims of one agent, worst first.
 *
 * Ordering by "not currently true" is the whole point of the trigger. A metadata update is most
 * likely a repair, so the claims worth spending a capped budget on are the ones a repair would
 * move. A claim already reading `true` gains the least from being checked again.
 */
export const CLAIMS_FOR_AGENT_SQL = `
SELECT f.id, f."feedbackUri", f."feedbackHash", v.outcome
  FROM "Feedback" f
  JOIN "Agent" a ON a.id = f.agent_id
  LEFT JOIN fovea.verdict_latest v ON v.feedback_id = f.id
 WHERE f."chainId" = $1 AND a."chainId" = $1 AND a."agentId" = $2 AND f."feedbackUri" <> ''
 ORDER BY (v.outcome IS DISTINCT FROM 'true') DESC, f."blockNumber" DESC, f.id
 LIMIT $3`;

export async function liveClaimsForAgent(agentNumber: number, limit: number): Promise<ClaimTarget[]> {
  const rows = await q<Record<string, unknown>>(CLAIMS_FOR_AGENT_SQL, [CHAIN_ID, agentNumber, limit]);
  return rows.map((x) => ({
    id: x.id as string,
    feedbackUri: (x.feedbackUri as string) ?? "",
    feedbackHash: (x.feedbackHash as string) ?? "",
    outcome: (x.outcome as Outcome | null) ?? null,
  }));
}

/**
 * Whether the index has ever seen this agent.
 *
 * Kept apart from the claim list so "we have not indexed this agent yet" and "this agent has no
 * document to check" stay separate answers. The first is our gap and a retry fixes it. The second
 * is a fact about the agent and no amount of retrying changes it.
 */
export async function liveAgentExists(agentNumber: number): Promise<boolean> {
  const r = await q1<{ id: string }>(
    `SELECT id FROM "Agent" WHERE "chainId" = $1 AND "agentId" = $2 LIMIT 1`,
    [CHAIN_ID, agentNumber],
  );
  return Boolean(r);
}

export type AppendRow = {
  feedbackId: string;
  feedbackUri: string;
  rung: Rung;
  outcome: Outcome;
  reason: string;
  declaredNetwork?: string;
  declaredTx?: string;
  mapping?: string;
  hashMatches?: boolean;
  computedHash?: string;
  foundChain?: string;
  foundChainId?: number;
  foundBlock?: string;
  checkedAt: string;
  checkedAtBlock?: string;
};

/**
 * Append a verdict. There is no update counterpart here, the same way there is none in
 * `VerdictStore`.
 *
 * The insert is written against the app's own pool rather than routed through `VerdictStore`
 * because that class opens a second pool and reads `schema.sql` off disk relative to its own
 * module, which is not a safe assumption inside a bundled server build. The column list and the
 * append-only rule are the same. The table's own CHECK constraints refuse a bad rung whichever
 * writer sent the row.
 */
export async function liveAppendVerdict(v: AppendRow): Promise<number> {
  const r = await q1<{ id: string }>(
    `INSERT INTO fovea.verdict
       (feedback_id, feedback_uri, rung, outcome, reason,
        declared_network, declared_tx, mapping, hash_matches, computed_hash,
        found_chain, found_chain_id, found_block, checked_at, checked_at_block, automatic)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)
     RETURNING id`,
    [
      v.feedbackId,
      v.feedbackUri,
      v.rung,
      v.outcome,
      v.reason,
      v.declaredNetwork ?? null,
      v.declaredTx ?? null,
      v.mapping ?? null,
      v.hashMatches ?? null,
      v.computedHash ?? null,
      v.foundChain ?? null,
      v.foundChainId ?? null,
      v.foundBlock ?? null,
      v.checkedAt,
      v.checkedAtBlock ?? null,
    ],
  );
  return Number(r!.id);
}

/**
 * A re-check that did not complete, as a verdict.
 *
 * `unknown`, always. There is deliberately no branch in this function that can return `false`. A
 * failure to look is not evidence that a payment did not happen. A webhook that turned our own
 * timeout into a negative verdict about somebody else would be the worst bug this project could
 * ship.
 */
export function couldNotCheck(
  reason: string,
  checkedAt: string,
): { rung: Rung; outcome: Outcome; reason: string; checkedAt: string } {
  return {
    rung: "declared",
    outcome: "unknown",
    reason: `re-check did not complete: ${reason}`,
    checkedAt,
  };
}

/**
 * Refuse a verdict whose outcome outruns its evidence. Returns the refusal. Null when it holds.
 *
 * Both rules are read off `verifier/src/ladder/verdict.ts`, which produces `false` in exactly one
 * place: the `parsed` rung, after a chain read that returned a head block. So a `false` arriving
 * from any other rung did not come from the ladder. Neither did one carrying no block. Neither
 * gets written. Exported because this one branch is the honesty position and a refactor that
 * widened it would be invisible in a diff.
 */
export function refuseUnsupportedOutcome(v: { outcome: Outcome; rung: Rung; checkedAtBlock?: string }): string | null {
  if (v.outcome !== "false") return null;
  if (v.rung !== "parsed") {
    return `a false verdict can only come from the parsed rung, this one says ${v.rung}`;
  }
  if (!v.checkedAtBlock) {
    return "a false verdict needs the block it was read at, because a negative means nothing without saying where we looked";
  }
  return null;
}

export type ClaimResult = {
  claimId: string;
  before: Outcome | null;
  after: Outcome;
  rung: Rung;
  reason: string;
  changed: boolean;
  verdictId: number;
};

export type AgentResult = {
  agentId: number;
  /** False when the index has never seen this agent, which is our gap rather than theirs. */
  known: boolean;
  claimsFound: number;
  deferred: number;
  claims: ClaimResult[];
};

export type Deps = {
  now: () => Date;
  signingKey: string | null;
  ensureSchema: () => Promise<void>;
  claimDelivery: (input: {
    key: string;
    keyedOn: KeyedOn;
    webhookId: string;
    eventType: string;
    receivedAt: string;
  }) => Promise<ClaimOutcome>;
  finishDelivery: (key: string, f: DeliveryFinish) => Promise<void>;
  recentDeliveries: (limit: number) => Promise<DeliveryRow[]>;
  agentExists: (agentNumber: number) => Promise<boolean>;
  claimsForAgent: (agentNumber: number, limit: number) => Promise<ClaimTarget[]>;
  /** Defaults to the ladder in `lib/check.ts`. Never a second implementation of it. */
  runLadder: (uri: string, feedbackHash: string) => Promise<CheckResult>;
  appendVerdict: (row: AppendRow) => Promise<number>;
};

export function liveDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  return {
    now: () => new Date(),
    signingKey: signingKeyFrom(env),
    ensureSchema: liveEnsureSchema,
    claimDelivery: liveClaimDelivery,
    finishDelivery: liveFinishDelivery,
    recentDeliveries: liveRecentDeliveries,
    agentExists: liveAgentExists,
    claimsForAgent: liveClaimsForAgent,
    runLadder: (uri, feedbackHash) => check({ uri, feedbackHash }),
    appendVerdict: liveAppendVerdict,
  };
}

/**
 * Re-run the ladder over one agent's claims and append what came back.
 *
 * Every claim gets a row. A claim whose document still fails appends an `unknown` with the reason,
 * because the store is a record of measurements and "we looked again and still could not read it"
 * is a measurement. The alternative, writing only the rows that improved, would make the history
 * lie by omission.
 */
export async function reverifyAgent(agentId: number, deps: Deps, limit = MAX_CLAIMS_PER_AGENT): Promise<AgentResult> {
  if (!(await deps.agentExists(agentId))) {
    return { agentId, known: false, claimsFound: 0, deferred: 0, claims: [] };
  }

  // One extra row is asked for so the response can say how many were left rather than implying
  // the cap was exactly enough.
  const found = await deps.claimsForAgent(agentId, limit + 1);
  const targets = found.slice(0, limit);
  const results: ClaimResult[] = [];

  for (const t of targets) {
    const checkedAt = deps.now().toISOString();
    let row: AppendRow;

    try {
      const r = await deps.runLadder(t.feedbackUri, t.feedbackHash);
      const refusal = refuseUnsupportedOutcome(r.verdict);
      if (refusal) {
        // The ladder handed back something it should not be able to produce. Recorded as unknown
        // and never as the outcome it claimed.
        row = { feedbackId: t.id, feedbackUri: t.feedbackUri, ...couldNotCheck(refusal, checkedAt) };
      } else {
        row = {
          feedbackId: t.id,
          feedbackUri: t.feedbackUri,
          rung: r.verdict.rung,
          outcome: r.verdict.outcome,
          reason: r.verdict.reason,
          declaredNetwork: r.verdict.declaredNetwork,
          declaredTx: r.verdict.declaredTx,
          mapping: r.verdict.mapping,
          hashMatches: r.verdict.hashMatches,
          computedHash: r.verdict.computedHash,
          foundChain: r.verdict.foundOnChain?.chain,
          foundChainId: r.verdict.foundOnChain?.chainId,
          foundBlock: r.verdict.foundOnChain?.blockNumber,
          checkedAt: r.verdict.checkedAt,
          checkedAtBlock: r.verdict.checkedAtBlock,
        };
      }
    } catch (e) {
      row = {
        feedbackId: t.id,
        feedbackUri: t.feedbackUri,
        ...couldNotCheck((e as Error).message ?? String(e), checkedAt),
      };
    }

    const verdictId = await deps.appendVerdict(row);
    results.push({
      claimId: t.id,
      before: t.outcome,
      after: row.outcome,
      rung: row.rung,
      reason: row.reason,
      changed: t.outcome !== null && t.outcome !== row.outcome,
      verdictId,
    });
  }

  return {
    agentId,
    known: true,
    claimsFound: found.length,
    deferred: Math.max(found.length - targets.length, 0),
    claims: results,
  };
}

/* ------------------------------------------------------------------ the handler */

const REFUSED_KEY =
  `this endpoint refuses every request while ${SIGNING_KEY_ENV} is unset. ` +
  "Skipping signature verification because the key is missing would make the endpoint open to anyone.";

function reproduceFor(agentIds: readonly number[]): string {
  if (agentIds.length === 0) return `curl -sS '${SITE}/api/webhooks/alchemy'`;
  return (
    `curl -sS '${SITE}/api/claims?limit=1000' | ` +
    `jq '.data.items[] | select(.agentId==${agentIds[0]}) | {id, outcome, checkedAt}'`
  );
}

/**
 * Take one delivery.
 *
 * The order is the security property. Raw body, then signature, then parse. Anything that parsed
 * the JSON first would be running a parser over unauthenticated input and could not recover the
 * exact bytes the digest covers.
 */
export async function handleAlchemyWebhook(req: Request, deps: Deps = liveDeps()): Promise<Response> {
  if (deps.signingKey === null) {
    return problem(503, "Webhook signing key is not configured", REFUSED_KEY, {
      envVar: SIGNING_KEY_ENV,
      retryable: true,
    });
  }

  // Raw text, before anything parses it, and bounded before it is buffered. The signature is
  // checked over these exact bytes, so the read has to hand back text rather than an object.
  let raw: string;
  const read = await readBodyText(req);
  if (!read.ok) return problem(read.status, read.title, read.detail);
  raw = read.text;

  const header = req.headers.get(SIGNATURE_HEADER);
  if (header === null || header.trim() === "") {
    return problem(401, "Missing signature", `Every delivery must carry ${SIGNATURE_HEADER}.`);
  }
  if (!verifySignature(raw, header, deps.signingKey)) {
    return problem(
      401,
      "Signature does not verify",
      "The HMAC SHA-256 of the raw body under this webhook's signing key does not match " +
        `${SIGNATURE_HEADER}. Nothing was read out of the body and nothing was written.`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "Body is not JSON", "The signature verified and the payload did not parse.");
  }

  const parsed = parseDelivery(body);
  if (!parsed.ok) {
    return problem(400, "Delivery shape not recognised", parsed.reason, {
      accepted: ["GRAPHQL, logs under event.data.block.logs", "ADDRESS_ACTIVITY, logs under event.activity[].log"],
    });
  }
  const delivery = parsed.delivery;
  const { key, keyedOn } = deliveryKeyFor(delivery, raw);
  const receivedAt = deps.now().toISOString();

  await deps.ensureSchema();
  const claim = await deps.claimDelivery({
    key,
    keyedOn,
    webhookId: delivery.webhookId,
    eventType: delivery.type,
    receivedAt,
  });

  if (!claim.claimed) {
    const prior = claim.prior;
    if (prior.status === "running") {
      // Another copy of this delivery is mid-flight. Answering 200 would tell Alchemy the work is
      // done before it is. Doing the work would append a second set of verdicts.
      return problem(
        409,
        "This delivery is already being processed",
        `Delivery ${key} was accepted at ${prior.receivedAt} and has not finished. Retry rather than treating this as a failure.`,
        { deliveryKey: key, keyedOn: prior.keyedOn },
      );
    }
    return json(
      envelope(
        {
          status: "replayed" as const,
          delivery: { key, keyedOn, replay: true },
          verdictsAppended: 0,
          note:
            "This delivery was already processed and nothing was appended. The result of the first " +
            "attempt is below. Keying on Alchemy's own delivery id is what makes a retry safe.",
          prior,
        },
        reproduceFor(prior.agentIds),
      ),
    );
  }

  try {
    const selection = selectAgents(delivery.logs);

    if (selection.agentIds.length === 0) {
      // A delivery this endpoint has no business acting on. Recorded rather than dropped, so a
      // webhook pointed at the wrong contract or the wrong event shows up as rows here instead of
      // as silence.
      await deps.finishDelivery(key, {
        status: "ignored",
        agentIds: [],
        claimsChecked: 0,
        verdictsAppended: 0,
        changed: 0,
        note: `no MetadataUpdate or URIUpdated log from the Identity Registry in ${selection.logsSeen} log(s)`,
        finishedAt: deps.now().toISOString(),
      });
      return json(
        envelope(
          {
            status: "ignored" as const,
            delivery: { key, keyedOn, replay: false },
            logsSeen: selection.logsSeen,
            refused: selection.refused,
            verdictsAppended: 0,
            note:
              "Nothing was re-verified and that is the correct answer for this delivery. The reason " +
              "each log was passed over is listed rather than summarised, because a webhook that " +
              "returns 200 and says nothing is indistinguishable from one that is broken.",
            watching: {
              contract: IDENTITY_REGISTRY,
              events: [
                { name: "MetadataUpdate", topic0: METADATA_UPDATE_TOPIC },
                { name: "URIUpdated", topic0: URI_UPDATED_TOPIC },
              ],
            },
          },
          reproduceFor([]),
        ),
      );
    }

    const agentIds = selection.agentIds.slice(0, MAX_AGENTS_PER_DELIVERY);
    const agentsDeferred = selection.agentIds.length - agentIds.length;
    const agents: AgentResult[] = [];
    for (const id of agentIds) agents.push(await reverifyAgent(id, deps));

    const claimsChecked = agents.reduce((n, a) => n + a.claims.length, 0);
    const changed = agents.reduce((n, a) => n + a.claims.filter((c) => c.changed).length, 0);
    const unknownAgents = agents.filter((a) => !a.known).map((a) => a.agentId);
    const deferred = agents.reduce((n, a) => n + a.deferred, 0) + agentsDeferred;

    // An event for an agent the index has never seen is our gap, not a no-op. Reported as a failed
    // delivery so Alchemy retries it once Retina has caught up, which is the self-healing part
    // working on our own lag rather than only on somebody else's document.
    if (claimsChecked === 0 && unknownAgents.length > 0) {
      await deps.finishDelivery(key, {
        status: "failed",
        agentIds: selection.agentIds,
        claimsChecked: 0,
        verdictsAppended: 0,
        changed: 0,
        note: `the index has not reached agent(s) ${unknownAgents.join(", ")}`,
        finishedAt: deps.now().toISOString(),
      });
      return problem(
        503,
        "The index has not reached this agent yet",
        `Agent(s) ${unknownAgents.join(", ")} are not in this index, so there is nothing to re-verify ` +
          "and nothing was written. This is our lag rather than a fact about the agent. Retry.",
        { deliveryKey: key, agentIds: selection.agentIds, retryable: true },
      );
    }

    await deps.finishDelivery(key, {
      status: "done",
      agentIds: selection.agentIds,
      claimsChecked,
      verdictsAppended: claimsChecked,
      changed,
      note:
        claimsChecked === 0
          ? "no claim of this agent points at a document, so there was nothing to re-check"
          : `${claimsChecked} claim(s) re-checked, ${changed} verdict(s) moved`,
      finishedAt: deps.now().toISOString(),
    });

    return json(
      envelope(
        {
          status: claimsChecked === 0 ? ("nothing-to-recheck" as const) : ("reverified" as const),
          delivery: { key, keyedOn, replay: false },
          matched: selection.matched,
          refused: selection.refused,
          claimsChecked,
          verdictsAppended: claimsChecked,
          changed,
          deferred,
          agents,
          note:
            claimsChecked === 0
              ? "This agent is indexed and none of its feedbacks point at a document, so there is no " +
                "payment claim to check. Nothing was appended and nothing failed."
              : "Every claim above got a new row. Nothing was updated in place, so a repaired document " +
                `reads as a change with both timestamps kept. ${SITE}/status lists every verdict that moved.` +
                (deferred > 0
                  ? ` ${deferred} claim(s) were past this delivery's budget and were not checked, which is ` +
                    "stated rather than rounded away."
                  : ""),
        },
        reproduceFor(agentIds),
      ),
    );
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    // Marked failed on the way out, which is what lets the next retry re-claim the key and do the
    // work. A delivery that threw and stayed marked `running` would be dropped for good.
    try {
      await deps.finishDelivery(key, {
        status: "failed",
        agentIds: [],
        claimsChecked: 0,
        verdictsAppended: 0,
        changed: 0,
        note: message.slice(0, 500),
        finishedAt: deps.now().toISOString(),
      });
    } catch {
      // The ledger write failed too. The 500 below is still the honest answer.
    }
    return problem(500, "Re-verification did not complete", message, {
      deliveryKey: key,
      retryable: true,
      note: "This delivery is recorded as failed, so a retry will be processed rather than treated as a replay.",
    });
  }
}

/**
 * What this endpoint is, plus the last few deliveries.
 *
 * A human opens a webhook URL in a browser before any provider posts to it, so the GET answers
 * rather than 405s. It reports whether a signing key is configured as a boolean. The key itself is
 * never in a response.
 */
export async function describeWebhook(deps: Deps = liveDeps()): Promise<Response> {
  let recent: DeliveryRow[] = [];
  let ledgerError: string | null = null;
  try {
    await deps.ensureSchema();
    recent = await deps.recentDeliveries(20);
  } catch (e) {
    // Logged in full server-side, reported as a fixed line: this endpoint is public and unauthenticated,
    // so the raw database error would hand a stranger our internals.
    console.error("[describeWebhook] ledger read failed:", (e as Error).message ?? String(e));
    ledgerError = "the delivery ledger could not be read";
  }

  return json(
    envelope(
      {
        how: `Alchemy posts here. Every delivery must carry ${SIGNATURE_HEADER}, an HMAC SHA-256 hex digest of the raw body under this webhook's signing key.`,
        signingKeyConfigured: deps.signingKey !== null,
        watching: {
          chain: CHAIN_ID,
          contract: IDENTITY_REGISTRY,
          events: [
            { name: "MetadataUpdate", signature: "MetadataUpdate(uint256)", topic0: METADATA_UPDATE_TOPIC, agentIdFrom: "data" },
            { name: "URIUpdated", signature: "URIUpdated(uint256,string,address)", topic0: URI_UPDATED_TOPIC, agentIdFrom: "topics[1]" },
          ],
        },
        whatItDoes:
          "Re-runs the verification ladder over that agent's claims and appends a verdict per claim. " +
          "Nothing is updated in place, so a repaired document reads as a change with both timestamps kept.",
        idempotency:
          "Keyed on Alchemy's own delivery id, falling back to a sha256 of the raw body when a payload " +
          "carries none. A retry of a finished delivery appends nothing. A retry of a failed one is processed.",
        budget: { maxAgentsPerDelivery: MAX_AGENTS_PER_DELIVERY, maxClaimsPerAgent: MAX_CLAIMS_PER_AGENT },
        recentDeliveries: recent,
        ledgerError,
      },
      `curl -sS '${SITE}/api/webhooks/alchemy'`,
    ),
    ledgerError === null ? {} : { status: 503 },
  );
}
