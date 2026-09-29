#!/usr/bin/env node
/**
 * Usage, counted without tracking people. Run every 10 minutes on the server (kanmani-usage.timer).
 *
 * 1. The web server's access log (Caddy JSON, kept 7 days) -> fovea.usage_daily and usage_integrator,
 *    for today and yesterday (UTC). Each run recomputes those two days from the log, so it is
 *    idempotent. Older days are closed: their salt is deleted and their rows are never touched again.
 *    Stored: counts per surface and client class, distinct clients as a count of salted hashes plus the
 *    names of sites and tools. Not stored: any IP, user agent string, path parameter or cookie.
 *
 * 2. Our contracts' events on Monad -> fovea.onchain_use, from a cursor, in 100-block windows (the
 *    public RPC's getLogs limit), capped per run so a backfill catches up across runs.
 *
 * Usage: node --experimental-strip-types scripts/usage-aggregate.mjs [--logs /var/log/caddy] [--no-chain]
 * Needs: FOVEA_DATABASE_URL (or the ENVIO_PG_* variables lib/db.ts reads).
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import pg from "pg";
import { classify, embedHost, MACHINE_SURFACES, surface, toolName } from "../lib/usage-classify.ts";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOG_DIR = arg("--logs", "/var/log/caddy");
const LOG_PREFIX = arg("--prefix", "kanmani");
const RPC = process.env.RPC_MONAD || "https://rpc.monad.xyz";
const OURS = new Set((process.env.KANMANI_OWN_ADDRESSES || "0xdb6c6340342e71a63cd11ebac2185204b7777777").toLowerCase().split(","));

function connectionString() {
  const e = process.env;
  if (e.FOVEA_DATABASE_URL) return e.FOVEA_DATABASE_URL;
  const pw = e.ENVIO_PG_PASSWORD ? `:${encodeURIComponent(e.ENVIO_PG_PASSWORD)}` : "";
  return `postgres://${e.ENVIO_PG_USER ?? "postgres"}${pw}@${e.ENVIO_PG_HOST ?? "127.0.0.1"}:${e.ENVIO_PG_PORT ?? "5434"}/${e.ENVIO_PG_DATABASE ?? "envio-dev"}`;
}
const db = new pg.Client({ connectionString: connectionString() });
await db.connect();
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ 1. access log */

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const OPEN = [yesterday, today];

async function saltFor(d) {
  const r = await db.query("SELECT salt FROM fovea.usage_salt WHERE day = $1", [d]);
  if (r.rows[0]) return r.rows[0].salt;
  const s = randomBytes(32);
  await db.query("INSERT INTO fovea.usage_salt (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING", [d, s]);
  return (await db.query("SELECT salt FROM fovea.usage_salt WHERE day = $1", [d])).rows[0].salt;
}
const salts = Object.fromEntries(await Promise.all(OPEN.map(async (d) => [d, await saltFor(d)])));

const files = readdirSync(LOG_DIR)
  .filter((f) => f.startsWith(LOG_PREFIX))
  .map((f) => join(LOG_DIR, f))
  // A rotated file older than two days cannot hold an open day.
  .filter((f) => Date.now() - statSync(f).mtimeMs < 3 * 86_400_000);

const agg = new Map(); // day|surface|class -> { calls, hashes:Set }
const integ = new Map(); // day|kind|name -> calls
let lines = 0;
for (const f of files) {
  const stream = f.endsWith(".gz") ? createReadStream(f).pipe(createGunzip()) : createReadStream(f);
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const d = day(e.ts);
    if (!salts[d]) continue;
    const r = e.request ?? {};
    const sfc = surface(r.method ?? "GET", r.uri ?? "/");
    if (!sfc) continue;
    lines++;
    const h = r.headers ?? {};
    const ua = (h["User-Agent"] ?? [""])[0];
    const cls = classify(ua);
    const ip = r.client_ip ?? r.remote_ip ?? "";
    const k = `${d}|${sfc}|${cls}`;
    let a = agg.get(k);
    if (!a) agg.set(k, (a = { calls: 0, hashes: new Set() }));
    a.calls++;
    // The only thing derived from the IP. It cannot outlive the day's salt.
    a.hashes.add(createHash("sha256").update(salts[d]).update(ip).update("\0").update(ua).digest("base64").slice(0, 22));
    if (cls !== "crawler" && MACHINE_SURFACES.has(sfc)) {
      const tool = cls === "software" ? toolName(ua) : null;
      if (tool) integ.set(`${d}|tool|${tool}`, (integ.get(`${d}|tool|${tool}`) ?? 0) + 1);
      if (sfc === "embed" || sfc === "api:agent") {
        const host = embedHost((h["Referer"] ?? [])[0], (h["Origin"] ?? [])[0]);
        if (host) integ.set(`${d}|embed-host|${host}`, (integ.get(`${d}|embed-host|${host}`) ?? 0) + 1);
      }
    }
  }
}

