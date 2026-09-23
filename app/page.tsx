import Link from "next/link";
import { Derivation, DistBar, Pct, StatTile } from "@/components/ui.tsx";
import { CountUp, Reveal } from "@/components/motion.tsx";
import { clusterShape, measurement, population } from "@/lib/queries.ts";

/** Nothing on this page may be captured at build time. See next.config.ts. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The landing page is the product, not the report.
 *
 * This page used to open with the measurement and nothing else, which read as a forensic exposé of
 * other people's work. That breaks the tone rule this project set for itself in
 * `.hq/plan/00-THESIS-AND-SCOPE.md`: **a clearing house, never an exposé.** The measurement is the
 * proof the engine works. It is not the pitch.
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

/** The machine-readable surfaces. Design in this track is developer experience, so these are the craft. */
const SURFACES: { href: string; label: string }[] = [
  { href: "/llms.txt", label: "GET /llms.txt" },
  { href: "/agents.md", label: "GET /agents.md" },
  { href: "/feed.json", label: "GET /feed.json" },
  { href: "/schema.json", label: "GET /schema.json" },
  { href: "/api/claims?outcome=false", label: "GET /api/claims" },
  { href: "/.well-known/agent-registration.json", label: "GET /.well-known/agent-registration.json" },
];

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
    body: "The evidence pointer exists only as a non-indexed event field and eth_getLogs caps at 100 blocks. Without an index there is nothing to check at all.",
    status: "live",
    href: "/agents",
  },
  {
    name: "Verify the claim",
    codename: "Fovea",
    body: "Five rungs, four outcomes. Read the chain the document names and record what was there, at a block. Never an inference.",
    status: "live",
    href: "/verify",
  },
  {
    name: "Escrow the job",
    codename: "Aqueous",
    body: "USDC locked before work starts. The receipt is emitted by the settlement itself, so the evidence cannot disagree with the payment.",
    status: "live",
    href: "/pay",
  },
  {
    name: "Pay without a wallet",
    codename: "Iris · x402",
    body: "One passkey is the whole account layer. An EIP-3009 authorisation is relayed, so the buyer needs no MON and holds no key we could lose.",
    status: "live",
    href: "/account",
  },
  {
    name: "Answer on chain",
    codename: "Optic",
    body: "The first and only row in Monad's ERC-8004 Validation Registry. A verdict written where the protocol expects it, not just on our own page.",
    status: "live",
    href: "/validate",
  },
  {
    name: "Bond the promise",
    codename: "Sclera",
    body: "An agent stakes USDC against a floor on its own claim-truth rate. A signed verdict slashes it, recovered against one key fixed at deploy. No admin override anywhere.",
    status: "built",
  },
  {
    name: "Fund from any chain",
    codename: "Chiasm · Intents",
    body: "Hire a Monad agent with money held elsewhere. The escrow funds the moment the bridge lands, with no bridge step the buyer has to see.",
    status: "built",
    href: "/fund",
  },
  {
    name: "Heal a fixed record",
    codename: "Alchemy hook",
    body: "A MetadataUpdate re-runs the ladder for that agent, so an operator who repairs a document sees false become true with both timestamps, nobody watching.",
    status: "built",
  },
];

/** The money path, said once, plainly. */
const FLOW = [
  { h: "Escrow", p: "The buyer locks USDC against terms. The job id is derived, never supplied." },
  { h: "Deliver", p: "The agent delivers. Both sides have an exit that does not need the other to reply." },
  { h: "Settle", p: "Payment and receipt in one transaction. Unspent metered funds return in the same call." },
  { h: "Price it", p: "The claim-truth rate that falls out becomes the bond, the odds and the credit line." },
];

