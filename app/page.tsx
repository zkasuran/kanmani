import Link from "next/link";
import { Derivation, DistBar, Num, OutcomeBadge, Pct, StatTile } from "@/components/ui.tsx";
import { CountUp, Reveal } from "@/components/motion.tsx";
import { clusterShape, measurement, population } from "@/lib/queries.ts";

/** Nothing on this page may be captured at build time. See next.config.ts. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The machine-readable surfaces, shown in the hero marquee. Every one is a live endpoint an agent
 * can fetch; the scroll is decoration over links that work with or without motion. Listed here
 * rather than inline so the two marquee copies stay identical.
 */
const SURFACES: { href: string; label: string }[] = [
  { href: "/llms.txt", label: "GET /llms.txt" },
  { href: "/agents.md", label: "GET /agents.md" },
  { href: "/feed.json", label: "GET /feed.json" },
  { href: "/schema.json", label: "GET /schema.json" },
  { href: "/api/claims?outcome=false", label: "GET /api/claims" },
  { href: "/.well-known/agent-registration.json", label: "GET /.well-known/agent-registration.json" },
];

export default async function Home() {
  const [pop, m, shape] = await Promise.all([
    population(),
    measurement(),
    clusterShape(),
  ]);

  const p = pop.rows;
  const d = m.rows;
  const s = shape.rows;

  const unknownTotal = d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- the one number */}
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-10 pt-12 sm:rounded-[var(--radius-lg)] sm:mx-0 sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <p className="eyebrow">erc-8004 · monad mainnet · chain 143</p>
          <h1 className="mt-4 max-w-4xl fluid-4 font-semibold leading-[1.12] tracking-tight">
            <span className="text-[var(--color-false)]">
              <CountUp value={d.doNotResolve} />
            </span>{" "}
            of <Num value={d.paymentClaims} /> payment claims on Monad name a transaction
            <br className="hidden sm:block" /> that is not on the chain they name.
          </h1>
          <p className="mt-5 max-w-3xl text-[length:var(--step-0)] leading-relaxed text-muted">
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

          {/* The machine-readable surfaces, drifting past like monad.xyz's partner rail. Every
              item is a real endpoint an agent can fetch; the motion is decoration over links that
              work with or without it. */}
          <div className="marquee mt-8 border-t border-[var(--color-line)]/70 pt-4" aria-label="Machine-readable surfaces">
            <div className="marquee__track font-mono text-[11px] text-faint" aria-hidden="false">
              {SURFACES.map((s) => (
                <a key={s.href} href={s.href} className="whitespace-nowrap transition-colors hover:text-[var(--color-brand)]">
                  {s.label}
                </a>
              ))}
            </div>
            <div className="marquee__track font-mono text-[11px] text-faint" aria-hidden="true">
              {SURFACES.map((s) => (
                <a key={`${s.href}-dup`} href={s.href} tabIndex={-1} className="whitespace-nowrap transition-colors hover:text-[var(--color-brand)]">
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the numbers at a glance */}
      <Reveal as="section" className="auto-grid">
        <StatTile label="agents indexed" value={p.agentsIndexed} hint="Every ERC-8004 agent Retina has seen registered on Monad." />
        <StatTile label="distinct evidence documents" value={s.records} tone="brand" hint="Agents share documents, so this is far below the agent count. It is the real number of things to check." />
        <StatTile label="payment claims checked" value={d.paymentClaims} hint="Documents that assert a payment and were taken through the whole ladder." />
        <StatTile label="claims that resolve" value={d.resolve} tone="true" hint="The cited transaction is on the chain the document names." />
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the stakes, said once */}
      <Reveal as="section" className="band grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <span className="kicker">the distinction</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            Hash integrity is not claim truth.
          </h2>
          <p className="lead mt-5 text-muted">
            Every tool in the registry checks that a document&apos;s bytes match the hash committed
            on chain. Ours checks the thing nobody else does: whether the payment the document
            <em className="text-[var(--color-text)] not-italic"> describes </em>
            actually happened on the chain it names.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GlanceCard
            tone="neutral"
            head="What every other tool sees"
            body="Bytes intact, hash matches. Verified. It says nothing about whether the transaction is real."
          />
          <GlanceCard
            tone="brand"
            head="What Kanmani checks"
            body="Read the named chain. Is the cited transaction there? Four honest outcomes, one rule."
          />
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the four outcomes, as a story */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">how a claim resolves</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            Four outcomes. And one rule that governs all of them.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            A failure to look is never an accusation.{" "}
            <span className="unknown-value">unknown</span> is never <span className="text-[var(--color-false)]">false</span>,
            and never zero — because these verdicts carry real operators&apos; names.
          </p>
        </div>

        <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
          <Cell
            outcome="true"
            n={d.resolve}
            of={d.verdicts}
            head="check out"
            body="The cited transaction is on the chain the document names, at a block we record."
            href="/claims?outcome=true"
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
            outcome="noClaim"
            n={d.noClaim}
            of={d.verdicts}
            head="assert no payment"
            body="A rating or a plain comment. Read fine, claims nothing, so it cannot be wrong."
            href="/claims?outcome=noClaim"
          />
          <Cell
            outcome="unknown"
            n={d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed}
            of={d.verdicts}
            head="we could not check"
            body={`${d.unknownBytesMoved} serve bytes that no longer match their own on-chain hash. ${d.unknownUnreachable} would not answer.`}
            href="/claims?outcome=unknown"
          />
        </div>
        <div className="mt-4">
          <Link href="/method" className="cta-ghost">how each rung is decided →</Link>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the one finding, as a case study */}
      <Reveal as="section" className="band">
        <div className="finding p-6 sm:p-9">
          <span className="kicker">the finding</span>
          <div className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
            <div>
              <div className="finding__figure">
                <CountUp value={s.largestMemberCount} />
              </div>
              <p className="mt-2 font-mono text-[12px] text-muted">
                agents across {s.largestDistinctOwners.toLocaleString()} distinct wallets
                {" · "}<Pct of={s.largestMemberCount} total={p.agentsIndexed} /> of the registry
              </p>
            </div>
            <div>
              <h2 className="fluid-2 font-semibold leading-tight tracking-tight">
                point at one document that returns a deletion.
              </h2>
              <p className="mt-4 text-[length:var(--step-0)] leading-relaxed text-muted max-w-xl">
                Not many documents shared by a few agents. One dead file, cited by thousands of
                agents across thousands of wallets — every one of them still reading as a valid
                registration to anything that checks only the hash.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link href="/operators" className="cta">what that document is →</Link>
                <Link href="/agents" className="cta-ghost">browse the agents →</Link>
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-[var(--color-line)] pt-4">
            <Derivation sql={shape.sql} note="The cluster shape, from the registry's own records." />
          </div>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- what the claims name */}
      <Reveal as="section" className="band grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="kicker">the shape of it</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            Every claim names Monad. {d.doNotResolve} of them are not on Monad.
          </h2>
          <p className="lead mt-5 text-muted">
            This was built expecting documents that cite one chain while the payment sits on
            another. That is not what is happening. The failure is simpler than the one it was
            designed for, so the site says the simpler thing.
          </p>
          <div className="mt-6">
            <Link href="/claims" className="cta-ghost">read every checked claim →</Link>
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <DistBar
            segments={[
              { value: d.resolve, className: "bg-[var(--color-true)]", label: "on the named chain" },
              { value: d.doNotResolve, className: "bg-[var(--color-false)]", label: "not on the named chain" },
              { value: d.noClaim, className: "bg-[var(--color-noclaim)]", label: "assert no payment" },
              { value: unknownTotal, className: "bg-[var(--color-unknown)]", label: "could not check" },
            ]}
          />
          <div className="mt-4 space-y-2.5 font-mono text-[12px]">
            <LegendRow className="bg-[var(--color-true)]" label="on the named chain" value={d.resolve} />
            <LegendRow className="bg-[var(--color-false)]" label="not on the named chain" value={d.doNotResolve} />
            <LegendRow className="bg-[var(--color-noclaim)]" label="assert no payment" value={d.noClaim} />
            <LegendRow className="bg-[var(--color-unknown)]" label="could not check" value={unknownTotal} />
          </div>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- for agents */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">built for software</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            An agent should never need to read HTML.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            Every surface here is served as plain data too, with live numbers, a{" "}
            <code className="font-mono text-[var(--color-brand)]">reproduce</code> field on every
            response, and a null rendered as <span className="unknown-value">unknown</span> rather
            than defaulted to zero.
          </p>
        </div>
        <div className="mt-8 auto-grid">
          {SURFACES.map((surface) => (
            <a
              key={surface.href}
              href={surface.href}
              className="glow-lift block rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-4 font-mono text-[12px] text-muted hover:text-[var(--color-text)]"
            >
              {surface.label}
            </a>
          ))}
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- closing */}
      <Reveal
        as="section"
        className="field field-live -mx-[var(--gutter)] mb-[calc(var(--section-gap)*-1)] overflow-hidden border-t border-[var(--color-line)] px-[var(--gutter)] sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border"
      >
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="closing relative">
          <h2 className="mx-auto max-w-3xl fluid-3 font-semibold leading-tight tracking-tight">
            Check the second thing yourself.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[length:var(--step-0)] text-muted">
            Paste any claim and get a verdict, with the command to re-derive it without us.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <Link href="/verify" className="cta">verify a claim →</Link>
            <Link href="/method" className="cta-ghost">how a verdict is decided →</Link>
            <Link href="/status" className="cta-ghost">is the index fresh? →</Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** A calm comparison card for the stakes band. `tone` borrows brand only as an accent, never as a
    verdict. */
function GlanceCard({ tone, head, body }: { tone: "neutral" | "brand"; head: string; body: string }) {
  const accent = tone === "brand" ? "border-[var(--brand-line)]" : "border-[var(--color-line)]";
  return (
    <div className={`rounded-[var(--radius)] border ${accent} bg-[var(--color-panel)] p-4`}>
      <p className={`text-[13px] font-semibold ${tone === "brand" ? "text-[var(--color-brand)]" : "text-[var(--color-text)]"}`}>
        {head}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** One labelled row in a distribution legend, colour swatch, name, and its count. */
function LegendRow({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)]/50 pb-2 last:border-0">
      <span className="inline-flex items-center gap-2 text-muted">
        <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
        {label}
      </span>
      <span className="tnum text-[var(--color-text)]">{value.toLocaleString()}</span>
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
