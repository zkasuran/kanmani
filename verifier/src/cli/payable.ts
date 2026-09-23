/**
 * The `payable` rung from the command line, one endpoint or the whole corpus.
 *
 *   node --experimental-strip-types src/cli/payable.ts https://prooflines.org/.well-known/x402
 *   ENVIO_PG_PASSWORD=... node --experimental-strip-types src/cli/payable.ts --records
 *   ... --records --limit 50 --dry           read 50 clusters, write nothing
 *   ... --records --http                     also resolve registration documents over the network
 *   ... --records --host-gap 500 --hosts 4   half a second between hits on one host, 4 hosts at once
 *
 * ## Why this is shaped around other people's servers
 *
 * A registration commonly declares four services on one host, so the naive pass is four
 * simultaneous requests to one small deployment. We publish findings about these operators.
 * Knocking one over while measuring whether it is up would be its own answer.
 *
 * So the queue is **per host, serial, with a gap**, concurrency runs across hosts rather than
 * within one. The two phases are sequential so no host is fetched for a document while it is
 * also being probed for a service.
 *
 * **Registration documents are read offline by default.** 1,862 of Monad's 2,012 records are http
 * and re-fetching all of them to find service endpoints is a real cost on somebody else's box, so
 * `--http` makes that choice deliberate rather than automatic. The `data:` and inline records need
 * no network at all and are always read.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connectionStringFrom } from "../store/store.ts";
import { recordTargets, type RecordTarget } from "../store/records.ts";
import { resolveEvidence } from "../ladder/resolve.ts";
import {
  classifyX402,
  declaredX402,
  fetchChallenge,
  payableCheck,
  serviceEndpoints,
  type PayableOutcome,
} from "../ladder/payable.ts";

type Args = {
  records: boolean;
  http: boolean;
  limit: number;
  hosts: number;
  hostGapMs: number;
  dry: boolean;
  only?: string;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    records: argv.includes("--records"),
    http: argv.includes("--http"),
    limit: Number(get("limit") ?? 5000),
    hosts: Math.max(1, Number(get("hosts") ?? 4)),
    hostGapMs: Math.max(0, Number(get("host-gap") ?? 350)),
    dry: argv.includes("--dry"),
    only: get("only"),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The host a URL will actually contact. Null when it contacts nothing. */
