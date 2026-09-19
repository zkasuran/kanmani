/**
 * Writing verdicts down.
 *
 * Append only, with no update path anywhere in this file. That is deliberate and it is the feature:
 * we publish verdicts about other people's work, so being wrong has to be cheap to fix and visible.
 * An operator who repairs a broken document should see `false -> true` with both timestamps rather
 * than a number quietly improving with no trace we ever said otherwise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import type { Verdict } from "../ladder/verdict.ts";

export type VerdictRow = Verdict & { feedbackId: string; feedbackUri: string; automatic?: boolean };

export function connectionStringFrom(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FOVEA_DATABASE_URL) return env.FOVEA_DATABASE_URL;
  const host = env.ENVIO_PG_HOST ?? "127.0.0.1";
  const port = env.ENVIO_PG_PORT ?? "5434";
  const user = env.ENVIO_PG_USER ?? "postgres";
  const db = env.ENVIO_PG_DATABASE ?? "envio-dev";
  const pw = env.ENVIO_PG_PASSWORD;
  if (!pw) throw new Error("ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL is required");
  return `postgres://${user}:${encodeURIComponent(pw)}@${host}:${port}/${db}`;
}

export class VerdictStore {
  // Declared and assigned separately rather than as a parameter property. Node's
  // --experimental-strip-types erases types without emitting anything and a parameter property is
  // one of the few TypeScript features that needs real emit, so `private constructor(private pool)`
  // fails at load with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Worth knowing before reaching for enums
  // or decorators anywhere in this package.
  private readonly pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  static async open(connectionString = connectionStringFrom()): Promise<VerdictStore> {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const here = dirname(fileURLToPath(import.meta.url));
    // Idempotent DDL, run on every open. The schema is ours, so nothing else is racing to define
    // it and this removes a whole class of "works on my machine" from the deploy.
    await pool.query(readFileSync(join(here, "schema.sql"), "utf8"));
    return new VerdictStore(pool);
  }

  /** Records a verdict. There is no update counterpart, on purpose. */
  async record(v: VerdictRow): Promise<number> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO fovea.verdict
         (feedback_id, feedback_uri, rung, outcome, reason,
          declared_network, declared_tx, mapping, hash_matches, computed_hash,
          found_chain, found_chain_id, found_block, checked_at, checked_at_block, automatic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
        v.foundOnChain?.chain ?? null,
        v.foundOnChain?.chainId ?? null,
        v.foundOnChain?.blockNumber ?? null,
        v.checkedAt,
        v.checkedAtBlock ?? null,
        v.automatic ?? true,
      ],
    );
    return Number(r.rows[0]!.id);
  }

  /** Every verdict ever recorded for one claim, oldest first. This is the correction trail. */
  async history(feedbackId: string): Promise<{ outcome: string; reason: string; checkedAt: Date }[]> {
    const r = await this.pool.query(
      `SELECT outcome, reason, checked_at FROM fovea.verdict
        WHERE feedback_id = $1 ORDER BY checked_at ASC, id ASC`,
      [feedbackId],
    );
    return r.rows.map((x) => ({ outcome: x.outcome, reason: x.reason, checkedAt: x.checked_at }));
  }

  async tally(): Promise<Record<string, number>> {
    const r = await this.pool.query(
      "SELECT outcome, count(*)::int AS n FROM fovea.verdict_latest GROUP BY outcome",
    );
    return Object.fromEntries(r.rows.map((x) => [x.outcome, x.n]));
  }

  /**
   * Claims whose verdict changed between their first and latest check.
   *
   * This is the view that makes being wrong survivable in public. A fixed document shows here as
   * `false -> true` with both timestamps, which reads better for the operator than never having
   * been measured at all.
   */
  async changed(): Promise<{ feedbackId: string; from: string; to: string }[]> {
    const r = await this.pool.query(
      `WITH first AS (SELECT DISTINCT ON (feedback_id) feedback_id, outcome
                        FROM fovea.verdict ORDER BY feedback_id, checked_at ASC, id ASC),
            last  AS (SELECT DISTINCT ON (feedback_id) feedback_id, outcome
                        FROM fovea.verdict ORDER BY feedback_id, checked_at DESC, id DESC)
       SELECT f.feedback_id, f.outcome AS from_outcome, l.outcome AS to_outcome
         FROM first f JOIN last l USING (feedback_id)
        WHERE f.outcome IS DISTINCT FROM l.outcome`,
    );
    return r.rows.map((x) => ({
      feedbackId: x.feedback_id,
      from: x.from_outcome,
      to: x.to_outcome,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
