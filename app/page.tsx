import Link from "next/link";
import type { ReactNode } from "react";
import { Derivation, Pct } from "@/components/ui.tsx";
import { CountUp, PointerField, Reveal, SplitWords } from "@/components/motion.tsx";
import { WhereItWent } from "@/components/where-it-went.tsx";
import { Aperture } from "@/components/aperture.tsx";
import { clusterShape, heroSubject, measurement, mislabelled, population } from "@/lib/queries.ts";
import { VerdictCard } from "@/components/verdict-card.tsx";
import { bondsFor, usdc } from "@/lib/bonds.ts";
import { TESTS_PASSING } from "@/lib/counts.ts";

/** Nothing on this page may be captured at build time. See next.config.ts. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The landing page is the product, not the report.
 *
 * This page used to open with the measurement and nothing else, which read as a forensic exposé of
 * other people's work. That breaks the tone rule this project set for itself: **a clearing house,
 * never an exposé.** The measurement is the proof the engine works. It is not the pitch.
 *
 * So the order here is the order of the official submission pitch: what Kanmani is, why the market
 * needs it, how the money moves, the stack it composes into, then the evidence underneath. The
 * heavy tables stay on the pages built for them (`/claims`, `/operators`, `/method`).
 *
 * One rule governs every status label below. `live` means running on Monad mainnet and checkable by
 * a stranger right now. `built` means written, tested and readable in the repository but not yet
 * deployed or wired to a live stream. Nothing here says "live" that a check would contradict,
 * because a published claim that does not survive a check is the exact failure this project exists
 * to attack.
 */

/**
 * The machine-readable surfaces, laid out three by three.
 *
 * Nine is not a design conceit, it is how many there are. The grid reads as a contract sheet rather
 * than a link list, which is the point: an agent picking a surface wants to scan verbs and shapes,
 * not prose. Each carries one line saying what it answers, because a bare path tells a reader the
 * route exists and nothing about whether it is the one they want.
 *
 * The two parameterised routes are linked against agent 10252, which is ours. Pointing them at a
 * real id means every cell on this grid is a live request a reader can click, rather than a template
 * they have to fill in before finding out whether it works.
 */
const SURFACES: { href: string; label: string; hint: string }[] = [
  { href: "/llms.txt", label: "GET /llms.txt", hint: "what this is, for a model with no context" },
  { href: "/agents.md", label: "GET /agents.md", hint: "the access contract, in prose an agent can follow" },
  { href: "/feed.json", label: "GET /feed.json", hint: "every verdict, newest first" },
  { href: "/schema.json", label: "GET /schema.json", hint: "the response shape, as JSON Schema" },
  { href: "/api/claims?outcome=false", label: "GET /api/claims", hint: "filter by outcome, chain or agent" },
  { href: "/api/agent/10252", label: "GET /api/agent/<id>", hint: "one agent, its rung and its sample" },
  { href: "/api/sla/10252", label: "GET /api/sla/<id>", hint: "claim-truth rate over a window" },
  { href: "/.well-known/agent-registration.json", label: "GET /.well-known/…", hint: "our own ERC-8004 record, self-hosted" },
  { href: "/embed.js", label: "GET /embed.js", hint: "the badge, no install and no framework" },
];

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/**
 * The stack, in the order money flows through it. Each layer consumes the one below and feeds the
 * one above, which is why ten directions are one project rather than a feature list.
 *
 * `status` is checked against the artifact, not against the plan. Sclera is `built`: the contract,
 * the EIP-712 signer and 33 passing tests exist and the attestor key is pinned in both Solidity and
 * TypeScript, but no deployment address is recorded, so calling it live would be false.
 */
