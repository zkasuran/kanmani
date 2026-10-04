import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { Cmd, Code, Facts, H2, LadderDiagram, Note, Prose, Shot } from "@/components/blog.tsx";

export const metadata = {
  title: "Hash integrity is not claim truth",
  description:
    "Every ERC-8004 tool checks that an evidence document was not tampered with. None checks that the payment it describes happened on the chain it names. We read 1,292 Monad evidence documents and checked.",
};

export default function ClaimTruth() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · the thesis · updated 2026-10-04"
        title="Hash integrity is not claim truth"
        lead="Monad's agent registry holds more than ten thousand agents. A tool can tell you whether an agent's evidence was tampered with. None of them tells you whether the payment the evidence describes ever happened. We checked every one."
      />

      <Prose>
        <H2>The check everybody already does</H2>
        <p>
          An ERC-8004 agent collects feedback. Each feedback entry on chain carries a pointer to an evidence
          document plus the keccak256 hash of that document. Fetch the document, hash it and compare. If the
          hashes match, nobody edited the document after it was committed. Every explorer that reads the
          registry does this.
        </p>
        <p>
          That check is real. It is also the wrong question for anyone about to pay an agent. A document can
          match its hash exactly and still describe a payment that never happened. Integrity proves the bytes
          did not change. It says nothing about whether what the bytes describe is true.
        </p>

        <H2>So we added the rungs above it</H2>
        <p>
          We check each claim one rung at a time. Each rung answers a question the one below it cannot. The
          top rung reads the cited transaction on the chain the document names. Then it checks that the value
          actually reached the recipient the document names, in the token and amount it names, at a depth of
          at least two blocks.
        </p>
      </Prose>

      <LadderDiagram />

      <Prose>
        <H2>What reading all of them found</H2>
        <p>
          We ran the ladder over every Monad feedback that carries an evidence pointer, 1,292 of the 9,288
          feedbacks in the registry. Most do not assert a payment at all: they are game ratings and plain-text
          comments, so there is nothing to be right or wrong about. Of the 185 that do assert one, two thirds
          cite a transaction that is not on the chain they name.
        </p>
      </Prose>

      <Shot
        post="claim-truth"
        name="distribution"
        width={1153}
        height={570}
        href="/claims"
        alt="The claims page: 123 not on the chain they name, 62 on the chain they name, 12 could not check, 1,095 assert no payment"
        caption={
          <>
            The live <Link href="/claims">claims page</Link> on 2026-10-04. Red is a payment claim whose
            transaction is not on the chain it names. Green is one we confirmed. Grey is a document we could not
            check, which is never counted as false.
          </>
        }
      />

      <Prose>
        <p>
          The 123 is the number everything here rests on, so it is worth seeing one up close. This claim comes
          from an execution.market worker receipt. The document is hash-perfect: the bytes we fetched are the
          bytes committed on chain. The transaction it cites does not exist on Monad.
        </p>
      </Prose>

      <Shot
        post="claim-truth"
        name="false-head"
        width={1153}
        height={648}
        href="/claim/143_10181_0x01F90369170C917A2c0E9d26D54c6A3A400984D3_1"
        alt="Verification history for one claim: ten scheduled checks from 30 September to 4 October, each false, each naming the block it read"
        caption={
          <>
            Ten checks of the same claim over five days, each recorded with the block it read. The history is
            append-only. If the author fixes the document, the next check writes a new row and the old ones stay,
            so the change is visible rather than a number quietly improving.
          </>
        }
      />

      <Shot
        post="claim-truth"
        name="false-chain"
        width={582}
        height={484}
        href="/claim/143_10181_0x01F90369170C917A2c0E9d26D54c6A3A400984D3_1"
        alt="What the chain says: bytes match the hash, not found on Monad, cross-chain search over BSC and five Alchemy chains"
        caption={
          <>
            The same claim, from the chain&apos;s side. The hash matches, so a hash-only tool would pass it. The
            transaction is not on Monad.
          </>
        }
      />

      <Note label="a bug this screenshot caught">
        The cross-chain line above says the transaction was found on none of the Alchemy chains. That check ran
        at 04:51 UTC, after our Alchemy account had hit its monthly capacity cap. Every one of those chains was
        answering HTTP 429. The code counted a refused request as a search that found nothing. It now records a
        failed provider as unreachable with the reason. The sentence on the page now says the result is
        inconclusive. The fix and its three tests are in <Code>lib/findtx.ts</Code>.
      </Note>

      <Prose>
        <H2>Check one yourself</H2>
        <p>
          Every verdict comes with the command that reproduces it. You do not need us to check the claim above.
          You need a public Monad RPC.
        </p>
      </Prose>

      <Cmd
        cmd={`cast tx 0x1508effd2e032b93bd0470c9ae6e537265b57a2f3119e8f4cddb63b0dae6e44b --rpc-url https://rpc.monad.xyz`}
        out="Error: tx not found: 0x1508effd2e032b93bd0470c9ae6e537265b57a2f3119e8f4cddb63b0dae6e44b"
        note="The transaction the document cites, asked for on the chain the document names."
      />

      <Facts
        caption="Every figure on this page, with where it is read from. Each is live except where a date says otherwise."
        rows={[
          { k: "agents in the registry", v: "10,278", src: "/status, the registry's own counter slot" },
          { k: "feedbacks", v: "9,288, of which 1,292 carry an evidence pointer", src: "/status" },
          { k: "assert a payment", v: "185", src: "feed.json data.summary.paymentClaims" },
          { k: "not on the chain they name", v: "123, two thirds of 185", src: "feed.json data.summary.doNotResolve" },
          { k: "confirmed", v: "62", src: "feed.json data.summary.resolve" },
          { k: "could not check", v: "12, never counted as false", src: "feed.json data.summary.couldNotCheck" },
        ]}
      />

      <Prose>
        <H2>Why this matters to someone with money on the line</H2>
        <p>
          The first user of this is not the agent being checked. It is whoever routes work to agents and pays
          them: a marketplace, a broker or a DAO. Today they can see that an agent has a hundred receipts. They
          cannot see how many of those receipts describe payments that never happened. On 2026-10-01 an
          outside broker paid two of our agents for exactly this answer, settled on Monad.
        </p>
        <p>
          The <Link href="/method">method page</Link> shows how each rung is decided. The{" "}
          <Link href="/developers">developers page</Link> has the free API and the MCP server.
        </p>
      </Prose>
    </div>
  );
}
