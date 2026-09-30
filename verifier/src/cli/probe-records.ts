/**
 * Resolve every distinct registration document once, politely.
 *
 *   ENVIO_PG_PASSWORD=... node --experimental-strip-types src/cli/probe-records.ts
 *   ... --limit 50 --dry            read the 50 biggest clusters, write nothing
 *   ... --host-gap 500 --hosts 4    half a second between hits on one host, 4 hosts at a time
 *
 * ## Why this is shaped around other people's servers
 *
 * 1,862 of Monad's 2,012 distinct records are http and three hosts carry 1,771 of them:
 * `agent-arcade-steel.vercel.app` has 762, `api.monadmogs.xyz` 526 and `dashboard.dev.fun` 483.
 * A naive pass with global concurrency would put hundreds of simultaneous requests on one small
 * deployment. We are publishing findings about these operators. Knocking their site over while
 * measuring whether their site is up would be its own answer.
 *
 * So the queue is **per host, serial, with a gap** and the concurrency is across hosts rather
 * than within one. Documents that need no network at all (`data:`, inline JSON) never enter a
 * host queue, which is most of the remainder.
 */
import pg from "pg";
import { connectionStringFrom } from "../store/store.ts";
import { probeRecord, recordProbe, recordTargets, type RecordTarget } from "../store/records.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Args = {
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
    limit: Number(get("limit") ?? 5000),
    hosts: Math.max(1, Number(get("hosts") ?? 4)),
    hostGapMs: Math.max(0, Number(get("host-gap") ?? 350)),
    dry: argv.includes("--dry"),
    only: get("only"),
  };
}

/** The host a target will actually contact or null when it contacts nothing. */
function hostOf(uri: string): string | null {
  const t = (uri ?? "").trim();
  if (!t || t.startsWith("data:") || t.startsWith("{")) return null;
  if (t.startsWith("ipfs://")) return "ipfs-gateway";
  try {
    return new URL(t).host.toLowerCase();
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const a = parseArgs(argv);
  const pool = new pg.Pool({ connectionString: connectionStringFrom(), max: 4 });
  const here = dirname(fileURLToPath(import.meta.url));
  // The app role cannot replay the whole schema in production (it does not own every fovea object).
  // Migrations are applied by the database owner. --migrate is for a local database.
  if (argv.includes("--migrate")) await pool.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));

  let targets = await recordTargets(pool, 143, a.limit);
  if (a.only) targets = targets.filter((t) => t.uri.includes(a.only!));

  const offline: RecordTarget[] = [];
  const byHost = new Map<string, RecordTarget[]>();
  for (const t of targets) {
    const h = hostOf(t.uri);
    if (h === null) offline.push(t);
    else byHost.set(h, [...(byHost.get(h) ?? []), t]);
  }

  console.log(
    `${targets.length} distinct records: ${offline.length} need no network, ` +
      `${targets.length - offline.length} across ${byHost.size} hosts ` +
      `(${a.hosts} hosts at a time, ${a.hostGapMs}ms between hits on one host)`,
  );

  const tally = { reachable: 0, unreachable: 0, agentsBehindDead: 0 };
  let done = 0;

  const record = async (t: RecordTarget) => {
    const p = await probeRecord(t);
    if (!a.dry) await recordProbe(pool, p);
    if (p.reachable) tally.reachable++;
    else {
      tally.unreachable++;
      tally.agentsBehindDead += t.memberCount;
    }
    done++;
    // Only the clusters worth a line. A singleton failing is a row, not news.
    if (t.memberCount > 5 || done % 250 === 0) {
      console.log(
        `  [${done}/${targets.length}] ${p.reachable ? "ok  " : "dead"} ` +
          `${String(t.memberCount).padStart(5)} agents  ${p.reason.slice(0, 60)}  ${t.uri.slice(0, 70)}`,
      );
    }
  };

  // Nothing to be polite about, so these go straight through.
  for (const t of offline) await record(t);

  // One worker per host slot. A slot takes the next whole host queue and works it in order, which
  // is what keeps a single host serial without a lock.
  const queue = [...byHost.values()];
  const worker = async () => {
    for (;;) {
      const hostQueue = queue.shift();
      if (!hostQueue) return;
      for (const t of hostQueue) {
        await record(t);
        if (a.hostGapMs) await sleep(a.hostGapMs);
      }
    }
  };
  await Promise.all(Array.from({ length: a.hosts }, worker));

  console.log(
    `\n${tally.reachable} records still resolve, ${tally.unreachable} do not. ` +
      `${tally.agentsBehindDead} agents point at a document that does not resolve.` +
      (a.dry ? "\n(--dry, nothing written)" : ""),
  );
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
