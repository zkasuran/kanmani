/**
 * The registration probe: does the document an agent's record points at still exist?
 *
 * This is a different question from the one `verdict.ts` answers. A verdict is about one
 * feedback's payment claim. This is about one registration document and on Monad 10,252 agents
 * resolve to 2,012 distinct documents, so the two questions have different denominators and very
 * different costs.
 *
 * **Probing per agent would mean fetching one dead Vercel URL 8,093 times to learn the same thing
 * once.** Deduplicating by record hash is not an optimisation here, it is the difference between a
 * pass that is polite to other people's servers and one that is not.
 *
 * The result is also the finding. "A dead URL" is a row. "8,093 agents across 7,962 wallets point
 * at one deleted deployment" is the same fact with its scale attached and the scale is only
 * available because the records are deduplicated in the first place.
 *
 * ## What a probe never says
 *
 * `reachable = false` means we asked and got a refusal, with the refusal recorded verbatim. It
 * does not mean the operator did anything wrong and the `reason` column must never imply that.
 * A timeout on our side and a deleted deployment on theirs both land as false here, which is why
 * the reason is stored rather than a bare boolean.
 */
import type pg from "pg";
import { resolveEvidence, type Source } from "../ladder/resolve.ts";

export type RecordProbe = {
  uriHash: string;
  uri: string;
  scheme: Source | "inline" | "other" | "empty";
  reachable: boolean;
  httpStatus?: number;
  byteLength?: number;
  mediaType?: string;
  parsedName?: string;
  reason: string;
  memberCount?: number;
  distinctOwners?: number;
  checkedAt: string;
  automatic?: boolean;
  /**
   * What a non-2xx response actually said. Recorded because a status code is not a protocol:
   * classifying 402 on the integer alone published 539 suspended hosting accounts as live agents
   * asking for payment. `record_state` reads these rather than the number.
   */
  wwwAuthenticate?: string;
  vendorError?: string;
};

/** What the indexer holds about one record, which is the input to a probe. */
export type RecordTarget = {
  uriHash: string;
  uri: string;
  memberCount: number;
  distinctOwners: number;
};

const HTTP_STATUS = /^HTTP (\d{3})/;

/**
 * Pull the status code back out of a failure reason.
 *
 * The guard reports a refusal as a sentence rather than a code, because most refusals have no
 * code at all (DNS, a private address, a size cap). Where there IS a code it is worth storing
 * separately so a page can say 404 rather than only "not reachable", so it is parsed back out
 * rather than threaded through every failure shape in the fetch path.
 */
function statusFrom(reason: string): number | undefined {
  const m = HTTP_STATUS.exec(reason);
  return m ? Number(m[1]) : undefined;
}

/**
 * Which kind of thing the record points at.
 *
 * `inline` is its own case and it matters. 82 records on Monad put a whole JSON document straight
 * into `tokenURI`, so there is no host to ask and nothing that can be deleted later. Calling that
 * "reachable" alongside a URL that happens to answer today would flatten the most interesting
 * distinction in the population: one of those two can stop being true without anyone touching the
 * chain.
 *
 * `resolveEvidence` refuses a bare JSON string, correctly, because for a FEEDBACK a URI that
 * merely failed to parse must never pass as evidence. A registration is the other way round, so
 * the case is handled here rather than by loosening that refusal.
 */
function schemeOf(uri: string): Source | "inline" | "other" | "empty" {
  if (!uri) return "empty";
  const lower = uri.toLowerCase();
  if (lower.startsWith("data:")) return "data";
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "http";
  if (lower.startsWith("ipfs://")) return "ipfs";
  const t = uri.trim();
  if (t.startsWith("{") && t.endsWith("}")) return "inline";
  return "other";
}

/**
 * Read the name a document gives itself.
 *
 * Best effort and deliberately narrow: an ERC-8004 record is JSON with a `name`, so anything
 * else returns undefined rather than guessing. A registration that resolves but names nothing is
 * a real and different state from one that does not resolve and collapsing them would hide it.
 */
export function nameFrom(bytes: Uint8Array): string | undefined {
  try {
    const doc: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
    const n = (doc as Record<string, unknown>).name;
    return typeof n === "string" && n.length > 0 ? n.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

export async function probeRecord(
  t: RecordTarget,
  now: () => Date = () => new Date(),
): Promise<RecordProbe> {
  const scheme = schemeOf(t.uri);
  const base = {
    uriHash: t.uriHash,
    uri: t.uri,
    scheme,
    memberCount: t.memberCount,
    distinctOwners: t.distinctOwners,
    checkedAt: now().toISOString(),
  };

  if (scheme === "empty") {
    return { ...base, reachable: false, reason: "the record declares no document at all" };
  }

  // On chain already. No network, no host, nothing that can be deleted out from under it.
  if (scheme === "inline") {
    const bytes = new TextEncoder().encode(t.uri);
    const name = nameFrom(bytes);
    return {
      ...base,
      reachable: true,
      byteLength: bytes.length,
      mediaType: "application/json",
      parsedName: name,
      reason: `${bytes.length} bytes stored inline in tokenURI, so there is no host to ask`,
    };
  }

  const r = await resolveEvidence(t.uri);
  if (!r.ok) {
    return {
      ...base,
      reachable: false,
      httpStatus: r.status ?? statusFrom(r.reason),
      mediaType: r.contentType,
      wwwAuthenticate: r.wwwAuthenticate,
      vendorError: r.vendorError,
      reason: r.reason,
    };
  }

  return {
    ...base,
    reachable: true,
    httpStatus: r.status,
    byteLength: r.bytes.length,
    mediaType: r.mediaType,
    parsedName: nameFrom(r.bytes),
    reason: `${r.bytes.length} bytes read from ${r.source ?? scheme}`,
  };
}

/* ------------------------------------------------------------------ storage */

/**
 * Every distinct record the indexer holds, biggest cluster first.
 *
 * Ordered by member count so a run that is interrupted has already answered the question about
 * the documents that most agents depend on, rather than having worked alphabetically through
 * 2,000 singletons.
 */
export async function recordTargets(pool: pg.Pool, chainId = 143, limit = 5000): Promise<RecordTarget[]> {
  const r = await pool.query(
    `SELECT id, uri, "memberCount", "distinctOwners"
       FROM "AgentRecord" WHERE "chainId" = $1
      ORDER BY "memberCount" DESC, "firstSeenBlock" ASC LIMIT $2`,
    [chainId, limit],
  );
  return r.rows.map((x) => ({
    uriHash: x.id,
    uri: x.uri ?? "",
    memberCount: Number(x.memberCount),
    distinctOwners: Number(x.distinctOwners),
  }));
}

export async function recordProbe(pool: pg.Pool, p: RecordProbe): Promise<number> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO fovea.record_probe
       (uri_hash, uri, scheme, reachable, http_status, byte_length, media_type,
        parsed_name, reason, member_count, distinct_owners, checked_at, automatic,
        www_authenticate, vendor_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      p.uriHash,
      p.uri,
      p.scheme,
      p.reachable,
      p.httpStatus ?? null,
      p.byteLength ?? null,
      p.mediaType ?? null,
      p.parsedName ?? null,
      p.reason,
      p.memberCount ?? null,
      p.distinctOwners ?? null,
      p.checkedAt,
      p.automatic ?? true,
      p.wwwAuthenticate ?? null,
      p.vendorError ?? null,
    ],
  );
  return Number(r.rows[0]!.id);
}
