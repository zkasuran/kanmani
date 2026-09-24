import Link from "next/link";
import { Mono, PageHeader, Panel } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { Count, Distribution, Ladder, Reproduce, TrustBadge, Verdict, outcomeMeaning } from "@/components/kit.tsx";
import { measurement } from "@/lib/queries.ts";
import { CHAINS, registrable } from "@/lib/chains.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Developers",
  description:
    "The components, the API and the one-line badge. Everything Kanmani knows, renderable in your own product, with the unknown rule built in.",
};

/** A copy-pasteable block. Kept local: this page is the only place that renders code as a product. */
function Snippet({ code }: { code: string }) {
  return (
    <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
      <pre className="sql">{code}</pre>
    </div>
  );
}

function Demo({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4">
      {children}
    </div>
  );
}

export default async function Developers() {
  const m = await measurement();
  const d = m.rows;
  const unknownTotal = d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="components · api · one-line embed"
        title="Render a verdict in your own product, without being able to render it wrongly."
        lead={
          <>
            The data has always been open. The hard part is that a verdict is easy to display badly and
            displaying it badly is worse than not displaying it. Everything below makes the three
            available mistakes unavailable: a null cannot print as{" "}
            <Mono>0</Mono>, <span className="unknown-value">unknown</span> cannot wear the colour of{" "}
            <span className="text-[var(--color-false)]">false</span> and there is no score to average
            the distinction away into.
          </>
        }
      />

      {/* ---------------------------------------------------------------- the embed */}
      <Reveal>
        <Panel
          id="embed"
          title="one line, for a directory that lists agents"
          subtitle="Measured status instead of declared status, in somebody else's page. No build step, no framework, no styles escaping into your layout."
        >
          <Snippet code={`<script src="https://kanmani.xyz/embed.js" data-agent="10182"></script>

<!-- light theme, for a light page -->
<script src="https://kanmani.xyz/embed.js" data-agent="10182" data-theme="light"></script>`} />
          <Demo>
            <TrustBadge
              agent={{
                agentId: 10182,
                name: null,
                registration: { state: "answered", uri: "https://execution.market/workers/0x350e…" },
                claims: { checked: 42, resolve: 1, doNotResolve: 41, couldNotCheck: 0, assertNoPayment: 0 },
              }}
            />
            <TrustBadge
              agent={{ agentId: 9999, name: null, registration: { state: "gone", uri: "" }, claims: null }}
            />
          </Demo>
          <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-muted">
            <li>
              <span className="text-[var(--color-text)]">It is sealed.</span> The badge renders inside a
              closed shadow root, so it cannot inherit your CSS and cannot leak into it. That matters
              beyond tidiness: a badge that picked up a host page&apos;s error red could show{" "}
              <span className="unknown-value">unknown</span> in the colour of an accusation.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It fails quiet.</span> A network error, a bad
              id or an unknown agent removes the element rather than drawing an error box in your page.
            </li>
            <li>
              <span className="text-[var(--color-text)]">Unchecked is not clean.</span> An agent nobody
              has measured shows <Mono>unchecked</Mono>, never a passing state.
            </li>
          </ul>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- components */}
      <Reveal>
        <Panel
          id="components"
          title="the components"
          subtitle="Every one of these is rendering live data on this page right now, from the same functions our own pages use. If a component here is broken, our site is broken too."
        >
          <div className="space-y-7">
            <div>
              <h3 className="font-mono text-[13px] text-[var(--color-brand)]">&lt;Verdict /&gt;</h3>
              <p className="mt-1 text-[13px] text-muted">
                The four outcomes and a fifth state for never-checked. The title attribute carries the
                meaning, verbatim from the verifier.
              </p>
              <Demo>
                <Verdict outcome="true" />
                <Verdict outcome="false" />
                <Verdict outcome="noClaim" />
                <Verdict outcome="unknown" />
                <Verdict outcome={null} />
                <Verdict outcome="false" size="lg" />
              </Demo>
              <Snippet code={`import { Verdict, outcomeMeaning } from "@/components/kit.tsx";

<Verdict outcome="unknown" />          // renders the word, in slate, never red
<Verdict outcome={null} />             // "unchecked", which is not "clean"
outcomeMeaning("unknown")
// ${JSON.stringify(outcomeMeaning("unknown"))}`} />
            </div>

            <div>
              <h3 className="font-mono text-[13px] text-[var(--color-brand)]">&lt;Count /&gt;</h3>
              <p className="mt-1 text-[13px] text-muted">
                The load-bearing one, four lines long. There is no prop that makes a null render as a
                digit.
              </p>
              <Demo>
                <span className="text-[15px]"><Count value={d.doNotResolve} /></span>
                <span className="text-faint">·</span>
                <span className="text-[15px]"><Count value={null} /></span>
                <span className="text-faint">·</span>
                <span className="text-[15px]"><Count value={0} /></span>
                <span className="font-mono text-[11px] text-faint">← a real zero still reads as 0</span>
              </Demo>
              <Snippet code={`<Count value={73} />      // 73
<Count value={0} />       // 0        a measured zero is a number
<Count value={null} />    // unknown  a failed read is a word`} />
            </div>

            <div>
              <h3 className="font-mono text-[13px] text-[var(--color-brand)]">&lt;Ladder /&gt;</h3>
              <p className="mt-1 text-[13px] text-muted">
                How far a claim got, as shape rather than score. Rungs not reached stay visible, so a
                reader sees what was not checked.
              </p>
              <Demo>
                <Ladder rung="declared" />
                <Ladder rung="parsed" />
                <Ladder rung="true" />
                <Ladder rung={null} />
              </Demo>
            </div>

            <div>
              <h3 className="font-mono text-[13px] text-[var(--color-brand)]">&lt;Distribution /&gt;</h3>
              <p className="mt-1 text-[13px] text-muted">
                Live, from this chain, right now: {d.resolve} resolve, {d.doNotResolve} do not,{" "}
                {d.noClaim} assert no payment, {unknownTotal} could not be checked. A segment below a
                floor width is still drawn, because a share that reads as zero when it is not is the
                error this project is about.
              </p>
              <Demo>
                <span className="w-full max-w-xl">
                  <Distribution
                    resolve={d.resolve}
                    doNotResolve={d.doNotResolve}
                    noClaim={d.noClaim}
                    couldNotCheck={unknownTotal}
                  />
                </span>
              </Demo>
              <Reproduce command={m.sql} />
            </div>
          </div>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- the api */}
      <Reveal>
        <Panel
          id="api"
          title="the api"
          subtitle="Open, CORS-enabled, no key. Every response carries checkedAt, checkedAtBlock and a reproduce field with the command that gets the same answer without us."
        >
          <Snippet code={`GET  /api/agent/<id>                        one agent, including what is not known about it
GET  /api/claims?outcome=false&limit=50     filterable, free
GET  /api/sla/<agentId>?fromBlock=&toBlock=  claim-truth rate over a block window
POST /api/verify                            402, then pay, then the verdict
GET  /feed.json                             every checked claim plus its distribution
GET  /schema.json                           the shape of every response
GET  /llms.txt                              the whole site as plain text, live numbers
GET  /agents.md                             the access contract, addressed to software
GET  /.well-known/agent-registration.json   our own ERC-8004 record`} />
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            Fields with no answer are <Mono>null</Mono> rather than absent, so nobody defaults them to
            zero. That is the one thing to know before consuming this by hand and it is the reason the
            components above exist.
          </p>
          <Snippet code={`curl -sS https://kanmani.xyz/api/agent/10182 | jq '.data.claims'
curl -sS 'https://kanmani.xyz/api/claims?outcome=false&limit=1' | jq '.data.total'
curl -sS https://kanmani.xyz/api/sla/10182 | jq '{rateBps, sample}'   # rateBps is null on an empty sample, never 0`} />
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- chains */}
      <Reveal>
        <Panel
          id="chains"
          title="adding a chain is one entry"
          subtitle="The chain registry is a data file and the conformance tests fail naming whatever is missing."
        >
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted">
            {CHAINS.length} chains declared, {registrable().length} carrying ERC-8004 registries. The
            registries are per-chain singletons sharing one address set, so a new chain needs no new
            addresses.{" "}
            <Link href="/chains" className="text-[var(--color-brand)] hover:underline">
              The coverage table →
            </Link>
          </p>
          <Snippet code={`// shared/erc8004-chains.json
{ "id": 130, "key": "unichain", "displayName": "Unichain",
  "aliases": ["unichain", "uni"], "rpcEnv": "RPC_UNICHAIN",
  "explorer": "https://uniscan.xyz",
  "erc8004": { "startBlock": 1234567, "indexed": false } }

export RPC_UNICHAIN=https://…
npm test    # conformance + drift and it names what is missing`} />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel title="how to actually get these">
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">There is no npm package yet.</span> An earlier
            version of this page showed{" "}
            <Mono>import … from &quot;@kanmani/kit&quot;</Mono>, which was an import path nobody could
            resolve, exactly the kind of claim this project exists to check, on our own page. Until a
            package is published, the honest instruction is to copy{" "}
            <Mono>components/kit.tsx</Mono> from the repository. It is one file, has no dependency
            beyond React and carries the rule with it.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">
              <Mono>embed.js</Mono> needs nothing.
            </span>{" "}
            It is a script tag against a live origin, so the badge is available today whatever happens
            to the package question.
          </p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">Licensing is resolved: copy it.</span>{" "}
            <Mono>components/kit.tsx</Mono> and <Mono>app/embed.js</Mono> are released under <Mono>MIT</Mono>
            the only two files in the repository that are, since the rest is source-available with no
            derivatives. A component that exists to be rendered inside somebody else&apos;s product cannot
            be read-only and what the kit publishes is a constraint rather than an asset: a restrictive
            licence on a safety property works against its own purpose. The reasoning is in{" "}
            <Mono>docs/24-KIT-LICENCE.md</Mono>.
          </p>
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="rule"
          title="the one rule, if you read nothing else">
          <p className="max-w-3xl text-[14px] leading-relaxed">
            <span className="unknown-value">unknown</span> is never{" "}
            <span className="text-[var(--color-false)]">false</span> and never{" "}
            <Mono>0</Mono>.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            These verdicts carry real operators&apos; names. A failure on our side to look is not
            evidence that a payment did not happen and collapsing the two would let somebody
            else&apos;s outage publish as an accusation, at scale, automatically. Every component here
            enforces that so you do not have to remember it.{" "}
            <Link href="/method" className="text-[var(--color-brand)] hover:underline">
              How each rung is decided →
            </Link>
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}
