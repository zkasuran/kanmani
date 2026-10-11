import Link from "next/link";
import { Mono, Panel } from "@/components/ui.tsx";
import { NOT_MEASURED, type Usage } from "@/lib/usage.ts";

const n = (v: number) => v.toLocaleString("en-US");
const Unknown = () => <span className="unknown-value">unknown</span>;
const CONTRACT: Record<string, string> = { aqueous: "Aqueous escrow", sclera: "Sclera bonds", agentPasskey: "AgentPasskey" };

/** "Who uses this" on /status. Strongest evidence first, each with how it was measured. */
export function UsagePanel({ u }: { u: Usage }) {
  const machine = (u.requests ?? []).filter((r) => r.class === "software" && r.surface !== "page");
  const crawl = (u.requests ?? []).filter((r) => r.class === "crawler").reduce((s, r) => s + r.calls, 0);
  const ocOthers = u.onchain ? u.onchain.byContract.reduce((s, r) => s + r.others, 0) : null;
  const ocOurs = u.onchain ? u.onchain.byContract.reduce((s, r) => s + r.ours, 0) : null;
  const tools = (u.integrators ?? []).filter((i) => i.kind === "tool");
  const hosts = (u.integrators ?? []).filter((i) => i.kind === "embed-host");
  const mcp = (u.integrators ?? []).filter((i) => i.kind === "mcp-client");
  return (
    <Panel
      id="usage"
      title="who uses this"
      subtitle={`Counted without tracking anyone: public chain events, software and site names plus daily counts whose distinct-client figure is a salted hash that cannot be linked across days. ${u.window ? `Requests: ${u.window.from} to ${u.window.to}.` : ""}`}
    >
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-3" data-testid="usage">
        <section>
          <p className="eyebrow">on chain, anyone can check</p>
          <p className="mt-2 font-mono text-2xl text-[var(--color-text)]">{ocOthers === null ? <Unknown /> : n(ocOthers)}</p>
          <p className="text-[12px] text-muted">
            actions on our contracts by addresses that are not ours{ocOurs !== null ? ` (ours: ${n(ocOurs)})` : ""}
          </p>
          {u.onchain?.others.length ? (
            <ul className="mt-2 flex flex-col gap-1 font-mono text-[11.5px]">
              {u.onchain.others.slice(0, 8).map((o) => (
                <li key={o.tx}>
                  <a className="text-[var(--color-brand)] ilink" href={`https://monadscan.com/tx/${o.tx}`} target="_blank" rel="noopener noreferrer">{o.tx.slice(0, 10)}…</a>{" "}
                  {CONTRACT[o.contract] ?? o.contract} {o.event}
                  {o.agentId ? <> · <Link href={`/agent/${o.agentId}`} className="ilink">#{o.agentId}</Link></> : null}
                </li>
              ))}
            </ul>
          ) : ocOthers === 0 ? (
            <p className="mt-2 text-[12px] text-muted">None yet. Every job, bond and passkey binding so far is ours.</p>
          ) : null}
          <p className="mt-3 text-[12px] text-muted">
            <span className="font-mono text-[var(--color-text)]">{u.built ? n(u.built.registeredByOthers) : <Unknown />}</span> agents registered by others with a URI our
            registration check produced{u.built ? ` (${n(u.built.checked)} URIs checked, ${n(u.built.registered)} registered in all)` : ""}.
          </p>
        </section>

        <section>
          <p className="eyebrow">software that called us</p>
          {tools.length || mcp.length || hosts.length ? (
            <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
              {[...mcp.map((i) => ({ ...i, what: "MCP client" })), ...tools.map((i) => ({ ...i, what: "tool" })), ...hosts.map((i) => ({ ...i, what: "site embedding us" }))]
                .slice(0, 12)
                .map((i) => (
                  <li key={`${i.kind}:${i.name}`} className="flex justify-between gap-2">
                    <span className="text-[var(--color-text)]">{i.name}</span>
                    <span className="text-faint">{i.what} · {n(i.calls)} calls · {i.days}d</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted">{u.integrators === null ? <Unknown /> : "No named tool, MCP client or embedding site in this window."}</p>
          )}
          {u.mcpTools?.length ? (
            <p className="mt-3 text-[12px] text-muted">MCP tool calls: {u.mcpTools.map((t) => `${t.name} ${n(t.calls)}`).join(" · ")}</p>
          ) : null}
        </section>

        <section>
          <p className="eyebrow">requests</p>
          {u.requests === null ? (
            <p className="mt-2"><Unknown /></p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px]">
              <dt className="text-faint">people reading pages</dt>
              <dd className="text-right text-[var(--color-text)]">{u.people ? `${n(u.people.visitorDays)} visitor-days` : "…"}</dd>
              {machine.slice(0, 8).map((r) => (
                <div key={r.surface} className="contents">
                  <dt className="text-faint">{r.surface}</dt>
                  <dd className="text-right text-[var(--color-text)]">{n(r.calls)} · {n(r.clientDays)} client-days</dd>
                </div>
              ))}
              <dt className="text-faint">crawlers (not use)</dt>
              <dd className="text-right text-muted">{n(crawl)}</dd>
            </dl>
          )}
        </section>
      </div>
      <div className="border-t border-[var(--color-line)] px-5 py-3 text-[11.5px] leading-relaxed text-faint">
        Not measured: {NOT_MEASURED.join(" ")} Machine-readable: <Mono>GET /api/usage</Mono>.
      </div>
    </Panel>
  );
}
