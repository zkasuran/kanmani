import Link from "next/link";
import { Addr, Derivation, Mono, Num, Panel } from "@/components/ui.tsx";
import { agents, agentsCount, AGENTS_ORDER_RULE, type AgentFilter } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Agents",
  // No count baked in here. The registry grows, so a literal goes stale. The live figure is read
  // from the counter slot and shown on the page itself.
  description: "Every registered agent on Monad, filterable by whether anyone else shares their record.",
};

const PER_PAGE = 60;

type Props = {
  searchParams: Promise<{ cluster?: string; x402?: string; evidence?: string; q?: string; page?: string }>;
};

export default async function Agents({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const filter: AgentFilter = {
    cluster: sp.cluster === "unique" || sp.cluster === "shared" ? sp.cluster : undefined,
    declaresX402: sp.x402 === "1" ? true : undefined,
    withEvidence: sp.evidence === "1" ? true : undefined,
    search: sp.q,
  };

  const [list, total] = await Promise.all([
    agents({ ...filter, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    agentsCount(filter),
  ]);
  const pages = Math.ceil(total / PER_PAGE);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, page: undefined, ...over } as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/agents?${s}` : "/agents";
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section>
        <span className="kicker">every registered agent, filterable by what shares its record</span>
        <h1 className="mt-3 fluid-3 font-semibold tracking-tight">Agents</h1>
        <p className="lead lead--wide mt-3 text-muted">
          {AGENTS_ORDER_RULE} Every ranked list on this site states its rule, because a list whose
          order comes from a number nobody can see is an opinion pretending to be data.
        </p>
      </section>

      {/* ---------------------------------------------------------------- filters */}
      <form
        action="/agents"
        className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="agent id, name, owner, wallet or document URL"
            className="min-w-[18rem] flex-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-faint focus:border-[var(--color-brand)]"
          />
          {/* Carried so a search does not silently drop the filters above it. */}
          {sp.cluster ? <input type="hidden" name="cluster" value={sp.cluster} /> : null}
          {sp.x402 ? <input type="hidden" name="x402" value={sp.x402} /> : null}
          {sp.evidence ? <input type="hidden" name="evidence" value={sp.evidence} /> : null}
          <button
            type="submit"
            className="rounded border border-[var(--color-line-bright)] px-3 py-1.5 font-mono text-[12px] text-muted hover:text-[var(--color-text)]"
          >
            search
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">record</span>
          <Chip href={qs({ cluster: undefined })} active={!filter.cluster}>
            any
          </Chip>
          <Chip
            href={qs({ cluster: "unique" })}
            active={filter.cluster === "unique"}
            title="Agents whose registration document nobody else points at. The filter that collapses the whole registry to the few a buyer can actually read."
          >
            nobody else shares it
          </Chip>
          <Chip
            href={qs({ cluster: "shared" })}
            active={filter.cluster === "shared"}
            title="Agents sharing a registration document with at least one other agent."
          >
            shared with others
          </Chip>

          <span className="ml-3 font-mono text-[11px] uppercase tracking-wide text-faint">also</span>
          <Chip
            href={qs({ evidence: sp.evidence === "1" ? undefined : "1" })}
            active={sp.evidence === "1"}
            title="Agents carrying at least one feedback that points at an evidence document."
          >
            has evidence
          </Chip>
          <Chip
            href={qs({ x402: sp.x402 === "1" ? undefined : "1" })}
            active={sp.x402 === "1"}
            title="The operator's own claim that this agent speaks x402. It is their statement, not our measurement."
          >
            declares x402
          </Chip>
        </div>

        <p className="border-t border-[var(--color-line)] pt-2 font-mono text-[11.5px] text-faint">
          <Num value={total} /> matching {total === 1 ? "agent" : "agents"}
          {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        </p>
      </form>

      <Panel>
        <div className="space-y-px">
          {list.rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">
              Nothing matches. That is a real answer, not an empty page.
            </p>
          ) : null}
          {list.rows.map((a) => (
            <Link
              key={a.id}
              href={`/agent/${a.agentId}`}
              className="block rounded border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Mono className="w-16 shrink-0 text-[13px]">#{a.agentId}</Mono>
                <span className="w-44 shrink-0 truncate text-[13px]">
                  {a.name ?? <span className="text-faint">unnamed</span>}
                </span>
                <span className="w-24 shrink-0">
                  {a.feedbackCount > 0 ? (
                    <Mono className="text-[11.5px] text-[var(--color-text)]">
                      {a.feedbackCount} feedback{a.feedbackCount === 1 ? "" : "s"}
                    </Mono>
                  ) : (
                    <Mono className="text-[11.5px] text-faint">no feedback</Mono>
                  )}
                </span>
                <span className="w-40 shrink-0">
                  {a.recordMemberCount === null ? (
                    <Mono className="unknown-value text-[11.5px]">no document</Mono>
                  ) : a.recordMemberCount === 1 ? (
                    <Mono className="text-[11.5px] text-[var(--color-true)]">record is its own</Mono>
                  ) : (
                    <Mono className="text-[11.5px] text-[var(--color-unknown)]">
                      shared with {(a.recordMemberCount - 1).toLocaleString()}
                    </Mono>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-faint">
                  {a.tokenUri ?? "no tokenURI"}
                </span>
                <Addr value={a.owner} />
              </div>
            </Link>
          ))}
        </div>

        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between border-t border-[var(--color-line)] pt-3 font-mono text-[12px]">
            {page > 1 ? (
              <Link href={qs({ page: String(page - 1) })} className="text-muted hover:text-[var(--color-text)]">
                ← previous
              </Link>
            ) : (
              <span className="text-faint">← previous</span>
            )}
            <span className="text-faint">
              {((page - 1) * PER_PAGE + 1).toLocaleString()}–
              {Math.min(page * PER_PAGE, total).toLocaleString()} of {total.toLocaleString()}
            </span>
            {page < pages ? (
              <Link href={qs({ page: String(page + 1) })} className="text-muted hover:text-[var(--color-text)]">
                next →
              </Link>
            ) : (
              <span className="text-faint">next →</span>
            )}
          </nav>
        ) : null}

        <Derivation sql={list.sql} />
      </Panel>
    </div>
  );
}

function Chip({
  href,
  active,
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`rounded border px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
        active
          ? "border-[var(--color-brand)] bg-[var(--color-brand-dim)]/20 text-[var(--color-text)]"
          : "border-[var(--color-line)] text-muted hover:border-[var(--color-line-bright)]"
      }`}
    >
      {children}
    </Link>
  );
}
