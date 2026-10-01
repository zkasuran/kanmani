/**
 * Every number Cornea puts on a page comes from exactly one query in this file and every page
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

/** Which published mapping read each document and what it decided. Coverage, in the open. */
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
  /**
   * How many chains this DOCUMENT is registered on, Monad included. 1 for almost everything.
   *
   * Not a measure of the agent's quality and not a ranking input. It answers one question a buyer
   * actually has: did this operator's standing start here or does it come from somewhere we can
   * also read?
   */
  chainCount: number;
  /** The chain ids sharing this document, ascending. Always contains Monad for a row on this page. */
  chainIds: number[];
};

/*
 * Monad's records, with one fact from elsewhere.
 *
 * The subject stays Monad: the row is a Monad `AgentRecord` and the ordering is Monad's. The LEFT
 * JOIN adds only whether the same DOCUMENT is registered on another chain, read from Chiasm's merged
 * row, which is keyed on the document's content hash because that is the only key that means the
 * same thing on two chains.
 *
 * Deliberately a join rather than a second population. This site is not an ERC-8004 explorer and
 * BSC is not a second list to browse; 356,647 BSC agents exist in the index to tell you something
 * about the Monad agent in front of you, which is that its standing did not start here.
 *
 * LEFT, so a record with no cross-chain row reads as 1 chain rather than disappearing.
 */
const CLUSTERS_SQL = `
SELECT r.id AS uri_hash, r.uri, r."memberCount", r."distinctOwners", r.kind,
       r.resolves, r."httpStatus", r."byteLength", r."parsedName", r."firstSeenBlock",
       COALESCE(c."chainCount", 1) AS chain_count,
       COALESCE(c."chainIds", ARRAY[$1]::integer[]) AS chain_ids
FROM "AgentRecord" r
LEFT JOIN "ChiasmRecord" c ON c.id = r.id
WHERE r."chainId" = $1
ORDER BY r."memberCount" DESC, r."firstSeenBlock" ASC
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
      chainCount: Number(r.chain_count),
      chainIds: parseChainIds(r.chain_ids),
    })),
  );
}

/**
 * Postgres hands an integer[] back as either an array or the string `{56,143}` depending on the
 * driver path. Parsed defensively rather than assumed, because guessing wrong here would silently
 * report every record as single-chain, which is a claim.
 */
function parseChainIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw === "string") {
    return raw.replace(/[{}]/g, "").split(",").map(Number).filter(Number.isFinite);
  }
  return [];
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

// Only documents some agent still points at. memberCount is never decremented when an agent
// repoints, so a document every agent has left keeps a count of 1 and would be counted as a unique
// record with an agent behind it. See REGISTRY_HEALTH_SQL.
const CLUSTER_SHAPE_SQL = `
WITH r AS (SELECT * FROM "AgentRecord" ar WHERE ar."chainId" = $1
             AND EXISTS (SELECT 1 FROM "Agent" a WHERE a."chainId" = $1 AND a."uriHash" = ar.id)),
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
SELECT r.id AS uri_hash, r.uri, r."memberCount", r."distinctOwners", r.kind,
       r.resolves, r."httpStatus", r."byteLength", r."parsedName", r."firstSeenBlock",
       COALESCE(c."chainCount", 1) AS chain_count,
       COALESCE(c."chainIds", ARRAY[$1]::integer[]) AS chain_ids
