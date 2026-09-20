/**
 * Every number Cornea puts on a page comes from exactly one query in this file, and every page
 * that shows a number can show the query that produced it.
 *
 * That is not documentation politeness. The entire claim of this project is that somebody else's
 * evidence should be checkable, so ours has to be checkable the same way. A reader with `psql`
 * and the connection string gets the same number we print, by running the string we printed.
 *
 * Two rules hold throughout:
 *
 * **`unknown` is never `0`.** A count that could not be read comes back `null` and renders as
 * "unknown", never as a zero that looks like a measurement. `IndexState.counterSlotCount` is
 * nullable in the indexer's own schema for this reason and it stays nullable here.
 *
 * **A claim we could not check is never a claim we judged.** `outcome` has four values and the
 * page must keep all four apart. Folding `unknown` into `false` would let somebody else's
 * outage publish as our accusation.
 */
import { CHAIN_ID, q, q1 } from "./db.ts";

/** A query and its text, so the page can print what it ran. */
export type Sourced<T> = { readonly sql: string; readonly rows: T };

const src = <T>(sql: string, rows: T): Sourced<T> => ({ sql: sql.trim(), rows });

/* ------------------------------------------------------------------ the population */

export type Population = {
  /** Rows Retina actually holds. */
  agentsIndexed: number;
  /**
   * What the registry's own counter slot says, read by the indexer at `atBlock`.
   * `null` when that read failed. Unknown is not zero.
   */
  counterSlotCount: number | null;
  atBlock: number | null;
  updatedAt: number | null;
  distinctRecords: number;
  feedbacks: number;
  /** Feedbacks carrying any evidence pointer at all. The rest have nothing to check. */
  feedbacksWithUri: number;
  validations: number;
};

const POPULATION_SQL = `
SELECT
  (SELECT count(*) FROM "Agent"        WHERE "chainId" = $1)                          AS agents_indexed,
  (SELECT count(*) FROM "AgentRecord"  WHERE "chainId" = $1)                          AS distinct_records,
  (SELECT count(*) FROM "Feedback"     WHERE "chainId" = $1)                          AS feedbacks,
  (SELECT count(*) FROM "Feedback"     WHERE "chainId" = $1 AND "feedbackUri" <> '')  AS feedbacks_with_uri,
  (SELECT count(*) FROM "Validation"   WHERE "chainId" = $1)                          AS validations,
  s."counterSlotCount", s."atBlock", s."updatedAt"
FROM (SELECT * FROM "IndexState" WHERE "chainId" = $1 LIMIT 1) s`;

export async function population(): Promise<Sourced<Population>> {
  const r = await q1<{
    agents_indexed: string;
    distinct_records: string;
    feedbacks: string;
    feedbacks_with_uri: string;
    validations: string;
    counterSlotCount: string | null;
    atBlock: string | null;
    updatedAt: string | null;
  }>(POPULATION_SQL, [CHAIN_ID]);

  return src(POPULATION_SQL, {
    agentsIndexed: Number(r?.agents_indexed ?? 0),
    distinctRecords: Number(r?.distinct_records ?? 0),
    feedbacks: Number(r?.feedbacks ?? 0),
    feedbacksWithUri: Number(r?.feedbacks_with_uri ?? 0),
    validations: Number(r?.validations ?? 0),
    // Deliberately null-preserving. A failed slot read is unknown and the page says so.
    counterSlotCount: r?.counterSlotCount == null ? null : Number(r.counterSlotCount),
    atBlock: r?.atBlock == null ? null : Number(r.atBlock),
    updatedAt: r?.updatedAt == null ? null : Number(r.updatedAt),
  });
}

/* ------------------------------------------------------------------ the measurement */

export type Outcome = "true" | "false" | "noClaim" | "unknown";
export type Rung = "declared" | "resolvable" | "intact" | "parsed" | "true";

export type Measurement = {
  /** Every claim we hold a current verdict for. */
  verdicts: number;
  /** Documents that assert a payment. The denominator the headline is about. */
  paymentClaims: number;
  /** Of those, the ones whose cited transaction is on the chain the document names. */
  resolve: number;
  /** Of those, the ones whose cited transaction is not there. Never includes an unknown. */
  doNotResolve: number;
  /** Read fine, asserts no payment. Not a gap. */
  noClaim: number;
  /** We could not look or could not read. Split by how far we got, because the two differ. */
  unknownUnreachable: number;
  unknownBytesMoved: number;
  unknownUnparsed: number;
};

const MEASUREMENT_SQL = `
SELECT
  count(*)                                                                   AS verdicts,
  count(*) FILTER (WHERE outcome IN ('true','false'))                        AS payment_claims,
  count(*) FILTER (WHERE outcome = 'true')                                   AS resolve,
  count(*) FILTER (WHERE outcome = 'false')                                  AS do_not_resolve,
  count(*) FILTER (WHERE outcome = 'noClaim')                                AS no_claim,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'declared')          AS unknown_unreachable,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'resolvable')        AS unknown_bytes_moved,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'intact')            AS unknown_unparsed
FROM fovea.verdict_latest`;

export async function measurement(): Promise<Sourced<Measurement>> {
  const r = await q1<Record<string, string>>(MEASUREMENT_SQL);
  const n = (k: string) => Number(r?.[k] ?? 0);
  return src(MEASUREMENT_SQL, {
    verdicts: n("verdicts"),
    paymentClaims: n("payment_claims"),
    resolve: n("resolve"),
    doNotResolve: n("do_not_resolve"),
    noClaim: n("no_claim"),
    unknownUnreachable: n("unknown_unreachable"),
    unknownBytesMoved: n("unknown_bytes_moved"),
    unknownUnparsed: n("unknown_unparsed"),
  });
}

