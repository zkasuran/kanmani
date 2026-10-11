import Link from "next/link";
import { Cta, Derivation, Num, Panel, Pct, StatTile } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { hosts, probedClusters, registryHealth, STATE_MEANING } from "@/lib/queries.ts";
import { clusterFunders } from "@/lib/funders.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Operators",
  description:
    "Monad's agent registry clustered by the document each agent registered, with the biggest shared document and how many wallets point at it.",
};

export default async function Operators() {
  const [health, cl, hs, funders] = await Promise.all([
    registryHealth(),
    probedClusters(40),
    hosts(20),
    clusterFunders(),
  ]);
  const h = health.rows;
  const biggest = cl.rows[0];

  const goneAgents = h.byState.find((s) => s.state === "gone")?.agents ?? 0;
  const paywalledAgents = h.byState.find((s) => s.state === "paywalled")?.agents ?? 0;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ---------------------------------------------------------------- the biggest cluster */}
      <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-10 pt-12 sm:rounded-[var(--radius-lg)] sm:mx-0 sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <span className="kicker">clustered by registration document, not by wallet</span>
          <h1 className="mt-4 max-w-4xl fluid-3 font-semibold leading-[1.15] tracking-tight">
            {biggest ? (
              <>
                <span className="text-[var(--color-brand)]">
                  <Num value={biggest.memberCount} /> agents
                </span>{" "}
                across{" "}
                <span className="text-[var(--color-brand)]">
                  <Num value={biggest.distinctOwners} /> distinct wallets
                </span>{" "}
                registered the same document.
              </>
            ) : (
              "No records indexed yet."
            )}
          </h1>
          {biggest ? (
            <div className="mt-5 max-w-3xl space-y-3">
              <p className="text-[15px] leading-relaxed text-muted">
                That document is{" "}
                <a
                  href={biggest.uri}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="break-all font-mono text-[13px] text-[var(--color-text)] underline decoration-[var(--color-line-bright)] underline-offset-4 hover:decoration-[var(--color-brand)]"
                >
                  {biggest.uri}
                </a>
                . We asked it{" "}
                {biggest.checkedAt ? (
                  <>on {biggest.checkedAt.slice(0, 10)}</>
                ) : (
                  <span className="unknown-value">at a time we have not recorded</span>
                )}{" "}
                and it answered{" "}
                <span className="font-mono text-[var(--color-false)]">
                  {biggest.reason ?? "with something we did not record"}
                </span>
                .
              </p>
              <p className="text-[14px] leading-relaxed text-muted">
                Nobody did anything wrong here. A preview deployment expired and thousands of
                registrations that were fine on the day they were written now point at nothing. The
                registrations are still on chain, still hash-perfect, still returned by every tool
                that reads the registry. That is the part worth showing: an agent can look completely
                healthy in a registry explorer while the only thing describing it has been gone for
                months.
              </p>
            </div>
          ) : null}
          {biggest ? (
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Cta href={`/operators/${biggest.uriHash}`} variant="brand">
                see who shares it →
              </Cta>
              <Cta href="/agents?cluster=shared">every shared record →</Cta>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------------------------------------------------------- the numbers at a glance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="agents in the registry"
          value={h.agentsTotal}
          hint="Every ERC-8004 agent indexed on Monad."
        />
        <StatTile
          label="distinct registration documents"
          value={h.recordsTotal}
          tone="brand"
          hint="Agents reuse documents, so this sits far below the agent count. It is the real number of things to ask about."
        />
        <StatTile
          label="agents whose document is gone"
          value={goneAgents}
          tone="false"
          hint="The host answered and said the document is not there. Not a timeout, not a guess."
        />
        <StatTile
          label="agents whose document is behind x402"
          value={paywalledAgents}
          tone="brand"
          hint="The registration document's own URL answered with a real x402 challenge. Service endpoints are not asked here."
        />
      </section>

      {/* ---------------------------------------------------------------- the eight states */}
      <Panel
        title="what every registration document does when you ask it"
        subtitle={
          <>
            {h.recordsTotal.toLocaleString()} distinct documents behind{" "}
            {h.agentsTotal.toLocaleString()} agents.{" "}
            {h.probedAt ? (
              <>Last asked {h.probedAt.slice(0, 16).replace("T", " ")}Z.</>
            ) : (
              <span className="unknown-value">Nothing has been asked yet.</span>
            )}
          </>
        }
      >
        <div className="space-y-1">
          {h.byState.map((s) => (
            <div
              key={s.state}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-line)]/50 py-2 last:border-0"
            >
              <div className="w-28 shrink-0">
                <RecordStateBadge state={s.state} />
              </div>
              <div className="w-56 shrink-0 font-mono text-[13px]">
                <Num value={s.agents} /> <span className="text-faint">agents</span>
                <span className="mx-2 text-faint">·</span>
                <Num value={s.records} /> <span className="text-faint">documents</span>
              </div>
              <div className="w-16 shrink-0 text-right font-mono text-[12px] text-muted">
                <Pct of={s.agents} total={h.agentsTotal} />
              </div>
              <p className="min-w-[16rem] flex-1 text-[12.5px] leading-relaxed text-muted">
                {STATE_MEANING[s.state]}
              </p>
            </div>
          ))}
          {h.notProbedRecords > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] py-2">
              <div className="w-28 shrink-0">
                <RecordStateBadge state={null} />
              </div>
              <div className="w-56 shrink-0 font-mono text-[13px]">
                <Num value={h.notProbedAgents} /> <span className="text-faint">agents</span>
                <span className="mx-2 text-faint">·</span>
                <Num value={h.notProbedRecords} /> <span className="text-faint">documents</span>
              </div>
              <div className="w-16 shrink-0 text-right font-mono text-[12px] text-muted">
                <Pct of={h.notProbedAgents} total={h.agentsTotal} />
              </div>
              <p className="min-w-[16rem] flex-1 text-[12.5px] leading-relaxed text-muted">
                {STATE_MEANING["not probed"]}
              </p>
            </div>
          ) : null}
          {h.agentsWithNoDocument > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] py-2">
              <div className="w-28 shrink-0">
                <span className="inline-block rounded border border-[var(--color-line)] bg-[var(--color-noclaim-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-noclaim)]">
                  none
                </span>
              </div>
              <div className="w-56 shrink-0 font-mono text-[13px]">
                <Num value={h.agentsWithNoDocument} /> <span className="text-faint">agents</span>
                <span className="mx-2 text-faint">·</span>
                <span className="text-faint">no document to ask about</span>
              </div>
              <div className="w-16 shrink-0 text-right font-mono text-[12px] text-muted">
                <Pct of={h.agentsWithNoDocument} total={h.agentsTotal} />
              </div>
              <p className="min-w-[16rem] flex-1 text-[12.5px] leading-relaxed text-muted">
                These agents registered with no tokenURI at all, so there is no record row to probe.
                Counted here rather than left out, because without them these buckets sum to{" "}
                {(h.agentsTotal - h.agentsWithNoDocument).toLocaleString()} against a registry of{" "}
                {h.agentsTotal.toLocaleString()} and {h.agentsWithNoDocument.toLocaleString()} agents quietly vanish off the page.
              </p>
            </div>
          ) : null}
        </div>

        <p className="mt-3 border-t border-[var(--color-line)] pt-3 font-mono text-[11.5px] text-faint">
          buckets sum to{" "}
          <span className="text-muted">
            {(
              h.byState.reduce((n, s) => n + s.agents, 0) +
              h.notProbedAgents +
              h.agentsWithNoDocument
            ).toLocaleString()}
          </span>{" "}
          against a registry of <span className="text-muted">{h.agentsTotal.toLocaleString()}</span>.
          Shown because a page whose parts do not add up to its own total is the failure this site
          is about.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Finding
            n={goneAgents}
            of={h.agentsTotal}
            head="agents whose registration document is gone"
            body="The host answered and said it is not there. Not a timeout, not a guess."
          />
          <Finding
            n={paywalledAgents}
            of={h.agentsTotal}
            head="agents whose registration document sits behind an x402 challenge"
            body="This asks the registration document's own URL, not the service endpoints the document lists, so an agent that takes x402 payments on its service (all twelve of ours do) is not counted here. It counts only a real challenge: a host that answers 402 with a suspended-account page is counted as gone, because a status code is not a protocol."
          />
        </div>
        <Derivation
          sql={health.sql}
          note="The state column is a view (fovea.record_state) so one definition serves the page, the feed and the API. A probe records what happened; the view decides what that means and the view is allowed to improve without re-fetching anyone's server."
        />
      </Panel>

      {/* ---------------------------------------------------------------- who funded the wallets */}
      <Panel
        id="funders"
        title="who funded those wallets, from Nansen"
        subtitle="A wallet count says how many. It does not say whether they are many operators or one. The first wallet that sent each one gas answers that, per wallet, for a random sample."
      >
        {funders === null || funders.rows.length === 0 ? (
          <p className="text-[13px] text-muted">
            <span className="unknown-value">unknown</span>: no wallet has been asked about yet.
          </p>
        ) : (
          <div className="space-y-4">
            {funders.rows.map((c) => (
              <div key={c.uri} className="border-b border-[var(--color-line)]/60 pb-3 last:border-0">
                <p className="break-all font-mono text-[12px] text-muted">{c.uri}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-text)]">
                  <Num value={c.topFunderWallets} /> of <Num value={c.found} /> sampled wallets were first funded by{" "}
                  <a className="font-mono text-[var(--color-brand)] ilink" href={`https://monadscan.com/address/${c.topFunder}`} target="_blank" rel="noopener noreferrer">
                    {c.topFunder ? `${c.topFunder.slice(0, 6)}…${c.topFunder.slice(-4)}` : "?"}
                  </a>
                  {c.topFunderLabel ? <span className="text-muted"> ({c.topFunderLabel})</span> : null}.{" "}
                  <span className="text-muted">
                    {c.distinctFunders} distinct funder{c.distinctFunders === 1 ? "" : "s"} across the sample; {c.sampled.toLocaleString()} of{" "}
                    {c.owners.toLocaleString()} wallets asked
                    {c.found < c.sampled ? `, ${c.sampled - c.found} unknown` : ""}.
                  </span>
                </p>
                {c.exampleTx ? (
                  <p className="mt-1 font-mono text-[11.5px] text-faint">
                    one funding tx:{" "}
                    <a className="ilink" href={`https://monadscan.com/tx/${c.exampleTx}`} target="_blank" rel="noopener noreferrer">
                      {c.exampleTx.slice(0, 12)}…
                    </a>
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-[12.5px] leading-relaxed text-muted">
              A shared funder describes how the wallets were set up, not anyone&apos;s intent: a deploy script, a faucet or a team
              funding its own test wallets all look like this. It does say the wallet count overstates the number of independent
              operators. Unsampled wallets are <span className="unknown-value">unknown</span>, never counted either way.
            </p>
          </div>
        )}
        {funders ? (
          <Derivation
            sql={funders.sql}
            note="Nansen profiler/address/related-wallets (1 credit a wallet), relation First Funder. The sample is ordered by md5(address), so rerunning asks the same wallets. Each funding tx can be opened on the explorer: from is the funder, to is the wallet. Labels (100 credits a wallet) were not affordable at this scale; first funders answer the question that mattered here."
          />
        ) : null}
      </Panel>

      {/* ---------------------------------------------------------------- hosts */}
      <Panel
        title="hosts, by how many agents depend on them"
        subtitle="A host nobody chose together is still a single point of failure they share."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2">host</th>
              <th className="pb-2 text-right">agents</th>
              <th className="pb-2 text-right">documents</th>
              <th className="pb-2 text-right">answered</th>
              <th className="pb-2 text-right">gone</th>
              <th className="pb-2 text-right">402</th>
              <th className="pb-2 text-right">other</th>
              <th className="pb-2 text-right">not asked</th>
            </tr>
          </thead>
          <tbody>
            {hs.rows.map((r) => (
              <tr key={r.host} className="border-b border-[var(--color-line)]/50 last:border-0">
                <td className="py-2 font-mono text-[12.5px] break-all">{r.host}</td>
                <td className="py-2 text-right font-mono">
                  <Num value={r.agents} />
                </td>
                <td className="py-2 text-right font-mono text-muted">
                  <Num value={r.records} />
                </td>
                <td className="py-2 text-right font-mono text-[var(--color-true)]">{r.answered || ""}</td>
                <td className="py-2 text-right font-mono text-[var(--color-false)]">{r.gone || ""}</td>
                <td className="py-2 text-right font-mono text-[var(--color-brand)]">{r.paywalled || ""}</td>
                <td className="py-2 text-right font-mono text-muted">{r.other || ""}</td>
                <td className="py-2 text-right font-mono unknown-value">{r.notProbed || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Derivation sql={hs.sql} />
      </Panel>

      {/* ---------------------------------------------------------------- the clusters */}
      <Panel
        title="every shared document, biggest cluster first"
        subtitle={`One row per distinct document. Storing ${(biggest?.memberCount ?? 0).toLocaleString()} copies of one dead URL would hide the cluster, which is the only part worth knowing.`}
      >
        <div className="space-y-px">
          {cl.rows.map((c) => (
            <Link
              key={c.uriHash}
              href={`/operators/${c.uriHash}`}
              className="block rounded border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-24 shrink-0 text-right font-mono text-[15px]">
                  <Num value={c.memberCount} />
                </span>
                <span className="w-20 shrink-0 font-mono text-[12px] text-faint">
                  <Num value={c.distinctOwners} /> wallets
                </span>
                <RecordStateBadge state={c.state} />
                {c.chainCount > 1 ? (
                  <span
                    className="chip chip--live"
                    title={`This document is registered on ${c.chainCount} chains: ${c.chainIds.join(", ")}. Matched on the document's content hash, which is the only key that means the same thing on two chains.`}
                  >
                    also on {c.chainIds.filter((id) => id !== 143).join(", ")}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted">
                  {c.uri || <span className="unknown-value">no document declared</span>}
                </span>
              </div>
              {c.memberCount > 1 && c.distinctOwners < c.memberCount ? (
                <p className="mt-0.5 pl-[7.5rem] text-[11.5px] text-faint">
                  {(c.memberCount - c.distinctOwners).toLocaleString()} of these were registered by a
                  wallet that registered more than one agent against this same document.
                </p>
              ) : null}
            </Link>
          ))}
        </div>
        <Derivation sql={cl.sql} />
      </Panel>
    </div>
  );
}

function Finding({ n, of, head, body }: { n: number; of: number; head: string; body: string }) {
  return (
    <div className="hover-lift rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4">
      <p className="stat-value text-[1.7rem]">{n.toLocaleString()}</p>
      <p className="mt-1.5 text-[13px] text-[var(--color-text)]">{head}</p>
      <p className="mt-0.5 font-mono text-[11px] text-faint">
        <Pct of={n} total={of} /> of the registry
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
