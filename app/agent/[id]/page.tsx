import Link from "next/link";
import { notFound } from "next/navigation";
import { Addr, Derivation, Mono, Num, OutcomeBadge, Panel, Row, RungLadder, StatTile, TxLink } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { agent, agentActions, claims, probedCluster, STATE_MEANING } from "@/lib/queries.ts";
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

  const [record, feedback, ownerLabel, trail] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: false, limit: 100 }),
    walletLabel(a.owner),
    agentActions(a.agentId),
  ]);

  const checked = feedback.rows.filter((c) => c.outcome !== null);
  const resolve = checked.filter((c) => c.outcome === "true").length;
  const doNot = checked.filter((c) => c.outcome === "false").length;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section>
        <Link href="/agents" className="font-mono text-[11px] text-faint hover:text-muted">
          ← all agents
        </Link>
        <div className="mt-3">
          <span className="kicker">one agent, every claim about it and how it was decided</span>
        </div>
        <h1 className="mt-3 flex flex-wrap items-baseline gap-3 fluid-3 font-semibold tracking-tight">
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
      </section>

      {/* ---------------------------------------------------------------- the numbers at a glance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="feedback on chain"
          value={a.feedbackCount}
          hint="Everything ever said about this agent in the registry."
        />
        <StatTile
          label="checkable claims"
          value={checked.length}
          tone="brand"
          hint="Feedback that points at a document, so it can be checked against a chain."
        />
        <StatTile
          label="resolve on the named chain"
          value={resolve}
          tone="true"
          hint="The cited transaction is on the chain the document names."
        />
        <StatTile
          label="cited transaction missing"
          value={doNot}
          tone="false"
          hint="We read the named chain successfully and the cited transaction is not on it."
        />
      </section>

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

      {/* ---------------------------------------------------------------- who authorised the document */}
      <Panel
        title={`authorisation trail · ${trail.rows.length}`}
        subtitle="Signed statements that somebody authorised this agent's document. Ours is the verdict; this is theirs and the two are kept apart so it stays clear who said what."
      >
        {trail.rows.length === 0 ? (
          <p className="py-2 text-[13px] leading-relaxed text-muted">
            No receipt has been published for this agent. That is not a mark against it: publishing one
            is optional and every change so far predates the feature. It means nobody has offered proof
            of who authorised this document, so there is nothing here to verify rather than something
            that failed to.{" "}
            <Link href="/studio" className="text-[var(--color-brand)] hover:underline">
              Sign one in the studio →
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            {trail.rows.map((t) => (
              <div key={t.signature} className="rounded border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Mono className="text-[var(--color-brand)]">{t.action}</Mono>
                  <Mono className="text-[11px] text-faint">
                    signed {t.signedAt.replace("T", " ").slice(0, 16)}Z
                  </Mono>
                </div>
                <dl className="mt-2 space-y-1">
                  <Row label="document">
                    <Mono className="break-all text-[12px] text-muted">{t.uriHash}</Mono>
                  </Row>
                  <Row label="authorised by">
                    <Mono className="break-all text-[12px] text-muted">{t.identity}</Mono>
                  </Row>
                  <Row label="sending account">
                    <Addr value={t.signer} />
                  </Row>
                </dl>
                <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                  The signing identity is ed25519 and cannot move money, so this proves who authorised
                  the document without granting them anything. It does not say the transaction landed,
                  that this account owns the agent or that the document is good.
                </p>
              </div>
            ))}
            <p className="pt-1 text-[12px] leading-relaxed text-muted">
              Every signature is served by{" "}
              <Mono className="text-[11.5px]">GET /api/receipt/action?agentId={a.agentId}</Mono>, so
              they can be checked without trusting us.
            </p>
          </div>
        )}
        <Derivation sql={trail.sql} />
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
