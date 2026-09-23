import Link from "next/link";
import { Derivation, DistBar, Num, OutcomeBadge, Panel, Pct, StatTile } from "@/components/ui.tsx";
import { clusterShape, mappingCoverage, measurement, networkSplit, population } from "@/lib/queries.ts";

/** Nothing on this page may be captured at build time. See next.config.ts. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const [pop, m, net, shape, cov] = await Promise.all([
    population(),
    measurement(),
    networkSplit(),
    clusterShape(),
    mappingCoverage(),
  ]);

  const p = pop.rows;
  const d = m.rows;
  const s = shape.rows;

  // The gap between what the registry's own counter says and what we hold. Unknown when the slot
  // read failed, never zero, because "the index is complete" and "we could not check" are not the
  // same statement.
  const gap = p.counterSlotCount === null ? null : p.counterSlotCount - p.agentsIndexed;
  const unknownTotal = d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed;

  return (
    <div className="space-y-12">
      {/* ---------------------------------------------------------------- the one number */}
      <section className="field rise -mx-5 -mt-10 overflow-hidden border-b border-[var(--color-line)] px-5 pb-10 pt-12 sm:rounded-[var(--radius-lg)] sm:mx-0 sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <p className="eyebrow">erc-8004 · monad mainnet · chain 143</p>
          <h1 className="mt-4 max-w-4xl text-[clamp(1.9rem,4.4vw,3rem)] font-semibold leading-[1.12] tracking-tight">
            <span className="text-[var(--color-false)]">
              <Num value={d.doNotResolve} />
            </span>{" "}
            of <Num value={d.paymentClaims} /> payment claims on Monad name a transaction
            <br className="hidden sm:block" /> that is not on the chain they name.
          </h1>
          <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-muted">
            Every one of those {d.paymentClaims} documents is hash-perfect. The bytes served today are
            the bytes committed on chain, so every tool that checks integrity calls them verified.
            Integrity is not truth. This site checks the second thing.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/claims?outcome=false"
              className="cta"
              style={{ borderColor: "color-mix(in oklab, var(--color-false) 45%, transparent)", background: "var(--color-false-bg)", color: "var(--color-false)" }}
            >
              see the {d.doNotResolve} that do not resolve →
            </Link>
            <Link href="/verify" className="cta-ghost">
              check one yourself →
            </Link>
            <Link href="/method" className="cta-ghost">
              how a verdict is decided →
            </Link>
          </div>

          {/* the distribution of every checked claim, as one bar */}
          <div className="mt-8 max-w-3xl">
            <DistBar
              segments={[
                { value: d.noClaim, className: "bg-[var(--color-noclaim)]", label: "assert no payment" },
                { value: d.doNotResolve, className: "bg-[var(--color-false)]", label: "not on the named chain" },
                { value: d.resolve, className: "bg-[var(--color-true)]", label: "on the named chain" },
                { value: unknownTotal, className: "bg-[var(--color-unknown)]", label: "could not check" },
              ]}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
              <Legend className="bg-[var(--color-noclaim)]" label={`${d.noClaim.toLocaleString()} no claim`} />
              <Legend className="bg-[var(--color-false)]" label={`${d.doNotResolve.toLocaleString()} false`} />
              <Legend className="bg-[var(--color-true)]" label={`${d.resolve.toLocaleString()} true`} />
              <Legend className="bg-[var(--color-unknown)]" label={`${unknownTotal.toLocaleString()} unknown`} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the numbers at a glance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="agents indexed" value={p.agentsIndexed} hint="Every ERC-8004 agent Retina has seen registered on Monad." />
        <StatTile label="distinct evidence documents" value={s.records} tone="brand" hint="Agents share documents, so this is far below the agent count. It is the real number of things to check." />
        <StatTile label="payment claims checked" value={d.paymentClaims} hint="Documents that assert a payment and were taken through the whole ladder." />
        <StatTile label="claims that resolve" value={d.resolve} tone="true" hint="The cited transaction is on the chain the document names." />
      </section>


      {/* ---------------------------------------------------------------- the breakdown */}
      <Panel
        title="every document with an evidence pointer and what it turned out to be"
        subtitle={
          <>
            {p.feedbacksWithUri.toLocaleString()} of {p.feedbacks.toLocaleString()} feedbacks carry a
            URI. The rest point at nothing, so there is nothing to check.
          </>
        }
      >
        <div className="grid gap-px overflow-hidden rounded border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
          <Cell
            outcome="noClaim"
            n={d.noClaim}
            of={d.verdicts}
            head="assert no payment"
            body="A game rating or a plain-text comment. Read fine, claims nothing, so it cannot be wrong. Counting these as a coverage gap would inflate our own failure number."
            href="/claims?outcome=noClaim"
          />
          <Cell
            outcome="false"
            n={d.doNotResolve}
            of={d.verdicts}
            head="cite a transaction that is not there"
            body="We read the chain the document names and the transaction is not on it. Never inferred, never assumed from a timeout."
            href="/claims?outcome=false"
          />
          <Cell
            outcome="true"
            n={d.resolve}
            of={d.verdicts}
            head="check out"
            body="The cited transaction is on the chain the document names, at a block we record."
            href="/claims?outcome=true"
          />
          <Cell
            outcome="unknown"
            n={d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed}
            of={d.verdicts}
            head="we could not check"
            body={`${d.unknownBytesMoved} serve bytes that no longer match their own on-chain hash. ${d.unknownUnreachable} would not answer. A failure to look is never an accusation.`}
            href="/claims?outcome=unknown"
          />
        </div>
        <Derivation
          sql={m.sql}
          note="One row per claim, latest verdict only. The full history of every re-check stays in fovea.verdict."
        />
      </Panel>

      {/* ---------------------------------------------------------------- the finding */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="which chain the claims name">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="pb-2">declared network</th>
                <th className="pb-2 text-right">found there</th>
                <th className="pb-2 text-right">not found</th>
              </tr>
            </thead>
            <tbody>
              {net.rows.map((r) => (
                <tr key={r.network} className="border-b border-[var(--color-line)]/50 last:border-0">
                  <td className="py-2 font-mono text-[13px]">{r.network}</td>
                  <td className="py-2 text-right font-mono text-[var(--color-true)]">
                    <Num value={r.resolve} />
                  </td>
                  <td className="py-2 text-right font-mono text-[var(--color-false)]">
                    <Num value={r.doNotResolve} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            This project was built expecting to find documents citing one chain while the payment sat
            on another. That is not what is happening. Every claim names Monad and{" "}
            {d.doNotResolve} of them are not on Monad. The failure is simpler than the one I designed
            for, so the site says the simpler thing.
          </p>
          <Derivation sql={net.sql} />
        </Panel>

        <Panel title="how the population divides" subtitle="by the document each agent registered">
          <dl className="space-y-2 text-sm">
            <Stat label="agents indexed" value={p.agentsIndexed} />
            <Stat
              label="the registry's own count"
              value={p.counterSlotCount}
              hint={`Read from storage slot 0xa040f7…04e00 at block ${p.atBlock?.toLocaleString() ?? "unknown"}. The registry is not enumerable, so this is the only source of population truth.`}
            />
            <Stat
              label="gap"
              value={gap}
              hint="Positive means the index is behind. Unknown means the slot read failed, which is not the same as zero."
            />
            <div className="h-2" />
            <Stat label="distinct registration documents" value={s.records} />
            <Stat
              label="agents whose record nobody shares"
              value={s.agentsWithUniqueRecord}
              hint="The filter a buyer actually wants."
            />
            <Stat
              label="agents sharing a record with another agent"
              value={s.agentsInACluster}
            />
          </dl>
          <p className="mt-4 rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-[13px] leading-relaxed">
            <span className="font-mono text-[var(--color-brand)]">
              {s.largestMemberCount.toLocaleString()} agents
            </span>{" "}
            across{" "}
            <span className="font-mono text-[var(--color-brand)]">
              {s.largestDistinctOwners.toLocaleString()} distinct wallets
            </span>{" "}
            point at one document (<Pct of={s.largestMemberCount} total={p.agentsIndexed} /> of the
            registry).{" "}
            <Link href="/operators" className="text-[var(--color-brand)] hover:underline">
              What that document is →
            </Link>
          </p>
          <Derivation sql={shape.sql} />
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- coverage in the open */}
      <Panel
        title="which published mapping read each document"
        subtitle="Coverage is published as a number, not implied by an absence of errors. A shape no mapping reads is a gap we report on ourselves."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2">mapping</th>
              <th className="pb-2">decided</th>
              <th className="pb-2 text-right">documents</th>
            </tr>
          </thead>
          <tbody>
            {cov.rows.map((r) => (
              <tr key={`${r.mapping}-${r.outcome}`} className="border-b border-[var(--color-line)]/50 last:border-0">
                <td className="py-2 font-mono text-[13px]">{r.mapping}</td>
                <td className="py-2">
                  <OutcomeBadge outcome={r.outcome} />
                </td>
                <td className="py-2 text-right font-mono">
                  <Num value={r.count} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[13px] text-muted">
          Every mapping carries the date it was induced from real documents. Adding one mapping
          moved the count of resolving claims from 2 to 12, which is why the unread count is
          published rather than folded into something softer.{" "}
          <Link href="/method" className="text-[var(--color-brand)] hover:underline">
            How each rung is decided →
          </Link>
        </p>
        <Derivation sql={cov.sql} />
      </Panel>
    </div>
  );
}

function Cell({
  outcome,
  n,
  of,
  head,
  body,
  href,
}: {
  outcome: "true" | "false" | "noClaim" | "unknown";
  n: number;
  of: number;
  head: string;
  body: string;
  href: string;
}) {
  return (
    <Link href={href} className="group block bg-[var(--color-panel)] p-4 transition-colors hover:bg-[var(--color-panel-2)]">
      <div className="flex items-baseline justify-between">
        <span className="tnum text-3xl font-semibold tracking-tight">{n.toLocaleString()}</span>
        <OutcomeBadge outcome={outcome} />
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-text)]">{head}</p>
      <p className="mt-0.5 font-mono text-[11px] text-faint">
        <Pct of={n} total={of} /> of all checked
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{body}</p>
    </Link>
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

function Stat({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)]/50 pb-1.5 last:border-0">
      <dt className="text-[13px] text-muted" title={hint}>
        {label}
        {hint ? <span className="ml-1 text-faint">ⓘ</span> : null}
      </dt>
      <dd className="font-mono text-[15px]">
        <Num value={value} title={hint} />
      </dd>
    </div>
  );
}