/**
 * Which network the payment claims name, against whether they were found there.
 *
 * Kept as its own query rather than folded into the headline because the answer is the finding:
 * if every claim names one chain, then "wrong chain" is not what is going on and the honest
 * sentence is different from the one this project was built expecting.
 */
export type NetworkSplit = { network: string; resolve: number; doNotResolve: number };

const NETWORK_SPLIT_SQL = `
SELECT coalesce(declared_network, '(none stated)') AS network,
       count(*) FILTER (WHERE outcome = 'true')  AS resolve,
       count(*) FILTER (WHERE outcome = 'false') AS do_not_resolve
FROM fovea.verdict_latest
WHERE outcome IN ('true','false')
GROUP BY 1
ORDER BY 2 + 3 DESC`;

export async function networkSplit(): Promise<Sourced<NetworkSplit[]>> {
  const rows = await q<{ network: string; resolve: string; do_not_resolve: string }>(NETWORK_SPLIT_SQL);
  return src(
    NETWORK_SPLIT_SQL,
    rows.map((r) => ({
      network: r.network,
      resolve: Number(r.resolve),
      doNotResolve: Number(r.do_not_resolve),
    })),
  );
}

/** Which published mapping read each document, and what it decided. Coverage, in the open. */
export type MappingCoverage = { mapping: string; outcome: Outcome; count: number };

const MAPPING_COVERAGE_SQL = `
SELECT coalesce(mapping, '(no mapping reached)') AS mapping, outcome, count(*) AS count
FROM fovea.verdict_latest
GROUP BY 1, 2
ORDER BY count DESC`;

export async function mappingCoverage(): Promise<Sourced<MappingCoverage[]>> {
  const rows = await q<{ mapping: string; outcome: Outcome; count: string }>(MAPPING_COVERAGE_SQL);
  return src(
    MAPPING_COVERAGE_SQL,
    rows.map((r) => ({ mapping: r.mapping, outcome: r.outcome, count: Number(r.count) })),
  );
}

/* ------------------------------------------------------------------ operator clusters */

export type Cluster = {
  uriHash: string;
  uri: string;
  memberCount: number;
  distinctOwners: number;
  kind: string;
  resolves: boolean | null;
  httpStatus: number | null;
  byteLength: number | null;
  parsedName: string | null;
  firstSeenBlock: number;
};

const CLUSTERS_SQL = `
SELECT id AS uri_hash, uri, "memberCount", "distinctOwners", kind,
       resolves, "httpStatus", "byteLength", "parsedName", "firstSeenBlock"
FROM "AgentRecord"
WHERE "chainId" = $1
ORDER BY "memberCount" DESC, "firstSeenBlock" ASC
LIMIT $2 OFFSET $3`;

export async function clusters(limit = 50, offset = 0): Promise<Sourced<Cluster[]>> {
  const rows = await q<Record<string, string | null>>(CLUSTERS_SQL, [CHAIN_ID, limit, offset]);
  return src(
    CLUSTERS_SQL,
    rows.map((r) => ({
      uriHash: r.uri_hash as string,
      uri: (r.uri as string) ?? "",
      memberCount: Number(r.memberCount),
      distinctOwners: Number(r.distinctOwners),
      kind: (r.kind as string) ?? "other",
      resolves: r.resolves === null ? null : (r.resolves as unknown as boolean),
      httpStatus: r.httpStatus === null ? null : Number(r.httpStatus),
      byteLength: r.byteLength === null ? null : Number(r.byteLength),
      parsedName: r.parsedName as string | null,
      firstSeenBlock: Number(r.firstSeenBlock),
    })),
  );
}

/**
 * How the population divides between documents nobody else uses and documents thousands share.
 *
 * The filter a buyer actually wants is "show me agents whose record is unique", so the number
 * behind that filter is computed here rather than left as a claim in prose.
 */
export type ClusterShape = {
  records: number;
  /** Records used by exactly one agent. */
  unique: number;
  /** Agents holding a record nobody else holds. */
  agentsWithUniqueRecord: number;
  /** Agents sharing a record with at least one other agent. */
  agentsInACluster: number;
  largestMemberCount: number;
  largestDistinctOwners: number;
  largestUri: string | null;
  largestResolves: boolean | null;
};

const CLUSTER_SHAPE_SQL = `
WITH r AS (SELECT * FROM "AgentRecord" WHERE "chainId" = $1),
     big AS (SELECT uri, "memberCount", "distinctOwners", resolves FROM r
             ORDER BY "memberCount" DESC LIMIT 1)
SELECT (SELECT count(*) FROM r)                                              AS records,
       (SELECT count(*) FROM r WHERE "memberCount" = 1)                      AS unique_records,
       (SELECT coalesce(sum("memberCount"),0) FROM r WHERE "memberCount" = 1) AS agents_unique,
       (SELECT coalesce(sum("memberCount"),0) FROM r WHERE "memberCount" > 1) AS agents_clustered,
       (SELECT "memberCount"    FROM big) AS largest_members,
       (SELECT "distinctOwners" FROM big) AS largest_owners,
       (SELECT uri              FROM big) AS largest_uri,
       (SELECT resolves         FROM big) AS largest_resolves`;

