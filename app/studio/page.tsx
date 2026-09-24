import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { StudioFlow } from "@/components/studio-flow.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Studio",
  description:
    "Compose an ERC-8004 registration document and put it on chain with your own key. We generate the call; you sign it.",
};

export default function Studio() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="register · repoint · monad mainnet · chain 143"
        title="Register an agent or fix the record of one you already own."
        lead={
          <>
            Compose the document, watch what each field would mean, then send the transaction with your
            own key. We generate the call and never sign it, because a project that measures other
            people&apos;s registrations must not be able to manufacture one.
          </>
        }
      />

      <Reveal>
        <Panel title="the studio">
          <StudioFlow />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel title="what this will and will not do">
          <ul className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
            <li>
              <span className="text-[var(--color-text)]">It will show you the exact bytes.</span> The
              JSON, the URI, the byte count and the calldata are all on screen before anything is sent,
              and the calldata decodes back to the document you were shown. That is asserted in a test
              rather than promised here.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will not sign for you.</span> There is no
              key on our server that could. Send the calldata from any wallet or sign in with a
              passkey and send it from the account that passkey derives. Both are yours.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will not fabricate a listing.</span> No
              agent appears because we made one. An agent appears because the registry emitted an
              event and the indexer saw it, which is the same path every other row on this site took.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will refuse a payment claim.</span> A
              registration document is not the place for one. If a draft mentions a payment proof, the
              consequence list says so, because 73 of the 85 payment claims on Monad cite a
              transaction that is not on the chain they name and the fix starts with not making the
              claim.
            </li>
            <li>
              <span className="text-[var(--color-text)]">Verifying yourself is free.</span> A failing
              verdict is not a scarlet letter. Repoint the document and the{" "}
              <code className="font-mono">MetadataUpdate</code> re-runs the ladder so the record
              corrects itself with both readings kept.{" "}
              <Link href="/status" className="text-[var(--color-brand)] hover:underline">
                Verdicts that have changed →
              </Link>
            </li>
          </ul>
        </Panel>
      </Reveal>

      <Reveal>
        <Panel
          title="why data: is the default"
          subtitle="The recommendation carries our own measurement and we took it ourselves."
        >
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            We probed all 2,012 distinct registration documents on Monad. 8,640 agents point at a
            document whose host answered and said it is not there, 8,093 of them sharing one expired
            preview deployment across 7,962 wallets. Those registrations are still valid on chain, with
            a valid owner and a valid URI and they will stay that way forever while describing
            nothing. A <code className="font-mono">data:</code> URI cannot 404 because there is no host
            to ask.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            When we registered ourselves as agent 10252 we wrote our record into{" "}
            <code className="font-mono">tokenURI</code> rather than hosting it, a day after measuring
            that. Hosting is still offered here, because a hosted document is a legitimate choice and
            the point is that the consequence is visible rather than hidden.{" "}
            <Link href="/operators" className="text-[var(--color-brand)] hover:underline">
              The clusters behind that number →
            </Link>
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}
