import Link from "next/link";
import { Addr, Mono, Num, PageHeader, Panel } from "@/components/ui.tsx";
import { RecordStateBadge } from "@/components/record-state.tsx";
import { agent, claims, probedCluster, type AgentRow, type ClusterWithProbe } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Compare",
  description: "Two to four agents side by side, rung first. What was claimed against what was found.",
};

type Props = { searchParams: Promise<{ ids?: string }> };

type Side = {
  agent: AgentRow;
  record: ClusterWithProbe | undefined;
  checked: number;
  resolve: number;
  doNot: number;
  unknown: number;
  noClaim: number;
};

async function side(id: string): Promise<Side | null> {
  const a = await agent(id);
  if (!a) return null;
  const [record, fb] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: true, limit: 200 }),
  ]);
  const rows = fb.rows;
  return {
    agent: a,
    record,
    checked: rows.filter((c) => c.outcome !== null).length,
    resolve: rows.filter((c) => c.outcome === "true").length,
    doNot: rows.filter((c) => c.outcome === "false").length,
    unknown: rows.filter((c) => c.outcome === "unknown").length,
    noClaim: rows.filter((c) => c.outcome === "noClaim").length,
  };
}

export default async function Compare({ searchParams }: Props) {
  const sp = await searchParams;
  const ids = (sp.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  const sides = (await Promise.all(ids.map(side))).filter((s): s is Side => s !== null);
  const missing = ids.length - sides.length;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="erc-8004 · monad mainnet · side by side"
        title="Two to four agents, rung first."
        lead={
          <>
            Rung first, then what each one claimed against what was found. There is no combined score
            and there is no winner, because a single number over two agents with different amounts of
            evidence would hide exactly the thing worth comparing.
          </>
        }
      />

      <Panel title="pick agents to compare">
        <form action="/compare" className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-[20rem] flex-1">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
            agent ids, comma separated, up to four
          </span>
          <input
            name="ids"
            defaultValue={sp.ids ?? ""}
            placeholder="10182, 10169, 2106"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-faint focus:border-[var(--color-brand)]"
          />
        </label>
        <button type="submit" className="cta">
          compare →
        </button>
        <Link href="/compare?ids=10182,10169,9" className="cta-ghost">
          try three
        </Link>
        </form>
      </Panel>

      <div className="space-y-5">
      {missing > 0 ? (
        <p className="font-mono text-[12px] text-[var(--color-unknown)]">
          {missing} of the ids given is not in the index, so it is left out rather than shown blank.
        </p>
      ) : null}

      {sides.length === 0 ? (
        <Panel>
          <p className="text-[13px] text-muted">
            Give at least one agent id. Ids are the registry&apos;s own, so{" "}
            <Mono className="text-[var(--color-brand)]">10182</Mono> is agent #10182 on Monad.
          </p>
        </Panel>
      ) : (
        <Panel title="what each one claimed against what was found">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-44 border-b border-[var(--color-line)] bg-[var(--color-ink)] px-2 pb-2 text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                  &nbsp;
                </th>
                {sides.map((s) => (
                  <th key={s.agent.id} className="border-b border-[var(--color-line)] px-3 pb-2 text-left">
                    <Link href={`/agent/${s.agent.agentId}`} className="ilink">
                      <Mono className="text-[14px] text-[var(--color-text)]">#{s.agent.agentId}</Mono>
                      <span className="ml-2 text-[12px] text-muted">{s.agent.name ?? "unnamed"}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Cmp label="claims that resolve" sides={sides}>
                {(s) =>
                  s.resolve > 0 ? (
                    <span className="font-mono text-[var(--color-true)]">{s.resolve}</span>
                  ) : (
                    <span className="font-mono text-faint">0</span>
                  )
                }
              </Cmp>
              <Cmp label="claims that do not" sides={sides}>
                {(s) =>
                  s.doNot > 0 ? (
                    <span className="font-mono text-[var(--color-false)]">{s.doNot}</span>
                  ) : (
                    <span className="font-mono text-faint">0</span>
                  )
                }
              </Cmp>
              <Cmp label="could not check" sides={sides}>
                {(s) => (s.unknown > 0 ? <span className="unknown-value font-mono">{s.unknown}</span> : <span className="font-mono text-faint">0</span>)}
              </Cmp>
              <Cmp label="assert no payment" sides={sides}>
                {(s) => <span className="font-mono text-muted">{s.noClaim}</span>}
              </Cmp>
              <Cmp label="feedback on chain" sides={sides}>
                {(s) => <Num value={s.agent.feedbackCount} />}
              </Cmp>
              <Cmp label="registration document" sides={sides}>
                {(s) => <RecordStateBadge state={s.record?.state ?? null} />}
              </Cmp>
              <Cmp label="document shared with" sides={sides}>
                {(s) =>
                  !s.record ? (
                    <span className="unknown-value font-mono text-[12px]">no document</span>
                  ) : s.record.memberCount === 1 ? (
                    <span className="font-mono text-[12px] text-[var(--color-true)]">nobody</span>
                  ) : (
                    <Link
                      href={`/operators/${s.record.uriHash}`}
                      className="font-mono text-[12px] text-[var(--color-unknown)] ilink"
                    >
                      {(s.record.memberCount - 1).toLocaleString()} others
                    </Link>
                  )
                }
              </Cmp>
              <Cmp label="declares x402" sides={sides}>
                {(s) =>
                  s.agent.declaresX402 ? (
                    <span className="font-mono text-[12px] text-[var(--color-brand)]">yes, by its own record</span>
                  ) : (
                    <span className="font-mono text-[12px] text-faint">no</span>
                  )
                }
              </Cmp>
              <Cmp label="registered at block" sides={sides}>
                {(s) => <Mono className="text-[12px] text-muted">{s.agent.registeredAtBlock.toLocaleString()}</Mono>}
              </Cmp>
              <Cmp label="transfers" sides={sides}>
                {(s) => <Num value={s.agent.transferCount} />}
              </Cmp>
              <Cmp label="owner" sides={sides}>
                {(s) => <Addr value={s.agent.owner} />}
              </Cmp>
            </tbody>
          </table>
          </div>
        </Panel>
      )}
      </div>
    </div>
  );
}

function Cmp({
  label,
  sides,
  children,
}: {
  label: string;
  sides: Side[];
  children: (s: Side) => React.ReactNode;
}) {
  return (
    <tr className="group">
      <th className="sticky left-0 z-10 border-b border-[var(--color-line)]/50 bg-[var(--color-ink)] px-2 py-2 text-left font-mono text-[11px] uppercase tracking-wide text-faint group-hover:text-muted">
        {label}
      </th>
      {sides.map((s) => (
        <td key={s.agent.id} className="border-b border-[var(--color-line)]/50 px-3 py-2">
          {children(s)}
        </td>
      ))}
    </tr>
  );
}