export async function clusterShape(): Promise<Sourced<ClusterShape>> {
  const r = await q1<Record<string, string | boolean | null>>(CLUSTER_SHAPE_SQL, [CHAIN_ID]);
  return src(CLUSTER_SHAPE_SQL, {
    records: Number(r?.records ?? 0),
    unique: Number(r?.unique_records ?? 0),
    agentsWithUniqueRecord: Number(r?.agents_unique ?? 0),
    agentsInACluster: Number(r?.agents_clustered ?? 0),
    largestMemberCount: Number(r?.largest_members ?? 0),
    largestDistinctOwners: Number(r?.largest_owners ?? 0),
    largestUri: (r?.largest_uri as string | null) ?? null,
    largestResolves: (r?.largest_resolves as boolean | null) ?? null,
  });
}

export type ClusterOwner = { owner: string; agentCount: number; firstSeenBlock: number };

const CLUSTER_OWNERS_SQL = `
SELECT owner, "agentCount", "firstSeenBlock"
FROM "AgentRecordOwner"
WHERE "chainId" = $1 AND record_id = $2
ORDER BY "agentCount" DESC, "firstSeenBlock" ASC
LIMIT $3`;

export async function clusterOwners(uriHash: string, limit = 100): Promise<Sourced<ClusterOwner[]>> {
  const rows = await q<{ owner: string; agentCount: number; firstSeenBlock: string }>(
    CLUSTER_OWNERS_SQL,
    [CHAIN_ID, uriHash, limit],
  );
  return src(
    CLUSTER_OWNERS_SQL,
    rows.map((r) => ({
      owner: r.owner,
      agentCount: Number(r.agentCount),
      firstSeenBlock: Number(r.firstSeenBlock),
    })),
  );
}

export const CLUSTER_SQL = `
SELECT id AS uri_hash, uri, "memberCount", "distinctOwners", kind,
       resolves, "httpStatus", "byteLength", "parsedName", "firstSeenBlock"
FROM "AgentRecord" WHERE "chainId" = $1 AND id = $2`;

export async function cluster(uriHash: string): Promise<Cluster | undefined> {
  const r = await q1<Record<string, string | null>>(CLUSTER_SQL, [CHAIN_ID, uriHash]);
  if (!r) return undefined;
  return {
    uriHash: r.uri_hash as string,
    uri: (r.uri as string) ?? "",
    memberCount: Number(r.memberCount),
    distinctOwners: Number(r.distinctOwners),
    kind: (r.kind as string) ?? "other",
    resolves: r.resolves === null ? null : (r.resolves as unknown as boolean),
    httpStatus: r.httpStatus === null ? null : Number(r.httpStatus),
    byteLength: r.byteLength === null ? null : Number(r.byteLength),
    parsedName: r.parsedName as string | null,
    firstSeenBlock: Number(r.firstSeenBlock),
  };
}

/* ------------------------------------------------------------------ agents */

export type AgentRow = {
  id: string;
  agentId: number;
  owner: string;
  agentWallet: string | null;
  tokenUri: string | null;
  uriHash: string | null;
  name: string | null;
  endpoints: string[];
  declaresX402: boolean;
  registeredAtBlock: number;
  rung: string;
  transferCount: number;
  metadataUpdateCount: number;
  /** From the joined record. Null when the agent declared no document at all. */
  recordMemberCount: number | null;
  recordResolves: boolean | null;
  feedbackCount: number;
};

