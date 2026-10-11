import Link from "next/link";
import { Derivation, Mono, Num, OutcomeBadge, PageHeader, Panel, Row, RungLadder, outcomeMeaning } from "@/components/ui.tsx";
import { check } from "@/lib/check.ts";
import { claim } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Verify",
  description: "Paste an evidence document or a claim id and get a verdict, with the command to re-derive it.",
};

type Props = { searchParams: Promise<{ uri?: string; hash?: string; id?: string }> };

export default async function Verify({ searchParams }: Props) {
  const sp = await searchParams;

  // An id resolves to its document and its on-chain commitment, so a verify by id is a real
  // verification rather than a hash of whatever the host feels like serving today.
  let uri = sp.uri?.trim();
  let hash = sp.hash?.trim();
  let fromClaim: Awaited<ReturnType<typeof claim>> = undefined;
  if (sp.id) {
    fromClaim = await claim(sp.id.trim());
    if (fromClaim) {
      uri = fromClaim.feedbackUri;
      hash = fromClaim.feedbackHash;
    }
  }

  const result = uri ? await check({ uri, feedbackHash: hash }).catch((e: unknown) => e as Error) : null;
  const failed = result instanceof Error;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="erc-8004 · monad mainnet · live check"
        title="Check any claim yourself."
        lead={
          <>
            Paste an evidence document or a claim id from this site. The check that runs here is the
            same code the sweep and the command line run, so this page and the tool cannot give
            different answers. The result gets its own URL, so it can be sent to whoever disagrees.
          </>
        }
      />

      <Panel title="check a document or a claim id">
        <form action="/verify" className="space-y-3">
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
            document uri or a claim id
          </span>
          <input
            name="uri"
            defaultValue={sp.id ? "" : (sp.uri ?? "")}
            placeholder="https://… · data:application/json,… · ipfs://…"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none placeholder:text-faint focus:border-[var(--color-brand)]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
            committed hash, optional
          </span>
          <input
            name="hash"
            defaultValue={sp.id ? "" : (sp.hash ?? "")}
            placeholder="0x… the feedbackHash recorded on chain"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none placeholder:text-faint focus:border-[var(--color-brand)]"
          />
          <span className="mt-1 block text-[11.5px] text-faint">
            Without this the intact rung cannot mean anything, because we would be comparing the
            bytes against a hash of the same bytes. The result says which of those two happened.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button type="submit" className="cta">
            check it →
          </button>
          <Link
            href="/verify?id=143_10182_0x103040545AC5031A11E8C03dd11324C7333a13C7_2"
            className="cta-ghost"
          >
            try one that resolves
          </Link>
          <Link href="/claims?outcome=false" className="cta-ghost">
            try one that does not
          </Link>
        </div>
        </form>
      </Panel>

      <div className="space-y-5">
      {fromClaim ? (
        <p className="font-mono text-[12px] text-muted">
          checking claim{" "}
          <Link href={`/claim/${encodeURIComponent(fromClaim.id)}`} className="text-[var(--color-brand)] ilink">
            {fromClaim.id}
          </Link>{" "}
          with its on-chain commitment
        </p>
      ) : null}

      {sp.id && !fromClaim ? (
        <Panel>
          <p className="text-[13px] text-[var(--color-false)]">
            No claim with that id is indexed. Checked against the index rather than guessed at.
          </p>
        </Panel>
      ) : null}

      {failed ? (
        <Panel title="the check did not complete">
          <p className="text-[13px] text-[var(--color-unknown)]">
            {(result as Error).message}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">
            This is our failure, not a verdict about the document. Nothing was recorded.
          </p>
        </Panel>
      ) : null}

      {result && !failed ? <Result r={result as Awaited<ReturnType<typeof check>>} /> : null}
      </div>
    </div>
  );
}

