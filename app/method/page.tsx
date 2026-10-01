import Link from "next/link";
import { Mono, Num, PageHeader, Panel, SectionHead } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { mappingProposals, atlasGap, type AtlasGap, type MappingProposalRow } from "@/lib/queries.ts";
import { ATLAS } from "../../verifier/src/ladder/parse.ts";
import { CHAINS } from "../../verifier/src/chains.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Method",
  description: "How each rung is decided, with the command to re-derive every one of them by hand.",
};

const RUNGS = [
  {
    id: "declared",
    q: "Does the record say anything at all?",
    how: "Read `feedbackURI` off the NewFeedback event. It is a non-indexed field, so it exists in the log and nowhere else. `readFeedback()` does not return it.",
    fails: "A feedback with an empty URI points at nothing, so there is nothing to be right or wrong about. It never reaches a verdict.",
    cmd: `curl -sS http://localhost:8081/v1/graphql -d '{"query":"{ Feedback(limit:1, where:{feedbackUri:{_neq:\\"\\"}}) { id feedbackUri feedbackHash } }"}'`,
  },
  {
    id: "resolvable",
    q: "Does the document it points at still exist?",
    how: "Fetch it through the SSRF guard. `data:` URIs decode in process with no network at all, which is 92% of this corpus. `ipfs://` goes through a gateway, so it is still a guarded fetch.",
    fails: "A host that times out, rate limits or returns an error gives `unknown`. Never `false`. A failure to look is not evidence that a payment did not happen.",
    cmd: `curl -sS -o /dev/null -w '%{http_code}\\n' '<the document url>'`,
  },
  {
    id: "intact",
    q: "Are the bytes the ones committed on chain?",
    how: "keccak256 over the raw fetched bytes, compared against `feedbackHash` from the event.",
    fails: "A mismatch stops the ladder at `unknown`, deliberately. The bytes served are not the bytes the author committed, so any claim read out of them would be attributed to somebody who never wrote it. Ten documents on Monad are in exactly this state: the URL is stable and the bytes are not.",
    cmd: `curl -sS '<url>' | cast keccak  # compare against feedbackHash`,
  },
  {
    id: "parsed",
    q: "Does the document assert a payment at all?",
    how: "Run the published atlas below. Exactly one mapping must match; two matching is refused rather than resolved by declaration order.",
    fails: "A shape no mapping reads is `unknown` and is reported as a coverage gap with its keys, so it can be added. Adding one mapping moved the count of resolving claims from 2 to 12, which is why the gap is published rather than folded into something softer.",
    cmd: `node --experimental-strip-types verifier/src/cli/locate.ts <network> <txHash>`,
  },
  {
    id: "true",
    q: "Did the thing the document describes actually happen?",
    how: "Read the cited transaction on the chain the document names, not on the chain we would prefer. The receipt is fetched and the chain head is recorded alongside it.",
    fails: "Absent receipt on a chain we read successfully is `false`. Any other error from the provider is `unknown`. The match is on the error type rather than on a message substring, because a provider is free to reword a message and getting this backwards turns an outage into a wave of accusations.",
    cmd: `cast receipt <txHash> --rpc-url https://rpc.monad.xyz`,
  },
];