export type AgentFilter = {
  /** `unique` = nobody else shares this agent's record. The differentiator filter. */
  cluster?: "unique" | "shared" | "any";
  /** Only agents whose record still resolves, or only those whose record is gone. */
  records?: "resolving" | "dead" | "any";
  declaresX402?: boolean;
  /** Only agents carrying at least one feedback with an evidence pointer. */
  withEvidence?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

/**
 * One list, one stated rule, no hidden score.
 *
 * Ordering is evidence first then recency, spelled out on the page in a sentence. There is no
 * secret weighting and there is no star rating, because a star rating over 9,188 feedbacks
 * written largely by one publisher would be a number that looks like consensus and is not.
 */
export const AGENTS_ORDER_RULE =
  "Agents carrying evidence first, then the ones whose record nobody else shares, then most recently registered.";

/**
 * The FROM and WHERE, built once and shared by the list and its count.
 *
 * Shared deliberately. A count computed from a different predicate than the list it labels is
 * the classic way a filtered page ends up saying "312 agents" above 40 rows, and nobody notices
 * because both numbers look plausible on their own.
 */
function agentSource(f: AgentFilter, params: unknown[]): string {
  const where: string[] = [`a."chainId" = $${params.push(CHAIN_ID)}`];
  const p = (v: unknown) => `$${params.push(v)}`;

  if (f.cluster === "unique") where.push(`coalesce(r."memberCount", 1) = 1`);
  if (f.cluster === "shared") where.push(`r."memberCount" > 1`);
  if (f.records === "resolving") where.push(`r.resolves IS TRUE`);
  if (f.records === "dead") where.push(`r.resolves IS FALSE`);
  if (f.declaresX402 === true) where.push(`a."declaresX402" IS TRUE`);
  if (f.withEvidence) where.push(`coalesce(fb.evidence, 0) > 0`);
  if (f.search && f.search.trim()) {
    const raw = f.search.trim();
    const s = `%${raw.toLowerCase()}%`;
    where.push(
      `(lower(coalesce(a.name,'')) LIKE ${p(s)} OR lower(a.owner) LIKE ${p(s)}` +
        ` OR lower(coalesce(a."agentWallet",'')) LIKE ${p(s)}` +
        ` OR lower(coalesce(a."tokenUri",'')) LIKE ${p(s)}` +
        ` OR a."agentId"::text = ${p(raw)})`,
    );
  }

  return `
FROM "Agent" a
LEFT JOIN "AgentRecord" r ON r.id = a."uriHash" AND r."chainId" = a."chainId"
LEFT JOIN (
  SELECT agent_id,
         count(*) AS total,
         count(*) FILTER (WHERE "feedbackUri" <> '') AS evidence
  FROM "Feedback" WHERE "chainId" = ${CHAIN_ID} GROUP BY agent_id
) fb ON fb.agent_id = a.id
WHERE ${where.join(" AND ")}`;
}

export async function agents(f: AgentFilter = {}): Promise<Sourced<AgentRow[]>> {
  const params: unknown[] = [];
  const source = agentSource(f, params);
  const p = (v: unknown) => `$${params.push(v)}`;

  const sql = `
SELECT a.id, a."agentId", a.owner, a."agentWallet", a."tokenUri", a."uriHash", a.name,
       a.endpoints, a."declaresX402", a."registeredAtBlock", a.rung,
       a."transferCount", a."metadataUpdateCount",
       r."memberCount" AS record_members, r.resolves AS record_resolves,
       coalesce(fb.total, 0) AS feedback_count${source}
ORDER BY coalesce(fb.evidence, 0) DESC, coalesce(r."memberCount", 1) ASC, a."agentId" DESC
LIMIT ${p(Math.min(f.limit ?? 50, 500))} OFFSET ${p(f.offset ?? 0)}`;

  const rows = await q<Record<string, never>>(sql, params);
  return src(
    sql,
    rows.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        id: r.id as string,
        agentId: Number(r.agentId),
        owner: r.owner as string,
        agentWallet: (r.agentWallet as string | null) ?? null,
        tokenUri: (r.tokenUri as string | null) ?? null,
        uriHash: (r.uriHash as string | null) ?? null,
        name: (r.name as string | null) ?? null,
        endpoints: (r.endpoints as string[] | null) ?? [],
        declaresX402: Boolean(r.declaresX402),
        registeredAtBlock: Number(r.registeredAtBlock),
        rung: (r.rung as string) ?? "declared",
        transferCount: Number(r.transferCount ?? 0),
        metadataUpdateCount: Number(r.metadataUpdateCount ?? 0),
        recordMemberCount: r.record_members == null ? null : Number(r.record_members),
        recordResolves: (r.record_resolves as boolean | null) ?? null,
        feedbackCount: Number(r.feedback_count ?? 0),
      };
    }),
  );
}

/** The exact count for a filter, computed from the same predicate the list uses. */
export async function agentsCount(f: AgentFilter = {}): Promise<number> {
  const params: unknown[] = [];
  const source = agentSource(f, params);
  const r = await q1<{ count: string }>(`SELECT count(*) AS count${source}`, params);
  return Number(r?.count ?? 0);
}

export async function agent(id: string): Promise<AgentRow | undefined> {
  const rows = await q<Record<string, unknown>>(
    `SELECT a.*, r."memberCount" AS record_members, r.resolves AS record_resolves,
            coalesce(fb.total,0) AS feedback_count
     FROM "Agent" a
     LEFT JOIN "AgentRecord" r ON r.id = a."uriHash" AND r."chainId" = a."chainId"
     LEFT JOIN (SELECT agent_id, count(*) AS total FROM "Feedback"
                WHERE "chainId" = $1 GROUP BY agent_id) fb ON fb.agent_id = a.id
     WHERE a."chainId" = $1 AND (a.id = $2 OR a."agentId"::text = $2)
     LIMIT 1`,
    [CHAIN_ID, id],
  );
  const x = rows[0];
  if (!x) return undefined;
  return {
    id: x.id as string,
    agentId: Number(x.agentId),
    owner: x.owner as string,
    agentWallet: (x.agentWallet as string | null) ?? null,
    tokenUri: (x.tokenUri as string | null) ?? null,
    uriHash: (x.uriHash as string | null) ?? null,
    name: (x.name as string | null) ?? null,
    endpoints: (x.endpoints as string[] | null) ?? [],
    declaresX402: Boolean(x.declaresX402),
    registeredAtBlock: Number(x.registeredAtBlock),
    rung: (x.rung as string) ?? "declared",
    transferCount: Number(x.transferCount ?? 0),
    metadataUpdateCount: Number(x.metadataUpdateCount ?? 0),
    recordMemberCount: x.record_members == null ? null : Number(x.record_members),
    recordResolves: (x.record_resolves as boolean | null) ?? null,
    feedbackCount: Number(x.feedback_count ?? 0),
  };
}

/* ------------------------------------------------------------------ claims and verdicts */

export type ClaimRow = {
  id: string;
  agentId: string;
  agentNumber: number;
  agentName: string | null;
  clientAddress: string;
  feedbackIndex: number;
  value: string;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackUri: string;
  feedbackHash: string;
  revoked: boolean;
  responseUri: string | null;
  responder: string | null;
  blockNumber: number;
  timestamp: number;
  txHash: string;
  /** Latest verdict, when one exists. A claim with no verdict is unchecked, not clean. */
  outcome: Outcome | null;
  rung: Rung | null;
  reason: string | null;
  declaredNetwork: string | null;
  declaredTx: string | null;
  mapping: string | null;
  hashMatches: boolean | null;
  computedHash: string | null;
  foundChain: string | null;
  foundChainId: number | null;
  foundBlock: string | null;
  checkedAt: string | null;
  checkedAtBlock: string | null;
};