function hostOf(uri: string): string | null {
  const t = (uri ?? "").trim();
  if (!t || t.startsWith("data:") || t.startsWith("{")) return null;
  try {
    return new URL(t).host.toLowerCase();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ one endpoint */

async function probeOne(url: string): Promise<number> {
  console.log(`endpoint : ${url}`);
  console.log();

  const got = await fetchChallenge(url);
  if (!got.ok) {
    // Printed differently on purpose. A blocked address is a fact about the address. A failed look
    // is a fact about us. The two are not the same answer.
    console.log(got.blocked ? "VERDICT  NOT payable" : "VERDICT  unknown, we could not look");
    console.log(`  ${got.reason}`);
    return got.blocked ? 1 : 2;
  }

  const r = classifyX402(got.res);
  console.log(`  HTTP ${got.res.status}  ${got.finalUrl}`);
  for (const h of ["www-authenticate", "content-type", "x-vercel-error", "allow"]) {
    const v = got.res.headers[h];
    if (v !== undefined) console.log(`  ${h.padEnd(18)} ${v}`);
  }
  console.log();

  if (r.challenge === true) {
    console.log(`VERDICT  payable, as a ${r.kind}`);
    console.log(`  ${r.reason}`);
    console.log(`  x402Version label  ${r.declaredVersion ?? "none"}`);
    console.log(`  observed shape     ${r.shapes.join(", ")}`);
    console.log(`  Monad mainnet      ${r.monadOption ? "yes" : "no"}`);
    for (const o of r.offers) {
      console.log(
        `  offer  ${o.shape.padEnd(8)} ${o.scheme ?? "?"} on ${o.network ?? "?"}` +
          `${o.chainId === undefined ? "" : ` (chain ${o.chainId})`}  ${o.amount ?? "no amount"} of ` +
          `${o.asset ?? "no asset"} to ${o.payTo ?? "nobody"}${o.actionable ? "" : "  NOT actionable"}`,
      );
    }
    return 0;
  }
  if (r.challenge === false) {
    console.log("VERDICT  NOT payable");
    console.log(`  ${r.reason}`);
    return 1;
  }
  console.log("VERDICT  unknown, we could not look");
  console.log(`  ${r.reason}`);
  return 2;
}

/* ------------------------------------------------------------------ the corpus sweep */

/** The sweep is the only writer, so the insert lives with it. Append only, same as every table. */
async function writeProbe(
  pool: pg.Pool,
  t: RecordTarget,
  o: PayableOutcome,
): Promise<void> {
  const hit = o.probes.find((p) => p.reading.challenge === true);
  const reading = hit?.reading.challenge === true ? hit.reading : undefined;
  const offer = reading?.offers.find((x) => x.actionable);
  const last = o.probes[o.probes.length - 1];
  const headers = last?.reading;

  await pool.query(
    `INSERT INTO fovea.payable_probe
       (uri_hash, uri, probed_url, declared_at, payable, reason,
        http_status, www_authenticate, content_type, vendor_error,
        offer_kind, declared_version, accepts_shape, monad_option,
        offer_network, offer_amount, offer_asset, offer_pay_to,
        claims_x402, declared_settlement_tx, endpoints_declared, endpoints_probed,
        member_count, distinct_owners, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [
      t.uriHash,
      t.uri,
      (hit ?? last)?.probedUrl ?? null,
      (hit ?? last)?.endpoint.declaredAt ?? null,
      String(o.payable),
      o.reason,
      statusFrom(headers),
      reading?.wwwAuthenticate ?? null,
      null,
      null,
      reading?.kind ?? null,
      reading?.declaredVersion ?? null,
      o.shapes?.join(",") ?? null,
      o.monadOption ?? null,
      offer?.network ?? null,
      offer?.amount ?? null,
      offer?.asset ?? null,
      offer?.payTo ?? null,
      o.declared.claimed,
      o.declared.settlementTx ?? null,
      o.endpoints.length,
      o.probes.length,
      t.memberCount,
      t.distinctOwners,
      o.checkedAt,
    ],
  );
}

/** The status is in the reason, because most refusals here have no status at all. */
function statusFrom(reading: { reason: string } | undefined): number | null {
  const m = /HTTP (\d{3})/.exec(reading?.reason ?? "");
  return m ? Number(m[1]) : null;
}

/** A document, read without a network where that is possible. */
async function documentFor(t: RecordTarget, allowHttp: boolean): Promise<unknown | null> {
  const uri = t.uri.trim();
  let bytes: Uint8Array | undefined;

  if (uri.startsWith("{")) {
    // The whole document is in tokenURI. 82 records on Monad do this.
    bytes = new TextEncoder().encode(uri);
  } else if (uri.startsWith("data:")) {
    const r = await resolveEvidence(uri);
    if (r.ok) bytes = r.bytes;
  } else if (allowHttp) {
    const r = await resolveEvidence(uri);
    if (r.ok) bytes = r.bytes;
  }
  if (bytes === undefined) return null;

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function sweep(a: Args): Promise<void> {
  const pool = new pg.Pool({ connectionString: connectionStringFrom(), max: 4 });
  const here = dirname(fileURLToPath(import.meta.url));
  await pool.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));

  let targets = await recordTargets(pool, 143, a.limit);
  if (a.only) targets = targets.filter((t) => t.uri.includes(a.only!));

  // Phase one: documents. Offline first and free, then the http ones through the host queue when
  // the flag asks for them. Sequential against phase two so no host sees both at once.
  console.log(
    `phase 1: reading ${targets.length} registration documents` +
      (a.http ? " (http included)" : " (offline only)"),
  );
  const docs = new Map<string, unknown>();
  const offline = targets.filter((t) => hostOf(t.uri) === null);
  for (const t of offline) {
    const d = await documentFor(t, a.http);
    if (d !== null) docs.set(t.uriHash, d);
  }
  if (a.http) {
    const byHost = groupByHost(targets.filter((t) => hostOf(t.uri) !== null), (t) => hostOf(t.uri)!);
    await drain(byHost, a, async (t) => {
      const d = await documentFor(t, true);
      if (d !== null) docs.set(t.uriHash, d);
    });
  }
  console.log(`  ${docs.size} documents read, ${targets.length - docs.size} not readable this way`);

  // Phase two: the service endpoints those documents declare, grouped by the host they contact.
  const withDoc = targets.filter((t) => docs.has(t.uriHash));
  const byServiceHost = groupByHost(withDoc, (t) => {
    const first = serviceEndpoints(docs.get(t.uriHash)).find((e) => e.url !== undefined);
    return first === undefined ? "none" : hostOf(first.url!) ?? "none";
  });
  console.log(
    `phase 2: probing across ${byServiceHost.size} service hosts ` +
      `(${a.hosts} at a time, ${a.hostGapMs}ms between hits on one)`,
  );

  const tally: Record<string, number> = { true: 0, false: 0, noOffer: 0, unknown: 0 };
  let done = 0;

  await drain(byServiceHost, a, async (t) => {
    const o = await payableCheck(docs.get(t.uriHash), { gapMs: a.hostGapMs });
    if (!a.dry) await writeProbe(pool, t, o);
    tally[String(o.payable)] = (tally[String(o.payable)] ?? 0) + 1;
    done++;
    // Only the rows worth a line. A singleton with no endpoint is a row, not news.
    if (o.payable === true || t.memberCount > 5 || done % 250 === 0) {
      const claim = declaredX402(docs.get(t.uriHash)).claimed ? "claims x402" : "no claim   ";
      console.log(
        `  [${done}/${withDoc.length}] ${String(o.payable).padEnd(7)} ${claim} ` +
          `${String(t.memberCount).padStart(5)} agents  ${o.reason.slice(0, 80)}`,
      );
    }
  });

  console.log(
    `\n${tally.true} payable, ${tally.false} answered and asked for nothing, ` +
      `${tally.noOffer} declare no endpoint, ${tally.unknown} could not be read.` +
      (a.dry ? "\n(--dry, nothing written)" : ""),
  );
  await pool.end();
}

function groupByHost(targets: RecordTarget[], host: (t: RecordTarget) => string): Map<string, RecordTarget[]> {
  const byHost = new Map<string, RecordTarget[]>();
  for (const t of targets) {
    const h = host(t);
    byHost.set(h, [...(byHost.get(h) ?? []), t]);
  }
  return byHost;
}

/**
 * One worker per host slot. A slot takes the next whole host queue and works it in order, which is
 * what keeps a single host serial without a lock.
 */
async function drain(
  byHost: Map<string, RecordTarget[]>,
  a: Args,
  work: (t: RecordTarget) => Promise<void>,
): Promise<void> {
  const queue = [...byHost.values()];
  const worker = async () => {
    for (;;) {
      const hostQueue = queue.shift();
      if (!hostQueue) return;
      for (const t of hostQueue) {
        await work(t);
        if (a.hostGapMs) await sleep(a.hostGapMs);
      }
    }
  };
  await Promise.all(Array.from({ length: a.hosts }, worker));
}

export async function run(argv = process.argv.slice(2)): Promise<number> {
  const a = parseArgs(argv);
  if (a.records) {
    await sweep(a);
    return 0;
  }
  const url = argv.find((x) => x.startsWith("http://") || x.startsWith("https://"));
  if (url === undefined) {
    console.error("usage: payable.ts <url>");
    console.error("       payable.ts --records [--http] [--limit N] [--hosts N] [--host-gap MS] [--dry]");
    return 2;
  }
  return await probeOne(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