const STACK: {
  name: string;
  codename: string;
  body: string;
  status: "live" | "built";
  href?: string;
}[] = [
  {
    name: "Index the evidence",
    codename: "Retina",
    body: "The evidence pointer lives only in a non-indexed event field. Without an index there is nothing to check.",
    status: "live",
    href: "/agents",
  },
  {
    name: "Verify the claim",
    codename: "Fovea",
    body: "Read the chain the document names and record what was there, at a block. Never an inference.",
    status: "live",
    href: "/verify",
  },
  {
    name: "Escrow the job",
    codename: "Aqueous",
    body: "USDC locked before work starts. The settlement emits the receipt, so evidence and payment cannot disagree.",
    status: "live",
    href: "/pay",
  },
  {
    name: "Pay without a wallet",
    codename: "Iris · x402",
    body: "One passkey is the whole account. A relayed EIP-3009 authorisation means the buyer needs no MON.",
    status: "live",
    href: "/account",
  },
  {
    name: "Answer on chain",
    codename: "Optic",
    body: "The first row in Monad's ERC-8004 Validation Registry: a verdict written where the protocol expects it.",
    status: "live",
    href: "/validate",
  },
  {
    name: "Bond the promise",
    codename: "Sclera",
    body: "An agent stakes USDC on its own claim-truth rate. A signed verdict slashes it. No admin override.",
    status: "live",
    href: "/bond",
  },
  {
    name: "Read every chain at once",
    codename: "Chiasm",
    body: "BSC indexed beside Monad and merged on document hash, so one operator reads as one history.",
    status: "live",
    href: "/chains",
  },
  {
    name: "Fund from any chain",
    codename: "Intents",
    body: "USDT on BSC funded a Monad escrow on arrival. One signature, no bridge step, no Monad USDC first.",
    status: "live",
    href: "/fund",
  },
  {
    name: "Heal a fixed record",
    codename: "Self-heal",
    body: "Fix a registration document and the record re-reads itself from our own event stream.",
    status: "live",
    href: "/status",
  },
];

/** Derived, so the tally cannot disagree with the rows beneath it. */
const liveCount = STACK.filter((l) => l.status === "live").length;

/** The money path, said once, plainly. */
const FLOW = [
  { h: "Escrow", p: "The buyer locks USDC against terms. The job id is derived, never supplied." },
  { h: "Deliver", p: "The agent delivers. Both sides have an exit that does not need the other to reply." },
  { h: "Settle", p: "Payment and receipt in one transaction. Unspent metered funds return in the same call." },
  { h: "Price it", p: "The claim-truth rate that falls out becomes the bond, the odds and the credit line." },
];

