import Link from "next/link";
import { Derivation, DistBar, Mono, Num, OutcomeBadge, Panel, RungLadder, StatTile } from "@/components/ui.tsx";
import { claims, claimsCount, mappingCoverage, type Outcome } from "@/lib/queries.ts";
import { searchedChains, searchedVia } from "@/lib/findtx.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Claims",
  description: "Every evidence document on Monad with a URI and what checking it against the chain found.",
};

const OUTCOMES: { key: Outcome | "all"; label: string }[] = [
  { key: "all", label: "everything" },
  { key: "false", label: "not on the chain they name" },
  { key: "true", label: "on the chain they name" },
  { key: "unknown", label: "could not check" },
  { key: "noClaim", label: "assert no payment" },
];

const PER_PAGE = 60;

type Props = {
  searchParams: Promise<{ outcome?: string; mapping?: string; page?: string }>;
};

export default async function Claims({ searchParams }: Props) {
  const sp = await searchParams;
  const outcome = (["true", "false", "noClaim", "unknown"] as const).find((o) => o === sp.outcome);
  const mapping = sp.mapping;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filter = { outcome, mapping, limit: PER_PAGE, offset: (page - 1) * PER_PAGE };

  const [list, total, cov] = await Promise.all([
    claims(filter),
    claimsCount({ outcome, mapping }),
    mappingCoverage(),
  ]);

  const mappings = [...new Set(cov.rows.map((c) => c.mapping))].filter((m) => !m.startsWith("("));
  const pages = Math.ceil(total / PER_PAGE);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { outcome: sp.outcome, mapping: sp.mapping, page: sp.page, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/claims?${s}` : "/claims";
  };

  // The verdict split of the whole checked corpus, summed from the coverage rows already fetched
  // above. This is the population, not the current filter, so the tiles read the same as the
  // landing page rather than the count in the filter bar.
  const outcomeTotal = (o: Outcome) =>
    cov.rows.reduce((n, r) => (r.outcome === o ? n + r.count : n), 0);
  const trueN = outcomeTotal("true");
  const falseN = outcomeTotal("false");
  const noClaimN = outcomeTotal("noClaim");
  const unknownN = outcomeTotal("unknown");

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- header */}
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-8 pt-10 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <span className="kicker">claims · monad mainnet · chain 143</span>
          <h1 className="mt-4 max-w-4xl fluid-3 font-semibold leading-[1.15] tracking-tight">
            Every evidence document and what checking it found
          </h1>
          <p className="lead lead--wide mt-4 text-muted">
            One row per evidence document carrying a URI. Ordered newest first by the block the
            feedback was recorded in. There is no score and no ranking here, because a list of other
            people&apos;s documents sorted by an opinion of ours would be exactly the thing this site
            argues against.
          </p>

          {/* the whole checked population at a glance, before any filter narrows it */}
          <div className="mt-7 auto-grid">
            <StatTile label="not on the chain they name" value={falseN} tone="false" hint="We read the chain the document names and the cited transaction is not on it." />
            <StatTile label="on the chain they name" value={trueN} tone="true" hint="The cited transaction is on the chain the document names." />
            <StatTile label="could not check" value={unknownN} tone="unknown" hint="A fetch failed, the bytes moved or no mapping read the shape. Never an accusation." />
            <StatTile label="assert no payment" value={noClaimN} hint="Read fine, claims nothing, so there is nothing to be right or wrong about." />
          </div>

          <div className="mt-6 max-w-3xl">
            <DistBar
              segments={[
                { value: noClaimN, className: "bg-[var(--color-noclaim)]", label: "assert no payment" },
                { value: falseN, className: "bg-[var(--color-false)]", label: "not on the named chain" },
                { value: trueN, className: "bg-[var(--color-true)]", label: "on the named chain" },
                { value: unknownN, className: "bg-[var(--color-unknown)]", label: "could not check" },
              ]}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
              <Legend className="bg-[var(--color-noclaim)]" label={`${noClaimN.toLocaleString()} no claim`} />
              <Legend className="bg-[var(--color-false)]" label={`${falseN.toLocaleString()} false`} />
              <Legend className="bg-[var(--color-true)]" label={`${trueN.toLocaleString()} true`} />
              <Legend className="bg-[var(--color-unknown)]" label={`${unknownN.toLocaleString()} unknown`} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- filters */}
      <div className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">verdict</span>
          {OUTCOMES.map((o) => {
            const active = (o.key === "all" && !outcome) || o.key === outcome;
            return (
              <Link
                key={o.key}
                href={qs({ outcome: o.key === "all" ? undefined : o.key, page: undefined })}
                className={`rounded border px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
                  active
                    ? "border-[var(--color-brand)] bg-[var(--color-brand-dim)]/20 text-[var(--color-text)]"
                    : "border-[var(--color-line)] text-muted hover:border-[var(--color-line-bright)]"
                }`}
              >
                {o.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">shape</span>
          <Link
            href={qs({ mapping: undefined, page: undefined })}
            className={`rounded border px-2.5 py-1 font-mono text-[11.5px] ${
              !mapping
                ? "border-[var(--color-brand)] bg-[var(--color-brand-dim)]/20"
                : "border-[var(--color-line)] text-muted hover:border-[var(--color-line-bright)]"
            }`}
          >
            any
          </Link>
          {mappings.map((m) => (
            <Link
              key={m}
              href={qs({ mapping: m, page: undefined })}
              className={`rounded border px-2.5 py-1 font-mono text-[11.5px] ${
                mapping === m
                  ? "border-[var(--color-brand)] bg-[var(--color-brand-dim)]/20"
                  : "border-[var(--color-line)] text-muted hover:border-[var(--color-line-bright)]"
              }`}
            >
              {m}
            </Link>
          ))}
        </div>
        <p className="border-t border-[var(--color-line)] pt-2 font-mono text-[11.5px] text-faint">
          <Num value={total} /> matching {total === 1 ? "claim" : "claims"}
          {pages > 1 ? ` · page ${page} of ${pages}` : ""}
          <span className="mx-2">·</span>
          <a href={`/api/claims?${new URLSearchParams(Object.entries({ outcome: sp.outcome, mapping: sp.mapping }).filter(([, v]) => v) as [string, string][]).toString()}`} className="text-muted hover:text-[var(--color-text)]">
            same filter as JSON →
          </a>
        </p>
        {(() => {
          const searched = searchedChains(143);
          return searched.length > 0 ? (
            <p className="pt-1 font-mono text-[11px] text-faint">
              false verdicts are {searchedVia(searched)}, so a mislabelled network is told apart from a missing payment
            </p>
          ) : null;
        })()}
      </div>

      {/* ---------------------------------------------------------------- rows */}
      <Panel title="matching documents">
        <div className="space-y-px">
          {list.rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">
              Nothing matches that filter. That is a real answer, not an empty page.
            </p>
          ) : null}
          {list.rows.map((c) => (
            <Link
              key={c.id}
              href={`/claim/${encodeURIComponent(c.id)}`}
              className="block rounded border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-20 shrink-0">
                  <OutcomeBadge outcome={c.outcome} />
                </span>
                <span className="w-16 shrink-0 font-mono text-[12px] text-muted">#{c.agentNumber}</span>
                <span className="w-44 shrink-0">
                  <RungLadder rung={c.rung} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                  {c.reason ?? <span className="unknown-value">no verdict recorded</span>}
                </span>
                <Mono className="shrink-0 text-[11px] text-faint">
                  block {c.blockNumber.toLocaleString()}
                </Mono>
              </div>
              {c.declaredTx ? (
                <p className="mt-0.5 truncate pl-[5.5rem] font-mono text-[11px] text-faint">
                  cites {c.declaredTx} on {c.declaredNetwork ?? "an unnamed chain"}
                </p>
              ) : null}
            </Link>
          ))}
        </div>

        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between border-t border-[var(--color-line)] pt-3 font-mono text-[12px]">
            {page > 1 ? (
              <Link href={qs({ page: String(page - 1) })} className="text-muted hover:text-[var(--color-text)]">
                ← previous
              </Link>
            ) : (
              <span className="text-faint">← previous</span>
            )}
            <span className="text-faint">
              {((page - 1) * PER_PAGE + 1).toLocaleString()}–
              {Math.min(page * PER_PAGE, total).toLocaleString()} of {total.toLocaleString()}
            </span>
            {page < pages ? (
              <Link href={qs({ page: String(page + 1) })} className="text-muted hover:text-[var(--color-text)]">
                next →
              </Link>
            ) : (
              <span className="text-faint">next →</span>
            )}
          </nav>
        ) : null}

        <Derivation sql={list.sql} />
      </Panel>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
