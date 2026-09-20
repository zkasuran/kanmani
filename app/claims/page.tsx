import Link from "next/link";
import { Derivation, Mono, Num, OutcomeBadge, Panel, RungLadder } from "@/components/ui.tsx";
import { claims, claimsCount, mappingCoverage, type Outcome } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Claims",
  description: "Every evidence document on Monad with a URI, and what checking it against the chain found.",
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Claims</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          One row per evidence document carrying a URI. Ordered newest first by the block the
          feedback was recorded in. There is no score and no ranking here, because a list of other
          people&apos;s documents sorted by an opinion of ours would be exactly the thing this site
          argues against.
        </p>
      </div>

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
      </div>

      {/* ---------------------------------------------------------------- rows */}
      <Panel>
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
