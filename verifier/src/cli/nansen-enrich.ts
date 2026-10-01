/**
 * Ask Nansen who each registration wallet is, once per distinct wallet, politely.
 *
 *   NANSEN_API_KEY=... ENVIO_PG_PASSWORD=... \
 *     node --experimental-strip-types src/cli/nansen-enrich.ts
 *   ... --limit 200            only the 200 wallets that registered the most agents
 *   ... --gap 400              400ms between calls, under Nansen's 5 per second
 *   ... --dry                  classify and print, write nothing
 *   ... --only 0xabc           a single address, for a spot check
 *
 * ## Why the labels endpoint and why the apikey path
 *
 * The operators page can say 7,962 wallets registered one dead document. It cannot say who they are.
 * Nansen's `POST /api/v1/profiler/address/labels` turns an address into its known entity and
 * behavioural labels, so that count becomes a distribution. That is Nansen data driving a core
 * feature rather than decorating a sidebar, which is the bounty's own test.
 *
 * Nansen supports paying per call over x402. On Monad it settles through the Molandak
 * facilitator, the same one this product pays its own verifier over. The client in lib/nansen.ts
 * speaks that path. But Nansen EXCLUDES the labels endpoint from x402: labels needs a Pro
 * subscription, so it is the apikey path. Read live from their docs on 2026-09-23. The x402 path is
 * where the profiler endpoints that do accept it run, for example related-wallets.
 *
 * ## Shaped around a rate limit, not around our impatience
 *
 * Nansen allows 5 requests a second and 60 a minute per wallet. So the sweep is serial with a gap
 * rather than a fan-out. One wallet is asked about once because a wallet's label is the same
 * whichever agent it registered. Deduplicating by wallet is what keeps this inside the limit and
 * off a paid meter for no reason.
 *
 * ## The fetch is guarded
 *
 * Even though api.nansen.ai is a fixed host we chose, the request still goes through the repo's SSRF
 * guard: the URL is screened and the host is resolved and every answer checked before the socket
 * connects, so a poisoned DNS answer pointing at a private address is refused rather than fetched.
 * That is the same guard the verifier uses on documents strangers put on chain.
 */
import https from "node:https";
import http from "node:http";
import type { LookupFunction } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { MAX_BYTES, TIMEOUT_MS, resolvePublic, screenUrl, type Resolver } from "../net/guard.ts";
import { connectionStringFrom } from "../store/store.ts";
import { enrichWallet, fetchRelatedWallets, firstFunder, NANSEN_BASE, type NansenAuth, type NansenHttpResponse, type NansenTransport, type WalletEnrichment } from "../../../lib/nansen.ts";

/* ------------------------------------------------------------------ the guarded transport */

/** Hands the socket the exact address the guard approved, so DNS cannot change under us. */
function pinnedLookup(addresses: string[]): LookupFunction {
  return ((hostname, options, callback) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const opts = typeof options === "function" ? {} : (options ?? {});
    const famOf = (a: string) => (a.includes(":") ? 6 : 4);
    if ((opts as { all?: boolean }).all) {
      cb(null, addresses.map((address) => ({ address, family: famOf(address) })));
    } else {
      cb(null, addresses[0]!, famOf(addresses[0]!));
    }
  }) as LookupFunction;
}

function flattenHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/**
 * One POST against an already-screened set of addresses.
 *
 * Returns the response for ANY status, including 402, 429 and 500, because the client needs the
 * status and the body to tell a payment challenge from a rate limit from a real answer. It throws
 * only on a transport failure: a timeout, a socket error, a body past the cap. A thrown error is a
 * fact about the exchange, never a made-up answer about the wallet.
 */