const CLAIM_COLUMNS = `
SELECT f.id, f.agent_id, f."clientAddress", f."feedbackIndex", f.value, f."valueDecimals",
       f.tag1, f.tag2, f.endpoint, f."feedbackUri", f."feedbackHash", f.revoked,
       f."responseUri", f.responder, f."blockNumber", f.timestamp, f."txHash",
       a."agentId" AS agent_number, a.name AS agent_name,
       v.outcome, v.rung, v.reason, v.declared_network, v.declared_tx, v.mapping,
       v.hash_matches, v.computed_hash, v.found_chain, v.found_chain_id, v.found_block,
       v.checked_at, v.checked_at_block`;

function toClaim(x: Record<string, unknown>): ClaimRow {
  return {
    id: x.id as string,
    agentId: x.agent_id as string,
    agentNumber: Number(x.agent_number),
    agentName: (x.agent_name as string | null) ?? null,
    clientAddress: x.clientAddress as string,
    feedbackIndex: Number(x.feedbackIndex),
    value: String(x.value ?? "0"),
    valueDecimals: Number(x.valueDecimals ?? 0),
    tag1: (x.tag1 as string) ?? "",
    tag2: (x.tag2 as string) ?? "",
    endpoint: (x.endpoint as string) ?? "",
    feedbackUri: (x.feedbackUri as string) ?? "",
    feedbackHash: (x.feedbackHash as string) ?? "",
    revoked: Boolean(x.revoked),
    responseUri: (x.responseUri as string | null) ?? null,
    responder: (x.responder as string | null) ?? null,
    blockNumber: Number(x.blockNumber),
    timestamp: Number(x.timestamp),
    txHash: (x.txHash as string) ?? "",
    outcome: (x.outcome as Outcome | null) ?? null,
    rung: (x.rung as Rung | null) ?? null,
    reason: (x.reason as string | null) ?? null,
    declaredNetwork: (x.declared_network as string | null) ?? null,
    declaredTx: (x.declared_tx as string | null) ?? null,
    mapping: (x.mapping as string | null) ?? null,
    hashMatches: (x.hash_matches as boolean | null) ?? null,
    computedHash: (x.computed_hash as string | null) ?? null,
    foundChain: (x.found_chain as string | null) ?? null,
    foundChainId: x.found_chain_id == null ? null : Number(x.found_chain_id),
    foundBlock: x.found_block == null ? null : String(x.found_block),
    checkedAt: x.checked_at == null ? null : new Date(x.checked_at as string).toISOString(),
    checkedAtBlock: x.checked_at_block == null ? null : String(x.checked_at_block),
  };
}

export type ClaimFilter = {
  outcome?: Outcome;
  rung?: Rung;
  network?: string;
  mapping?: string;
  agentId?: string;
  /** Only feedbacks that point at a document. The rest have nothing to verify. */
  withUri?: boolean;
  limit?: number;
  offset?: number;
};

/** Shared by the list and its count, for the same reason `agentSource` is. */
function claimSource(f: ClaimFilter, params: unknown[]): string {
  const where: string[] = [`f."chainId" = $${params.push(CHAIN_ID)}`];
  const p = (v: unknown) => `$${params.push(v)}`;

  if (f.withUri !== false) where.push(`f."feedbackUri" <> ''`);
  if (f.outcome) where.push(`v.outcome = ${p(f.outcome)}`);
  if (f.rung) where.push(`v.rung = ${p(f.rung)}`);
  if (f.network) where.push(`v.declared_network = ${p(f.network)}`);
  if (f.mapping) where.push(`v.mapping = ${p(f.mapping)}`);
  if (f.agentId) where.push(`f.agent_id = ${p(f.agentId)}`);

  return `
FROM "Feedback" f
JOIN "Agent" a ON a.id = f.agent_id
LEFT JOIN fovea.verdict_latest v ON v.feedback_id = f.id
WHERE ${where.join(" AND ")}`;
}

export async function claims(f: ClaimFilter = {}): Promise<Sourced<ClaimRow[]>> {
  const params: unknown[] = [];
  const source = claimSource(f, params);
  const p = (v: unknown) => `$${params.push(v)}`;

  const sql = `${CLAIM_COLUMNS}${source}
ORDER BY f."blockNumber" DESC, f.id
LIMIT ${p(Math.min(f.limit ?? 50, 1000))} OFFSET ${p(f.offset ?? 0)}`;

  const rows = await q<Record<string, unknown>>(sql, params);
  return src(sql, rows.map(toClaim));
}

export async function claimsCount(f: ClaimFilter = {}): Promise<number> {
  const params: unknown[] = [];
  const source = claimSource(f, params);
  const r = await q1<{ count: string }>(`SELECT count(*) AS count${source}`, params);
  return Number(r?.count ?? 0);
}

export async function claim(id: string): Promise<ClaimRow | undefined> {
  const rows = await q<Record<string, unknown>>(
    `${CLAIM_COLUMNS}
     FROM "Feedback" f
     JOIN "Agent" a ON a.id = f.agent_id
     LEFT JOIN fovea.verdict_latest v ON v.feedback_id = f.id
     WHERE f."chainId" = $1 AND f.id = $2 LIMIT 1`,
    [CHAIN_ID, id],
  );
  return rows[0] ? toClaim(rows[0]) : undefined;
}

/**
 * Every verdict ever recorded for one claim, oldest first.
 *
 * This is the correction trail and it is why the store has no update path. An operator who
 * repairs a document sees `false -> true` with both timestamps rather than a number quietly
 * improving with no trace that we ever said otherwise.
 */
