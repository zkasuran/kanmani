import Link from "next/link";
import { Derivation, Mono, Num, OutcomeBadge, PageHeader, Panel, StatTile } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { changedClaims, freshness, population, registryHealth } from "@/lib/queries.ts";
import { usage } from "@/lib/usage.ts";
import { UsagePanel } from "@/components/usage-panel.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Status",
  description: "How fresh every number on this site is and what is stale.",
};

/** A worker that is not scheduled is a worker that does not run, so the schedule is published. */
const WORKERS = [
  {
    name: "Retina, the indexer",
    what: "Follows the ERC-8004 registries on Monad and writes Agent, AgentRecord and Feedback rows. The evidence pointer exists only in a non-indexed log field, so without this there is nothing to check.",
    cadence: "continuous, following the head",
  },
  {
    name: "population check",
    what: "Reads the registry's own counter slot and records it against the block it was read at. The registry is not enumerable, so this is the only source of population truth.",
    cadence: "every 10,000 blocks from block 105,000,000",
  },
  {
    name: "Fovea, the verdict sweep",
    what: "Walks every claim down the ladder and appends a verdict. Never updates one.",
    cadence: "on demand and the history of every check is kept",
  },
  {
    name: "the record probe",
    what: "Asks each distinct registration document whether it still answers. Deduplicated by record hash, per host, serial, with a gap, because a handful of hosts carry most of the documents.",
    cadence: "on demand",
  },
];

