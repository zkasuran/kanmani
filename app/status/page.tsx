import Link from "next/link";
import { Derivation, Mono, Num, OutcomeBadge, PageHeader, Panel, StatTile } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import {
  changedClaims,
  chainStatus,
  crossChainMerge,
  entityCounts,
  freshness,
  handlerActivity,
  population,
  registryHealth,
} from "@/lib/queries.ts";
import { byId } from "@/lib/chains.ts";
import type {
  ChainStatusRow,
  CrossChainMerge,
  EntityCount,
  HandlerActivity,
  Sourced,
} from "@/lib/queries.ts";
import { usage } from "@/lib/usage.ts";
import { UsagePanel } from "@/components/usage-panel.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Status",
  description: "How fresh every number on this site is and what is stale.",
};

/** A worker that is not scheduled is a worker that does not run, so the schedule is published. */
const WORKERS = [
  {
    name: "Retina, the indexer",
    what: "Follows the ERC-8004 registries on Monad and writes Agent, AgentRecord and Feedback rows. The evidence pointer exists only in a non-indexed log field, so without this there is nothing to check.",
    cadence: "continuous, following the head",
  },
  {
    name: "population check",
    what: "Reads the registry's own counter slot and records it against the block it was read at. The registry is not enumerable, so this is the only source of population truth.",
    cadence: "every 10,000 blocks from block 105,000,000",
  },
  {
    name: "Fovea, the verdict sweep",
    what: "Walks every claim without a verdict down the ladder and appends one. Never updates one. A cited transaction missing from Monad is searched for on the other chains we can read, so a mislabelled network is told apart from a missing payment.",
    cadence: "new claims hourly (kanmani-sweep). Documents that can change plus every unknown rechecked every 6 hours (kanmani-recheck). Every check is kept",
  },
  {
    name: "the record probe",
    what: "Asks each distinct registration document whether it still answers. Deduplicated by record hash, per host, serial, with a gap, because a handful of hosts carry most of the documents.",
    cadence: "daily at 03:30 UTC, systemd timer kanmani-probe (ops/systemd)",
  },
  {
    name: "usage counts",
    what: "Turns the access log into daily counts per surface and reads on-chain use of our contracts. Salted daily hashes, no IP stored.",
    cadence: "every 10 minutes, systemd timer kanmani-usage (ops/systemd)",
  },
];