export type VerdictHistoryRow = {
  id: number;
  rung: Rung;
  outcome: Outcome;
  reason: string;
  checkedAt: string;
  checkedAtBlock: string | null;
  automatic: boolean;
  mapping: string | null;
  foundChain: string | null;
  foundBlock: string | null;
};

export const VERDICT_HISTORY_SQL = `
SELECT id, rung, outcome, reason, checked_at, checked_at_block, automatic,
       mapping, found_chain, found_block
FROM fovea.verdict
WHERE feedback_id = $1
ORDER BY checked_at ASC, id ASC`;

export async function verdictHistory(feedbackId: string): Promise<VerdictHistoryRow[]> {
  const rows = await q<Record<string, unknown>>(VERDICT_HISTORY_SQL, [feedbackId]);
  return rows.map((r) => ({
    id: Number(r.id),
    rung: r.rung as Rung,
    outcome: r.outcome as Outcome,
    reason: r.reason as string,
    checkedAt: new Date(r.checked_at as string).toISOString(),
    checkedAtBlock: r.checked_at_block == null ? null : String(r.checked_at_block),
    automatic: Boolean(r.automatic),
    mapping: (r.mapping as string | null) ?? null,
    foundChain: (r.found_chain as string | null) ?? null,
    foundBlock: r.found_block == null ? null : String(r.found_block),
  }));
}

/**
 * Claims whose verdict has ever changed.
 *
 * A row here is the append-only store earning its keep: either we were wrong and corrected it,
 * or somebody fixed their document and the page moved on its own. Both are worth showing and
 * neither is visible in a store that updates in place.
 */
export type ChangedClaim = {
  feedbackId: string;
  feedbackUri: string;
  from: Outcome;
  to: Outcome;
  firstCheckedAt: string;
  lastCheckedAt: string;
  checks: number;
};

export const CHANGED_SQL = `
WITH ends AS (
  SELECT feedback_id,
         min(checked_at) AS first_at,
         max(checked_at) AS last_at,
         count(*)        AS checks,
         (array_agg(outcome ORDER BY checked_at ASC,  id ASC))[1] AS first_outcome,
         (array_agg(outcome ORDER BY checked_at DESC, id DESC))[1] AS last_outcome,
         (array_agg(feedback_uri ORDER BY checked_at DESC, id DESC))[1] AS uri
  FROM fovea.verdict GROUP BY feedback_id
)
SELECT * FROM ends WHERE first_outcome IS DISTINCT FROM last_outcome
ORDER BY last_at DESC LIMIT $1`;

export async function changedClaims(limit = 50): Promise<Sourced<ChangedClaim[]>> {
  const rows = await q<Record<string, unknown>>(CHANGED_SQL, [limit]);
  return src(
    CHANGED_SQL,
    rows.map((r) => ({
      feedbackId: r.feedback_id as string,
      feedbackUri: (r.uri as string) ?? "",
      from: r.first_outcome as Outcome,
      to: r.last_outcome as Outcome,
      firstCheckedAt: new Date(r.first_at as string).toISOString(),
      lastCheckedAt: new Date(r.last_at as string).toISOString(),
      checks: Number(r.checks),
    })),
  );
}

/** Freshness, for /status. Every number here is about whether the page can be trusted today. */
export type Freshness = {
  latestIndexedBlock: number | null;
  latestFeedbackBlock: number | null;
  indexStateUpdatedAt: number | null;
  verdictsTotal: number;
  claimsWithAVerdict: number;
  claimsWithNoVerdict: number;
  oldestVerdictAt: string | null;
  newestVerdictAt: string | null;
};

export const FRESHNESS_SQL = `
SELECT
  (SELECT "atBlock"     FROM "IndexState" WHERE "chainId" = $1 LIMIT 1) AS index_block,
  (SELECT "updatedAt"   FROM "IndexState" WHERE "chainId" = $1 LIMIT 1) AS index_updated,
  (SELECT max("blockNumber") FROM "Feedback" WHERE "chainId" = $1)      AS feedback_block,
  (SELECT count(*) FROM fovea.verdict)                                  AS verdicts_total,
  (SELECT count(*) FROM fovea.verdict_latest)                           AS with_verdict,
  (SELECT count(*) FROM "Feedback" f WHERE f."chainId" = $1 AND f."feedbackUri" <> ''
     AND NOT EXISTS (SELECT 1 FROM fovea.verdict v WHERE v.feedback_id = f.id)) AS without_verdict,
  (SELECT min(checked_at) FROM fovea.verdict)                           AS oldest,
  (SELECT max(checked_at) FROM fovea.verdict)                           AS newest`;

export async function freshness(): Promise<Sourced<Freshness>> {
  const r = await q1<Record<string, unknown>>(FRESHNESS_SQL, [CHAIN_ID]);
  return src(FRESHNESS_SQL, {
    latestIndexedBlock: r?.index_block == null ? null : Number(r.index_block),
    latestFeedbackBlock: r?.feedback_block == null ? null : Number(r.feedback_block),
    indexStateUpdatedAt: r?.index_updated == null ? null : Number(r.index_updated),
    verdictsTotal: Number(r?.verdicts_total ?? 0),
    claimsWithAVerdict: Number(r?.with_verdict ?? 0),
    claimsWithNoVerdict: Number(r?.without_verdict ?? 0),
    oldestVerdictAt: r?.oldest == null ? null : new Date(r.oldest as string).toISOString(),
    newestVerdictAt: r?.newest == null ? null : new Date(r.newest as string).toISOString(),
  });
}

