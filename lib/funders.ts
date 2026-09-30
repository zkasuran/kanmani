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