export default async function Status() {
  const usageNow = await usage(7);
  const [f, pop, health, changed, cs, ec, ha, cc] = await Promise.all([
    freshness(),
    population(),
    registryHealth(),
    changedClaims(40),
    chainStatus(),
    entityCounts(),
    handlerActivity(),
    crossChainMerge(),
  ]);
  const fr = f.rows;
  const p = pop.rows;
  const hh = health.rows;

  const now = Date.now();
  const indexAgeMin =
    fr.indexStateUpdatedAt === null ? null : Math.round((now / 1000 - fr.indexStateUpdatedAt) / 60);
  const verdictAgeMin =
    fr.newestVerdictAt === null
      ? null
      : Math.round((now - new Date(fr.newestVerdictAt).getTime()) / 60000);
  const gap = p.counterSlotCount === null ? null : p.counterSlotCount - p.agentsIndexed;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="erc-8004 · monad mainnet · freshness"
        title="Every number here is a measurement at a time."
        lead={
          <>
            This page says which time. A page that reports a figure that was true when it was
            written, with no way to tell how long ago that was, is the failure mode this exists to
            prevent.
          </>
        }
      />

      <Reveal as="section" className="auto-grid">
        <StatTile label="agents we hold" value={p.agentsIndexed} hint="Agent rows Retina has indexed on Monad." />
        <StatTile
          label="the registry's own count"
          value={p.counterSlotCount}
          hint="Read from the registry's counter slot. The registry is not enumerable, so this is the only source of population truth."
        />
        <StatTile
          label="gap"
          value={gap}
          tone={gap !== null && gap !== 0 ? "unknown" : "neutral"}
          hint="Positive means the index is behind. Unknown means the slot read failed, which is not the same as zero."
        />
        <StatTile label="verdicts that have changed" value={changed.rows.length} tone="brand" hint="Claims whose verdict moved after a re-check. The correction trail." />
      </Reveal>

      <Reveal as="div" className="grid gap-5 lg:grid-cols-2">
        <Panel title="freshness">
          <dl className="space-y-1.5 text-sm">
            <Line
              label="index last wrote its population"
              value={indexAgeMin === null ? null : indexAgeMin}
              suffix=" min ago"
              warn={indexAgeMin !== null && indexAgeMin > 120}
            />
            <Line label="index at block" value={fr.latestIndexedBlock} />
            <Line label="newest feedback indexed at block" value={fr.latestFeedbackBlock} />
            <Line
              label="registry says"
              value={p.counterSlotCount}
              suffix=" agents"
            />
            <Line label="we hold" value={p.agentsIndexed} suffix=" agents" />
            <Line
              label="gap"
              value={gap}
              warn={gap !== null && gap !== 0}
              hint="Positive means the index is behind. Unknown means the slot read failed, which is not zero."
            />
            <div className="h-2" />
            <Line
              label="newest verdict"
              value={verdictAgeMin}
              suffix=" min ago"
              warn={verdictAgeMin !== null && verdictAgeMin > 60 * 24 * 3}
            />
            <Line label="verdicts recorded, all time" value={fr.verdictsTotal} />
            <Line label="claims carrying a current verdict" value={fr.claimsWithAVerdict} />
            <Line
              label="claims with a URI and no verdict"
              value={fr.claimsWithNoVerdict}
              warn={fr.claimsWithNoVerdict > 0}
              hint="Unchecked is not the same as clean. A non-zero here is a gap in our coverage, stated as one."
            />
            <div className="h-2" />
            <Line
              label="registration documents asked"
              value={hh.recordsTotal - hh.notProbedRecords}
              suffix={` of ${hh.recordsTotal.toLocaleString()}`}
            />
            <Line
              label="documents never asked"
              value={hh.notProbedRecords}
              warn={hh.notProbedRecords > 0}
            />
          </dl>
          <Derivation sql={f.sql} />
        </Panel>

        <Panel title="workers and what schedules them">
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            A worker that is not scheduled is a worker that does not run. The schedule lives in the
            repository and the deploy installs it, rather than living in somebody&apos;s memory.
          </p>
          <div className="space-y-2">
            {WORKERS.map((w) => (
              <div key={w.name} className="rounded border border-[var(--color-line)] p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px]">{w.name}</span>
                  <Mono className="text-[11px] text-faint">{w.cadence}</Mono>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{w.what}</p>
              </div>
            ))}
          </div>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- the indexer */}
      <Reveal className="flex flex-col gap-5">
        <div>
          <span className="kicker">the indexer · retina on hypersync</span>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-text)]">
            What Retina has processed and where the two chains cross.
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
            Read live from Envio&apos;s own tables, so a reader with psql gets the same numbers by running
            the strings below. BSC and the cross-chain merge come live after the one pending resync, so
            until then they read Monad only rather than blank. A schema dropped mid-resync reads
            unknown rather than zero.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChainStatusPanel cs={cs} />
          <EntityCountsPanel ec={ec} />
          <HandlerActivityPanel ha={ha} />
          <CrossChainPanel cc={cc} />
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- corrections */}
      <Reveal>
        <UsagePanel u={usageNow} />
      </Reveal>

      <Reveal>
      <Panel
        id="corrections"
        title={`verdicts that have changed · ${changed.rows.length}`}
        subtitle="Either we were wrong and corrected it or somebody fixed their document and the page moved on its own. Both are worth showing and neither is visible in a store that updates in place."
      >
        {changed.rows.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">
            No verdict has changed yet. This table exists before it has anything in it, because the
            place to build a correction trail is before the first correction.
          </p>
        ) : (
          <div className="space-y-px">
            {changed.rows.map((c) => (
              <Link
                key={c.feedbackId}
                href={`/claim/${encodeURIComponent(c.feedbackId)}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-transparent px-2 py-1.5 hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
              >
                <span className="flex shrink-0 items-center gap-1.5">
                  <OutcomeBadge outcome={c.from} />
                  <span className="text-faint">→</span>
                  <OutcomeBadge outcome={c.to} />
                </span>
                <Mono className="shrink-0 text-[11px] text-faint">
                  {c.checks} checks · {c.lastCheckedAt.replace("T", " ").slice(0, 16)}Z
                </Mono>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                  {c.feedbackUri}
                </span>
              </Link>
            ))}
          </div>
        )}
        <Derivation sql={changed.sql} />
      </Panel>
      </Reveal>

      <Reveal>
      <Panel title="what this site does not know">
        <ul className="space-y-2 text-[13.5px] leading-relaxed text-muted">
          <Gap n={fr.claimsWithNoVerdict}>
            claims carry a URI and have never been checked. Unchecked is not clean.
          </Gap>
          <Gap n={hh.notProbedRecords}>
            registration documents have never been asked whether they still answer.
          </Gap>
          <Gap n={hh.byState.find((s) => s.state === "unknown")?.records ?? 0}>
            registration documents answered in a way we could not read: a rate limit, a timeout, a
            server error or a document past our own size cap. Ours, not theirs.
          </Gap>
          <Gap n={p.validations}>
            validation requests exist in the Validation Registry on Monad. Nobody is writing there
            yet, so that half of ERC-8004 is empty rather than unmeasured.
          </Gap>
        </ul>
      </Panel>
      </Reveal>
    </div>
  );
}

function Line({
  label,
  value,
  suffix,
  warn,
  hint,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)]/50 pb-1 last:border-0">
      <dt className="text-[13px] text-muted" title={hint}>
        {label}
        {hint ? <span className="ml-1 text-faint">ⓘ</span> : null}
      </dt>
      <dd className={`font-mono text-[14px] ${warn ? "text-[var(--color-unknown)]" : ""}`}>
        <Num value={value} suffix={suffix} title={hint} />
      </dd>
    </div>
  );
}

function Gap({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className={`tnum shrink-0 font-mono ${n > 0 ? "text-[var(--color-unknown)]" : "text-[var(--color-true)]"}`}>
        {n.toLocaleString()}
      </span>
      <span>{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ the indexer panels */

/** The read failed, which is unknown rather than zero. The whole position of the site, in one line. */
function UnknownRead() {
  return (
    <p className="py-2 text-[13px] text-muted">
      <span className="unknown-value">unknown</span>. Envio&apos;s <Mono className="text-[12px]">public</Mono> schema
      could not be read, which happens while a resync drops and recreates it. This is not zero.
    </p>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[13px] text-muted">{children}</p>;
}

function Field({ label, children, tone }: { label: string; children: React.ReactNode; tone?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[13px] ${tone ? "text-[var(--color-unknown)]" : ""}`}>{children}</span>
    </div>
  );
}

function chainName(id: number): string {
  return byId(id)?.displayName ?? `chain ${id}`;
}

function ChainStatusPanel({ cs }: { cs: Sourced<ChainStatusRow[] | null> }) {
  return (
    <Panel title="per chain · head, lag, events">
      {cs.rows === null ? (
        <UnknownRead />
      ) : cs.rows.length === 0 ? (
        <EmptyNote>No chain has written a checkpoint yet, so there is nothing to report.</EmptyNote>
      ) : (
        <div className="space-y-2">
          {cs.rows.map((r) => (
            <div key={r.chainId} className="rounded border border-[var(--color-line)] p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px]">{chainName(r.chainId)}</span>
                {r.caughtUpAt ? (
                  <Mono className="text-[11px] text-[var(--color-true)]">caught up to head</Mono>
                ) : (
                  <Mono className="text-[11px] text-faint">following head</Mono>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                <Field label="head"><Num value={r.head} /></Field>
                <Field label="processed"><Num value={r.processed} /></Field>
                <Field label="lag" tone={r.lag !== null && r.lag > 0}><Num value={r.lag} /></Field>
                <Field label="events"><Num value={r.events} /></Field>
              </dl>
            </div>
          ))}
        </div>
      )}
      <Derivation sql={cs.sql} />
    </Panel>
  );
}

const PER_CHAIN_ENTITIES = ["Agent", "AgentRecord", "AgentRecordOwner", "Feedback", "Validation"];
const CROSS_CHAIN_ENTITIES = ["ChiasmRecord", "ChiasmPresence"];

function EntityCountsPanel({ ec }: { ec: Sourced<EntityCount[] | null> }) {
  const rows = ec.rows;
  const chains =
    rows === null
      ? []
      : [...new Set(rows.filter((r) => r.chainId !== null).map((r) => r.chainId as number))].sort((a, b) => a - b);
  const at = (entity: string, chainId: number | null): number | null => {
    const hit = rows?.find((r) => r.entity === entity && r.chainId === chainId);
    return hit ? hit.n : null;
  };
  return (
    <Panel title="rows per entity">
      {rows === null ? (
        <UnknownRead />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left">
              <th className="py-1.5 pr-3 font-mono text-[10px] uppercase tracking-wide text-faint">entity</th>
              {chains.map((c) => (
                <th key={c} className="py-1.5 pl-3 text-right font-mono text-[10px] uppercase tracking-wide text-faint">
                  {chainName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PER_CHAIN_ENTITIES.map((entity) => (
              <tr key={entity} className="border-b border-[var(--color-line)]/40">
                <td className="py-1.5 pr-3"><Mono className="text-[12px]">{entity}</Mono></td>
                {chains.map((c) => (
                  <td key={c} className="py-1.5 pl-3 text-right font-mono"><Num value={at(entity, c)} /></td>
                ))}
              </tr>
            ))}
            {CROSS_CHAIN_ENTITIES.map((entity) => (
              <tr key={entity} className="border-b border-[var(--color-line)]/40 last:border-0">
                <td className="py-1.5 pr-3"><Mono className="text-[12px]">{entity}</Mono></td>
                <td className="py-1.5 pl-3 text-right font-mono text-muted" colSpan={Math.max(chains.length, 1)}>
                  <Num value={at(entity, null)} /> <span className="text-faint text-[11px]">cross-chain, one row set</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Derivation sql={ec.sql} />
    </Panel>
  );
}

function HandlerActivityPanel({ ha }: { ha: Sourced<HandlerActivity | null> }) {
  const data = ha.rows;
  return (
    <Panel title="events per handler">
      {data === null ? (
        <UnknownRead />
      ) : (
        <>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">
            Rows each handler wrote, not a raw log count. <Mono className="text-[11px]">MetadataSet</Mono> and{" "}
            <Mono className="text-[11px]">URIUpdated</Mono> mutate an Agent in place and keep no counter of their
            own, so they fold into the Agent row. An exact per-event-name count needs Envio&apos;s raw_events
            table, which this deployment keeps off. See <Mono className="text-[11px]">indexer/README.md</Mono>.
          </p>
          <div className="space-y-2">
            {data.perChain.map((r) => (
              <div key={r.chainId} className="rounded border border-[var(--color-line)] p-2.5">
                <div className="text-[13px]">{chainName(r.chainId)}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <Field label="registered"><Num value={r.registered} /></Field>
                  <Field label="transfers (later)"><Num value={r.laterTransfers} /></Field>
                  <Field label="metadata updates"><Num value={r.metadataUpdates} /></Field>
                  <Field label="new feedback"><Num value={r.newFeedback} /></Field>
                  <Field label="feedback revoked"><Num value={r.feedbackRevoked} /></Field>
                  <Field label="responses"><Num value={r.responses} /></Field>
                  <Field label="validation requests"><Num value={r.validationRequests} /></Field>
                  <Field label="validation responses"><Num value={r.validationResponses} /></Field>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
      <Derivation sql={ha.sql} />
    </Panel>
  );
}

function CrossChainPanel({ cc }: { cc: Sourced<CrossChainMerge | null> }) {
  const data = cc.rows;
  // Group the (document, chain) rows back to one document, so the shared URI prints once.
  const docs = new Map<
    string,
    { uri: string; chainCount: number; agentCount: number; presence: { chainId: number; agents: number; firstAgentId: string }[] }
  >();
  if (data) {
    for (const r of data.detail) {
      const d = docs.get(r.uriHash) ?? { uri: r.uri, chainCount: r.chainCount, agentCount: r.agentCount, presence: [] };
      d.presence.push({ chainId: r.chainId, agents: r.agentsOnChain, firstAgentId: r.firstAgentId });
      docs.set(r.uriHash, d);
    }
  }
  return (
    <Panel title="merged on record hash · the two chains cross">
      {data === null ? (
        <UnknownRead />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="documents indexed" value={data.summary.documents} />
            <StatTile label="referenced on both chains" value={data.summary.onBothChains} tone="brand" />
            <StatTile
              label="key collisions"
              value={data.summary.keyCollisions}
              tone="unknown"
              hint="A content key is 64-bit, not a digest. The cross-chain claim only holds while this is 0."
            />
          </div>
          {data.summary.onBothChains === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              No document is referenced from more than one chain yet. The merge needs the BSC backfill, which
              is on the pending resync, so this reads Monad only rather than claiming zero crossings.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {[...docs.entries()].map(([hash, d]) => (
                <div key={hash} className="rounded border border-[var(--color-line)] p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/agent/${d.presence[0]!.firstAgentId}`}
                      className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--color-brand)] ilink"
                    >
                      {d.uri || hash}
                    </Link>
                    <Mono className="text-[11px] text-faint">{d.agentCount} agents · {d.chainCount} chains</Mono>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    {d.presence
                      .sort((a, b) => a.chainId - b.chainId)
                      .map((p) => (
                        <span key={p.chainId} className="font-mono text-[11.5px] text-muted">
                          {chainName(p.chainId)}: {p.agents.toLocaleString()}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Derivation sql={cc.sql} />
    </Panel>
  );
}
