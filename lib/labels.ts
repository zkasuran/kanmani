/**
 * Reading the Nansen enrichment back for the pages.
 *
 * Separate from lib/queries.ts on purpose: this is the one enrichment that comes from a paid third
 * party rather than from the chain, so it gets its own module and its own honesty rules rather than
 * being threaded through the query file everything else uses.
 *
 * Two rules carry over from the rest of the site. A wallet with no label is `unknown`, never a zero.
 * And a wallet we could not look up is kept apart in the store from one Nansen answered nothing for,
 * even though the page shows both as unknown, because our outage is not a fact about their wallet.
 *
 * Every read is guarded with `to_regclass`, because fovea.wallet_label only exists after the enrich
 * CLI has run once. Before that the page is not broken, it just shows every wallet as unknown, which
 * is exactly true: nobody has looked yet.
 */
import { CHAIN_ID, q, q1 } from "./db.ts";
import type { LabelCategory } from "./nansen.ts";

/** The chain string the enrichment rows are keyed on. Matches the CLI's `--chain monad`. */
export const LABEL_CHAIN = "monad";

/** A query and the text that produced it, so a page can print what it ran. */
export type Sourced<T> = { readonly sql: string; readonly rows: T };
const src = <T>(sql: string, rows: T): Sourced<T> => ({ sql: sql.trim(), rows });

export type CategoryCount = { category: LabelCategory; wallets: number };

/**
 * How the registry's owner wallets divide by what Nansen knows about them.
 *
 * `walletsTotal` is every distinct owner wallet in the registry. `labeled` splits by category.
 * `unlabeled` is Nansen answering with nothing. `unknownLookedUp` is a lookup that failed. `notLookedUp`
 * is a wallet the enrich CLI has not reached yet. The four non-labeled routes to one `unknown` on the
 * page. All of them plus the labeled buckets sum back to `walletsTotal`, which is checked on the
 * page the same way the operators buckets are.
 */
export type LabelDistribution = {
  walletsTotal: number;
  labeledWallets: number;
  unlabeled: number;
  unknownLookedUp: number;
  notLookedUp: number;
  byCategory: CategoryCount[];
  askedAt: string | null;
};

const WALLETS_TOTAL_SQL = `
SELECT count(*) AS wallets
FROM (SELECT DISTINCT lower(owner) AS address FROM "Agent" WHERE "chainId" = $1) o`;

const DISTRIBUTION_SQL = `
WITH owners AS (SELECT DISTINCT lower(owner) AS address FROM "Agent" WHERE "chainId" = $1)
SELECT w.status, w.category, count(*) AS wallets, max(w.checked_at) AS last_at
FROM owners o
JOIN fovea.wallet_label_latest w ON w.address = o.address AND w.chain = $2
GROUP BY w.status, w.category`;

/** True when the enrichment table has been created, so a read before the first CLI run is safe. */
async function tableExists(): Promise<boolean> {
  const r = await q1<{ present: boolean }>(
    "SELECT to_regclass('fovea.wallet_label_latest') IS NOT NULL AS present",
  );
  return Boolean(r?.present);
}

export async function labelDistribution(): Promise<Sourced<LabelDistribution>> {
  const totalRow = await q1<{ wallets: string }>(WALLETS_TOTAL_SQL, [CHAIN_ID]);
  const walletsTotal = Number(totalRow?.wallets ?? 0);

  const empty: LabelDistribution = {
    walletsTotal,
    labeledWallets: 0,
    unlabeled: 0,
    unknownLookedUp: 0,
    notLookedUp: walletsTotal,
    byCategory: [],
    askedAt: null,
  };

  if (!(await tableExists())) return src(DISTRIBUTION_SQL, empty);

  const rows = await q<{ status: string; category: string | null; wallets: string; last_at: string }>(
    DISTRIBUTION_SQL,
    [CHAIN_ID, LABEL_CHAIN],
  );

  const byCategory = new Map<LabelCategory, number>();
  let labeledWallets = 0;
  let unlabeled = 0;
  let unknownLookedUp = 0;
  let askedAt: string | null = null;

  for (const r of rows) {
    const wallets = Number(r.wallets);
    if (r.last_at && (askedAt === null || r.last_at > askedAt)) askedAt = r.last_at;
    if (r.status === "labeled" && r.category) {
      byCategory.set(r.category as LabelCategory, (byCategory.get(r.category as LabelCategory) ?? 0) + wallets);
      labeledWallets += wallets;
    } else if (r.status === "unlabeled") {
      unlabeled += wallets;
    } else {
      unknownLookedUp += wallets;
    }
  }

  const looked = labeledWallets + unlabeled + unknownLookedUp;
  return src(DISTRIBUTION_SQL, {
    walletsTotal,
    labeledWallets,
    unlabeled,
    unknownLookedUp,
    notLookedUp: Math.max(0, walletsTotal - looked),
    byCategory: [...byCategory.entries()]
      .map(([category, wallets]) => ({ category, wallets }))
      .sort((a, b) => b.wallets - a.wallets),
    askedAt: askedAt ? new Date(askedAt).toISOString() : null,
  });
}

/** The latest label for one wallet. Null when nobody has looked it up. */
export type WalletLabelRow = {
  status: "labeled" | "unlabeled" | "unknown";
  category: LabelCategory | null;
  labels: string[];
  reason: string;
  source: string;
  authMode: string;
  checkedAt: string;
};

const WALLET_LABEL_SQL = `
SELECT status, category, labels, reason, source, auth_mode, checked_at
FROM fovea.wallet_label_latest
WHERE address = lower($1) AND chain = $2
LIMIT 1`;

export async function walletLabel(address: string): Promise<WalletLabelRow | null> {
  if (!address || !(await tableExists())) return null;
  const r = await q1<{
    status: string;
    category: string | null;
    labels: string[] | null;
    reason: string;
    source: string;
    auth_mode: string;
    checked_at: string;
  }>(WALLET_LABEL_SQL, [address, LABEL_CHAIN]);
  if (!r) return null;
  return {
    status: r.status as WalletLabelRow["status"],
    category: (r.category as LabelCategory | null) ?? null,
    labels: r.labels ?? [],
    reason: r.reason,
    source: r.source,
    authMode: r.auth_mode,
    checkedAt: new Date(r.checked_at).toISOString(),
  };
}

/** Display metadata per category, kept here because it is presentation, not classification. */
export const CATEGORY_META: Record<LabelCategory, { label: string; cls: string }> = {
  smart_money: { label: "smart money", cls: "text-[var(--color-brand)] bg-[var(--color-brand-dim)]/25" },
  cefi: { label: "exchange / CeFi", cls: "text-[var(--color-true)] bg-[var(--color-true-bg)]" },
  defi: { label: "DeFi", cls: "text-[var(--color-true)] bg-[var(--color-true-bg)]/60" },
  nft: { label: "NFT", cls: "text-[var(--color-noclaim)] bg-[var(--color-noclaim-bg)]" },
  social: { label: "social", cls: "text-[var(--color-noclaim)] bg-[var(--color-noclaim-bg)]/60" },
  behavioral: { label: "behavioural", cls: "text-muted bg-[var(--color-panel-2)]" },
  other: { label: "other", cls: "text-muted bg-[var(--color-panel-2)]" },
};