function postOnce(
  url: URL,
  addresses: string[],
  headers: Record<string, string>,
  body: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<NansenHttpResponse> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<NansenHttpResponse>((resolve, reject) => {
    let settled = false;
    const ok = (r: NansenHttpResponse) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const fail = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };

    const req = mod.request(
      url,
      { method: "POST", lookup: pinnedLookup(addresses), headers, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            ok({ status, headers: flattenHeaders(res.headers), bodyText: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          ok({ status, headers: flattenHeaders(res.headers), bodyText: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", (e) => fail(new Error(`read failed: ${e.message}`)));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      fail(new Error(`timed out after ${timeoutMs}ms`));
    });
    req.on("error", (e) => fail(new Error(`request failed: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

/**
 * A transport that screens through the SSRF guard, then connects to the exact address it screened.
 *
 * Exported so a test can inject a resolver and prove the guard refuses a host that resolves to a
 * private address, without opening a socket. A guard refusal throws rather than returning a status,
 * because there was no HTTP exchange to describe.
 */
export function guardedTransport(
  opts: { resolver?: Resolver; maxBytes?: number; timeoutMs?: number } = {},
): NansenTransport {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  return async (req) => {
    const screened = screenUrl(req.url);
    if (!screened.ok) throw new Error(`SSRF guard refused ${req.url}: ${screened.reason}`);
    const url = screened.url;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const resolved = await resolvePublic(host, opts.resolver);
    if (!resolved.ok) throw new Error(`SSRF guard refused ${host}: ${resolved.reason}`);
    return postOnce(url, resolved.addresses, req.headers, req.body, maxBytes, timeoutMs);
  };
}

/* ------------------------------------------------------------------ the store */

/** Append one enrichment row. There is no update path, same as every table in this schema. */
export async function writeLabel(pool: pg.Pool, e: WalletEnrichment): Promise<void> {
  await pool.query(
    `INSERT INTO fovea.wallet_label
       (address, chain, status, category, labels, label_count, source, auth_mode, reason, http_status, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      e.address,
      e.chain,
      e.status,
      e.category,
      e.labels,
      e.labelCount,
      e.source,
      e.authMode,
      e.reason,
      e.httpStatus,
      e.checkedAt,
    ],
  );
}

/** The distinct owner wallets, the ones that registered the most agents first. */
export async function ownerWallets(
  pool: pg.Pool,
  chainId: number,
  limit: number,
): Promise<{ address: string; agents: number }[]> {
  const r = await pool.query<{ address: string; agents: string }>(
    `SELECT lower(owner) AS address, count(*) AS agents
       FROM "Agent" WHERE "chainId" = $1
      GROUP BY lower(owner)
      ORDER BY count(*) DESC, lower(owner)
      LIMIT $2`,
    [chainId, limit],
  );
  return r.rows.map((x) => ({ address: x.address, agents: Number(x.agents) }));
}

/* ------------------------------------------------------------------ the sweep */

type Args = { limit: number; gapMs: number; dry: boolean; only?: string };

export function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    limit: Number(get("limit") ?? 5000),
    gapMs: Math.max(0, Number(get("gap") ?? 300)),
    dry: argv.includes("--dry"),
    only: get("only"),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(argv = process.argv.slice(2)): Promise<number> {
  const a = parseArgs(argv);

  const apiKey = process.env.NANSEN_API_KEY ?? "";
  if (!apiKey) {
    console.error(
      "NANSEN_API_KEY is not set. The labels endpoint needs a Pro apikey (Nansen excludes it from " +
        "x402), so this refuses to run rather than make an unauthenticated call. Set NANSEN_API_KEY " +
        "in .env.local.",
    );
    return 2;
  }
  const auth: NansenAuth = { mode: "apikey", apiKey };
  const transport = guardedTransport();

  const pool = new pg.Pool({ connectionString: connectionStringFrom(), max: 4 });
  const here = dirname(fileURLToPath(import.meta.url));
  // Replaying the whole schema needs owner rights on every fovea table, which the app role does not
  // have in production. Migrations are applied by the database owner; --migrate is for a local DB.
  if (argv.includes("--migrate")) await pool.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));

  if (argv.includes("--funders")) {
    const code = await runFunders(pool, argv, auth, transport, a.gapMs, a.dry);
    await pool.end();
    return code;
  }

  let wallets = await ownerWallets(pool, 143, a.limit);
  if (a.only) wallets = wallets.filter((w) => w.address === a.only!.toLowerCase());

  console.log(`${wallets.length} distinct wallets, ${a.gapMs}ms between calls${a.dry ? ", dry run" : ""}`);
  const tally: Record<string, number> = { labeled: 0, unlabeled: 0, unknown: 0 };
  let done = 0;

  for (const w of wallets) {
    let e: WalletEnrichment;
    try {
      e = await enrichWallet(w.address, "monad", auth, transport);
    } catch (err) {
      // A transport throw (guard refusal, timeout, socket error) is our failure to look, so it is
      // unknown, never a label. Recorded rather than dropped so a re-run can retry it.
      e = {
        address: w.address,
        chain: "monad",
        status: "unknown",
        category: null,
        labels: [],
        labelCount: 0,
        source: "nansen:profiler/address/labels",
        authMode: "apikey",
        reason: err instanceof Error ? err.message : String(err),
        httpStatus: null,
        checkedAt: new Date().toISOString(),
      };
    }
    if (!a.dry) await writeLabel(pool, e);
    tally[e.status] = (tally[e.status] ?? 0) + 1;
    done++;
    if (e.status === "labeled" || w.agents > 5 || done % 100 === 0) {
      console.log(
        `  [${done}/${wallets.length}] ${e.status.padEnd(9)} ${String(w.agents).padStart(5)} agents  ` +
          `${e.category ?? "-"}  ${e.reason.slice(0, 60)}  ${w.address}`,
      );
    }
    if (a.gapMs) await sleep(a.gapMs);
  }

  console.log(
    `\n${tally.labeled} labeled, ${tally.unlabeled} answered with no label, ` +
      `${tally.unknown} could not be looked up.${a.dry ? "\n(--dry, nothing written)" : ""}`,
  );
  await pool.end();
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

/* ------------------------------------------------------------------ first funders */

/** Credits left, from Nansen's free account endpoint. Null when it cannot be read. */
async function creditsLeft(apiKey: string): Promise<number | null> {
  try {
    const r = await fetch(`${NANSEN_BASE}/api/v1/account`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { credits_remaining?: number };
    return typeof j.credits_remaining === "number" ? j.credits_remaining : null;
  } catch {
    return null;
  }
}

/**
 * Whether another billed Nansen call is allowed this run.
 *
 * Two guards in one, and both run every time. The budget is call-based, so it holds even when the
 * credit read failed (`credits` is null): an unattended daily timer can never overspend because it
 * lost sight of the balance. The reserve is balance-based and goes quiet on a null read. Whichever
 * trips first stops the run. This is the guard the live timer leans on, proven by a test that makes
 * the old reserve-only path fail it first.
 */
export function withinBudget(spent: number, budget: number, credits: number | null, reserve: number): boolean {
  if (spent >= budget) return false;
  if (credits !== null && credits - 1 < reserve) return false;
  return true;
}

/**
 * First funders for a reproducible random sample of wallets in the largest clusters, plus an
 * optional one-step reach up the graph.
 *
 *   --funders --clusters 20 --per-cluster 10 --budget 5 --reserve 5 --funder-reach
 *
 * The sample is ordered by md5(address), so a rerun asks the same wallets and a reader can re-derive
 * which were chosen. Wallets with an existing found/none answer are skipped. One run spends at most
 * --budget billed calls (default 5) and never drops the balance under --reserve. The budget cap is
 * call-based, so it holds even if Nansen's account read fails; both guards run together through
 * withinBudget. --funder-reach then asks, once per cluster, who first funded that cluster's own top
 * funder (1 credit, same endpoint, new subject), sharing the same budget so it can never overspend.
 *
 * creditsLeft is injectable so a test drives the whole run with no socket.
 */
export async function runFunders(
  pool: pg.Pool,
  argv: string[],
  auth: NansenAuth,
  transport: NansenTransport,
  gapMs: number,
  dry: boolean,
  opts: { creditsFn?: (apiKey: string) => Promise<number | null> } = {},
): Promise<number> {
  const creditsFn = opts.creditsFn ?? creditsLeft;
  const num = (k: string, d: number) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? Number(argv[i + 1]) : d;
  };
  const clusters = num("clusters", 3), per = num("per-cluster", 25), reserve = num("reserve", 5), budget = num("budget", 5);
  const reach = argv.includes("--funder-reach");
  const apiKey = auth.mode === "apikey" ? auth.apiKey : "";
  const top = await pool.query<{ id: string; uri: string; owners: string }>(
    `SELECT id, uri, "distinctOwners" AS owners FROM "AgentRecord" WHERE "chainId" = 143 AND "distinctOwners" > 1 ORDER BY "distinctOwners" DESC LIMIT $1`,
    [clusters],
  );
  let credits = await creditsFn(apiKey);
  let spent = 0;
  console.log(`first funders: ${top.rows.length} clusters, ${per} wallets each, credits ${credits ?? "unknown"}, budget ${budget}, reserve ${reserve}${reach ? ", funder-reach on" : ""}`);
  const tally = { found: 0, none: 0, unknown: 0, skipped: 0 };
  outer: for (const c of top.rows) {
    const w = await pool.query<{ address: string }>(
      `SELECT lower(o.owner) AS address FROM "AgentRecordOwner" o
        WHERE o.record_id = $1
          AND NOT EXISTS (SELECT 1 FROM fovea.wallet_funder_latest f WHERE f.address = lower(o.owner) AND f.chain = 'monad' AND f.status IN ('found','none'))
        ORDER BY md5(lower(o.owner)) LIMIT $2`,
      [c.id, per],
    );
    console.log(`  cluster ${c.uri.slice(0, 60)} (${c.owners} owners): asking ${w.rows.length}`);
    for (const { address } of w.rows) {
      if (!withinBudget(spent, budget, credits, reserve)) {
        console.log(`  stopping: spent ${spent}/${budget}, ${credits ?? "unknown"} credits left, reserve ${reserve}`);
        break outer;
      }
      const r = await fetchRelatedWallets(address, "monad", auth, transport).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e), authMode: "apikey" as const, httpStatus: null }));
      const f = firstFunder(r);
      // Only a billed (200) call counts against budget and credits. A 429/402/500 is ok:false and
      // deducts nothing, matching Nansen not charging rejected or rate-limited requests.
      if (r.ok) {
        spent += 1;
        if (credits !== null) credits -= 1;
      }
      tally[f.status]++;
      if (!dry) {
        await pool.query(
          `INSERT INTO fovea.wallet_funder (address, chain, status, funder, funder_label, tx, funded_at, reason, http_status, sample)
           VALUES ($1,'monad',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [address, f.status, f.status === "found" ? f.funder : null, f.status === "found" ? f.funderLabel : null, f.status === "found" ? f.tx : null, f.status === "found" ? f.fundedAt : null, f.status === "found" ? null : f.reason, r.httpStatus ?? null, `cluster:${c.id}`],
        );
      }
      if (f.status !== "found") console.log(`    ${f.status} ${address} ${"reason" in f ? f.reason.slice(0, 80) : ""}`);
      if (r.httpStatus === 403) break outer;
      if (gapMs) await sleep(gapMs);
    }
  }
  // --funder-reach: one step up the graph. For each cluster's current top funder, ask who first
  // funded IT (1 credit, same endpoint, new subject), under the same budget so it can never
  // overspend. Idempotent: a funder with a reach row already is skipped. Stored under the tag
  // funder:<address> so it never collides with the cluster:<id> sample rows.
  if (reach) {
    for (const c of top.rows) {
      const tf = await pool.query<{ funder: string }>(
        `SELECT funder FROM fovea.wallet_funder_latest
          WHERE sample = 'cluster:' || $1 AND chain = 'monad' AND status = 'found' AND funder IS NOT NULL
          GROUP BY funder ORDER BY count(*) DESC LIMIT 1`,
        [c.id],
      );
      const funder = tf.rows[0]?.funder;
      if (!funder) continue;
      const seen = await pool.query(
        `SELECT 1 FROM fovea.wallet_funder WHERE sample = 'funder:' || $1 AND chain = 'monad' AND status IN ('found','none') LIMIT 1`,
        [funder],
      );
      if (seen.rows.length) {
        tally.skipped += 1;
        continue;
      }
      if (!withinBudget(spent, budget, credits, reserve)) {
        console.log(`  funder-reach stopping: spent ${spent}/${budget}, ${credits ?? "unknown"} credits left, reserve ${reserve}`);
        break;
      }
      const r = await fetchRelatedWallets(funder, "monad", auth, transport).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e), authMode: "apikey" as const, httpStatus: null }));
      const f = firstFunder(r);
      if (r.ok) {
        spent += 1;
        if (credits !== null) credits -= 1;
      }
      tally[f.status] += 1;
      if (!dry) {
        await pool.query(
          `INSERT INTO fovea.wallet_funder (address, chain, status, funder, funder_label, tx, funded_at, reason, http_status, sample)
           VALUES ($1,'monad',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [funder, f.status, f.status === "found" ? f.funder : null, f.status === "found" ? f.funderLabel : null, f.status === "found" ? f.tx : null, f.status === "found" ? f.fundedAt : null, f.status === "found" ? null : f.reason, r.httpStatus ?? null, `funder:${funder}`],
        );
      }
      console.log(`  funder-reach ${funder}: ${f.status}`);
      if (r.httpStatus === 403) break;
      if (gapMs) await sleep(gapMs);
    }
  }

  console.log(`\n${tally.found} found, ${tally.none} none, ${tally.unknown} unknown, ${tally.skipped} skipped. spent ${spent}, credits now ${await creditsFn(apiKey) ?? "unknown"}${dry ? " (dry)" : ""}`);
  return 0;
}
