/**
 * How many escrow jobs have settled in USDC on Monad mainnet, counted from the chain.
 *
 * Every settlement out of Aqueous, flat or metered, goes through one `_settle`, which emits
 * `Settled`. The count is the number of those logs. It used to be the typed string "1 job", which went
 * stale the day a second job settled.
 *
 * Stored, not rescanned. Public RPCs cap eth_getLogs at 100 to 1,000 blocks and HyperSync
 * rate-limits the server, so each `Settled` log is kept in fovea.settled_job with a cursor. A request
 * scans only the blocks since the cursor, in bounded 1,000-block steps, then counts the table. The
 * history before the first scan was seeded from HyperSync (scripts/seed-settled-jobs.mjs).
 *
 * A failed scan never invents a number: the stored count is returned with the block it is good
 * through. Nothing stored at all is null, which the page shows as unknown.
 */
import { q } from "./db.ts";

export const AQUEOUS = "0xd75f7786d0dd42c8f161bd78e87d37001044fc32";
/** keccak256("Settled(bytes32,address,address,uint256,uint256,uint256,address)") */
export const SETTLED_TOPIC = "0x7a9f2c7ad0c277bb2d581018d537473ef509de757f16c955da69691e9138a91d";
export const CHUNK = 1_000;
const MAX_CHUNKS_PER_CALL = 40;
const TTL_MS = 60_000;

export type SettledJobs = { count: number; paidAtomic: bigint; throughBlock: number };
export type RawLog = { transactionHash: string; blockNumber: string; topics: string[]; data: string };
export type Row = { tx: string; block: number; agent: string; paidAtomic: bigint };

export const DDL = `
CREATE SCHEMA IF NOT EXISTS fovea;
CREATE TABLE IF NOT EXISTS fovea.settled_job (
  tx text PRIMARY KEY, block bigint NOT NULL, agent text NOT NULL, paid_atomic numeric NOT NULL
);
CREATE TABLE IF NOT EXISTS fovea.settled_cursor (id int PRIMARY KEY CHECK (id = 1), through_block bigint NOT NULL);
`;

/** One Settled log to a row. `paid` is the second data word: (token, paid, returned, units, settledBy). */
export function rowOf(l: RawLog): Row {
  return {
    tx: l.transactionHash.toLowerCase(),
    block: Number(BigInt(l.blockNumber)),
    agent: ("0x" + l.topics[2].slice(-40)).toLowerCase(),
    paidAtomic: BigInt("0x" + l.data.slice(2 + 64, 2 + 128)),
  };
}

/** The [from, to] ranges for one call, at most `max` chunks, never past `head`. */
export function plan(after: number, head: number, chunk = CHUNK, max = MAX_CHUNKS_PER_CALL): [number, number][] {
  const out: [number, number][] = [];
  let from = after + 1;
  while (from <= head && out.length < max) {
    const to = Math.min(from + chunk - 1, head);
    out.push([from, to]);
    from = to + 1;
  }
  return out;
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const b = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (!r.ok || b.error) throw new Error(b.error?.message ?? `HTTP ${r.status}`);
  return b.result;
}

let ready: Promise<unknown> | null = null;
let cached: { at: number; value: SettledJobs | null } | null = null;

export async function settledJobs(env: Record<string, string | undefined> = process.env): Promise<SettledJobs | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    ready ??= q(DDL);
    await ready;
    const url = env.MONAD_LOGS_RPC || env.RPC_MONAD_FALLBACK || env.RPC_MONAD;
    const cur = await q<{ through_block: string }>(`SELECT through_block FROM fovea.settled_cursor WHERE id = 1`);
    if (cur.length === 0) return (cached = { at: Date.now(), value: null }).value;
    let through = Number(cur[0].through_block);
    if (url) {
      try {
        const head = Number(BigInt((await rpc(url, "eth_blockNumber", [])) as string));
        for (const [from, to] of plan(through, head)) {
          const logs = (await rpc(url, "eth_getLogs", [
            { address: AQUEOUS, topics: [SETTLED_TOPIC], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) },
          ])) as RawLog[];
          for (const r of logs.map(rowOf)) {
            await q(`INSERT INTO fovea.settled_job (tx, block, agent, paid_atomic) VALUES ($1,$2,$3,$4) ON CONFLICT (tx) DO NOTHING`, [r.tx, r.block, r.agent, r.paidAtomic.toString()]);
          }
          through = to;
          await q(`UPDATE fovea.settled_cursor SET through_block = $1 WHERE id = 1`, [through]);
        }
      } catch {
        // The stored count stands, good through `through`. A scan failure is not a zero.
      }
    }
    const agg = await q<{ n: string; paid: string | null }>(`SELECT count(*) AS n, sum(paid_atomic) AS paid FROM fovea.settled_job`);
    const value = { count: Number(agg[0].n), paidAtomic: BigInt(agg[0].paid ?? "0"), throughBlock: through };
    return (cached = { at: Date.now(), value }).value;
  } catch {
    return null;
  }
}

/** "1 job" or "N jobs". */
export function jobsLabel(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "job" : "jobs"}`;
}