await db.query("BEGIN");
await db.query("DELETE FROM fovea.usage_daily WHERE day = ANY($1::date[])", [OPEN]);
// Only the kinds this script owns: mcp-client rows are written live by the app.
await db.query("DELETE FROM fovea.usage_integrator WHERE day = ANY($1::date[]) AND kind IN ('tool','embed-host')", [OPEN]);
for (const [k, v] of agg) {
  const [d, s, c] = k.split("|");
  await db.query("INSERT INTO fovea.usage_daily (day, surface, class, calls, clients) VALUES ($1,$2,$3,$4,$5)", [d, s, c, v.calls, v.hashes.size]);
}
for (const [k, n] of integ) {
  const [d, kind, name] = k.split("|");
  await db.query("INSERT INTO fovea.usage_integrator (day, kind, name, calls) VALUES ($1,$2,$3,$4)", [d, kind, name, n]);
}
// Close every day before yesterday: without its salt, its hashes can never be recomputed or linked.
await db.query("DELETE FROM fovea.usage_salt WHERE day < $1", [yesterday]);
await db.query("COMMIT");
console.log(`log: ${files.length} files, ${lines} counted requests, ${agg.size} rows, ${integ.size} integrator rows for ${OPEN.join(", ")}`);

/* ------------------------------------------------------------------ 2. our contracts on chain */

if (!process.argv.includes("--no-chain")) {
  const CONTRACTS = {
    aqueous: { address: "0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32", from: 106_000_000 },
    sclera: { address: "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf", from: 107_700_000 },
    agentPasskey: { address: "0x1E30531CD3ea6DE2958DB363418a5382C419dC24", from: 109_009_000 },
  };
  // topic0 -> [event, which topic is the actor, which topic is the agent id]
  const { keccak256, toHex } = await import("viem");
  const sig = (s) => keccak256(toHex(s));
  const EVENTS = {
    [sig("JobCreated(bytes32,address,address,address,uint256,uint256,uint64,bytes32)")]: ["JobCreated", 2, null],
    [sig("BondPosted(uint256,address,address,uint128,uint16,uint64,uint32,uint64)")]: ["BondPosted", 2, 1],
    [sig("PasskeyBound(uint256,address,uint256,uint256,uint256)")]: ["PasskeyBound", 2, 1],
    [sig("PasskeyUnbound(uint256,address)")]: ["PasskeyUnbound", 2, 1],
  };
  const rpc = async (method, params) => {
    for (let t = 0; t < 5; t++) {
      try {
        const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        // A rate-limited public RPC answers 200 with neither result nor error.
        if (!("result" in j)) throw new Error(`no result (HTTP ${r.status})`);
        return j.result;
      } catch (e) {
        if (t === 4) throw e;
        await new Promise((r) => setTimeout(r, 500 * (t + 1)));
      }
    }
  };
  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  const WINDOW = 100, PARALLEL = 4, MAX_WINDOWS = Number(arg("--max-windows", "3000"));
  for (const [name, c] of Object.entries(CONTRACTS)) {
    const cur = await db.query("SELECT block FROM fovea.usage_cursor WHERE name = $1", [name]);
    let from = cur.rows[0] ? Number(cur.rows[0].block) + 1 : c.from;
    let windows = 0, found = 0;
    while (from <= head && windows < MAX_WINDOWS) {
      const batch = [];
      for (let i = 0; i < PARALLEL && from + i * WINDOW <= head; i++) {
        const f = from + i * WINDOW, t = Math.min(f + WINDOW - 1, head);
        batch.push(
          rpc("eth_getLogs", [{ address: c.address, fromBlock: toHex(f), toBlock: toHex(t) }]).then((logs) => {
            // A null answer is a failed read, not "no events": the cursor must not move past it.
            if (!Array.isArray(logs)) throw new Error(`getLogs ${f}-${t} returned ${JSON.stringify(logs)}`);
            return { t, logs };
          }),
        );
      }
      let got;
      try {
        got = await Promise.all(batch);
      } catch (e) {
        console.log(`chain: ${name} stopped at ${from} for this run: ${e.message.slice(0, 120)}`);
        break;
      }
      for (const { logs } of got) {
        for (const l of logs) {
          const ev = EVENTS[l.topics[0]];
          if (!ev) continue;
          const actor = "0x" + l.topics[ev[1]].slice(26).toLowerCase();
          const agentId = ev[2] === null ? null : BigInt(l.topics[ev[2]]).toString();
          await db.query(
            `INSERT INTO fovea.onchain_use (tx, log_index, block, contract, event, actor, agent_id, ours) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [l.transactionHash, parseInt(l.logIndex, 16), parseInt(l.blockNumber, 16), name, ev[0], actor, agentId, OURS.has(actor)],
          );
          found++;
        }
      }
      const last = Math.max(...got.map((g) => g.t));
      await db.query("INSERT INTO fovea.usage_cursor (name, block) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET block = EXCLUDED.block", [name, last]);
      windows += got.length;
      from = last + 1;
      // Stay under the public RPC's rate limit: a steady crawl beats a burst that gets refused.
      await new Promise((r) => setTimeout(r, 120));
    }
    console.log(`chain: ${name} scanned ${windows} windows to ${from - 1} (head ${head}), ${found} events`);
  }
}
await db.end();
