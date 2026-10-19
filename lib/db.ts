/**
 * The one connection to the one database.
 *
 * Cornea reads two schemas that are owned by different things and have different lifecycles:
 *
 * - `public` belongs to Envio. It is dropped and recreated on every indexer resync, so nothing
 *   here may hold a reference to a row in it across requests and no query may assume a table
 *   exists. A resync mid-request shows as an error, which is honest, rather than as a stale
 *   number, which is not.
 * - `fovea` belongs to us. Append only. It survives a resync precisely because it is not in
 *   `public`, which is the whole reason it was moved out.
 *
 * Pages read through this file and nowhere else, so there is exactly one place where a query
 * becomes a number on a page.
 */
import pg from "pg";

/**
 * Postgres `numeric` comes back as a string by default because it can exceed IEEE754. Block
 * numbers and agent ids are both numeric here and both are small enough to be safe, but the
 * parser is global and changing it would silently corrupt a real bignum somewhere else. So the
 * default stays and every read site converts deliberately.
 *
 * `int8` (bigint) gets the same treatment for the same reason: `count(*)` returns int8 and
 * arrives as a string, which is why every count in queries.ts goes through Number().
 */

declare global {
  // Next's dev server re-evaluates modules on every edit. Without this the pool leaks a new
  // set of connections per edit until Postgres refuses them, which reads as "the database is
  // down" about ninety seconds into a styling session. `var` is what a global augmentation
  // takes: `let` and `const` do not attach to globalThis.
  var __corneaPool: pg.Pool | undefined;
}

export function connectionString(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FOVEA_DATABASE_URL) return env.FOVEA_DATABASE_URL;
  const host = env.ENVIO_PG_HOST ?? "127.0.0.1";
  const port = env.ENVIO_PG_PORT ?? "5434";
  const user = env.ENVIO_PG_USER ?? "postgres";
  const db = env.ENVIO_PG_DATABASE ?? "envio-dev";
  const pw = env.ENVIO_PG_PASSWORD;
  if (!pw) {
    throw new Error(
      "Cornea needs a database. Set FOVEA_DATABASE_URL or ENVIO_PG_PASSWORD plus the ENVIO_PG_* " +
        "parts. There is no default password on purpose.",
    );
  }
  return `postgres://${user}:${encodeURIComponent(pw)}@${host}:${port}/${db}`;
}

export function pool(): pg.Pool {
  if (!globalThis.__corneaPool) {
    const cs = connectionString();
    // Enforce TLS for a remote database. A loopback connection on the box needs none and forcing it
    // would break the deployment, so it is switched on only when the host is not local.
    const host = hostOf(cs);
    const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
    globalThis.__corneaPool = new pg.Pool({
      connectionString: cs,
      max: 8,
      // A page that cannot get a connection in five seconds should say so rather than hang
      // until the browser gives up with nothing on screen.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // No single query may hold a connection forever. Without this a heavy or pathological read on
      // an eight-connection pool can starve the whole site, since every page reads through here. The
      // server-side statement_timeout bounds the query on the database and query_timeout bounds the
      // wait on the client, so a runaway is cancelled rather than pinning a slot until it finishes.
      statement_timeout: 10_000,
      query_timeout: 12_000,
      idle_in_transaction_session_timeout: 15_000,
      ...(isLocal ? {} : { ssl: { rejectUnauthorized: true } }),
    });
  }
  return globalThis.__corneaPool;
}

/** The host out of a postgres connection string, for deciding whether TLS is needed. */
function hostOf(cs: string): string {
  try {
    return new URL(cs).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

/**
 * Whether to log that queries are queueing for a connection. Pure so a test can hold it.
 *
 * Two bursts of timeouts (14 and 19 October) left only "timeout exceeded when trying to connect" behind,
 * which says the pool was full and not why. A line naming how many were waiting, at most one every thirty
 * seconds, makes the next one diagnosable without adding noise to a healthy day.
 */
export const POOL_WARN_EVERY_MS = 30_000;
export function shouldWarnPoolPressure(waiting: number, now: number, lastWarnAt: number): boolean {
  return waiting >= 3 && now - lastWarnAt >= POOL_WARN_EVERY_MS;
}
let lastPoolWarn = 0;

export async function q<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const p = pool();
  const now = Date.now();
  if (shouldWarnPoolPressure(p.waitingCount, now, lastPoolWarn)) {
    lastPoolWarn = now;
    console.warn(`[db] pool pressure: ${p.waitingCount} queries waiting, ${p.totalCount - p.idleCount} of ${p.options.max} connections busy`);
  }
  const r = await p.query<T>(sql, params as unknown[]);
  return r.rows;
}

export async function q1<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

/**
 * The chain this deployment indexes. Kept as a constant rather than read per row because every
 * table is partitioned by it and a page that silently mixed two chains would be wrong in a way
 * nobody would notice.
 */
export const CHAIN_ID = 143;