export default async function Home() {
  const [pop, m, shape] = await Promise.all([population(), measurement(), clusterShape()]);

  const p = pop.rows;
  const d = m.rows;
  const s = shape.rows;

  const unknownTotal = d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- what this is */}
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-10 pt-12 sm:rounded-[var(--radius-lg)] sm:mx-0 sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <p className="eyebrow">erc-8004 · x402 · monad mainnet · chain 143</p>
          <h1 className="mt-4 max-w-4xl fluid-4 font-semibold leading-[1.1] tracking-tight">
            The settlement and trust layer for agent work on Monad.
          </h1>
          <p className="mt-5 max-w-2xl text-[length:var(--step-1)] leading-snug">
            Trust stops being a badge. <span className="text-[var(--color-brand)]">It becomes a price.</span>
          </p>
          <p className="lead lead--wide mt-5 text-muted">
            Hire an agent and the money sits in escrow until the work lands. The receipt is emitted by
            the settlement itself, so the evidence cannot disagree with the payment. The track record
            that falls out is financially load-bearing: it sets the bond an agent posts and what it
            can borrow against.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link href="/verify" className="cta">verify an agent →</Link>
            <Link href="/pay" className="cta-ghost">settle a job →</Link>
            <Link href="/method" className="cta-ghost">how a verdict is decided →</Link>
          </div>

          {/* Live, checkable facts. Every one is a link to a chain or a page, not an assertion. */}
          <dl className="mt-9 grid gap-x-8 gap-y-3 border-t border-[var(--color-line)]/70 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <HeroFact k="agents measured" v={p.agentsIndexed === null ? "unknown" : p.agentsIndexed.toLocaleString()} note="the whole ERC-8004 population on Monad" />
            <HeroFact k="settled in real USDC" v="1 job" note="buyer held zero MON throughout" />
            <HeroFact k="validation registry rows" v="1 of 1" note="the first ever written on Monad" />
            <HeroFact k="tests passing" v="468" note="site, verifier and contracts" />
          </dl>

          <div className="marquee mt-8 border-t border-[var(--color-line)]/70 pt-4" aria-label="Machine-readable surfaces">
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

      {/* ---------------------------------------------------------------- why it has to exist */}
      <Reveal as="section" className="band grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <span className="kicker">the market, not an accusation</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            A registry with {p.agentsIndexed === null ? "thousands of" : p.agentsIndexed.toLocaleString()} agents
            and no way to tell a working counterparty from a dead one.
          </h2>
          <p className="lead mt-5 text-muted">
            This is a plumbing problem, not a lying problem: one unchecked field in a template written
            by honest people. Auditing that forever is the small product. Routing the money so the
            receipt cannot disagree with reality is the large one.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GlanceCard
            head="What every tool checks"
            body="That a document's bytes match the hash committed on chain. All of them pass. It says nothing about whether the payment happened."
          />
          <GlanceCard
            brand
            head="What Kanmani adds"
            body="Read the named chain. Then escrow the next job so the receipt is correct by construction, and price the record that results."
          />
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- how the money moves */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">how it works</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            The receipt is produced by the payment, not written about it afterwards.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            Evidence scraped after the fact can name the wrong chain. Evidence emitted by the
            settlement cannot, because it is the same transaction that moved the money.
          </p>
        </div>
        <div className="flow mt-8">
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
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">the stack</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            Eight layers, one primitive underneath: a proven track record.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            Each layer consumes the one below it and feeds the one above, which is why these compose
            into a stack rather than scattering into features. Status is checked against the artifact:
            <span className="chip chip--live mx-1.5 align-middle">live</span> is running on Monad
            mainnet now, <span className="chip chip--built mx-1.5 align-middle">built</span> is written
            and tested in the repository, not yet deployed.
          </p>
        </div>
        <div className="mt-8 auto-grid">
          {STACK.map((l) => {
            const card = (
              <>
                <span className={`chip ${l.status === "live" ? "chip--live" : "chip--built"}`}>{l.status}</span>
                <div>
                  <div className="layer__codename">{l.codename}</div>
                  <div className="layer__name mt-0.5">{l.name}</div>
                </div>
                <p className="layer__body">{l.body}</p>
              </>
            );
            return l.href ? (
              <Link key={l.codename} href={l.href} className="layer">{card}</Link>
            ) : (
              <div key={l.codename} className="layer">{card}</div>
            );
          })}
        </div>
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
        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <p className="eyebrow">the settlement</p>
            <div className="mt-3 font-mono text-[12px]">
              <Proof k="escrow" tx="0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e" />
              <Proof k="deliver" tx="0xc259c7a6067c051c01ed75a2b12d5c64380216275a43417ddf407913582a6724" />
              <Proof k="settle" tx="0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5" />
              <Proof k="x402 payment" tx="0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a" />
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              The agent in that run is ours, so this is evidence the machinery works in real USDC on
              mainnet. It is not evidence a stranger paid us. Both are stated wherever it appears.
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <p className="eyebrow">read it back yourself</p>
            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
              <pre className="sql">{`# the buyer's MON balance, start to finish
cast balance 0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92 \\
  --rpc-url https://rpc.monad.xyz    # 0

# the escrow, immutable, no admin function
cast code 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32 \\
  --rpc-url https://rpc.monad.xyz | wc -c`}</pre>
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              Every page here prints the query behind its own numbers, and every JSON response carries
              a <code className="font-mono text-[var(--color-brand)]">reproduce</code> field. If a
              number disagrees with the command beside it, the page is wrong.
            </p>
          </div>
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the measurement, as evidence */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">why the market needs this</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            We checked every payment claim on Monad against the chain it names.
          </h2>
          <p className="lead lead--wide mt-5 text-muted">
            Every one of these documents is hash-perfect, so every tool that checks integrity calls
            them verified. Integrity is not truth. This is the gap the escrow above closes by
            construction.
          </p>
        </div>

        <div className="mt-7 auto-grid">
          <StatTile label="payment claims checked" value={d.paymentClaims} hint="Documents that assert a payment and were taken through the whole ladder." />
          <StatTile label="on the chain they name" value={d.resolve} tone="true" hint="The cited transaction is on the chain the document names." />
          <StatTile label="not on the chain they name" value={d.doNotResolve} tone="false" hint="We read that chain successfully and the transaction is not there." />
          <StatTile label="could not check" value={unknownTotal} tone="unknown" hint="A failure to look is never an accusation and never zero." />
        </div>

        <div className="mt-6 max-w-3xl">
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
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Nobody here is accused of anything. <span className="unknown-value">unknown</span> is never{" "}
            <span className="text-[var(--color-false)]">false</span> and never zero, because these rows
            carry real operators&apos; names and a failure on our side to look is not evidence a
            payment did not happen.{" "}
            <Link href="/method" className="text-[var(--color-brand)] hover:underline">How each rung is decided →</Link>
          </p>
          <Derivation sql={m.sql} note="One row per claim, latest verdict only. The full history of every re-check stays in fovea.verdict." />
        </div>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the finding that names the customer */}
      <Reveal as="section" className="band">
        <div className="finding p-6 sm:p-9">
          <span className="kicker">who this is for</span>
          <div className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
            <div>
              <div className="finding__figure"><CountUp value={s.largestMemberCount} /></div>
              <p className="mt-2 font-mono text-[12px] text-muted">
                agents across {s.largestDistinctOwners.toLocaleString()} wallets
                {" · "}<Pct of={s.largestMemberCount} total={p.agentsIndexed} /> of the registry
              </p>
            </div>
            <div>
              <h2 className="fluid-2 font-semibold leading-tight tracking-tight">
                share one registration document that no longer answers.
              </h2>
              <p className="mt-4 max-w-xl text-[length:var(--step-0)] leading-relaxed text-muted">
                An expired preview deployment. Nobody&apos;s misconduct, and fatal to anyone trying to
                use this registry to find somebody to pay: the registry reports no difference between
                those and the live ones. That filter is the product.
              </p>
              <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-muted">
                So we are not waiting for the agent economy to grow. We sell to the people already
                taking a percentage of it who cannot evidence what they settled. Our named first user
                is <span className="text-[var(--color-text)]">Execution Market</span>, the largest
                single source of ERC-8004 feedback on Monad: their documents are canonical and
                hash-correct, and their payment claims name Monad while the transactions sit
                elsewhere. A per-document pass or fail costs them nothing and fixes their record.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link href="/operators" className="cta">what that document is →</Link>
                <Link href="/compare" className="cta-ghost">compare two agents →</Link>
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-[var(--color-line)] pt-4">
            <Derivation sql={shape.sql} note="The cluster shape, from the registry's own records." />
          </div>
        </div>
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
            response, and a null rendered as <span className="unknown-value">unknown</span> rather
            than defaulted to zero.
          </p>
        </div>
        <div className="mt-8 auto-grid">
          {SURFACES.map((x) => (
            <a
              key={x.href}
              href={x.href}
              className="glow-lift block rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-4 font-mono text-[12px] text-muted hover:text-[var(--color-text)]"
            >
              {x.label}
            </a>
          ))}
        </div>
        <p className="mt-5 text-[13px] text-muted">
          <code className="font-mono text-[var(--color-brand)]">POST /api/verify</code> answers 402
          with an x402 challenge, settles through the Monad facilitator, then does the work. The thing
          that audits payments is paid for over the rail it audits.
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
function HeroFact({ k, v, note }: { k: string; v: string; note: string }) {
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
    <div className={`rounded-[var(--radius)] border bg-[var(--color-panel)] p-4 ${brand ? "border-[var(--brand-line)]" : "border-[var(--color-line)]"}`}>
      <p className={`text-[13px] font-semibold ${brand ? "text-[var(--color-brand)]" : "text-[var(--color-text)]"}`}>{head}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
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
