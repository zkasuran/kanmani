import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { Cmd, Code, Facts, H2, Note, Prose, Shot } from "@/components/blog.tsx";

export const metadata = {
  title: "Sixty of sixty-two wallets share one funder",
  description:
    "8,093 Monad agents across 7,962 wallets registered one document that now returns 404. Nansen's first-funder data traces 60 of 62 sampled wallets to a single address, which says the wallet count overstates how many operators there are.",
};

export default function Nansen() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · nansen · updated 2026-10-04"
        title="Sixty of sixty-two wallets share one funder"
        lead="8,093 agents on Monad point at one deleted document, registered by 7,962 different wallets. A wallet count says how many. It cannot say whether that is thousands of operators or one. Nansen can."
      />

      <Prose>
        <H2>The cluster</H2>
        <p>
          Our <Link href="/operators">operators page</Link> groups agents by the registration document they
          point at, not by wallet. Grouped that way, the largest cluster in the registry is one URL on a Vercel
          preview deployment that has since expired. Asking it today returns HTTP 404.
        </p>
      </Prose>

      <Shot
        post="nansen"
        name="cluster"
        width={1229}
        height={499}
        href="/operators"
        alt="8,093 agents across 7,962 distinct wallets registered the same document, which answered HTTP 404"
        caption={
          <>
            The live operators page. Every one of those registrations is still on chain, still hash-perfect and
            still listed by every tool that reads the registry. The only thing describing them has gone.
          </>
        }
      />

      <Prose>
        <p>
          Grouping them is already useful. The next question is the one a buyer actually has: are these 7,962
          independent operators who reused a template? Or one hand behind many addresses? The registry has no
          way to answer that. Every wallet is a fresh address with nothing in common but the document.
        </p>

        <H2>Who sent each wallet its first gas</H2>
        <p>
          A new wallet on Monad cannot register anything until something sends it MON for gas. Whoever sent it
          that first MON is its first funder. That is one of the relations Nansen&apos;s profiler returns. We
          call <Code>profiler/address/related-wallets</Code> on Monad for a sample of the cluster&apos;s wallets,
          read the entry tagged First Funder and record it with the funding transaction.
        </p>
      </Prose>

      <Facts
        caption="The integration, stated so it can be checked and repeated."
        rows={[
          { k: "endpoint", v: <Code>profiler/address/related-wallets</Code>, src: "chain: monad, relation: First Funder" },
          { k: "cost", v: "1 credit per wallet, paid per call over x402", src: "71 credits for the run below" },
          { k: "sample", v: "62 of the 7,962 wallets", src: "ordered by md5(address), so a rerun asks the same wallets" },
          { k: "not used", v: "address labels", src: "100 credits per wallet, not affordable at this scale" },
        ]}
      />

      <Shot
        post="nansen"
        name="funders"
        width={1229}
        height={782}
        href="/operators"
        alt="Who funded those wallets, from Nansen: 60 of 62 sampled wallets first funded by 0x97cd…0996"
        caption={
          <>
            The result on the operators page. 60 of the 62 sampled wallets were first funded by one address. The
            same panel shows the smaller clusters, where a single funder is behind every wallet sampled.
          </>
        }
      />

      <Prose>
        <p>
          Every row carries a funding transaction, so none of this rests on trusting Nansen or us. Here is the
          first one, opened on Monad:
        </p>
      </Prose>

      <Cmd
        cmd="cast tx 0x04d8d5f83e3785ec892ac9f7ef06908c73b0c864a45284ed709b2460134f069b --rpc-url https://rpc.monad.xyz"
        out={`blockNumber  55949903
from         0x97cD97CFE21799bacBf39D0a53469e5f82f30996
to           0xfCADC1758a2a473A9DcbFA77747B66Cc1849016d
value        11000000000000000000`}
        note="11 MON from the shared funder to one of the cluster's wallets. The other funding transactions have the same shape."
      />

      <Note label="what this does and does not say">
        A shared funder describes how the wallets were set up. It says nothing about anyone&apos;s intent: a deploy
        script, a faucet or a team funding its own test wallets all look exactly like this. What it does say is
        that 7,962 wallets is not 7,962 independent operators, so any reputation signal that counts wallets as
        voices counts this one many times. We say 60 of 62 sampled, never 60 of 7,962. A wallet we have not
        sampled reads <span className="unknown-value">unknown</span>, never counted either way.
      </Note>

      <Prose>
        <H2>Where it is used</H2>
        <p>
          It is not a side panel. Twin, our shared-document agent, carries the first-funder line in its paid
          answer, so a buyer asking about an agent in this cluster learns it shares one funder with thousands of
          others. Every cluster page shows the same with its transaction links. A daily job spends the remaining
          credit budget on the next clusters and keeps a reserve, so the sample grows rather than arriving in one
          burst.
        </p>
        <p>
          The request shapes and the credits spent are written up on the{" "}
          <Link href="/developers">developers page</Link>, so anyone can repeat the run.
        </p>
      </Prose>
    </div>
  );
}