/* ------------------------------------------------------------------ registration documents */

/**
 * Whether the document an agent's REGISTRATION points at still exists.
 *
 * Read from `fovea.record_probe`, not from `AgentRecord`. The indexer's own enrichment columns
 * are left null on purpose: `public` is dropped on every resync, so an enrichment stored there
 * would cost 2,012 fetches of other people's servers every time our schema changed.
 *
 * A record with no probe row renders as unknown, never as dead. Not having looked is a state.
 */
export type RecordState =
  | "onchain"
  | "answered"
  | "gone"
  | "paywalled"
  | "refused"
  | "nohost"
  | "malformed"
  | "unknown";

export type RecordProbeRow = {
  uriHash: string;
  uri: string;
  scheme: string;
  /**
   * What the probe means, from `fovea.record_state`. One of `onchain`, `answered`, `gone`,
   * `paywalled`, `refused`, `nohost`, `malformed`, `unknown`, or null when nothing has probed
   * this record yet. Never-looked is a state, and it is not `gone`.
   */
  state: RecordState | null;
  reachable: boolean | null;
  httpStatus: number | null;
  byteLength: number | null;
  mediaType: string | null;
  parsedName: string | null;
  reason: string | null;
  checkedAt: string | null;
};

export type ClusterWithProbe = Cluster & RecordProbeRow;

export const CLUSTERS_PROBED_SQL = `
SELECT r.id AS uri_hash, r.uri, r."memberCount", r."distinctOwners", r.kind, r."firstSeenBlock",
       p.scheme, p.reachable, p.http_status, p.byte_length, p.media_type,
       p.parsed_name, p.reason, p.checked_at, p.state
FROM "AgentRecord" r
LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
WHERE r."chainId" = $1
ORDER BY r."memberCount" DESC, r."firstSeenBlock" ASC
LIMIT $2 OFFSET $3`;

function toProbedCluster(x: Record<string, unknown>): ClusterWithProbe {
  return {
    uriHash: x.uri_hash as string,
    uri: (x.uri as string) ?? "",
    memberCount: Number(x.memberCount),
    distinctOwners: Number(x.distinctOwners),
    kind: (x.kind as string) ?? "other",
    firstSeenBlock: Number(x.firstSeenBlock),
    // These four come off AgentRecord and are deliberately never written by the indexer.
    resolves: null,
    httpStatus: x.http_status == null ? null : Number(x.http_status),
    byteLength: x.byte_length == null ? null : Number(x.byte_length),
    parsedName: (x.parsed_name as string | null) ?? null,
    scheme: (x.scheme as string) ?? (x.kind as string) ?? "other",
    reachable: x.reachable === null || x.reachable === undefined ? null : Boolean(x.reachable),
    mediaType: (x.media_type as string | null) ?? null,
    reason: (x.reason as string | null) ?? null,
    state: (x.state as RecordState | null) ?? null,
    checkedAt: x.checked_at == null ? null : new Date(x.checked_at as string).toISOString(),
  };
}

export async function probedClusters(limit = 40, offset = 0): Promise<Sourced<ClusterWithProbe[]>> {
  const rows = await q<Record<string, unknown>>(CLUSTERS_PROBED_SQL, [CHAIN_ID, limit, offset]);
  return src(CLUSTERS_PROBED_SQL, rows.map(toProbedCluster));
}

export async function probedCluster(uriHash: string): Promise<ClusterWithProbe | undefined> {
  const rows = await q<Record<string, unknown>>(
    `SELECT r.id AS uri_hash, r.uri, r."memberCount", r."distinctOwners", r.kind, r."firstSeenBlock",
            p.scheme, p.reachable, p.http_status, p.byte_length, p.media_type,
            p.parsed_name, p.reason, p.checked_at, p.state
     FROM "AgentRecord" r
     LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
     WHERE r."chainId" = $1 AND r.id = $2`,
    [CHAIN_ID, uriHash],
  );
  return rows[0] ? toProbedCluster(rows[0]) : undefined;
}

/**
 * The registry, summed by what its registration documents actually do when asked.
 *
 * Eight buckets rather than two, because the truth has eight states and a boolean would publish
 * a rate limit as a deletion. The one that matters most is `notProbed`: a record nobody has
 * asked about renders as unknown and is never added to either side of a ratio.
 */
export type RegistryHealth = {
  agentsTotal: number;
  recordsTotal: number;
  notProbedRecords: number;
  notProbedAgents: number;
  /**
   * Agents carrying no tokenURI at all, so they have no record row to probe.
   *
   * Counted separately because without it the state buckets sum to 10,172 against a registry of
   * 10,252 and 80 agents quietly vanish off the page. A registration that says nothing about
   * itself is a finding, not a gap in the join.
   */
  agentsWithNoDocument: number;
  byState: { state: RecordState; records: number; agents: number }[];
  probedAt: string | null;
};

export const REGISTRY_HEALTH_SQL = `
SELECT coalesce(p.state, 'not probed') AS state,
       count(*)                        AS records,
       sum(r."memberCount")            AS agents,
       max(p.checked_at)               AS probed_at
FROM "AgentRecord" r
LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
WHERE r."chainId" = $1
GROUP BY 1
ORDER BY agents DESC`;

const STATE_ORDER: RecordState[] = [
  "gone",
  "paywalled",
  "refused",
  "nohost",
  "malformed",
  "unknown",
  "answered",
  "onchain",
];

