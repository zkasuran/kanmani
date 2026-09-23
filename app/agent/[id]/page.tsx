import Link from "next/link";
import { notFound } from "next/navigation";
import { Addr, Derivation, Mono, Num, OutcomeBadge, Panel, Row, RungLadder, TxLink } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { agent, claims, probedCluster, STATE_MEANING } from "@/lib/queries.ts";
import { CATEGORY_META, walletLabel } from "@/lib/labels.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const a = await agent(decodeURIComponent(id));
  if (!a) return { title: "Agent not found" };
  return {
    title: `Agent #${a.agentId}${a.name ? ` · ${a.name}` : ""}`,
    description: `What is known about agent #${a.agentId} on Monad, how it was decided and when.`,
  };
}

export default async function AgentPage({ params }: Props) {
  const { id } = await params;
  const a = await agent(decodeURIComponent(id));
  if (!a) notFound();

  const [record, feedback, ownerLabel] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: false, limit: 100 }),
    walletLabel(a.owner),
  ]);

  const checked = feedback.rows.filter((c) => c.outcome !== null);
  const resolve = checked.filter((c) => c.outcome === "true").length;
  const doNot = checked.filter((c) => c.outcome === "false").length;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/agents" className="font-mono text-[11px] text-faint hover:text-muted">
          ← all agents
        </Link>
        <h1 className="mt-2 flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight">
          <span>#{a.agentId}</span>
          <span className="text-[var(--color-muted)]">{a.name ?? "unnamed"}</span>
        </h1>

        {/* The one-sentence answer, before any table. */}
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed">
          {checked.length === 0 ? (
            <>
              Nothing has ever been claimed about this agent that we can check.{" "}
              {a.feedbackCount > 0
                ? `It carries ${a.feedbackCount} feedback${a.feedbackCount === 1 ? "" : "s"}, none of which points at a document.`
                : "It carries no feedback at all."}
            </>
          ) : doNot > 0 ? (
            <>
              <span className="text-[var(--color-false)]">
                {doNot} of {checked.length}
              </span>{" "}
              claims about this agent cite a transaction that is not on the chain the document
              names.
            </>
          ) : resolve > 0 ? (
            <>
              <span className="text-[var(--color-true)]">All {resolve}</span> payment claims about
              this agent cite a transaction we found on the chain the document names.
            </>
          ) : (
            <>
              This agent carries {checked.length} checked document
              {checked.length === 1 ? "" : "s"} and none of them asserts a payment.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="the registration">
          <dl>
            <Row label="owner">
              <Addr value={a.owner} href={`/agents?q=${a.owner}`} />
              <span className="ml-2 text-[11.5px] text-faint">holds the ERC-721</span>
            </Row>
            <Row label="owner, per Nansen">
              {ownerLabel && ownerLabel.status === "labeled" && ownerLabel.category ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`${CATEGORY_META[ownerLabel.category].cls} inline-block rounded border border-current/20 px-2 py-0.5 font-mono text-[11px]`}
                  >
                    {CATEGORY_META[ownerLabel.category].label}
                  </span>
                  <span className="text-[12.5px] text-muted">{ownerLabel.labels.slice(0, 4).join(", ")}</span>
                </span>
              ) : (
                <span
                  className="unknown-value"
                  title={
                    ownerLabel
                      ? "Nansen answered and holds no label for this wallet. That is not a negative finding."
                      : "Nobody has asked Nansen about this wallet yet. Not looked up is not the same as no label."
                  }
                >
                  unknown
                </span>
              )}
            </Row>
            <Row label="agent wallet">
              {a.agentWallet ? (
                <>
                  <Addr value={a.agentWallet} />
                  <span className="ml-2 text-[11.5px] text-faint">what it transacts with</span>
                </>
              ) : (
                <span className="unknown-value">not declared</span>
              )}
            </Row>
            <Row label="registered">
              <Mono className="text-muted">block {a.registeredAtBlock.toLocaleString()}</Mono>
            </Row>
            <Row label="transferred">
              <Num value={a.transferCount} suffix={a.transferCount === 1 ? " time" : " times"} />
            </Row>
            <Row label="metadata updated">
              <Num value={a.metadataUpdateCount} suffix={a.metadataUpdateCount === 1 ? " time" : " times"} />
            </Row>
            <Row label="declares x402">
              {a.declaresX402 ? (
                <span className="text-[var(--color-brand)]">
                  yes, by its own record. That is the operator&apos;s statement, not our measurement
                </span>
              ) : (
                <span className="text-faint">no</span>
              )}
            </Row>
            <Row label="endpoints">
              {a.endpoints.length ? (
                <ul className="space-y-0.5">
                  {a.endpoints.map((e) => (
                    <li key={e}>
                      <Mono className="break-all text-muted">{e}</Mono>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-faint">none absolute enough to call</span>
              )}
            </Row>
          </dl>
        </Panel>

        <Panel title="the document it points at">
          {record ? (
            <>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                <RecordStateBadge state={record.state} />
                <span className="text-[12.5px] text-muted">
                  {record.state ? STATE_MEANING[record.state] : STATE_MEANING["not probed"]}
                </span>
              </p>
              <dl>
                <Row label="uri">
                  {record.uri ? (
                    <a
                      href={record.uri}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className="break-all font-mono text-[12.5px] text-[var(--color-brand)] hover:underline"
                    >
                      {record.uri}
                    </a>
                  ) : (
                    <span className="unknown-value">none</span>
                  )}
                </Row>
                <Row label="what it answered">
                  {record.reason ? (
                    <Mono className="text-muted">{record.reason}</Mono>
                  ) : (
                    <span className="unknown-value">nothing has asked yet</span>
                  )}
                </Row>
                <Row label="shared with">
                  {record.memberCount > 1 ? (
                    <Link
                      href={`/operators/${record.uriHash}`}
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {(record.memberCount - 1).toLocaleString()} other agents across{" "}
                      {record.distinctOwners.toLocaleString()} wallets →
                    </Link>
                  ) : (
                    <span className="text-[var(--color-true)]">
                      nobody. This document describes this agent and nothing else
                    </span>
                  )}
                </Row>
              </dl>
              {record.memberCount > 1 ? (
                <p className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-2.5 text-[12.5px] leading-relaxed text-muted">
                  A shared record is not a judgment about this operator. It usually means a template
                  or a launcher wrote the same URL for everyone it registered. It does mean the
                  document cannot describe this agent specifically, so nothing in it is evidence
                  about this agent in particular.
                </p>
              ) : null}
            </>
          ) : (
            <p className="unknown-value text-[13px]">
              This agent registered with no tokenURI, so there is no document to ask about.
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title={`feedback · ${a.feedbackCount} on chain, ${checked.length} checkable`}
        subtitle="Anyone can leave feedback about an agent. Only the ones pointing at a document can be checked against a chain."
      >
        {feedback.rows.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">
            Nothing has been said about this agent on chain.
          </p>
        ) : (
          <div className="space-y-px">
            {feedback.rows.map((c) => (
              <Link
                key={c.id}
                href={`/claim/${encodeURIComponent(c.id)}`}
                className="block rounded border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-20 shrink-0">
                    <OutcomeBadge outcome={c.outcome} />
                  </span>
                  <span className="w-44 shrink-0">
                    <RungLadder rung={c.rung} />
                  </span>
                  <span className="w-28 shrink-0">
                    <Addr value={c.clientAddress} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                    {c.reason ??
                      (c.feedbackUri ? (
                        <span className="unknown-value">no verdict recorded</span>
                      ) : (
                        <span className="text-faint">points at no document, so nothing to check</span>
                      ))}
                  </span>
                  <Mono className="shrink-0 text-[11px] text-faint">
                    block {c.blockNumber.toLocaleString()}
                  </Mono>
                </div>
              </Link>
            ))}
          </div>
        )}
        <Derivation sql={feedback.sql} />
      </Panel>

      <div className="flex flex-wrap gap-2 font-mono text-[12px]">
        <a
          href={`/api/agent/${a.agentId}`}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-muted hover:text-[var(--color-text)]"
        >
          this agent as JSON →
        </a>
        <Link
          href={`/compare?ids=${a.agentId}`}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-muted hover:text-[var(--color-text)]"
        >
          compare with another →
        </Link>
        <a
          href={`https://monadexplorer.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=${a.agentId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-muted hover:text-[var(--color-text)]"
        >
          on the explorer →
        </a>
      </div>
    </div>
  );
}