FROM "AgentRecord" r
LEFT JOIN "ChiasmRecord" c ON c.id = r.id
WHERE r."chainId" = $1 AND r.id = $2`;

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
    chainCount: Number(r.chain_count ?? 1),
    chainIds: parseChainIds(r.chain_ids),
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
  /** Only agents whose record still resolves or only those whose record is gone. */
  records?: "resolving" | "dead" | "any";
  declaresX402?: boolean;
  /** Only agents carrying at least one feedback with an evidence pointer. */
  withEvidence?: boolean;
  search?: string;
  /**
   * Exact owner, compared case-insensitively. Not `search`, which is a substring match over five
   * columns and would list an agent whose name happens to contain part of an address as "yours".
   */
  owner?: string;
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
 * the classic way a filtered page ends up saying "312 agents" above 40 rows and nobody notices
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
  if (f.owner) where.push(`lower(a.owner) = lower(${p(f.owner)})`);
  if (f.search && f.search.trim()) {
    const raw = f.search.trim();
    // Escape the LIKE metacharacters so a search for "%" or "a_c" is a literal substring, not a
    // wildcard. Without this, "?q=%" matches the whole registry and the count beside it reports that
    // as a real match, which on a project whose pitch is correct numbers is a defect not a nicety.
    const esc = raw.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
    const s = `%${esc}%`;
    where.push(
      `(lower(coalesce(a.name,'')) LIKE ${p(s)} ESCAPE '\\' OR lower(a.owner) LIKE ${p(s)} ESCAPE '\\'` +
        ` OR lower(coalesce(a."agentWallet",'')) LIKE ${p(s)} ESCAPE '\\'` +
        ` OR lower(coalesce(a."tokenUri",'')) LIKE ${p(s)} ESCAPE '\\'` +
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
  // Accepts either the internal key or the public on-chain agent id, so a link can carry the number
  // a reader actually sees on the page rather than an indexer implementation detail.
  if (f.agentId) { const x = p(f.agentId); where.push(`(f.agent_id = ${x} OR a."agentId"::text = ${x})`); }

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
 * The claim-truth rate for one agent over a block window.
 *
 * This is the number the slashing oracle reads. It is deliberately a pure function of an agent id
 * and a block range, nothing else, because a CRE workflow reaches consensus by having independent
 * nodes compute the same answer: anything keyed on wall-clock time (like `checked_at`) would drift
 * between nodes and break the aggregation. The window is `[fromBlock, toBlock]` on `Feedback`'s own
 * `blockNumber`, which comes from the chain, so two nodes reading the same range get the same rows.
 *
 * `unknown` is carried apart from the rate and excluded from both sides of it. A claim we could not
 * check is not a claim the agent failed. Folding it in would let our own rate limit or a
 * transient outage slash somebody. `sampleSize` is the decided count (`true` plus `false`), which is
 * what a `minSampleSize` floor must be compared against, never the raw feedback count.
 */
export type ClaimTruthWindow = {
  agentId: number;
  fromBlock: string;
  toBlock: string;
  /** Feedbacks with an evidence pointer recorded in the window, before any verdict is considered. */
  feedbacks: number;
  /** Decided claims: true + false. This is what a minSampleSize floor is measured against. */
  sampleSize: number;
  trueCount: number;
  falseCount: number;
  /** Carried apart, never in the rate. A claim we could not check is not one the agent failed. */
  unknownCount: number;
  /** Claims that parsed but assert no payment, so there is nothing to resolve. Not a failure. */
  noClaimCount: number;
  /** true / (true + false), in basis points. null when the sample is empty, never a misleading 0. */
  rateBps: number | null;
};

export const CLAIM_TRUTH_WINDOW_SQL = `
SELECT
  count(*) FILTER (WHERE f."feedbackUri" <> '')                       AS feedbacks,
  count(*) FILTER (WHERE v.outcome IN ('true','false'))               AS sample_size,
  count(*) FILTER (WHERE v.outcome = 'true')                          AS true_count,
  count(*) FILTER (WHERE v.outcome = 'false')                         AS false_count,
  count(*) FILTER (WHERE v.outcome = 'unknown')                       AS unknown_count,
  count(*) FILTER (WHERE v.outcome = 'noClaim')                       AS no_claim_count
FROM "Feedback" f
JOIN "Agent" a ON a.id = f.agent_id
LEFT JOIN fovea.verdict_latest v ON v.feedback_id = f.id
WHERE f."chainId" = $1
  AND a."agentId"::text = $2
  AND f."blockNumber" >= $3
  AND f."blockNumber" <= $4`;

export async function claimTruthWindow(
  agentId: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Sourced<ClaimTruthWindow>> {
  const r = await q1<Record<string, string>>(CLAIM_TRUTH_WINDOW_SQL, [
    CHAIN_ID,
    agentId,
    fromBlock.toString(),
    toBlock.toString(),
  ]);
  const n = (k: string) => Number(r?.[k] ?? 0);
  const trueCount = n("true_count");
  const sampleSize = n("sample_size");
  return src(CLAIM_TRUTH_WINDOW_SQL, {
    agentId: Number(agentId),
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    feedbacks: n("feedbacks"),
    sampleSize,
    trueCount,
    falseCount: n("false_count"),
    unknownCount: n("unknown_count"),
    noClaimCount: n("no_claim_count"),
    // Basis points, so the contract compares integers. Empty sample is null, not a 0 that reads as
    // "every claim was false", which would slash an agent nobody has rated yet.
    rateBps: sampleSize === 0 ? null : Math.round((trueCount / sampleSize) * 10_000),
  });
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

/**
 * The block the indexer has actually processed up to, from Envio's own progress table.
 *
 * Not `IndexState.atBlock`. That row is written by a sweep every 10,000 blocks (about 44 minutes), so
 * between sweeps it reads as up to 44 minutes stale while the index itself is a few blocks behind
 * head. Sentinel measured its freshness bound against that row and refused nearly every 64-block
 * request as stale when the index was current. Null when the table cannot be read.
 */
export const INDEX_PROGRESS_SQL = `SELECT progress_block FROM public.envio_chains WHERE id = $1`;
export async function indexProgress(): Promise<number | null> {
  try {
    const r = await q1<{ progress_block: string | number | null }>(INDEX_PROGRESS_SQL, [CHAIN_ID]);
    return r?.progress_block == null ? null : Number(r.progress_block);
  } catch {
    return null;
  }
}

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
   * `paywalled`, `refused`, `nohost`, `malformed`, `unknown` or null when nothing has probed
   * this record yet. Never-looked is a state and it is not `gone`.
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
       p.parsed_name, p.reason, p.checked_at, p.state,
       COALESCE(c."chainCount", 1) AS chain_count,
       COALESCE(c."chainIds", ARRAY[$1]::integer[]) AS chain_ids
FROM "AgentRecord" r
LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
LEFT JOIN "ChiasmRecord" c ON c.id = r.id
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
    chainCount: Number(x.chain_count ?? 1),
    chainIds: parseChainIds(x.chain_ids),
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
   * Counted separately because without it the state buckets sum short of the registry total and the
   * agents with no tokenURI quietly vanish off the page. A registration that says nothing about
   * itself is a finding, not a gap in the join.
   */
  agentsWithNoDocument: number;
  byState: { state: RecordState; records: number; agents: number }[];
  probedAt: string | null;
};

/*
 * Agents are counted from "Agent" as it stands, not from AgentRecord."memberCount". The indexer
 * increments memberCount when an agent points at a document and never decrements it when the agent
 * repoints, so on 2026-09-30 71 documents with no current agent still carried a count of one each
 * and the buckets summed to 10,344 against a registry of 10,273. A document nobody points at any
 * more is not behind any agent, so it drops out here rather than being counted twice.
 */
export const REGISTRY_HEALTH_SQL = `
WITH live AS (
  SELECT "uriHash" AS h, count(*) AS n FROM "Agent" WHERE "chainId" = $1 AND "uriHash" IS NOT NULL GROUP BY 1
)
SELECT coalesce(p.state, 'not probed') AS state,
       count(*)                        AS records,
       sum(l.n)                        AS agents,
       max(p.checked_at)               AS probed_at
FROM "AgentRecord" r
JOIN live l ON l.h = r.id
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
  paywalled: "The host returned a real x402 payment challenge, so it is a live agent asking to be paid before it serves the document. A 402 that is not a challenge, like a suspended host, is counted as gone rather than here.",
  refused: "The host is alive and will not serve the document to us.",
  nohost: "The domain in the URI no longer resolves to any host.",
  malformed: "The URI was never a usable pointer. Nothing was deleted, because it could not have worked.",
  unknown:
    "We could not find out. A rate limit, a timeout, a server error or a document past our own size cap. Never an accusation.",
  "not probed": "Nothing has asked about this document yet. Not having looked is a state and it is not a failure.",
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

/* ------------------------------------------------------------------ authorisation trail */

/**
 * Who authorised a change to this agent's document plus when.
 *
 * Distinct from a verdict in a way worth keeping distinct: a verdict is our measurement of whether a
 * claim is true and a receipt is somebody's signed statement that they authorised a document. One is
 * ours, the other is theirs. Rendering them in the same list would blur who said what.
 *
 * The signature comes back so a reader can check it rather than trust that we did.
 */
export type ActionRow = {
  action: string;
  chainId: number;
  uriHash: string;
  signer: string;
  identity: string;
  signature: string;
  signedAt: string;
  receivedAt: string;
};

export const AGENT_ACTIONS_SQL = `
SELECT action, chain_id, uri_hash, signer, identity, signature, signed_at, received_at
FROM fovea.agent_action
WHERE agent_id = $1
ORDER BY signed_at DESC
LIMIT 20`;

export async function agentActions(agentId: number): Promise<Sourced<ActionRow[]>> {
  try {
    const rows = await q<Record<string, string | number>>(AGENT_ACTIONS_SQL, [agentId]);
    return src(
      AGENT_ACTIONS_SQL,
      rows.map((r) => ({
        action: String(r.action),
        chainId: Number(r.chain_id),
        uriHash: String(r.uri_hash),
        signer: String(r.signer),
        identity: String(r.identity),
        signature: String(r.signature),
        signedAt: String(r.signed_at),
        receivedAt: String(r.received_at),
      })),
    );
  } catch {
    // The table may not exist yet on an installation that has not applied the schema. An empty trail
    // is the correct answer there: nobody has published a receipt. It is not an error page and it is
    // not a claim that none were ever signed.
    return src(AGENT_ACTIONS_SQL, []);
  }
}

/* ------------------------------------------------------------------ agents per chain */

/**
 * Agent counts for every chain the indexer holds, keyed by chain id.
 *
 * Exists because the chains page was quoting a BSC figure typed into prose. By the time anyone
 * noticed it was 797 short, which is the precise failure this project attacks: a published number the
 * database contradicts. Anything that states a population now has to ask for it.
 *
 * Not filtered to one chain, because the caller is usually comparing two and a second round trip to
 * say "and BSC has this many" is how the two numbers end up measured at different moments.
 */
const AGENTS_BY_CHAIN_SQL = `SELECT "chainId" AS chain_id, count(*) AS n FROM "Agent" GROUP BY 1 ORDER BY 1`;

export async function agentsByChain(): Promise<Sourced<{ counts: Record<number, number> }>> {
  const rows = await q<{ chain_id: string; n: string }>(AGENTS_BY_CHAIN_SQL, []);
  const counts: Record<number, number> = {};
  for (const r of rows) counts[Number(r.chain_id)] = Number(r.n);
  return src(AGENTS_BY_CHAIN_SQL, { counts });
}

/* ------------------------------------------------------------ where a false claim actually is */

/**
 * The single most important correction this project has made to its own headline.
 *
 * For months the finding was "73 of 85 payment claims do not resolve", which was true and read as an
 * accusation: 73 operators fabricated payments. Once Alchemy made Ethereum, Optimism, Base, Arbitrum and
 * Polygon reachable, the truth turned out to be that **64 of those 73 are real mined transactions on a
 * different chain** and only 9 exist nowhere.
 *
 * So a `false` verdict splits into two findings that deserve completely different words. A mislabelled
 * network is one wrong field in a document somebody can fix. A hash that exists on no chain is the
 * serious one. Publishing them as a single number was the misleading part and it was misleading in the
 * direction that harms operators, which is the worst direction for a project like this.
 */
export type MislabelledSplit = {
  /** Real transactions, wrong network named. Repairable. */
  elsewhere: number;
  /**
   * Hashes not located on the declared chain or on any chain the cross-chain backfill reached.
   *
   * This is deliberately NOT called "fabricated" or "genuinely nowhere". A `found_chain` that is
   * null means the search that ran did not place the transaction, which is not the same as an
   * exhaustive search that came back empty: a chain with no configured endpoint is unsearched, not
   * clear. Treating unsearched as fabricated would harm operators in the one direction this project
   * must not. The exhaustive-vs-inconclusive split needs the backfill to record which chains it
   * reached per verdict, which it does not yet, so this count is reported as "not found where we
   * looked" rather than as an accusation. See docs/14-GAPS.md.
   */
  nowhere: number;
  /** Per-chain breakdown, biggest first. 45 on one chain is a defaulting tool, not scattered error. */
  byChain: { chain: string; chainId: number | null; count: number }[];
};

const MISLABELLED_SQL = `
SELECT found_chain, found_chain_id, count(*) AS n
FROM fovea.verdict_latest
WHERE outcome = 'false'
GROUP BY 1, 2
ORDER BY n DESC`;

export async function mislabelled(): Promise<Sourced<MislabelledSplit>> {
  const rows = await q<{ found_chain: string | null; found_chain_id: string | null; n: string }>(
    MISLABELLED_SQL,
    [],
  );
  let elsewhere = 0;
  let nowhere = 0;
  const byChain: MislabelledSplit["byChain"] = [];
  for (const r of rows) {
    const n = Number(r.n);
    if (r.found_chain) {
      elsewhere += n;
      byChain.push({ chain: r.found_chain, chainId: r.found_chain_id ? Number(r.found_chain_id) : null, count: n });
    } else {
      nowhere += n;
    }
  }
  return src(MISLABELLED_SQL, { elsewhere, nowhere, byChain });
}

/* ============================================================ the indexer panel (spec 17, 7.1)
 *
 * Four reads that describe the indexer itself rather than the agents it holds: how far each chain
 * has processed, how many rows each entity carries, what each handler wrote, and where the two
 * chains cross on one registration document. Every one reads Envio's own `public` schema, which is
 * dropped and recreated on a resync (lib/db.ts), so every one fails closed to `null`, rendered as
 * "could not read" rather than as a zero that would read as a measurement.
 */

/** Per chain: head, processed, lag and events, from Envio's own chain_metadata view. */
export type ChainStatusRow = {
  chainId: number;
  /** source_block, the height HyperSync reports. Null when the view could not be read. */
  head: number | null;
  /** progress_block, fully processed. Lag is head minus this. */
  processed: number | null;
  lag: number | null;
  fetched: number | null;
  events: number | null;
  isHyperSync: boolean | null;
  /** Set when historical sync finished, null while still catching up. */
  caughtUpAt: string | null;
};

export const CHAIN_STATUS_SQL = `
SELECT chain_id,
       block_height                            AS head,
       latest_processed_block                  AS processed,
       (block_height - latest_processed_block) AS lag,
       latest_fetched_block_number             AS fetched,
       num_events_processed                    AS events,
       is_hyper_sync                           AS is_hyper_sync,
       timestamp_caught_up_to_head_or_endblock AS caught_up_at
FROM public.chain_metadata
ORDER BY chain_id`;

export async function chainStatus(): Promise<Sourced<ChainStatusRow[] | null>> {
  // chain_metadata is a view over Envio's envio_chains table and lives in `public`, which a resync
  // drops. A failed read is unknown, never a row of zeros, so this mirrors indexProgress().
  try {
    const rows = await q<{
      chain_id: string | number;
      head: string | number | null;
      processed: string | number | null;
      lag: string | number | null;
      fetched: string | number | null;
      events: string | number | null;
      is_hyper_sync: boolean | null;
      caught_up_at: string | Date | null;
    }>(CHAIN_STATUS_SQL);
    const num = (x: string | number | null) => (x == null ? null : Number(x));
    return src(
      CHAIN_STATUS_SQL,
      rows.map((r) => ({
        chainId: Number(r.chain_id),
        head: num(r.head),
        processed: num(r.processed),
        lag: num(r.lag),
        fetched: num(r.fetched),
        // The view types this float4, so round it back to the integer count it really is.
        events: r.events == null ? null : Math.round(Number(r.events)),
        isHyperSync: r.is_hyper_sync == null ? null : Boolean(r.is_hyper_sync),
        caughtUpAt: r.caught_up_at == null ? null : new Date(r.caught_up_at).toISOString(),
      })),
    );
  } catch {
    return src(CHAIN_STATUS_SQL, null);
  }
}

/** One row count per entity per chain. The two cross-chain tables carry no chainId, so it is null. */
export type EntityCount = { entity: string; chainId: number | null; n: number };

export const ENTITY_COUNTS_SQL = `
SELECT 'Agent'            AS entity, "chainId", count(*) AS n FROM "Agent"            GROUP BY "chainId"
UNION ALL SELECT 'AgentRecord',      "chainId", count(*) FROM "AgentRecord"      GROUP BY "chainId"
UNION ALL SELECT 'AgentRecordOwner', "chainId", count(*) FROM "AgentRecordOwner" GROUP BY "chainId"
UNION ALL SELECT 'Feedback',         "chainId", count(*) FROM "Feedback"         GROUP BY "chainId"
UNION ALL SELECT 'Validation',       "chainId", count(*) FROM "Validation"       GROUP BY "chainId"
UNION ALL SELECT 'ChiasmRecord',     NULL::integer, count(*) FROM "ChiasmRecord"
UNION ALL SELECT 'ChiasmPresence',   NULL::integer, count(*) FROM "ChiasmPresence"
ORDER BY entity, "chainId" NULLS FIRST`;

export async function entityCounts(): Promise<Sourced<EntityCount[] | null>> {
  try {
    const rows = await q<{ entity: string; chainId: string | number | null; n: string }>(ENTITY_COUNTS_SQL);
    return src(
      ENTITY_COUNTS_SQL,
      rows.map((r) => ({
        entity: r.entity,
        chainId: r.chainId == null ? null : Number(r.chainId),
        n: Number(r.n),
      })),
    );
  } catch {
    return src(ENTITY_COUNTS_SQL, null);
  }
}

/**
 * What each handler wrote, per chain.
 *
 * This is the fallback count, not an exact per-event-name count. The exact source is Envio's
 * raw_events table, which this deployment keeps off (rawEvents defaults false) to save a write on
 * every log, so the honest column here is "rows this handler wrote" rather than "raw logs seen".
 * Two IdentityRegistry events, MetadataSet and URIUpdated, mutate an Agent in place and keep no
 * counter of their own, so they are folded into the Agent row rather than invented. See
 * indexer/README.md for the exact-count path (rawEvents: true plus one resync).
 */
export type HandlerCounts = {
  chainId: number;
  registered: number;
  laterTransfers: number;
  metadataUpdates: number;
  newFeedback: number;
  feedbackRevoked: number;
  responses: number;
  validationRequests: number;
  validationResponses: number;
};
export type HandlerActivity = {
  perChain: HandlerCounts[];
  /** Events the fallback cannot count on their own, stated rather than hidden. */
  foldedIntoAgent: string[];
};

export const HANDLER_ACTIVITY_SQL = `
SELECT c."chainId",
       COALESCE(a.registered, 0)           AS registered,
       COALESCE(a.later_transfers, 0)      AS later_transfers,
       COALESCE(a.metadata_updates, 0)     AS metadata_updates,
       COALESCE(f.new_feedback, 0)         AS new_feedback,
       COALESCE(f.feedback_revoked, 0)     AS feedback_revoked,
       COALESCE(f.responses, 0)            AS responses,
       COALESCE(v.validation_requests, 0)  AS validation_requests,
       COALESCE(v.validation_responses, 0) AS validation_responses
FROM (SELECT "chainId" FROM "Agent"
      UNION SELECT "chainId" FROM "Feedback"
      UNION SELECT "chainId" FROM "Validation") c
LEFT JOIN (SELECT "chainId", count(*) AS registered,
                  sum("transferCount") AS later_transfers,
                  sum("metadataUpdateCount") AS metadata_updates
           FROM "Agent" GROUP BY "chainId") a ON a."chainId" = c."chainId"
LEFT JOIN (SELECT "chainId", count(*) AS new_feedback,
                  count(*) FILTER (WHERE revoked) AS feedback_revoked,
                  count(*) FILTER (WHERE "responseUri" IS NOT NULL) AS responses
           FROM "Feedback" GROUP BY "chainId") f ON f."chainId" = c."chainId"
LEFT JOIN (SELECT "chainId", count(*) AS validation_requests,
                  count(*) FILTER (WHERE response IS NOT NULL) AS validation_responses
           FROM "Validation" GROUP BY "chainId") v ON v."chainId" = c."chainId"
ORDER BY c."chainId"`;

export async function handlerActivity(): Promise<Sourced<HandlerActivity | null>> {
  try {
    const rows = await q<Record<string, string | number | null>>(HANDLER_ACTIVITY_SQL);
    const n = (x: string | number | null | undefined) => Number(x ?? 0);
    return src(HANDLER_ACTIVITY_SQL, {
      perChain: rows.map((r) => ({
        chainId: Number(r.chainId),
        registered: n(r.registered),
        laterTransfers: n(r.later_transfers),
        metadataUpdates: n(r.metadata_updates),
        newFeedback: n(r.new_feedback),
        feedbackRevoked: n(r.feedback_revoked),
        responses: n(r.responses),
        validationRequests: n(r.validation_requests),
        validationResponses: n(r.validation_responses),
      })),
      foldedIntoAgent: ["MetadataSet", "URIUpdated"],
    });
  } catch {
    return src(HANDLER_ACTIVITY_SQL, null);
  }
}

/** The merge the per-chain tables cannot answer: documents referenced from more than one chain. */
export type CrossChainSummary = { documents: number; onBothChains: number; keyCollisions: number };
export type CrossChainDetail = {
  uriHash: string;
  uri: string;
  chainCount: number;
  chainIds: number[];
  agentCount: number;
  firstSeenChainId: number;
  uriConflict: boolean;
  chainId: number;
  agentsOnChain: number;
  firstAgentId: string;
};
export type CrossChainMerge = { summary: CrossChainSummary; detail: CrossChainDetail[] };

export const CROSS_CHAIN_SUMMARY_SQL = `
SELECT count(*)                                              AS documents,
       count(*) FILTER (WHERE "chainCount" >= 2)             AS on_both_chains,
       count(*) FILTER (WHERE "chainCount" >= 2
                        AND "uriConflict")                   AS key_collisions
FROM "ChiasmRecord"`;

export const CROSS_CHAIN_DETAIL_SQL = `
SELECT r.id AS uri_hash, r.uri, r."chainCount", r."chainIds", r."agentCount",
       r."firstSeenChainId", r."uriConflict",
       p."chainId", p."agentCount" AS agents_on_chain, p."firstAgentId"
FROM "ChiasmRecord" r
JOIN "ChiasmPresence" p ON p.record_id = r.id
WHERE r."chainCount" >= 2 AND NOT r."uriConflict"
ORDER BY r."agentCount" DESC, r.id, p."chainId"`;export async function crossChainMerge(): Promise<Sourced<CrossChainMerge | null>> {
  const sql = `${CROSS_CHAIN_SUMMARY_SQL}\n\n${CROSS_CHAIN_DETAIL_SQL}`;
  try {
    const summaryRow = await q1<{ documents: string; on_both_chains: string; key_collisions: string }>(
      CROSS_CHAIN_SUMMARY_SQL,
    );
    const detail = await q<{
      uri_hash: string;
      uri: string | null;
      chainCount: string | number;
      chainIds: unknown;
      agentCount: string | number;
      firstSeenChainId: string | number;
      uriConflict: boolean;
      chainId: string | number;
      agents_on_chain: string | number;
      firstAgentId: string | number;
    }>(CROSS_CHAIN_DETAIL_SQL);
    return src(sql, {
      summary: {
        documents: Number(summaryRow?.documents ?? 0),
        onBothChains: Number(summaryRow?.on_both_chains ?? 0),
        keyCollisions: Number(summaryRow?.key_collisions ?? 0),
      },
      detail: detail.map((r) => ({
        uriHash: r.uri_hash,
        uri: r.uri ?? "",
        chainCount: Number(r.chainCount),
        chainIds: parseChainIds(r.chainIds),
        agentCount: Number(r.agentCount),
        firstSeenChainId: Number(r.firstSeenChainId),
        uriConflict: Boolean(r.uriConflict),
        chainId: Number(r.chainId),
        agentsOnChain: Number(r.agents_on_chain),
        firstAgentId: String(r.firstAgentId),
      })),
    });
  } catch {
    return src(sql, null);
  }
}


/* ------------------------------------------------------------------ the atlas review queue */

/**
 * The induced-mapping proposals waiting for review.
 *
 * This reads fovea.mapping_proposal_latest and nothing in the verdict pipeline reads it back. A
 * proposal is a candidate the model induced for a document shape the hand atlas could not read; it
 * becomes a verdict only when a human reviews it and adds the mapping to ATLAS in code. So this query
 * powers a queue the reader can inspect, never a number on a claim.
 *
 * The SQL travels with the rows, like every reader here, so /method can print what it ran.
 */
export type MappingProposalRow = {
  shapeKey: string;
  feedbackIds: string[];
  /** How many live claims this one shape would resolve once its mapping is added. */
  coveredClaims: number;
  model: string;
  converged: boolean;
  roundTripOk: boolean;
  iterations: number;
  toolCalls: number;
  proposalName: string | null;
  proposalNote: string | null;
  proposalKind: string | null;
  status: string;
  checkedAt: string;
};

export const MAPPING_PROPOSALS_SQL = `
SELECT shape_key, feedback_ids, model, converged, round_trip_ok, iterations, tool_calls,
       proposal, give_up_reason, status, checked_at
FROM fovea.mapping_proposal_latest
ORDER BY converged DESC, checked_at DESC`;

export async function mappingProposals(): Promise<Sourced<MappingProposalRow[]>> {
  try {
    const rows = await q<Record<string, unknown>>(MAPPING_PROPOSALS_SQL);
    return src(
      MAPPING_PROPOSALS_SQL,
      rows.map((r) => {
        const p = (r.proposal as { name?: string; note?: string; kind?: string } | null) ?? null;
        const ids = (r.feedback_ids as string[] | null) ?? [];
        return {
          shapeKey: String(r.shape_key),
          feedbackIds: ids,
          coveredClaims: ids.length,
          model: String(r.model ?? ""),
          converged: Boolean(r.converged),
          roundTripOk: Boolean(r.round_trip_ok),
          iterations: Number(r.iterations ?? 0),
          toolCalls: Number(r.tool_calls ?? 0),
          proposalName: p?.name ?? null,
          proposalNote: p?.note ?? null,
          proposalKind: p?.kind ?? null,
          status: String(r.status ?? "pending"),
          checkedAt: new Date(r.checked_at as string).toISOString(),
        };
      }),
    );
  } catch {
    // The table may not exist yet on an installation that has not applied the schema. An empty queue
    // is the honest answer there, the same posture agentActions() takes, never an error page.
    return src(MAPPING_PROPOSALS_SQL, []);
  }
}

/**
 * The gap in two numbers a page can state from the database rather than from prose: how many intact
 * documents no mapping reads, and how many converged proposals wait in the queue to close that gap.
 *
 * `unparsed` reuses measurement().unknownUnparsed, the same count /method and /feed.json already show.
 * `pendingProposals` is null when the queue table has not been applied yet, unknown rather than a
 * misleading zero.
 */
export type AtlasGap = { unparsed: number; pendingProposals: number | null };

export const ATLAS_GAP_SQL = `
SELECT count(*) FILTER (WHERE status = 'pending' AND converged) AS pending_converged
FROM fovea.mapping_proposal_latest`;

export async function atlasGap(): Promise<AtlasGap> {
  const m = await measurement();
  let pendingProposals: number | null;
  try {
    const r = await q1<{ pending_converged: string }>(ATLAS_GAP_SQL);
    pendingProposals = Number(r?.pending_converged ?? 0);
  } catch {
    pendingProposals = null;
  }
  return { unparsed: m.rows.unknownUnparsed, pendingProposals };
}
