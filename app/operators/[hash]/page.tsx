import Link from "next/link";
import { notFound } from "next/navigation";
import { Addr, Derivation, Mono, Num, Panel, Row } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { clusterMembers, clusterOwners, probedCluster, STATE_MEANING } from "@/lib/queries.ts";
import { clusterFunder } from "@/lib/funders.ts";
import { funderSummary } from "@/lib/nansen.ts";
import { funderReachFor } from "@/lib/funder-reach.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ hash: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props) {
  const { hash } = await params;
  const c = await probedCluster(hash);
  if (!c) return { title: "Cluster not found" };
  return {
    title: `${c.memberCount.toLocaleString()} agents share this document`,
    description: `${c.memberCount.toLocaleString()} agents across ${c.distinctOwners.toLocaleString()} wallets registered ${c.uri}.`,
  };
}

const PER_PAGE = 100;

export default async function ClusterPage({ params, searchParams }: Props) {
  const { hash } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const c = await probedCluster(hash);
  if (!c) notFound();

  const [members, owners, fund] = await Promise.all([
    clusterMembers(hash, PER_PAGE, (page - 1) * PER_PAGE),
    clusterOwners(hash, 60),
    clusterFunder(hash), // hash === AgentRecord.id === the sample key suffix
  ]);
  const funder = funderSummary(fund);
  // One step up the funding graph: who first funded this cluster's top funder. Read from our own
  // store, no Nansen call. Only looked up when the cluster has a sampled top funder.
  const reach = funder.status === "sampled" ? await funderReachFor(funder.topFunder) : null;
  const pages = Math.ceil(c.memberCount / PER_PAGE);
  // Agents registered by a wallet that registered more than one against this same document.
  const repeats = c.memberCount - c.distinctOwners;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section>
        <Link href="/operators" className="font-mono text-[11px] text-faint hover:text-muted">
          ← all clusters
        </Link>
        <div className="mt-3">
          <span className="kicker">one registration document, everyone who points at it</span>
          <h1 className="mt-3 fluid-3 font-semibold leading-[1.15] tracking-tight">
            <Num value={c.memberCount} /> {c.memberCount === 1 ? "agent" : "agents"} across{" "}
            <Num value={c.distinctOwners} /> {c.distinctOwners === 1 ? "wallet" : "wallets"}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <RecordStateBadge state={c.state} />
            <span className="text-[13px] text-muted">
              {c.state ? STATE_MEANING[c.state] : STATE_MEANING["not probed"]}
            </span>
          </p>
          {c.chainCount > 1 ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded border border-[var(--brand-line)] bg-[var(--color-panel)] px-3 py-2">
              <span className="chip chip--live">
                also on {c.chainIds.filter((id) => id !== 143).join(", ")}
              </span>
              <span className="text-[13px] leading-relaxed text-muted">
                This exact document is registered on {c.chainCount} chains ({c.chainIds.join(", ")}),
                matched on its content hash, which is the only key that means the same thing on two
                chains. The standing behind this agent did not start on Monad.{" "}
                <Link href="/chains" className="text-[var(--color-brand)] ilink">
                  Which chains we read →
                </Link>
              </span>
            </p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="the document">
          <dl>
            <Row label="uri">
              {c.uri ? (
                <a
                  href={c.uri}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="break-all font-mono text-[12.5px] text-[var(--color-brand)] ilink"
                >
                  {c.uri}
                </a>
              ) : (
                <span className="unknown-value">this record declares no document</span>
              )}
            </Row>
            <Row label="record hash">
              <Mono className="break-all text-[12px] text-muted">{c.uriHash}</Mono>
            </Row>
            <Row label="scheme">
              <Mono className="text-muted">{c.scheme ?? c.kind}</Mono>
            </Row>
            <Row label="what it answered">
              {c.reason ? (
                <span
                  className={`font-mono text-[12.5px] ${
                    c.state === "answered" || c.state === "onchain"
                      ? "text-[var(--color-true)]"
                      : c.state === "unknown"
                        ? "text-[var(--color-unknown)]"
                        : "text-[var(--color-false)]"
                  }`}
                >
                  {c.reason}
                </span>
              ) : (
                <span className="unknown-value">nothing has asked yet</span>
              )}
            </Row>
            <Row label="asked at">
              {c.checkedAt ? (
                <Mono className="text-muted">{c.checkedAt.replace("T", " ").slice(0, 19)}Z</Mono>
              ) : (
                <span className="unknown-value">never</span>
              )}
            </Row>
            <Row label="size">
              <Num value={c.byteLength} suffix=" bytes" />
            </Row>
            <Row label="name it gives itself">
              {c.parsedName ? (
                <Mono>{c.parsedName}</Mono>
              ) : (
                <span className="unknown-value">none readable</span>
              )}
            </Row>
            <Row label="first registered">
              <Mono className="text-muted">block {c.firstSeenBlock.toLocaleString()}</Mono>
            </Row>
          </dl>
          {c.uri ? (
            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
              <p className="mb-1 font-mono text-[11px] text-faint">check it yourself</p>
              <pre className="sql">{`curl -sS -o /dev/null -w '%{http_code}\\n' '${c.uri}'`}</pre>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="who registered against it"
          subtitle={
            repeats > 0
              ? `${repeats.toLocaleString()} of these registrations came from a wallet that registered more than one agent against this same document.`
              : "Every agent here was registered by a different wallet."
          }
        >
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            Counted at registration time, not from who holds the token now. An agent is an ERC-721
            and ownership moves, so a live aggregate would answer &quot;who holds these today&quot;
            when the claim being made is about who registered them.
          </p>
          <div className="max-h-96 space-y-px overflow-auto">
            {owners.rows.map((o) => (
              <div
                key={o.owner}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)]/40 py-1 last:border-0"
              >
                <Addr value={o.owner} href={`/agents?q=${o.owner}`} />
                <Mono className="text-[11.5px] text-faint">
                  {o.agentCount} {o.agentCount === 1 ? "agent" : "agents"} · first at block{" "}
                  {o.firstSeenBlock.toLocaleString()}
                </Mono>
              </div>
            ))}
          </div>
          {c.distinctOwners > owners.rows.length ? (
            <p className="mt-2 font-mono text-[11px] text-faint">
              showing {owners.rows.length} of {c.distinctOwners.toLocaleString()} wallets
            </p>
          ) : null}
          <Derivation sql={owners.sql} note={`$2 = ${c.uriHash}`} />
        </Panel>
      </div>

      <Panel title="who funded these wallets, from Nansen" id="funders">
        {funder.status === "unsampled" ? (
          <p className="text-[13px] text-muted">
            <span className="unknown-value">unknown</span>: {funder.sentence}
          </p>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-[var(--color-text)]">
              <Num value={funder.topFunderWallets} /> of <Num value={funder.found} /> sampled wallets were first funded by{" "}
              <a
                className="font-mono text-[var(--color-brand)] ilink"
                href={`https://monadscan.com/address/${funder.topFunder}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {funder.topFunder.slice(0, 6)}…{funder.topFunder.slice(-4)}
              </a>
              {funder.topFunderLabel ? <span className="text-muted"> ({funder.topFunderLabel})</span> : null}.{" "}
              <span className="text-muted">
                {funder.distinctFunders} distinct funder{funder.distinctFunders === 1 ? "" : "s"} across the sample.
              </span>
            </p>
            {funder.exampleTx ? (
              <p className="mt-1 font-mono text-[11.5px] text-faint">
                one funding tx:{" "}
                <a
                  className="ilink"
                  href={`https://monadscan.com/tx/${funder.exampleTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {funder.exampleTx.slice(0, 12)}…
                </a>
              </p>
            ) : null}
            {reach && reach.status === "found" && reach.reachFunder ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                That funder was itself first funded by{" "}
                <a
                  className="font-mono text-[var(--color-brand)] ilink"
                  href={`https://monadscan.com/address/${reach.reachFunder}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {reach.reachFunder.slice(0, 6)}…{reach.reachFunder.slice(-4)}
                </a>
                {reach.reachFunderLabel ? <span> ({reach.reachFunderLabel})</span> : null}, one step further up the funding graph.
              </p>
            ) : null}
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              A shared funder describes how the wallets were set up, not anyone&apos;s intent. It does say the wallet
              count overstates the number of independent operators. Unsampled wallets are{" "}
              <span className="unknown-value">unknown</span>, never counted either way.
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="the agents"
        subtitle={`${c.memberCount.toLocaleString()} agents point at this one document.`}
      >
        <div className="flex flex-wrap gap-1.5">
          {members.rows.map((m) => (
            <Link
              key={m.id}
              href={`/agent/${m.agentId}`}
              title={`agent #${m.agentId} · owner ${m.owner} · ${m.feedbackCount} feedbacks`}
              className={`rounded border px-2 py-0.5 font-mono text-[11.5px] transition-colors hover:border-[var(--color-brand)] ${
                m.feedbackCount > 0
                  ? "border-[var(--color-line-bright)] text-[var(--color-text)]"
                  : "border-[var(--color-line)] text-faint"
              }`}
            >
              #{m.agentId}
            </Link>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px] text-faint">
          Brighter means the agent carries at least one feedback. Faint means nothing has ever been
          said about it.
        </p>

        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between border-t border-[var(--color-line)] pt-3 font-mono text-[12px]">
            {page > 1 ? (
              <Link href={`/operators/${hash}?page=${page - 1}`} className="text-muted hover:text-[var(--color-text)]">
                ← previous
              </Link>
            ) : (
              <span className="text-faint">← previous</span>
            )}
            <span className="text-faint">
              {((page - 1) * PER_PAGE + 1).toLocaleString()}–
              {Math.min(page * PER_PAGE, c.memberCount).toLocaleString()} of{" "}
              {c.memberCount.toLocaleString()}
            </span>
            {page < pages ? (
              <Link href={`/operators/${hash}?page=${page + 1}`} className="text-muted hover:text-[var(--color-text)]">
                next →
              </Link>
            ) : (
              <span className="text-faint">next →</span>
            )}
          </nav>
        ) : null}
        <Derivation sql={members.sql} note={`$2 = ${c.uriHash}`} />
      </Panel>
    </div>
  );
}