export default async function Method() {
  // The review queue is read from the database, newest per shape. Both reads degrade to empty or
  // unknown rather than crashing a page that is otherwise static: the queue is additive, not a
  // dependency the ladder prose rests on.
  const proposals: MappingProposalRow[] = (await mappingProposals()).rows;
  let gap: AtlasGap | null = null;
  try {
    gap = await atlasGap();
  } catch {
    gap = null;
  }
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- header */}
      <PageHeader
        kicker="method · monad mainnet · chain 143"
        title="How each verdict on this site is decided"
        lead={
          <>
            Every verdict here is reproducible by hand. Each rung says what question it answers, how
            it decides, what happens when it cannot decide and the command that gets the same answer
            without this site. If any of them disagree with what a page here says, the page is wrong.
          </>
        }
      />

      {/* ---------------------------------------------------------------- the rule */}
      <Reveal>
      <Panel title="the one rule that governs everything else">
        <p className="text-[15px] leading-relaxed">
          <span className="text-[var(--color-false)]">false</span> means we read the chain and the
          transaction is not on it.{" "}
          <span className="unknown-value">unknown</span> means we could not look or could not read
          what we fetched. These are never collapsed.
        </p>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
          The difference is the whole reason this project can be published. These verdicts have
          people&apos;s names attached. Folding a timeout into a negative would let somebody
          else&apos;s outage publish as our accusation, automatically, at scale. It showed up live
          rather than in a test: one endpoint returned HTTP 525 mid-run and the verdict came back
          unknown. Collapsed the tempting way, that run would have published &quot;this transaction
          does not exist&quot; on the strength of an outage.
        </p>
      </Panel>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the ladder */}
      <Reveal as="section" className="space-y-4">
        <SectionHead eyebrow="the ladder" title="How each rung decides" />
        {RUNGS.map((r, i) => (
          <Panel key={r.id} title={`${i + 1}. ${r.id}`} subtitle={r.q}>
            <dl className="space-y-3 text-[13.5px] leading-relaxed">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-wide text-faint">how it decides</dt>
                <dd className="mt-1 text-muted">{r.how}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-wide text-faint">
                  when it cannot decide
                </dt>
                <dd className="mt-1 text-muted">{r.fails}</dd>
              </div>
            </dl>
            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
              <p className="mb-1 font-mono text-[11px] text-faint">re-derive it</p>
              <pre className="sql">{r.cmd}</pre>
            </div>
          </Panel>
        ))}
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the atlas */}
      <Reveal>
      <Panel
        title="the atlas"
        subtitle="The mappings that read a document shape, written against real documents on Monad and then published. A reader re-running the pipeline executes these deterministically, with no model anywhere in the loop and gets the same numbers. The induction loop that proposes new mappings is a separate step with its own record: see docs/27-ATLAS-INDUCTION.md."
      >
        <div className="space-y-3">
          {ATLAS.map((m) => (
            <div key={m.name} id={m.name} className="rounded border border-[var(--color-line)] p-3 target:border-[var(--color-brand)]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Mono className="text-[13px] text-[var(--color-brand)]">{m.name}</Mono>
                <Mono className="text-[11px] text-faint">induced {m.induced}</Mono>
              </div>
              <p className="mt-1 text-[13px] text-muted">{m.note}</p>
              <Link
                href={`/claims?mapping=${m.name}`}
                className="mt-1 inline-block font-mono text-[11.5px] text-faint hover:text-muted"
              >
                every document this mapping read →
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
          A mapping can move a verdict, so every one carries the date it was induced. Two mappings
          matching one document is refused rather than resolved by array order, because declaration
          order is invisible to a reader and changes silently when somebody appends a mapping. A
          document no mapping reads comes back with its keys attached, so the shape can be added
          rather than guessed at.
        </p>
      </Panel>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- the review queue */}
      <Reveal>
      <Panel
        id="review-queue"
        title="the review queue"
        subtitle="Mappings a model induced for a document shape the hand atlas could not read. Each one was confirmed to round-trip through the parser above, then parked here for a human. This is the depth the Qwen bounty rewards: the model proposes, the deterministic parser checks, a person decides."
      >
        <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
          A proposal is a candidate, not a verdict. The model proposes a mapping. The parser confirms
          it round-trips. Then it waits here for review.{" "}
          <span className="text-[var(--color-text)]">Nothing on this queue has changed a verdict on
          this site.</span>{" "}
          A mapping only moves a number after a human reviews it and adds it to the atlas in code, which
          lands in the append-only verdict trail as{" "}
          <Mono className="text-[var(--color-false)]">unknown</Mono> →{" "}
          <Mono className="text-[var(--color-true)]">true</Mono> or{" "}
          <Mono className="text-[var(--color-false)]">false</Mono>.
        </p>

        {gap ? (
          <p className="mt-3 text-[13px] text-muted">
            <Num value={gap.unparsed} /> intact document{gap.unparsed === 1 ? "" : "s"} no mapping reads
            right now. <Num value={gap.pendingProposals} /> converged proposal
            {gap.pendingProposals === 1 ? "" : "s"} wait here to close that.{" "}
            <Link href="/claims?outcome=unknown&rung=intact" className="text-[var(--color-brand)] hover:underline">
              see the unmapped claims →
            </Link>
          </p>
        ) : null}

        {proposals.length === 0 ? (
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            The queue is empty right now. When the proposer runs against a shape the hand atlas cannot
            read, the candidate it induces appears here with its full transcript, the model that
            proposed it and the round-trip result. It still does not touch a verdict.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {proposals.map((p) => (
              <div key={p.shapeKey} className="rounded border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Mono className="text-[12.5px] text-[var(--color-brand)]">
                    {p.proposalName ?? p.shapeKey}
                  </Mono>
                  <Mono className="text-[11px] text-faint">{p.status}</Mono>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-faint">
                  <span>model {p.model || "unknown"}</span>
                  <span>
                    round-trips {p.converged && p.roundTripOk ? "yes" : "no"} · {p.iterations} turn
                    {p.iterations === 1 ? "" : "s"} · {p.toolCalls} parser call
                    {p.toolCalls === 1 ? "" : "s"}
                  </span>
                  <span>
                    covers <Num value={p.coveredClaims} /> claim{p.coveredClaims === 1 ? "" : "s"}
                  </span>
                  <span>{p.checkedAt.slice(0, 10)}</span>
                </div>
                {p.converged && p.proposalNote ? (
                  <p className="mt-1 text-[13px] text-muted">{p.proposalNote}</p>
                ) : (
                  <p className="mt-1 text-[13px] text-muted">
                    no mapping found yet{p.proposalKind ? ` (${p.proposalKind})` : ""}. The gap stays
                    visible rather than retried silently.
                  </p>
                )}
                <Link
                  href="/claims?outcome=unknown&rung=intact"
                  className="mt-1 inline-block font-mono text-[11.5px] text-faint hover:text-muted"
                >
                  the claims this shape covers →
                </Link>
              </div>
            ))}
          </div>
        )}
      </Panel>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- coverage */}
      <Reveal>
      <Panel
        title="chain coverage"
        subtitle="A transaction that is not found means nothing without the list of chains it was looked for on. This is what makes a negative falsifiable."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2">chain</th>
              <th className="pb-2">id</th>
              <th className="pb-2">names a document may use</th>
            </tr>
          </thead>
          <tbody>
            {CHAINS.map((c) => (
              <tr key={c.id} className="border-b border-[var(--color-line)]/50 last:border-0">
                <td className="py-2 font-mono text-[13px]">{c.displayName}</td>
                <td className="py-2 font-mono text-[12px] text-muted">{c.id}</td>
                <td className="py-2 font-mono text-[11.5px] text-faint">{c.aliases.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
          A chain with no endpoint configured returns null rather than a client pointed at a
          default. A silent fallback would make an unconfigured chain look checked, which is the
          difference between &quot;not found&quot; and &quot;not looked for&quot;. A document naming
          a chain not on this list gets <span className="unknown-value">unknown</span> and the
          reason says which chain it named.
        </p>
      </Panel>
      </Reveal>

      <hr className="rule-soft" />

      {/* ---------------------------------------------------------------- corrections */}
      <Reveal>
      <Panel title="what happens when we are wrong">
        <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
          Verdicts are stored append only. There is no update path anywhere in the code. A re-check
          writes a new row, so a document somebody repairs reads as{" "}
          <Mono className="text-[var(--color-false)]">false</Mono> →{" "}
          <Mono className="text-[var(--color-true)]">true</Mono> with both timestamps, rather than as
          a number quietly improving with no trace we ever said otherwise. Every claim page carries
          its full verification history for that reason.{" "}
          <Link href="/status" className="text-[var(--color-brand)] hover:underline">
            Claims whose verdict has changed →
          </Link>
        </p>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
          The registry also gives an agent an on-chain right of reply. Where an operator has used
          it, the reply is rendered beside our verdict on the claim page. We do not get the last
          word on somebody else&apos;s reputation by construction.
        </p>
      </Panel>
      </Reveal>
    </div>
  );
}