export default async function Status() {
  const usageNow = await usage(7);
  const [f, pop, health, changed] = await Promise.all([
    freshness(),
    population(),
    registryHealth(),
    changedClaims(40),
  ]);
  const fr = f.rows;
  const p = pop.rows;
  const hh = health.rows;

  const now = Date.now();
  const indexAgeMin =
    fr.indexStateUpdatedAt === null ? null : Math.round((now / 1000 - fr.indexStateUpdatedAt) / 60);
  const verdictAgeMin =
    fr.newestVerdictAt === null
      ? null
      : Math.round((now - new Date(fr.newestVerdictAt).getTime()) / 60000);
  const gap = p.counterSlotCount === null ? null : p.counterSlotCount - p.agentsIndexed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="erc-8004 · monad mainnet · freshness"
        title="Every number here is a measurement at a time."
        lead={
          <>
            This page says which time. A page that reports a figure that was true when it was
            written, with no way to tell how long ago that was, is the failure mode this exists to
            prevent.
          </>
        }
      />

      <Reveal as="section" className="auto-grid">
        <StatTile label="agents we hold" value={p.agentsIndexed} hint="Agent rows Retina has indexed on Monad." />
        <StatTile
          label="the registry's own count"
          value={p.counterSlotCount}
          hint="Read from the registry's counter slot. The registry is not enumerable, so this is the only source of population truth."
        />
        <StatTile
          label="gap"
          value={gap}
          tone={gap !== null && gap !== 0 ? "unknown" : "neutral"}
          hint="Positive means the index is behind. Unknown means the slot read failed, which is not the same as zero."
        />
        <StatTile label="verdicts that have changed" value={changed.rows.length} tone="brand" hint="Claims whose verdict moved after a re-check. The correction trail." />
      </Reveal>

      <Reveal as="div" className="grid gap-5 lg:grid-cols-2">
        <Panel title="freshness">
          <dl className="space-y-1.5 text-sm">
            <Line
              label="index last wrote its population"
              value={indexAgeMin === null ? null : indexAgeMin}
              suffix=" min ago"
              warn={indexAgeMin !== null && indexAgeMin > 120}
            />
            <Line label="index at block" value={fr.latestIndexedBlock} />
            <Line label="newest feedback indexed at block" value={fr.latestFeedbackBlock} />
            <Line
              label="registry says"
              value={p.counterSlotCount}
              suffix=" agents"
            />
            <Line label="we hold" value={p.agentsIndexed} suffix=" agents" />
            <Line
              label="gap"
              value={gap}
              warn={gap !== null && gap !== 0}
              hint="Positive means the index is behind. Unknown means the slot read failed, which is not zero."
            />
            <div className="h-2" />
            <Line
              label="newest verdict"
              value={verdictAgeMin}
              suffix=" min ago"
              warn={verdictAgeMin !== null && verdictAgeMin > 60 * 24 * 3}
            />
            <Line label="verdicts recorded, all time" value={fr.verdictsTotal} />
            <Line label="claims carrying a current verdict" value={fr.claimsWithAVerdict} />
            <Line
              label="claims with a URI and no verdict"
              value={fr.claimsWithNoVerdict}
              warn={fr.claimsWithNoVerdict > 0}
              hint="Unchecked is not the same as clean. A non-zero here is a gap in our coverage, stated as one."
            />
            <div className="h-2" />
            <Line
              label="registration documents asked"
              value={hh.recordsTotal - hh.notProbedRecords}
              suffix={` of ${hh.recordsTotal.toLocaleString()}`}
            />
            <Line
              label="documents never asked"
              value={hh.notProbedRecords}
              warn={hh.notProbedRecords > 0}
            />
          </dl>
          <Derivation sql={f.sql} />
        </Panel>

        <Panel title="workers and what schedules them">
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            A worker that is not scheduled is a worker that does not run. The schedule lives in the
            repository and the deploy installs it, rather than living in somebody&apos;s memory.
          </p>
          <div className="space-y-2">
            {WORKERS.map((w) => (
              <div key={w.name} className="rounded border border-[var(--color-line)] p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px]">{w.name}</span>
                  <Mono className="text-[11px] text-faint">{w.cadence}</Mono>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{w.what}</p>
              </div>
            ))}
          </div>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- corrections */}
      <Reveal>
        <UsagePanel u={usageNow} />
      </Reveal>

      <Reveal>
      <Panel
        id="corrections"
        title={`verdicts that have changed · ${changed.rows.length}`}
        subtitle="Either we were wrong and corrected it or somebody fixed their document and the page moved on its own. Both are worth showing and neither is visible in a store that updates in place."
      >
        {changed.rows.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">
            No verdict has changed yet. This table exists before it has anything in it, because the
            place to build a correction trail is before the first correction.
          </p>
        ) : (
          <div className="space-y-px">
            {changed.rows.map((c) => (
              <Link
                key={c.feedbackId}
                href={`/claim/${encodeURIComponent(c.feedbackId)}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-transparent px-2 py-1.5 hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
              >
                <span className="flex shrink-0 items-center gap-1.5">
                  <OutcomeBadge outcome={c.from} />
                  <span className="text-faint">→</span>
                  <OutcomeBadge outcome={c.to} />
                </span>
                <Mono className="shrink-0 text-[11px] text-faint">
                  {c.checks} checks · {c.lastCheckedAt.replace("T", " ").slice(0, 16)}Z
                </Mono>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                  {c.feedbackUri}
                </span>
              </Link>
            ))}
          </div>
        )}
        <Derivation sql={changed.sql} />
      </Panel>
      </Reveal>

      <Reveal>
      <Panel title="what this site does not know">
        <ul className="space-y-2 text-[13.5px] leading-relaxed text-muted">
          <Gap n={fr.claimsWithNoVerdict}>
            claims carry a URI and have never been checked. Unchecked is not clean.
          </Gap>
          <Gap n={hh.notProbedRecords}>
            registration documents have never been asked whether they still answer.
          </Gap>
          <Gap n={hh.byState.find((s) => s.state === "unknown")?.records ?? 0}>
            registration documents answered in a way we could not read: a rate limit, a timeout, a
            server error or a document past our own size cap. Ours, not theirs.
          </Gap>
          <Gap n={p.validations}>
            validation requests exist in the Validation Registry on Monad. Nobody is writing there
            yet, so that half of ERC-8004 is empty rather than unmeasured.
          </Gap>
        </ul>
      </Panel>
      </Reveal>
    </div>
  );
}

function Line({
  label,
  value,
  suffix,
  warn,
  hint,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)]/50 pb-1 last:border-0">
      <dt className="text-[13px] text-muted" title={hint}>
        {label}
        {hint ? <span className="ml-1 text-faint">ⓘ</span> : null}
      </dt>
      <dd className={`font-mono text-[14px] ${warn ? "text-[var(--color-unknown)]" : ""}`}>
        <Num value={value} suffix={suffix} title={hint} />
      </dd>
    </div>
  );
}

function Gap({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className={`tnum shrink-0 font-mono ${n > 0 ? "text-[var(--color-unknown)]" : "text-[var(--color-true)]"}`}>
        {n.toLocaleString()}
      </span>
      <span>{children}</span>
    </li>
  );
}
