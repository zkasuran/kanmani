import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { Cmd, Code, Facts, H2, Note, Prose, Shot } from "@/components/blog.tsx";

export const metadata = {
  title: "Qwen 3.8 Max wrote a parser we shipped",
  description:
    "Three Monad claims sat as unknown because no parser could read their shape. Qwen 3.8 Max proposed a mapping, ran it against our own parser as a tool and converged in one turn. One field changed in review. The claim it unlocked checks out on chain.",
};

/** The real run, read from verifier/src/atlas/inductions/tab-settlement-feedback.v1.2026-10-04.json. */
const RUN = {
  model: "Qwen/Qwen3.8-Max",
  servedBy: "GMI Cloud, OpenAI-compatible API",
  at: "2026-10-04 11:38 UTC",
  turns: 1,
  toolCalls: 1,
  seconds: 16,
};

export default function Qwen() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · qwen 3.8 max · 2026-10-04"
        title="Qwen 3.8 Max wrote a parser we shipped"
        lead="Three Monad claims sat as unknown because nothing could read their shape. Qwen 3.8 Max proposed a mapping, tested it against our own parser and converged in one turn. It is now the first mapping in the atlas that a model wrote rather than a person."
      />

      <Prose>
        <H2>The gap</H2>
        <p>
          Every evidence document an agent publishes is JSON in whatever shape its author chose. Our verifier
          reads them through an atlas of mappings, one per shape. A mapping says where the network, the
          transaction hash, the payer, the recipient and the amount live. The parser only uses those fields. A
          document whose shape no mapping matches stops at the <Code>intact</Code> rung as{" "}
          <span className="unknown-value">unknown</span>. We never guess.
        </p>
        <p>
          Three documents on Monad were in that state. They come from a settlement gateway and describe a tab
          being paid off. Before today this is what each one looked like:
        </p>
      </Prose>

      <Shot
        post="qwen"
        name="before"
        width={1058}
        height={760}
        alt="A claim page showing unknown: no published mapping reads this document shape, read by mapping: no mapping reached this document, found on chain: not looked for"
        caption={
          <>
            Before. The bytes match their on-chain hash, so the document is genuine. Nothing could read it, so the
            chain was never asked.
          </>
        }
      />

      <Prose>
        <H2>How Qwen is used: plan, call the parser, read, revise</H2>
        <p>
          We give Qwen the document and one tool, <Code>try_mapping</Code>. It proposes a mapping as paths into
          the document, plus its own prediction of what those paths will extract. The tool compiles the proposal
          and runs our real parser over the real bytes, then hands the result back. If the parser extracted what
          Qwen predicted and no existing mapping also claims the shape, the loop accepts. Otherwise Qwen reads
          what actually came out and revises, for up to six turns.
        </p>
        <p>
          The proposal is data, never code. Nothing Qwen writes is evaluated. At worst a wrong proposal reads the
          wrong field. The round-trip check then rejects it.
        </p>
      </Prose>

      <Facts
        caption="The converged run. The full transcript, the proposal and the tool outputs are committed beside the mapping."
        rows={[
          { k: "model", v: RUN.model, src: RUN.servedBy },
          { k: "when", v: RUN.at },
          { k: "turns to converge", v: `${RUN.turns}, with ${RUN.toolCalls} call to the parser`, src: `${RUN.seconds} seconds end to end` },
          { k: "what Qwen predicted", v: "network 143, txHash 0x863e9ae5…f817497" },
          { k: "what the parser extracted", v: "network 143, txHash 0x863e9ae5…f817497", src: "equal, so accepted" },
        ]}
      />

      <Note label="the first run failed because of our bug">
        <p>
          The first real run an hour earlier gave up after six turns. Reading the transcript, Qwen&apos;s first
          proposal was already correct. It sent the <Code>claim</Code> field as a JSON string rather than a nested
          object, which some OpenAI-compatible servers do. Our loop cast the arguments to a type without checking
          them, read the paths off a string and compiled an empty mapping every time. The parser told Qwen it was wrong. It spent five turns rewriting a right answer, trying rooted paths, snake case and fewer
          fields.
        </p>
        <p className="mt-2">
          The fix validates the arguments field by field and decodes a string <Code>claim</Code> once. Replaying
          the first run&apos;s turn-one proposal through it extracts network 143 and the right hash. Then we ran
          Qwen again for real. It converged in one turn.
        </p>
      </Note>

      <Prose>
        <H2>What review changed</H2>
        <p>
          A converged mapping is a candidate, not a release. A person reads it before it joins the atlas. Qwen
          read the recipient as <Code>settlement.serviceId</Code>. That field is{" "}
          <Code>0x7461622e64656d6f…</Code>, which decodes to the text <Code>tab.demo</Code>: a label, not an
          address anything can be paid at. The settlement transaction&apos;s own USDC transfer pays{" "}
          <Code>settlement.collection</Code>, so the shipped mapping uses that.
        </p>
      </Prose>

      <Cmd
        cmd={`cast receipt 0x863e9ae50961b38e7bf12e7ae14e7384bc543725ea51c8acdd9dc8bf9f817497 --rpc-url https://rpc.monad.xyz`}
        out={`status   1 (success)   block 109379821
Transfer 0x754704bc…b603 (USDC)
  from 0x3a3b6079…e7ce  (settlement.agent)
  to   0x49472ef9…783a  (settlement.collection)
  200000 units`}
        note="The payment the document describes, read from Monad and summarised to its status and its one USDC Transfer log. The recipient is the collection address, so that is what the mapping must point at."
      />

      <Prose>
        <H2>After</H2>
        <p>
          With the reviewed mapping in the atlas, the verifier reads the document, asks Monad for the transaction
          and checks the value. The answer is <span className="text-[var(--color-true)]">true</span>: 200,000
          atomic units of USDC reached <Code>0x49472ef9…783a</Code> at block 109,379,821. That claim had been
          unknown since it was written.
        </p>
      </Prose>

      <Shot
        post="qwen"
        name="after"
        width={1058}
        height={760}
        href="/claim/143_10255_0x49472EF9ED99f30d4eaD45Ac9E1C16c31f70783A_3"
        alt="The same claim after the new mapping shipped"
        caption="After. The same claim once the mapping shipped and we re-ran the ladder over the three documents. The new verdict is appended. The old unknown row stays in its history."
      />

      <Prose>
        <H2>Two earlier runs: knowing what is not a payment</H2>
        <p>
          A verifier is also judged by what it does not count. Two earlier Qwen runs answered that side. Both found
          that the shape claims no payment.
        </p>
        <p>
          On Sep 28 Qwen read BNB Smart Chain evidence documents, which our atlas had never parsed. At the time BSC held
          25,643 of them against Monad&apos;s 1,287. In 320 sampled documents it found an uptime report whose{" "}
          <Code>value</Code> is 10000 at 2 decimals with the tag <Code>uptime</Code>. That is 100.00% uptime,
          not an amount. A careless parser would have read each one as a payment and manufactured claims out
          of uptime pings. We checked it by hand. Across the shape no field names a transaction, a payer or a
          token, so the right answer is no claim.
        </p>
        <p>
          On Sep 30 we ran Qwen as a paid agent. Scribe, ERC-8004 agent 10272, sells this same loop over x402
          with the <Code>upto</Code> scheme: send it a document in an unmapped shape and it returns
          Qwen&apos;s mapping only if it round-trips through our parser. It charges per model turn under a ceiling the buyer signs, so
          a buyer pays for the turns used, not the ceiling. One turn classified a BSC rating document (a score
          and two self-promotion tags) as no claim. It charged 4,000 of a 10,000 unit ceiling in USDC on Monad.
          Payer and payee were both our wallet, so it proves the metered rail, not demand.
        </p>
      </Prose>

      <Cmd
        cmd={`cast receipt 0x87a7eb4e92d71e0357f0f1f9d1147050000e0f8d8d3a78241b1bf789cb6c76f8 --rpc-url https://rpc.monad.xyz`}
        out={`status   1 (success)   block 109248917
Transfer 0x754704bc…b603 (USDC)
  from 0xdb6c6340…7777  (our wallet)
  to   0xdb6c6340…7777  (our wallet)
  4000 units`}
        note="The Scribe charge: one model turn plus the base price, settled under the upto ceiling. Both run records are committed beside the mapping in verifier/src/atlas/inductions/."
      />

      <Prose>
        <H2>What Qwen was worth here</H2>
        <p>
          Without it, each new evidence shape costs a person reading a stranger&apos;s JSON and writing a
          parser. With it, a new shape costs one model call and one review. Qwen does not decide any verdict. It
          proposes where to look, our parser checks the proposal against the real bytes, a person checks the
          meaning and the chain decides what is true. The model is used where it is strong: reading an
          unfamiliar structure and naming its fields.
        </p>
        <p>
          The run file is <Code>verifier/src/atlas/inductions/tab-settlement-feedback.v1.2026-10-04.json</Code>.
          The loop is <Code>verifier/src/atlas/induce.ts</Code>. The script{" "}
          <Code>scripts/atlas-propose.mjs</Code> runs it over every unread shape in the live index. The{" "}
          <Link href="/method">method page</Link> lists every mapping and when it was added.
        </p>
      </Prose>
    </div>
  );
}
