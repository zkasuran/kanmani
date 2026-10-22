import Link from "next/link";
import { notFound } from "next/navigation";
import { Addr, Derivation, Mono, Num, OutcomeBadge, Panel, Row, RungLadder, StatTile } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { agent, agentActions, claims, probedCluster, STATE_MEANING } from "@/lib/queries.ts";
import { CATEGORY_META, walletLabel } from "@/lib/labels.ts";
import { bondFor, usdc } from "@/lib/bonds.ts";
import { adextoMarketsFor } from "@/lib/adexto.ts";
import { AgentPasskeyPanel } from "@/components/agent-passkey.tsx";
import { partitionRevoked } from "@/lib/claim-views.ts";

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

/** Unchecked rows shown before folding. Enough to show they exist, not enough to bury the verdicts. */
const UNCHECKED_SHOWN = 5;

export default async function AgentPage({ params }: Props) {
  const { id } = await params;
  const a = await agent(decodeURIComponent(id));
  if (!a) notFound();

  const [record, feedback, ownerLabel, trail, bond, markets] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: false, limit: 100 }),
    walletLabel(a.owner),
    agentActions(a.agentId),
    bondFor(Number(a.agentId)),
    adextoMarketsFor(Number(a.agentId)),
  ]);

  // Feedback its author withdrew is not a claim to judge. It stays listed, labelled, and is not counted.
  const { live: liveRows, revoked: revokedRows } = partitionRevoked(feedback.rows);
  const checked = liveRows.filter((c) => c.outcome !== null);
  const resolve = checked.filter((c) => c.outcome === "true").length;
  const doNot = checked.filter((c) => c.outcome === "false").length;
  // A false verdict splits in two once other chains are readable and the two deserve different
  // words. This page kept saying "cite a transaction that is not on the chain" after the landing was
  // corrected, which is the accusation, on the page an operator actually lands on.
  const elsewhere = checked.filter((c) => c.outcome === "false" && c.foundChain).length;
  const nowhere = doNot - elsewhere;
  const unchecked = liveRows.filter((c) => c.outcome === null);
  const decided = liveRows.filter((c) => c.outcome !== null);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-9 pt-9 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
        <Link href="/agents" className="hero__in font-mono text-[11px] text-faint hover:text-muted">
          ← all agents
        </Link>
        <div className="hero__in mt-3" style={{ ["--d" as string]: "40ms" }}>
          <span className="kicker">one agent, every claim about it and how it was decided</span>
        </div>
        <h1 className="hero__in mt-3 flex flex-wrap items-baseline gap-3 fluid-3 font-semibold tracking-tight" style={{ ["--d" as string]: "90ms" }}>
          <span>#{a.agentId}</span>
          <span className="text-[var(--color-muted)]">{a.name ?? "unnamed"}</span>
        </h1>

        {/* The one-sentence answer, before any table. */}
        <p className="hero__in mt-3 max-w-3xl text-[15px] leading-relaxed" style={{ ["--d" as string]: "200ms" }}>
          {checked.length === 0 ? (
            <>
              Nothing has ever been claimed about this agent that we can check.{" "}
              {a.feedbackCount > 0
                ? `It carries ${a.feedbackCount} feedback${a.feedbackCount === 1 ? "" : "s"}, none of which points at a document.`
                : "It carries no feedback at all."}
            </>
          ) : doNot > 0 && elsewhere > 0 ? (
            <>
              {doNot} of {checked.length} claims about this agent name a chain the payment is not on.{" "}
              <span className="text-[var(--color-brand)]">{elsewhere} of those are real payments</span> on a
              different chain, which is one wrong field in a document.{" "}
              {nowhere > 0 ? (
                <>
                  <span className="text-[var(--color-false)]">{nowhere}</span> cite a transaction we did not
                  find on any chain we searched.
                </>
              ) : (
                <>Every cited transaction was found on some chain.</>
              )}
            </>
          ) : doNot > 0 ? (
            <>
              <span className="text-[var(--color-false)]">
                {doNot} of {checked.length}
              </span>{" "}
              claims about this agent cite a transaction that exists on no chain we can read.
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
      </section>

      {/* ---------------------------------------------------------------- the numbers at a glance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
        {/* Split, because one red "41 missing" beside a sentence saying 37 are real payments is the
            page contradicting itself. Brand for the repairable one, false only for the one that is. */}
        <StatTile
          label="real payment, wrong chain named"
          value={elsewhere}
          tone="brand"
          hint="The cited transaction is mined on a different chain from the one the document names. One field to fix."
        />
        <StatTile
          label="on no chain we can read"
          value={nowhere}
          tone="false"
          hint="Not found on any chain we searched. A chain we cannot read is unsearched, not clear, so this is not proof the payment never happened."
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {bond ? (
          <Panel
            title="money staked on this record"
            subtitle="Read live from Sclera on every load, not from an index, because a window matures when a block passes and emits nothing to index."
          >
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-faint">state</dt>
                <dd className="mt-0.5 font-mono text-[14px] text-[var(--color-text)]">
                  {bond.state}
                  {bond.state === "active" && bond.matured === true ? (
                    <span className="ml-2 text-[11.5px] text-muted">window closed, releasable</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-faint">at stake</dt>
                <dd className="mt-0.5 font-mono text-[14px] text-[var(--color-text)]">
                  {usdc(bond.amountAtomic)} USDC
                  {bond.state === "released" ? (
                    <span className="ml-2 text-[11.5px] text-muted">returned in full</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-faint">claim-truth floor</dt>
                <dd className="mt-0.5 font-mono text-[14px] text-[var(--color-text)]">
                  {(bond.minTruthRateBps / 100).toFixed(0)}%
                  <span className="ml-2 text-[11.5px] text-muted">over at least {bond.minSampleSize} decided claims</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-faint">window</dt>
                <dd className="mt-0.5 font-mono text-[14px] text-[var(--color-text)]">
                  {bond.postedAtBlock} to {bond.maturesAtBlock}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              Below the floor this stake can be taken. That is what makes the record cost something to
              hold rather than being a badge. Check it yourself:{" "}
              <Mono className="break-all">
                cast call {bond.address} &apos;bonds(uint256)&apos; {a.agentId} --rpc-url https://rpc.monad.xyz
              </Mono>
            </p>
          </Panel>
        ) : null}

        {markets.length ? (
          <Panel
            id="markets"
            title="this agent has a token market"
            subtitle="On ADEXTO, a separate project. The binding is read from ADEXTO's factory on chain, agentIdOf(token), not from a list."
          >
            <ul className="space-y-1.5">
              {markets.map((m) => (
                <li key={m.token} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
                  <a href={m.url} target="_blank" rel="noreferrer noopener" className="font-mono text-[var(--color-brand)] ilink">
                    ${m.symbol}
                  </a>
                  <span className="text-[var(--color-text)]">{m.name}</span>
                  <Mono className="text-[11.5px] text-muted">{m.token.slice(0, 10)}…{m.token.slice(-4)}</Mono>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Before trading an agent&apos;s market, read the agent&apos;s record on this page: what its payment claims say and
              whether they happened. That is all this panel is for. Kanmani does not rank, endorse or advise on any token.
            </p>
          </Panel>
        ) : null}

        <Panel
          id="passkey"
          title="a device passkey for this agent"
          subtitle="Verified on chain by Monad's native P256 precompile. The owner binds it; anyone holding it can prove it on chain for free."
        >
          <AgentPasskeyPanel agentId={Number(a.agentId)} />
        </Panel>

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
                      className="break-all font-mono text-[12.5px] text-[var(--color-brand)] ilink"
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
                      className="text-[var(--color-brand)] ilink"
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
        title={`feedback · ${a.feedbackCount} on chain, ${checked.length} checkable${revokedRows.length > 0 ? `, ${revokedRows.length} withdrawn by its author` : ""}`}
        subtitle="Anyone can leave feedback about an agent. Only the ones pointing at a document can be checked against a chain."
      >
        {feedback.rows.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">
            Nothing has been said about this agent on chain.
          </p>
        ) : (
          <div className="space-y-px">
            {/* Decided rows first. Newest-first put 36 "no verdict recorded" rows above the one that
                matters on this very agent, which buried the finding under what we have not done. */}
            {[...decided, ...unchecked.slice(0, UNCHECKED_SHOWN)].map((c) => (
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
                  <span className="min-w-0 flex-1 basis-full sm:basis-auto sm:truncate text-[12.5px] text-muted">
                    {c.outcome === "false" && c.foundChain ? (
                      <>
                        real payment on <span className="text-[var(--color-brand)]">{c.foundChain}</span>, document
                        says {c.declaredNetwork ?? "another chain"}
                      </>
                    ) : c.reason ??
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
            {unchecked.length > UNCHECKED_SHOWN ? (
              <p className="px-2 pt-3 text-[12px] text-faint">
                {unchecked.length - UNCHECKED_SHOWN} more unchecked, not shown. Unchecked is not clean:
                it means no verdict has been recorded yet.{" "}
                <a href={`/api/claims?agent=${a.agentId}&limit=1000`} target="_blank" rel="noopener" className="text-[var(--color-brand)] ilink">
                  every claim for this agent, as JSON →
                </a>
              </p>
            ) : null}
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
            <Link href="/account#agents" className="text-[var(--color-brand)] ilink">
              Sign one from your account →
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
          href={`https://monadscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=${a.agentId}`}
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
