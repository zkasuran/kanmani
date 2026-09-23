import Link from "next/link";
import { Addr, Derivation, Num, Panel, Pct } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { hosts, probedClusters, registryHealth, STATE_MEANING } from "@/lib/queries.ts";
import { CATEGORY_META, labelDistribution } from "@/lib/labels.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Operators",
  description:
    "Monad's agent registry clustered by the document each agent registered. 8,093 agents across 7,962 wallets point at one URL that returns 404.",
};

export default async function Operators() {
  const [health, cl, hs, labels] = await Promise.all([
    registryHealth(),
    probedClusters(40),
    hosts(20),
    labelDistribution(),
  ]);
  const h = health.rows;
  const biggest = cl.rows[0];
  const ld = labels.rows;
  const unknownWallets = ld.unlabeled + ld.unknownLookedUp + ld.notLookedUp;

  const goneAgents = h.byState.find((s) => s.state === "gone")?.agents ?? 0;
  const paywalledAgents = h.byState.find((s) => s.state === "paywalled")?.agents ?? 0;

  return (
    <div className="space-y-10">
      <section>
        <p className="font-mono text-[11px] uppercase tracking-widest text-faint">
          clustered by registration document, not by wallet
        </p>
        <h1 className="mt-3 text-[clamp(1.6rem,3.4vw,2.4rem)] font-semibold leading-[1.15] tracking-tight">
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
          <div className="mt-4 max-w-3xl space-y-3">
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
                {h.agentsTotal.toLocaleString()} and 80 agents quietly vanish off the page.
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
            head="agents that expose a real x402 payment challenge"
            body="A live endpoint answering with an x402 challenge, so a buyer could pay it. This is counted only on a real challenge. A host that answers 402 with a suspended-account page is counted as gone, not here, because a status code is not a protocol."
          />
        </div>
        <Derivation
          sql={health.sql}
          note="The state column is a view (fovea.record_state) so one definition serves the page, the feed and the API. A probe records what happened; the view decides what that means and the view is allowed to improve without re-fetching anyone's server."
        />
      </Panel>

      {/* ---------------------------------------------------------------- who the wallets are */}
      <Panel
        title="who those wallets are, from Nansen"
        subtitle={
          <>
            {ld.walletsTotal.toLocaleString()} distinct wallets registered an agent.{" "}
            {ld.askedAt ? (
              <>
                Nansen labels {ld.labeledWallets.toLocaleString()} of them. Last asked{" "}
                {ld.askedAt.slice(0, 16).replace("T", " ")}Z.
              </>
            ) : (
              <span className="unknown-value">Nobody has asked Nansen yet, so every wallet is unknown.</span>
            )}
          </>
        }
      >
        <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-muted">
          A wallet count says how many. It does not say who. Nansen&apos;s labels endpoint turns each
          address into its known entity and behavioural labels, so the count becomes a distribution.
          A wallet Nansen holds nothing on is <span className="unknown-value">unknown</span>, never a
          zero. So is one we have not asked about yet. Absence of a label is not a finding about the
          wallet.
        </p>
        <div className="space-y-1">
          {ld.byCategory.map((c) => (
            <div
              key={c.category}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-line)]/50 py-2 last:border-0"
            >
              <div className="w-36 shrink-0">
                <span
                  className={`${CATEGORY_META[c.category].cls} inline-block rounded border border-current/20 px-2 py-0.5 font-mono text-[11px]`}
                >
                  {CATEGORY_META[c.category].label}
                </span>
              </div>
              <div className="w-40 shrink-0 font-mono text-[13px]">
                <Num value={c.wallets} /> <span className="text-faint">wallets</span>
              </div>
              <div className="w-16 shrink-0 text-right font-mono text-[12px] text-muted">
                <Pct of={c.wallets} total={ld.walletsTotal} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] py-2">
            <div className="w-36 shrink-0">
              <span className="unknown-value inline-block rounded border border-[var(--color-line)] px-2 py-0.5 font-mono text-[11px]">
                unknown
              </span>
            </div>
            <div className="w-40 shrink-0 font-mono text-[13px]">
              <Num value={unknownWallets} /> <span className="text-faint">wallets</span>
            </div>
            <div className="w-16 shrink-0 text-right font-mono text-[12px] text-muted">
              <Pct of={unknownWallets} total={ld.walletsTotal} />
            </div>
            <p className="min-w-[16rem] flex-1 text-[12.5px] leading-relaxed text-muted">
              {ld.notLookedUp.toLocaleString()} not asked about yet, {ld.unlabeled.toLocaleString()}{" "}
              Nansen answered with no label, {ld.unknownLookedUp.toLocaleString()} we could not look
              up. All three are unknown rather than a claim about the wallet.
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 font-mono text-[11.5px] text-faint">
          buckets sum to{" "}
          <span className="text-muted">
            {(ld.byCategory.reduce((n, c) => n + c.wallets, 0) + unknownWallets).toLocaleString()}
          </span>{" "}
          against {ld.walletsTotal.toLocaleString()} distinct wallets.
        </p>
        <Derivation
          sql={labels.sql}
          note="Paid per wallet against Nansen's labels endpoint (POST /api/v1/profiler/address/labels), deduplicated so one wallet is asked about once whichever agent it registered. Nansen excludes labels from x402, so this is the apikey path. The profiler endpoints that accept x402 settle on Monad through the same Molandak facilitator this product's own verifier is paid over."
        />
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
        subtitle="One row per distinct document. Storing 8,093 copies of one dead URL would hide the cluster, which is the only part worth knowing."
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
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3">
      <p className="tnum text-2xl font-semibold">{n.toLocaleString()}</p>
      <p className="mt-0.5 text-[13px]">{head}</p>
      <p className="font-mono text-[11px] text-faint">
        <Pct of={n} total={of} /> of the registry
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