export async function registryHealth(): Promise<Sourced<RegistryHealth>> {
  const rows = await q<Record<string, unknown>>(REGISTRY_HEALTH_SQL, [CHAIN_ID]);
  const totals = await q1<{ total: string; no_document: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE "uriHash" IS NULL OR "tokenUri" IS NULL OR "tokenUri" = '')
              AS no_document
       FROM "Agent" WHERE "chainId" = $1`,
    [CHAIN_ID],
  );

  const byState = rows
    .filter((r) => r.state !== "not probed")
    .map((r) => ({
      state: r.state as RecordState,
      records: Number(r.records),
      agents: Number(r.agents),
    }))
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));

  const np = rows.find((r) => r.state === "not probed");
  const probedAt = rows
    .map((r) => (r.probed_at == null ? null : new Date(r.probed_at as string).toISOString()))
    .filter((x): x is string => x !== null)
    .sort()
    .pop();

  return src(REGISTRY_HEALTH_SQL, {
    agentsTotal: Number(totals?.total ?? 0),
    agentsWithNoDocument: Number(totals?.no_document ?? 0),
    recordsTotal: rows.reduce((n, r) => n + Number(r.records), 0),
    notProbedRecords: np ? Number(np.records) : 0,
    notProbedAgents: np ? Number(np.agents) : 0,
    byState,
    probedAt: probedAt ?? null,
  });
}

/** What each state means, in one sentence a stranger can check the code against. */
export const STATE_MEANING: Record<RecordState | "not probed", string> = {
  onchain:
    "The document is written into tokenURI itself. There is no host to ask, so it cannot be deleted later.",
  answered: "The document was fetched and read.",
  gone: "The host answered and said the document is not there.",
  paywalled: "The host is alive and returned HTTP 402, asking for payment before it will serve the document.",
  refused: "The host is alive and will not serve the document to us.",
  nohost: "The domain in the URI no longer resolves to any host.",
  malformed: "The URI was never a usable pointer. Nothing was deleted, because it could not have worked.",
  unknown:
    "We could not find out. A rate limit, a timeout, a server error or a document past our own size cap. Never an accusation.",
  "not probed": "Nothing has asked about this document yet. Not having looked is a state, and it is not a failure.",
};

/**
 * Hosts, ranked by how many agents depend on them.
 *
 * A host is a single point of failure that thousands of registrations share, usually without
 * their operators knowing about each other. Ranking by agents rather than by records is
 * deliberate: one host with two URLs and 8,094 agents behind it matters more than one with 762
 * URLs and 762 agents.
 */
export type HostRow = {
  host: string;
  records: number;
  agents: number;
  answered: number;
  gone: number;
  paywalled: number;
  other: number;
  notProbed: number;
};

export const HOSTS_SQL = `
SELECT split_part(split_part(r.uri, '://', 2), '/', 1)        AS host,
       count(*)                                                AS records,
       sum(r."memberCount")                                    AS agents,
       count(*) FILTER (WHERE p.state = 'answered')            AS answered,
       count(*) FILTER (WHERE p.state = 'gone')                AS gone,
       count(*) FILTER (WHERE p.state = 'paywalled')           AS paywalled,
       count(*) FILTER (WHERE p.state IN ('refused','nohost','malformed','unknown')) AS other,
       count(*) FILTER (WHERE p.state IS NULL)                 AS not_probed
FROM "AgentRecord" r
LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
WHERE r."chainId" = $1 AND r.uri LIKE 'http%'
GROUP BY 1
ORDER BY agents DESC
LIMIT $2`;

export async function hosts(limit = 25): Promise<Sourced<HostRow[]>> {
  const rows = await q<Record<string, string>>(HOSTS_SQL, [CHAIN_ID, limit]);
  return src(
    HOSTS_SQL,
    rows.map((r) => ({
      host: r.host,
      records: Number(r.records),
      agents: Number(r.agents),
      answered: Number(r.answered),
      gone: Number(r.gone),
      paywalled: Number(r.paywalled),
      other: Number(r.other),
      notProbed: Number(r.not_probed),
    })),
  );
}

/** Agents pointing at one record, for the cluster detail page. */
export const CLUSTER_MEMBERS_SQL = `
SELECT a.id, a."agentId", a.owner, a."agentWallet", a."registeredAtBlock",
       coalesce(fb.total, 0) AS feedback_count
FROM "Agent" a
LEFT JOIN (SELECT agent_id, count(*) AS total FROM "Feedback" WHERE "chainId" = $1 GROUP BY agent_id) fb
  ON fb.agent_id = a.id
WHERE a."chainId" = $1 AND a."uriHash" = $2
ORDER BY a."agentId" ASC
LIMIT $3 OFFSET $4`;

export type ClusterMember = {
  id: string;
  agentId: number;
  owner: string;
  agentWallet: string | null;
  registeredAtBlock: number;
  feedbackCount: number;
};

export async function clusterMembers(
  uriHash: string,
  limit = 100,
  offset = 0,
): Promise<Sourced<ClusterMember[]>> {
  const rows = await q<Record<string, unknown>>(CLUSTER_MEMBERS_SQL, [CHAIN_ID, uriHash, limit, offset]);
  return src(
    CLUSTER_MEMBERS_SQL,
    rows.map((r) => ({
      id: r.id as string,
      agentId: Number(r.agentId),
      owner: r.owner as string,
      agentWallet: (r.agentWallet as string | null) ?? null,
      registeredAtBlock: Number(r.registeredAtBlock),
      feedbackCount: Number(r.feedback_count ?? 0),
    })),
  );
}
