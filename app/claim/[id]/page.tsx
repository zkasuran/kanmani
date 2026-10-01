import Link from "next/link";
import { notFound } from "next/navigation";
import { Addr, Derivation, Mono, Num, OutcomeBadge, Panel, Row, TxLink, outcomeMeaning } from "@/components/ui.tsx";
import { claim, verdictHistory, VERDICT_HISTORY_SQL } from "@/lib/queries.ts";
import { searchedChains, searchedVia } from "@/lib/findtx.ts";
import { resolveDeclared } from "@/lib/chains.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const c = await claim(decodeURIComponent(id));
  if (!c) return { title: "Claim not found" };
  return {
    title: `Claim ${c.id}`,
    description: c.reason ?? "This claim has no recorded verdict.",
  };
}

export default async function ClaimPage({ params }: Props) {
  const { id } = await params;
  const c = await claim(decodeURIComponent(id));
  if (!c) notFound();

  const history = await verdictHistory(c.id);
  const isDataUri = c.feedbackUri.startsWith("data:");
  const declaredId = (c.declaredNetwork ? resolveDeclared(c.declaredNetwork)?.id : null) ?? 143;
  const searched = c.declaredTx ? searchedChains(declaredId) : [];

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- header */}
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-8 pt-8 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <Link href="/claims" className="font-mono text-[11px] text-faint hover:text-muted">
            ← all claims
          </Link>
          <p className="kicker mt-3">evidence document · monad mainnet · chain 143</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="break-all font-mono text-lg tracking-tight">{c.id}</h1>
            <OutcomeBadge outcome={c.outcome} size="lg" />
          </div>
          {c.reason ? (
            <p className="mt-4 max-w-3xl text-[15px] leading-relaxed">
              {c.reason.charAt(0).toUpperCase() + c.reason.slice(1)}.
            </p>
          ) : (
            <p className="mt-4 unknown-value max-w-3xl text-[15px]">
              No verdict has been recorded for this claim. Unchecked is not the same as clean.
            </p>
          )}
          {c.outcome ? (
            <p className="mt-2 max-w-3xl text-[13px] text-muted">{outcomeMeaning(c.outcome)}</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* -------------------------------------------------- what the document claimed */}
        <Panel title="what the document says">
          <dl>
            <Row label="declared network">
              {c.declaredNetwork ? (
                <Mono>{c.declaredNetwork}</Mono>
              ) : (
                <span className="unknown-value">none stated</span>
              )}
            </Row>
            <Row label="cited transaction">
              {c.declaredTx ? (
                <span className="break-all font-mono text-[12.5px]">{c.declaredTx}</span>
              ) : (
                <span className="unknown-value">none stated</span>
              )}
            </Row>
            <Row label="read by mapping">
              {c.mapping ? (
                <Link href={`/method#${c.mapping}`} className="font-mono text-[13px] text-[var(--color-brand)] hover:underline">
                  {c.mapping}
                </Link>
              ) : (
                <span className="unknown-value">no mapping reached this document</span>
              )}
            </Row>
            <Row label="evidence pointer">
              {isDataUri ? (
                <div>
                  <Mono className="text-muted">data: URI, decoded in process with no network call</Mono>
                  <pre className="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-2 font-mono text-[11px] text-muted">
                    {decodeURIComponent(c.feedbackUri.slice(0, 900))}
                  </pre>
                </div>
              ) : (
                <a
                  href={c.feedbackUri}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="break-all font-mono text-[12.5px] text-[var(--color-brand)] hover:underline"
                >
                  {c.feedbackUri}
                </a>
              )}
            </Row>
          </dl>
        </Panel>

        {/* -------------------------------------------------- what we found */}
        <Panel title="what the chain says">
          <dl>
            <Row label="bytes match the hash">
              {c.hashMatches === null ? (
                <span className="unknown-value">not checked</span>
              ) : c.hashMatches ? (
                <span className="text-[var(--color-true)]">
                  yes, keccak256 of the bytes served equals the hash committed on chain
                </span>
              ) : (
                <span className="text-[var(--color-unknown)]">
                  no. The bytes served now are not the bytes the author committed, so nothing read
                  out of them can be attributed to them
                </span>
              )}
            </Row>
            <Row label="committed hash">
              <span className="break-all font-mono text-[12px] text-muted">{c.feedbackHash}</span>
            </Row>
            {c.computedHash ? (
              <Row label="hash we computed">
                <span
                  className={`break-all font-mono text-[12px] ${
                    c.hashMatches ? "text-muted" : "text-[var(--color-unknown)]"
                  }`}
                >
                  {c.computedHash}
                </span>
              </Row>
            ) : null}
            <Row label="found on chain">
              {c.foundChain ? (
                <span className="text-[var(--color-true)]">
                  {c.foundChain} (chain {c.foundChainId}) at block {Number(c.foundBlock).toLocaleString()}
                </span>
              ) : c.outcome === "false" ? (
                <span className="text-[var(--color-false)]">
                  not found on {c.declaredNetwork ?? "the network named"}
                </span>
              ) : (
                <span className="unknown-value">not looked for</span>
              )}
            </Row>
            {c.declaredTx ? (
              <Row label="cross-chain search">
                {searched.length > 0 ? (
                  <span className="text-muted">
                    {searchedVia(searched)}
                    {!c.foundChain && c.outcome === "false" ? ", found on none of them" : ""}
                  </span>
                ) : (
                  <span className="unknown-value">no cross-chain endpoints configured</span>
                )}
              </Row>
            ) : null}
            <Row label="checked at">
              {c.checkedAt ? (
                <Mono className="text-muted">
                  {c.checkedAt.replace("T", " ").slice(0, 19)}Z
                  {c.checkedAtBlock ? ` · block ${Number(c.checkedAtBlock).toLocaleString()}` : ""}
                </Mono>
              ) : (
                <span className="unknown-value">never</span>
              )}
            </Row>
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            A verdict is a measurement at a time, so both the wall clock and the block are recorded.
            Without the block, &quot;not found&quot; is unfalsifiable: a reader cannot tell whether
            we looked before the transaction existed.
          </p>
        </Panel>
      </div>

      {/* -------------------------------------------------- the on-chain record */}
      <Panel title="the feedback itself" subtitle="As the Reputation Registry recorded it.">
        <div className="grid gap-x-8 sm:grid-cols-2">
          <dl>
            <Row label="about agent">
              <Link href={`/agent/${c.agentNumber}`} className="text-[var(--color-brand)] hover:underline">
                #{c.agentNumber}
                {c.agentName ? ` · ${c.agentName}` : ""}
              </Link>
            </Row>
            <Row label="left by">
              <Addr value={c.clientAddress} />
            </Row>
            <Row label="score">
              <Mono>
                {c.value}
                {c.valueDecimals ? ` (${c.valueDecimals} decimals)` : ""}
              </Mono>
            </Row>
            <Row label="revoked">
              {c.revoked ? (
                <span className="text-[var(--color-unknown)]">
                  yes, the author withdrew this feedback on chain
                </span>
              ) : (
                <span className="text-muted">no</span>
              )}
            </Row>
          </dl>
          <dl>
            <Row label="tags">
              <Mono className="text-muted">
                {[c.tag1, c.tag2].filter(Boolean).join(" · ") || "none"}
              </Mono>
            </Row>
            <Row label="endpoint">
              <Mono className="break-all text-muted">{c.endpoint || "none"}</Mono>
            </Row>
            <Row label="recorded in">
              <TxLink hash={c.txHash} chainId={143} />
              <span className="ml-2 font-mono text-[12px] text-faint">
                block {c.blockNumber.toLocaleString()}
              </span>
            </Row>
            <Row label="operator reply">
              {c.responseUri ? (
                <a
                  href={c.responseUri}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="break-all font-mono text-[12px] text-[var(--color-brand)] hover:underline"
                >
                  {c.responseUri}
                </a>
              ) : (
                <span className="text-faint">
                  none. The registry gives the agent an on-chain right of reply and it is rendered
                  here when used.
                </span>
              )}
            </Row>
          </dl>
        </div>
      </Panel>

      {/* -------------------------------------------------- the correction trail */}
      <Panel
        title={`verification history · ${history.length} check${history.length === 1 ? "" : "s"}`}
        subtitle="Append only. A re-check writes a new row and never edits an old one, so a document somebody repairs reads as a change with both timestamps rather than as a number quietly improving."
      >
        <ol className="space-y-2">
          {history.map((h, i) => {
            const changed = i > 0 && history[i - 1]!.outcome !== h.outcome;
            return (
              <li
                key={h.id}
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border px-3 py-2 ${
                  changed
                    ? "border-[var(--color-brand)]/40 bg-[var(--color-brand-dim)]/10"
                    : "border-[var(--color-line)]"
                }`}
              >
                <Mono className="w-40 shrink-0 text-faint">
                  {h.checkedAt.replace("T", " ").slice(0, 19)}Z
                </Mono>
                <OutcomeBadge outcome={h.outcome} />
                <Mono className="text-[11px] text-faint">{h.rung}</Mono>
                {changed ? (
                  <Mono className="text-[11px] text-[var(--color-brand)]">
                    changed from {history[i - 1]!.outcome}
                  </Mono>
                ) : null}
                <span className="min-w-[14rem] flex-1 text-[12.5px] text-muted">{h.reason}</span>
                <Mono className="text-[11px] text-faint">
                  {h.automatic ? "scheduled" : "asked for"}
                </Mono>
              </li>
            );
          })}
        </ol>
        <Derivation sql={VERDICT_HISTORY_SQL} note={`$1 = ${c.id}`} />
      </Panel>
    </div>
  );
}
