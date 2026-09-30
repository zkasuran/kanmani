import Link from "next/link";
import { Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";

/**
 * The Qwen write-up the bounty asks for: how Qwen 3.8 Max is used here and what it was worth.
 *
 * Every figure on this page comes from a recorded run or a transaction anyone can open. The two
 * run records live in the repository (verifier/src/atlas/inductions/). Nothing here is typed from
 * memory: if a run is repeated and the numbers move, this page is what has to change.
 */

export const metadata = {
  title: "How Qwen 3.8 Max reads evidence nobody wrote a parser for",
  description:
    "Kanmani uses Qwen 3.8 Max as a tool-using agent that maps unfamiliar ERC-8004 evidence documents. A mapping is accepted only if the real parser confirms it. Two recorded runs, one paid on Monad.",
};

const SCRIBE_TX = "0x87a7eb4e92d71e0357f0f1f9d1147050000e0f8d8d3a78241b1bf789cb6c76f8";

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--color-text)]">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 font-mono text-[12px] leading-relaxed text-muted">
      {children}
    </pre>
  );
}

export default function QwenArticle() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="writing · qwen 3.8 max · 2026-09-30"
        title="How Qwen 3.8 Max reads evidence nobody wrote a parser for"
        lead="Kanmani checks whether the payment an ERC-8004 agent's evidence document claims actually happened on the chain it names. That check needs to know which fields hold the chain and the transaction. Qwen finds them in shapes we have never seen. The verifier refuses any answer it cannot confirm."
      />

      <Panel title="the problem Qwen solves">
        <div className="space-y-3">
          <P>
            ERC-8004 feedback points at an evidence document and says nothing about its shape. Every operator
            invents one. To test a payment claim, the verifier has to know that <Mono>settlement.tx_hash</Mono>{" "}
            is the transaction in one document and <Mono>payment.proof</Mono> is it in another. The mapping from a
            shape to those fields is what we call the atlas.
          </P>
          <P>
            On Monad the atlas is five hand-written mappings plus a rule for plain-text comments. Together they
            read every Monad evidence document we have checked. That was the easy chain. BNB Smart Chain carries the same registries and far more evidence.
            We sampled 320 of its documents and the atlas, built entirely from Monad, read <strong>none</strong> of
            them. Writing a parser per shape by hand does not scale to a registry where anyone can invent a format
            tomorrow.
          </P>
        </div>
      </Panel>

      <Panel title="what Qwen does: a tool loop, not a prompt">
        <div className="space-y-3">
          <P>
            Qwen 3.8 Max gets the raw bytes of one document and a single tool, <Mono>try_mapping</Mono>. The tool runs
            a proposed mapping through our real evidence parser, the same code that produces published verdicts,
            and returns exactly what it extracted. Qwen proposes the keys that identify the shape and the path to
            each payment field, along with what it predicts the parser will pull out. It reads the result and
            revises. It can also say the shape asserts no payment at all, by setting <Mono>claim</Mono> to null.
          </P>
          <P>
            The loop does not trust the model. It accepts a mapping only when what the parser extracted matches
            what Qwen predicted. A proposal it cannot confirm costs a turn and can never reach a verdict. Running
            out of turns is recorded as a give-up, never as a success. Each of those three properties has a test
            that breaks when its guard is removed (<Mono>verifier/src/atlas/induce.test.ts</Mono>).
          </P>
          <P>
            So the division of labour is fixed. Qwen reads and proposes. Deterministic code decides. No model
            output touches money. Nothing a model says becomes a <Mono>true</Mono> or <Mono>false</Mono>{" "}
            without the parser and then the chain agreeing.
          </P>
        </div>
      </Panel>

      <Panel title="run one: a field called value that was not money" subtitle="recorded 2026-09-28, verifier/src/atlas/inductions/gebo-uptime-report.v1.json">
        <div className="space-y-3">
          <P>
            The most common unread shape in the BSC sample carries <Mono>value: 10000</Mono> with{" "}
            <Mono>valueDecimals: 2</Mono>. A parser written in a hurry reads that as a payment of 10,000 units, finds
            no matching transaction and marks the claim false. Qwen converged with one tool call and proposed{" "}
            <Mono>gebo-uptime-report.v1</Mono> with no payment claim, reasoning that the figure is 100.00% uptime and
            that the document has no transaction, payer, recipient, token or network.
          </P>
          <P>
            We checked that by hand before believing it. Every document of the shape carries{" "}
            <Mono>tag1: &quot;uptime&quot;</Mono> and the same value. A key scan across the sample for anything
            payment-like returned nothing. There were 41 documents of that shape in the sample. Read wrongly, they
            would have become 41 invented payment claims, each marked false, on a project whose headline is claims
            that do not resolve. The value here was an error not made.
          </P>
        </div>
      </Panel>

      <Panel title="run two: live, paid, on Monad" subtitle="2026-09-30, through the Scribe agent, ERC-8004 #10272">
        <div className="space-y-3">
          <P>
            The same loop is a hireable agent. Scribe takes an evidence document over HTTP or A2A and returns
            a confirmed mapping, paid with x402 <Mono>upto</Mono>: the caller signs a ceiling and is charged only
            for the model turns used.
          </P>
          <P>
            We sent it a document from a shape that dominates BSC&apos;s gzip-encoded evidence (36 of 40 we sampled): a
            feedback entry with <Mono>score: 100</Mono>, <Mono>tag1: &quot;get top 1 rank --&gt;&quot;</Mono> and a
            Telegram link in the comment. Qwen returned <Mono>feedback-rating.v1</Mono>, no payment claim. It noted
            unprompted that the tags were being used for self-promotion rather than for rating. A numeric score of 100
            is exactly the kind of field a careless mapping turns into an amount.
          </P>
          <div className="space-y-1 text-[13px]">
            <Row label="ceiling signed">
              <Mono className="text-muted">10,000 units (0.01 USDC)</Mono>
            </Row>
            <Row label="charged">
              <Mono className="text-muted">4,000 units: a 2,000 base plus one model turn at 2,000</Mono>
            </Row>
            <Row label="settled on Monad">
              <a
                className="font-mono text-[12.5px] text-[var(--color-brand)] hover:underline"
                href={`https://monadexplorer.com/tx/${SCRIBE_TX}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SCRIBE_TX.slice(0, 18)}…
              </a>
            </Row>
          </div>
          <P>
            <strong>Who paid.</strong> The payer and the payee are the same wallet, ours. This proves the path works
            end to end: a model doing tool-using work behind a metered on-chain payment. It says nothing about demand
            and we do not count it as revenue.
          </P>
        </div>
      </Panel>

      <Panel title="one provider constraint we hit">
        <div className="space-y-3">
          <P>
            The loop originally forced a tool call on every turn with <Mono>tool_choice: &quot;required&quot;</Mono>.
            Qwen 3.8 Max rejects that in thinking mode:
          </P>
          <Code>{`InternalError.Algo.InvalidParameter: The tool_choice parameter does not
support being set to required or object in thinking mode`}</Code>
          <P>
            Turning thinking off would have fixed the error and lost the point, because the reasoning is what
            noticed a field named <Mono>value</Mono> was not money. The client now sends <Mono>auto</Mono> for this
            model. The loop already tolerates a turn without a tool call and still accepts nothing it has not put
            through the parser, so the cost is at most one retry.
          </P>
        </div>
      </Panel>

      <Panel title="what Qwen was worth here and what it was not">
        <div className="space-y-3">
          <P>
            Worth: coverage of formats nobody on our side has seen, at the moment a document arrives, without a
            deploy. Both runs so far found shapes that assert <strong>no</strong> payment. That sounds like a null
            result. In this domain it is the valuable one, because the expensive mistake is inventing a claim and
            then publishing that it was false.
          </P>
          <P>
            Not claimed: two shapes from two runs are not a coverage figure for BSC. Neither mapping has been added
            to the shipped atlas, because one confirmed run is a proposal worth reviewing and not yet a standard.
            The Monad verdicts on this site all come from the hand-written atlas.
          </P>
        </div>
      </Panel>

      <Panel title="run it yourself">
        <div className="space-y-3">
          <Code>{`# the loop directly, with your own key (GMI Cloud or DashScope, OpenAI-compatible)
export GMI_API_KEY=...
export QWEN_BASE_URL=https://api.gmi-serving.com/v1
export QWEN_MODEL=Qwen/Qwen3.8-Max
npx tsx verifier/src/atlas/demo.ts

# or hire Scribe: an unpaid call answers 402 with its x402 options
curl -s -X POST https://kanmani.xyz/api/service/scribe \\
  -H 'content-type: application/json' \\
  -d '{"document":{"value":"10000","valueDecimals":2,"tag1":"uptime"}}'`}</Code>
          <P>
            Scribe&apos;s registration, A2A card and price are on <Link className="text-[var(--color-brand)] hover:underline" href="/hire">/hire</Link>.
            The loop, the parser and both run records are in the repository under <Mono>verifier/src/atlas/</Mono>.
          </P>
        </div>
      </Panel>
    </div>
  );
}
