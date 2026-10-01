import Link from "next/link";
import { Mono, PageHeader, Panel, Prize, Row } from "@/components/ui.tsx";
import { postBySlug } from "@/lib/writing.ts";

/**
 * The thesis piece. Structural facts only (the ladder, owner-initiated validation, the mislabel
 * pattern), so nothing here goes stale. Live counts are linked to the page that renders them rather
 * than hardcoded, except the sweep figures that MEMORY pins to a date.
 */

export const metadata = {
  title: "Hash integrity is not claim truth",
  description:
    "Every ERC-8004 tool checks that an evidence document was not tampered with. None checks that the payment it describes actually happened on the chain it names. Kanmani adds that rung.",
};

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--color-text)]">{children}</p>;
}

export default function ClaimTruth() {
  const post = postBySlug("claim-truth")!;
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="writing · the thesis · 2026-10-01"
        title="Hash integrity is not claim truth"
        lead="Monad has more than ten thousand registered ERC-8004 agents. The registry cannot tell you which of them did the work or whether the payments their records cite ever happened. That second gap is the one nobody else closes."
      >
        <Prize post={post} />
      </PageHeader>

      <Panel title="the gap every other tool leaves open">
        <div className="space-y-3">
          <P>
            An ERC-8004 agent earns feedback. Each feedback points at an evidence document and the document
            asserts things: a job delivered, a payment settled, a counterparty paid. Every tool on Monad can
            confirm that the document was not altered after it was committed, because the on-chain feedback
            carries a hash and the bytes either match or they do not.
          </P>
          <P>
            That check is real and it is also shallow. A document can be hash-perfect and still lie. An agent
            can publish an untampered receipt that says a payment cleared on Monad while the payment sits on
            another chain or never happened at all. Integrity proves the bytes did not change. It says nothing
            about whether the thing the bytes describe is true.
          </P>
        </div>
      </Panel>

      <Panel title="the ladder, one rung per question">
        <div className="space-y-3">
          <P>
            So we check a claim rung by rung. Each rung answers a question the one below it cannot.
            <Mono> declared</Mono> is whether the record says anything at all. <Mono>resolvable</Mono> is
            whether the document it points at still exists. <Mono>intact</Mono> is whether the bytes are the
            ones committed on chain, which is where most tools stop.
          </P>
          <P>
            The next rung is the one the whole project rests on. <Mono className="text-[var(--color-true)]">true</Mono>{" "}
            asks whether the thing the document describes actually happened: we read the cited transaction on the
            chain it names, then match the payer, the recipient, the amount and the token. Only then do{" "}
            <Mono>payable</Mono> and <Mono>settled</Mono> follow, which ask whether a buyer could pay this agent
            now and whether a payment to it has provably cleared. The ladder is per claim, never per agent.
          </P>
          <P>
            <Link className="text-[var(--color-brand)] hover:underline" href="/method">The method page</Link>{" "}
            shows how each rung is decided, reproducible by hand.{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/claims">The claims page</Link>{" "}
            lists every document with the verdict and the command to re-derive it.
          </P>
        </div>
      </Panel>

      <Panel title="what reading the chain actually turns up">
        <div className="space-y-3">
          <P>
            The registry fills unevenly. The permissionless half, feedback, fills up: Monad carries thousands of
            feedbacks. The half that needs consent, the Validation Registry, stays near empty, because a
            validator cannot publish about an agent it does not own. So the loud signal is self-reported and
            unchecked, which is exactly what a truth rung is for.
          </P>
          <P>
            Measured in our 2026-09-12 sweep, <strong>8,093 agents point at one deleted document</strong>, a
            Vercel deployment that returns 404 across thousands of wallets. Saying those agents are registered is
            true and useless. Saying they all resolve to one dead URL is the same fact made usable.{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/operators">The operators page</Link>{" "}
            clusters them live by the document they share.
          </P>
          <P>
            A sharper case: some agents label a payment <Mono>network: &quot;monad&quot;</Mono> while the
            transaction they cite is on another chain entirely. Two we sampled wrote one transfer on Arbitrum and
            one on Avalanche under the same Monad label. A tool that trusts the label calls them verified. Reading
            the cited transaction on the chain it names is what catches it.
          </P>
        </div>
      </Panel>

      <Panel title="why this is a product and not a demo">
        <div className="space-y-3">
          <P>
            The first user is not the agent being checked. It is whoever takes a cut of agent work and cannot
            prove the receipts: a marketplace or a DAO that routes jobs and settles payments, with no way today
            to tell a real settlement from a hash-perfect story about one. Kanmani is the settlement and trust
            layer that answers both, on Monad mainnet, with every number tracing to a command the user can run.
          </P>
          <P>
            The next step is small and real: one external paid job verified end to end, then one more integration
            partner reading our verdicts. The supply already exists and it is unverified. Verifying it is the
            product.
          </P>
        </div>
      </Panel>
    </div>
  );
}
