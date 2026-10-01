/**
 * First funders of registration wallets, per cluster, from fovea.wallet_funder (Nansen
 * related-wallets). A random sample per cluster, ordered by md5(address), so it is reproducible.
 * A sample is reported as a sample: "60 of 62 sampled", never as a claim about every wallet.
 */
import { q } from "./db.ts";

export type ClusterFunders = {
  uri: string;
  owners: number;
  sampled: number;
  found: number;
  distinctFunders: number;
  topFunder: string | null;
  topFunderLabel: string | null;
  topFunderWallets: number;
  exampleTx: string | null;
  askedAt: string | null;
};

export const FUNDERS_SQL = `
WITH s AS (
  SELECT f.*, r.uri, r."distinctOwners" AS owners FROM fovea.wallet_funder_latest f
  JOIN "AgentRecord" r ON 'cluster:' || r.id = f.sample AND r."chainId" = 143
), top AS (
  SELECT DISTINCT ON (sample) sample, funder, funder_label, count(*) AS n, min(tx) AS tx
  FROM s WHERE status = 'found' GROUP BY sample, funder, funder_label ORDER BY sample, count(*) DESC
)
SELECT s.uri, s.owners, count(*) AS sampled, count(*) FILTER (WHERE s.status = 'found') AS found,
       count(DISTINCT s.funder) AS funders, t.funder AS top_funder, t.funder_label AS top_label, t.n AS top_n,
       t.tx AS example_tx, max(s.checked_at) AS asked_at
FROM s LEFT JOIN top t USING (sample)
GROUP BY s.uri, s.owners, t.funder, t.funder_label, t.n, t.tx
ORDER BY s.owners DESC, s.uri`;

export async function clusterFunders(): Promise<{ sql: string; rows: ClusterFunders[] } | null> {
  try {
    const rows = await q<Record<string, string | null>>(FUNDERS_SQL);
    return {
      sql: FUNDERS_SQL.trim(),
      rows: rows.map((r) => ({
        uri: r.uri!,
        owners: Number(r.owners),
        sampled: Number(r.sampled),
        found: Number(r.found),
        distinctFunders: Number(r.funders),
        topFunder: r.top_funder,
        topFunderLabel: r.top_label || null,
        topFunderWallets: Number(r.top_n ?? 0),
        exampleTx: r.example_tx,
        askedAt: r.asked_at ? new Date(r.asked_at).toISOString() : null,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * One cluster's first-funder sample, by its record id (the uriHash). The cluster page and Twin both
 * hold that id, so this is the per-cluster twin of clusterFunders() with no new join: the sample key
 * is `cluster:<id>`, matching how the sampler writes it. Returns null when the cluster has no sample
 * yet (or the table does not exist yet), which funderSummary() renders as unsampled, never a zero.
 */
export const FUNDER_ONE_SQL = `
WITH s AS (SELECT * FROM fovea.wallet_funder_latest WHERE sample = 'cluster:' || $1 AND chain = 'monad'),
top AS (
  SELECT funder, funder_label, count(*) AS n, min(tx) AS tx
  FROM s WHERE status = 'found' GROUP BY funder, funder_label ORDER BY count(*) DESC LIMIT 1)
SELECT count(*) AS sampled, count(*) FILTER (WHERE s.status = 'found') AS found,
       count(DISTINCT s.funder) AS funders, t.funder AS top_funder, t.funder_label AS top_label,
       t.n AS top_n, t.tx AS example_tx, max(s.checked_at) AS asked_at
FROM s LEFT JOIN top t ON true GROUP BY t.funder, t.funder_label, t.n, t.tx`;

export async function clusterFunder(recordId: string): Promise<ClusterFunders | null> {
  try {
    const rows = await q<Record<string, string | null>>(FUNDER_ONE_SQL, [recordId]);
    const r = rows[0];
    if (!r || Number(r.sampled) === 0) return null;
    return {
      uri: "",
      owners: 0,
      sampled: Number(r.sampled),
      found: Number(r.found),
      distinctFunders: Number(r.funders),
      topFunder: r.top_funder,
      topFunderLabel: r.top_label || null,
      topFunderWallets: Number(r.top_n ?? 0),
      exampleTx: r.example_tx,
      askedAt: r.asked_at ? new Date(r.asked_at).toISOString() : null,
    };
  } catch {
    return null;
  }
}
