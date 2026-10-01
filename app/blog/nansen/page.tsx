import Link from "next/link";
import { Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";

/**
 * The Nansen piece. The finding is in docs/19-NANSEN.md and rendered live on the operators page.
 * Stated as a sample with its method, never extrapolated to the whole cluster, per the house rule
 * that a sample size is quoted and a share is never inflated.
 */

export const metadata = {
  title: "Sixty of sixty-two wallets share one funder",
  description:
    "Thousands of ERC-8004 agents on Monad point at one dead document. Nansen's first-funder data traces a sample of that cluster back to a single wallet, which turns 'all registered' into something a buyer can use.",
};

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--color-text)]">{children}</p>;
}

const FUNDER = "0x97cd97cfe21799bacbf39d0a53469e5f82f30996";

export default function Nansen() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · nansen · 2026-10-01"
        title="Sixty of sixty-two wallets share one funder"
        lead="Thousands of agents on Monad point at one deleted document. The registry calls them all registered. Nansen answers the question the registry cannot: where did the gas to create them come from."
      />

      <Panel title="the question a cluster raises">
        <div className="space-y-3">
          <P>
            Our operators view clusters agents by the document they registered. The largest cluster is almost
            eight thousand wallets pointing at one Vercel deployment that returns 404. Grouping them is already
            useful. The next question is the interesting one: are these independent operators who happened to
            reuse a template or one hand behind many addresses.
          </P>
        </div>
      </Panel>

      <Panel title="what Nansen adds and what it costs">
        <div className="space-y-3">
          <P>
            Nansen&apos;s profiler answers who funded an address. We call{" "}
            <Mono>profiler/address/related-wallets</Mono> with the Monad chain set, read the entry tagged first
            funder and record it. It is a 1-credit call paid over x402, so the cost is legible and metered rather
            than a flat subscription.
          </P>
          <div className="space-y-1 text-[13px]">
            <Row label="endpoint">
              <Mono className="text-muted">profiler/address/related-wallets · chain monad</Mono>
            </Row>
            <Row label="cost">
              <Mono className="text-muted">1 credit per address, x402 metered</Mono>
            </Row>
            <Row label="first funder">
              <Mono className="text-muted">{FUNDER}</Mono>
            </Row>
          </div>
        </div>
      </Panel>

      <Panel title="the finding, stated as the sample it is">
        <div className="space-y-3">
          <P>
            Of 62 wallets we sampled from the dead-document cluster, <strong>60 share one first funder</strong>,
            the address above, each seeded with the same 11 MON, across six transactions anyone can open on
            Monad. That is one hand funding the fan-out, not sixty independent operators.
          </P>
          <P>
            We say 60 of 62 sampled, never 60 of eight thousand. The daily credit budget caps how many we can
            check, so the honest claim is the sample and its size. A wallet we have not funded a lookup for
            reads <Mono>unknown</Mono> rather than a guess. That rule is the same one the whole site runs on: a
            number that was not measured is never rendered as if it were.
          </P>
        </div>
      </Panel>

      <Panel title="into the core, not bolted on">
        <div className="space-y-3">
          <P>
            The sample is not a side panel. Twin, our shared-document agent, carries the first-funder line in its
            paid answer. Every operator cluster page shows the same, with tx links and{" "}
            <Mono>unknown</Mono> where a cluster is unsampled. A daily timer spends the budget on the next
            clusters and keeps a reserve, so the sample grows day over day rather than in one burst.
          </P>
          <P>
            See it live on{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/operators">the operators page</Link>.
            How we did it, with the request shapes and the credits used, is written up for a stranger to
            reproduce on the{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/developers">developers page</Link>.
          </P>
        </div>
      </Panel>
    </div>
  );
}