function Result({ r }: { r: Awaited<ReturnType<typeof check>> }) {
  const v = r.verdict;
  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <OutcomeBadge outcome={v.outcome} size="lg" />
          <RungLadder rung={v.rung} />
        </div>
        <p className="mt-3 text-[16px] leading-relaxed">
          {v.reason.charAt(0).toUpperCase() + v.reason.slice(1)}.
        </p>
        <p className="mt-1 text-[13px] text-muted">{outcomeMeaning(v.outcome)}</p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="what was read">
          <dl>
            <Row label="bytes">
              <Num value={r.bytesRead} suffix=" bytes" />
            </Row>
            <Row label="media type">
              {r.mediaType ? <Mono className="text-muted">{r.mediaType}</Mono> : <span className="unknown-value">not stated</span>}
            </Row>
            <Row label="resolved via">
              {r.source ? <Mono className="text-muted">{r.source}</Mono> : <span className="unknown-value">not reached</span>}
            </Row>
            <Row label="mapping">
              {v.mapping ? (
                <Link href={`/method#${v.mapping}`} className="font-mono text-[13px] text-[var(--color-brand)] ilink">
                  {v.mapping}
                </Link>
              ) : (
                <span className="unknown-value">no mapping read this shape</span>
              )}
            </Row>
            <Row label="hash check">
              {!r.hashWasSupplied ? (
                <span className="unknown-value">
                  no commitment supplied, so this proves nothing. We hashed what we were served
                </span>
              ) : v.hashMatches ? (
                <span className="text-[var(--color-true)]">
                  the bytes served match the hash committed on chain
                </span>
              ) : (
                <span className="text-[var(--color-unknown)]">
                  the bytes served do not match the commitment, so nothing read out of them can be
                  attributed to the author
                </span>
              )}
            </Row>
            {v.computedHash ? (
              <Row label="computed">
                <Mono className="break-all text-[12px] text-muted">{v.computedHash}</Mono>
              </Row>
            ) : null}
          </dl>
        </Panel>

        <Panel title="what it claimed and what the chain said">
          <dl>
            <Row label="declared network">
              {v.declaredNetwork ? <Mono>{v.declaredNetwork}</Mono> : <span className="unknown-value">none</span>}
            </Row>
            <Row label="cited transaction">
              {v.declaredTx ? (
                <Mono className="break-all text-[12px]">{v.declaredTx}</Mono>
              ) : (
                <span className="unknown-value">none</span>
              )}
            </Row>
            <Row label="found">
              {v.foundOnChain ? (
                <span className="text-[var(--color-true)]">
                  {v.foundOnChain.chain} (chain {v.foundOnChain.chainId}) at block{" "}
                  {Number(v.foundOnChain.blockNumber).toLocaleString()}
                </span>
              ) : v.outcome === "false" ? (
                <span className="text-[var(--color-false)]">not on the chain the document names</span>
              ) : (
                <span className="unknown-value">not looked for</span>
              )}
            </Row>
            <Row label="checked at">
              <Mono className="text-muted">
                {v.checkedAt.replace("T", " ").slice(0, 19)}Z
                {v.checkedAtBlock ? ` · block ${Number(v.checkedAtBlock).toLocaleString()}` : ""}
              </Mono>
            </Row>
          </dl>
          <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <p className="mb-1 font-mono text-[11px] text-faint">run the same check yourself</p>
            <pre className="sql">{r.reproduce}</pre>
          </div>
        </Panel>
      </div>

      <Panel
        title="what a negative was tested against"
        subtitle="A transaction that is not found means nothing without the list of chains it was looked for on. Publishing the coverage is what makes a false falsifiable."
      >
        <div className="flex flex-wrap gap-1.5">
          {r.coverage.map((c) => (
            <span
              key={c.id}
              title={c.configured ? "an RPC is configured for this chain" : "no RPC configured, so this chain is not covered"}
              className={`rounded border px-2 py-0.5 font-mono text-[11.5px] ${
                c.configured
                  ? "border-[var(--color-true)]/40 bg-[var(--color-true-bg)] text-[var(--color-true)]"
                  : "border-[var(--color-line)] unknown-value"
              }`}
            >
              {c.chain} · {c.id}
            </span>
          ))}
        </div>
      </Panel>

      <Derivation
        sql={JSON.stringify(v, null, 2)}
        note="The verdict object exactly as the API returns it. Same shape, same fields, same code path."
      />
    </div>
  );
}