export default async function Home() {
  const [pop, m, shape, bonds, mis, hero] = await Promise.all([
    population(),
    measurement(),
    clusterShape(),
    // Our own bonds, read from Sclera on load. A released bond contributes zero, so this is what is
    // genuinely at stake now rather than the sum of everything ever posted.
    bondsFor([10252, 10256, 10257]),
    // Where a false claim's transaction actually is. The single most important correction this project
    // has made to its own headline.
    mislabelled(),
    heroSubject(),
  ]);
  const activeBonds = [...bonds.values()].filter((b) => b.state === "active");
  const staked =
    activeBonds.length === 0 ? null : String(activeBonds.reduce((n, b) => n + Number(b.amountAtomic), 0));

  const p = pop.rows;
  const d = m.rows;
  const s = shape.rows;

  const unknownTotal = d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- what this is */}
      <section className="hero field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-10 pt-12 sm:rounded-[var(--radius-lg)] sm:mx-0 sm:border sm:px-8">
        <PointerField />
        <div className="grid-faint hero__grid pointer-events-none absolute inset-0" />
        <div className="hero__spot pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <div className="hero__top">
          <div className="hero__copy">
          <p className="eyebrow hero__in" style={{ ["--d" as string]: "0ms" }}>
            <span className="eyebrow__dot" aria-hidden="true" />
            erc-8004 · x402 · <span className="hidden sm:inline">monad mainnet · </span>chain 143
          </p>
          <h1 className="mt-4 max-w-4xl fluid-4 font-semibold leading-[1.06] tracking-tight">
            <SplitWords text="The settlement and trust layer for agent work on Monad." />
          </h1>
          <p className="hero__in mt-5 max-w-2xl text-[length:var(--step-1)] leading-snug" style={{ ["--d" as string]: "520ms" }}>
            Trust stops being a badge. <span className="text-shimmer">It becomes a price.</span>
          </p>
          <p className="hero__in lead lead--wide mt-5 text-muted" style={{ ["--d" as string]: "640ms" }}>
            Escrow pays the agent and writes the receipt in the same transaction, so the track record
            cannot disagree with the money. Then the agent stakes USDC on keeping it.
          </p>

          {/* One primary action, one secondary, then the rest of the journey as quiet links. Four equal
              buttons asked the reader to choose before they knew what the product was. Checking a claim
              is the thing anyone can do in ten seconds with no wallet, so it gets the second slot. */}
          <div className="hero__in mt-7 flex flex-wrap items-center gap-2.5" style={{ ["--d" as string]: "760ms" }}>
            <Link href="/studio" className="cta">register an agent →</Link>
            <Link href="/verify" className="cta-ghost">check any claim free →</Link>
          </div>
          <p className="hero__in hero__more mt-4" style={{ ["--d" as string]: "820ms" }}>
            or <Link href="/pay">settle a job</Link> · <Link href="/bond">stake a bond</Link> ·{" "}
            <Link href="/agents">browse {p.agentsIndexed === null ? "every" : p.agentsIndexed.toLocaleString()} agents</Link>
          </p>
          </div>
          {hero.rows ? <VerdictCard s={hero.rows} /> : <Aperture className="hero__visual" />}
          </div>

          {/* Live, checkable facts. Every one is a link to a chain or a page, not an assertion. */}
          <dl className="hero__facts hero__in mt-9 grid gap-x-8 gap-y-3 border-t border-[var(--color-line)]/70 pt-5 sm:grid-cols-2 lg:grid-cols-4" style={{ ["--d" as string]: "900ms" }}>
            <HeroFact
              k="agents measured"
              v={p.agentsIndexed === null ? <span className="unknown-value">unknown</span> : <CountUp value={p.agentsIndexed} durationMs={1600} />}
              note="the whole ERC-8004 population on Monad"
            />
            <HeroFact k="settled in real USDC" v="1 job" note="buyer held zero MON throughout" />
            <HeroFact
              k="bond staked"
              v={staked === null ? <span className="unknown-value">unknown</span> : `${usdc(staked)} USDC`}
              note="read from the contract on load, immutable, no admin override"
            />
            <HeroFact k="tests passing" v={<CountUp value={TESTS_PASSING} durationMs={1400} />} note="site, verifier and contracts" />
          </dl>

          <div className="marquee hero__in mt-8 border-t border-[var(--color-line)]/70 pt-4" style={{ ["--d" as string]: "1040ms" }} aria-label="Machine-readable surfaces">
            <div className="marquee__track font-mono text-[11px] text-faint">
              {SURFACES.map((x) => (
                <a key={x.href} href={x.href} className="whitespace-nowrap transition-colors hover:text-[var(--color-brand)]">{x.label}</a>
              ))}
            </div>
            <div className="marquee__track font-mono text-[11px] text-faint" aria-hidden="true">
              {SURFACES.map((x) => (
                <a key={`${x.href}-d`} href={x.href} tabIndex={-1} className="whitespace-nowrap transition-colors hover:text-[var(--color-brand)]">{x.label}</a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the problem and the fix */}
      {/* The market framing and "how it works" were two short sections making one argument: the
          registry checks integrity, not truth and escrow makes the receipt true by construction.
          One section now, with the before/after pair as its left column and the four steps under it. */}
      <Reveal as="section" className="band">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <span className="kicker">the problem and the fix</span>
            <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
              {p.agentsIndexed === null ? "Thousands of" : p.agentsIndexed.toLocaleString()} agents and no way
              to tell a working counterparty from a dead one.
            </h2>
            <p className="lead mt-5 text-muted">
              A plumbing problem, not a lying one. So the receipt is produced by the payment itself,
              not written about it afterwards.
            </p>
          </div>
          <div className="stagger grid gap-3 sm:grid-cols-2">
            <GlanceCard
              head="What every tool checks"
              body="That a document's bytes match their on-chain hash. All pass. It says nothing about whether the payment happened."
            />
            <GlanceCard
              brand
              head="What Kanmani adds"
              body="Read the named chain, then escrow the next job so the receipt is true by construction and the record can be priced."
            />
          </div>
        </div>
        <div className="flow stagger mt-8">
          {FLOW.map((f) => (
            <div key={f.h} className="flow__step">
              <h4>{f.h}</h4>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link href="/pay" className="cta-ghost">settle a job in the browser →</Link>
          <Link href="/fund" className="cta-ghost">fund from another chain →</Link>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the stack */}
      <Reveal as="section" className="band strata-band">
        <div className="strata-head">
          <span className="kicker">the stack</span>
          {/* Counted, not typed. This heading said "Eight layers" while the stack held nine, which is
              the same drift the hardcoded population figures had. */}
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            {NUMBER_WORDS[STACK.length] ?? STACK.length} layers, one primitive underneath: a proven
            track record.
          </h2>
          <p className="lead mt-5 text-muted">
            In the order money moves. Each layer consumes the one below and feeds the one above, so
            they compose into a stack rather than scattering into features.
          </p>
          <p className="strata-tally mt-6">
            <span className="strata-tally__n">{liveCount}</span>
            <span>
              of {STACK.length} live on Monad mainnet.{" "}
              {STACK.length - liveCount > 0 ? (
                <>
                  {STACK.length - liveCount} built and tested, not yet run in production and drawn
                  hollow so the difference is visible without reading a chip.
                </>
              ) : null}
            </span>
          </p>
        </div>

        <ol className="strata">
          {STACK.map((l, i) => {
            const inner = (
              <>
                <span className={`strata__node strata__node--${l.status}`} aria-hidden="true" />
                <span className="strata__idx" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="strata__main">
                  <div className="strata__title">
                    <span className="strata__name">{l.name}</span>
                    <span className="strata__codename">{l.codename}</span>
                  </div>
                  <p className="strata__body">{l.body}</p>
                </div>
                <span className={`chip ${l.status === "live" ? "chip--live" : "chip--built"} strata__chip`}>
                  {l.status}
                </span>
              </>
            );
            return (
              <li key={l.codename} className={`strata__row strata__row--${l.status}`} style={{ ["--i" as string]: i }}>
                {l.href ? (
                  <Link href={l.href} className="strata__link">
                    {inner}
                  </Link>
                ) : (
                  <div className="strata__link">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- proof on mainnet */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">proof, on chain 143</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            One complete job, settled in real USDC. No testnet screenshots.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            1.40 escrowed at two cents a call, 30 of 70 used, 0.60 to the agent, 0.80 returned in the
            same transaction that pays, 0 retained. The buyer held zero MON at every point.
          </p>
        </div>
        <div className="spot mt-7 grid gap-5 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="eyebrow">the settlement</p>
            <div className="mt-3 font-mono text-[12px]">
              <Proof k="escrow" tx="0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e" />
              <Proof k="deliver" tx="0xc259c7a6067c051c01ed75a2b12d5c64380216275a43417ddf407913582a6724" />
              <Proof k="settle" tx="0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5" />
              <Proof k="x402 payment" tx="0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a" />
            </div>
          </div>
          <div className="flex flex-col justify-between gap-4">
            <p className="text-[12.5px] leading-relaxed text-muted">
              The agent in that run is ours, so this proves the machinery works in real USDC on mainnet,
              not that a stranger paid us. Every layer is checked from a clean machine with no key:
            </p>
            <pre className="sql rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">./scripts/prove.sh   # 12 checks, all nine layers</pre>
          </div>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the measurement, as evidence */}
      {/* One visual carries the finding. This section used to state the same numbers four times: tiles,
          a finding panel, the flow diagram and a distribution bar. The diagram says it best, so the
          rest is reduced to the one line that frames it and the one line that protects operators. */}
      <Reveal as="section" className="band">
        <div className="evidence-head">
          <div className="max-w-2xl">
            <span className="kicker">why the market needs this</span>
            <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
              {d.paymentClaims} payment claims. {d.doNotResolve} name the wrong chain.{" "}
              <span className="text-[var(--color-brand)]">{mis.rows.elsewhere} of those are real payments.</span>
            </h2>
            <p className="lead lead--wide mt-5 text-muted">
              Every document is hash-perfect, so integrity checkers call them all verified. Reading the
              chain they name finds {d.resolve} there. Reading every other chain finds{" "}
              {mis.rows.elsewhere} more, so only {mis.rows.nowhere} cite a transaction that exists
              nowhere. One wrong field is not a fake payment.
            </p>
          </div>
          <dl className="evidence-tally">
            <div><dt>on the named chain</dt><dd className="text-[var(--color-true)]">{d.resolve}</dd></div>
            <div><dt>real, wrong chain</dt><dd className="text-[var(--color-brand)]">{mis.rows.elsewhere}</dd></div>
            <div><dt>on no chain</dt><dd className="text-[var(--color-false)]">{mis.rows.nowhere}</dd></div>
            <div><dt>could not check</dt><dd className="unknown-value">{unknownTotal}</dd></div>
          </dl>
        </div>

        {mis.rows.elsewhere > 0 ? (
          <div className="mt-7">
            <WhereItWent byChain={mis.rows.byChain} nowhere={mis.rows.nowhere} />
          </div>
        ) : null}

        <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-muted">
          Nobody here is accused of anything. <span className="unknown-value">unknown</span> is never{" "}
          <span className="text-[var(--color-false)]">false</span> and never zero: a failure on our side
          to look is not evidence a payment did not happen.{" "}
          <Link href="/method" className="text-[var(--color-brand)] hover:underline">How each rung is decided →</Link>{" "}
          <Link href="/studio" className="text-[var(--color-brand)] hover:underline">Fix a record →</Link>
        </p>
        <Derivation sql={m.sql} note="One row per claim, latest verdict only. The full history of every re-check stays in fovea.verdict." />
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the finding that names the customer */}
      {/* Was a full band with two paragraphs. The number is the finding, so it is now one compact
          strip: the figure, what it is, who the first user is and where to look. */}
      <Reveal as="section" className="band">
        <div className="finding finding--strip">
          <div className="finding__figure"><CountUp value={s.largestMemberCount} /></div>
          <div className="min-w-0">
            <span className="kicker">who this is for</span>
            <h2 className="mt-2 fluid-2 font-semibold leading-tight tracking-tight">
              agents across {s.largestDistinctOwners.toLocaleString()} wallets share one registration
              document that no longer answers.
            </h2>
            <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted">
              <Pct of={s.largestMemberCount} total={p.agentsIndexed} /> of the registry and the registry
              reports no difference between those and the live ones. First user:{" "}
              <span className="text-[var(--color-text)]">Execution Market</span>, whose payments are real
              and name the wrong chain.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5 lg:flex-col">
            <Link href="/operators" className="cta">what that document is →</Link>
            <Link href="/compare" className="cta-ghost">compare two agents →</Link>
          </div>
        </div>
        <Derivation sql={shape.sql} note="The cluster shape, from the registry's own records." />
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- built for software */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">built for software</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            An agent should never need to read HTML.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            Every surface is served as data too, with live numbers, a{" "}
            <code className="font-mono text-[var(--color-brand)]">reproduce</code> field on every
            response and a null rendered as <span className="unknown-value">unknown</span> rather
            than defaulted to zero.
          </p>
        </div>
        {/* A terminal listing rather than nine cards: the audience is software, the routes are the
            content and the cards repeated the hero's scrolling list at three times the height. */}
        <div className="term mt-8" role="list">
          <div className="term__bar" aria-hidden="true"><i /><i /><i /><span>kanmani.xyz</span></div>
          {SURFACES.map((x) => (
            <a
              key={x.href}
              href={x.href}
              role="listitem"
              // New tab: each returns a document, not a page, so navigating in place would strand the
              // reader on raw JSON. noopener so the opened document gets no handle on this window.
              target="_blank"
              rel="noopener"
              className="term__row"
            >
              <span className="term__route">{x.label}</span>
              <span className="term__hint">{x.hint}</span>
            </a>
          ))}
          <div className="term__row term__row--post">
            <span className="term__route">POST /api/verify</span>
            <span className="term__hint">402 with an x402 challenge, settled on Monad, then the check runs</span>
          </div>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          The thing that audits payments is paid for over the rail it audits.
        </p>
      </Reveal>

      {/* ---------------------------------------------------------------- closing */}
      <Reveal
        as="section"
        className="field field-live -mx-[var(--gutter)] mb-[calc(var(--section-gap)*-1)] overflow-hidden border-t border-[var(--color-line)] px-[var(--gutter)] sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border"
      >
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="closing relative">
          <h2 className="mx-auto max-w-3xl fluid-3 font-semibold leading-tight tracking-tight">
            Make your track record load-bearing.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[length:var(--step-0)] text-muted">
            Check any claim free, in the browser or over the API, with the command to re-derive it
            without us.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <Link href="/verify" className="cta">verify a claim →</Link>
            <Link href="/agents" className="cta-ghost">browse every agent →</Link>
            <Link href="/status" className="cta-ghost">is the index fresh? →</Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** One checkable fact in the hero. The value is large, the note says what would falsify it. */
function HeroFact({ k, v, note }: { k: string; v: ReactNode; note: string }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">{k}</dt>
      <dd className="stat-value mt-1 text-[length:var(--step-2)] text-[var(--color-text)]">{v}</dd>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">{note}</p>
    </div>
  );
}

/** A labelled mainnet transaction, linked to the explorer. */
function Proof({ k, tx }: { k: string; tx: string }) {
  return (
    <div className="proof-row">
      <span className="text-faint">{k}</span>
      <a
        href={`https://monadexplorer.com/tx/${tx}`}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[var(--color-brand)] hover:underline"
      >
        {tx.slice(0, 10)}…{tx.slice(-8)}
      </a>
    </div>
  );
}

/** A calm comparison card. `brand` accents the border only, never a verdict colour as a fill. */
function GlanceCard({ head, body, brand }: { head: string; body: string; brand?: boolean }) {
  return (
    <div className={`spot rounded-[var(--radius)] border bg-[var(--color-panel)] p-4 ${brand ? "border-[var(--brand-line)]" : "border-[var(--color-line)]"}`}>
      <p className={`text-[13px] font-semibold ${brand ? "text-[var(--color-brand)]" : "text-[var(--color-text)]"}`}>{head}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

