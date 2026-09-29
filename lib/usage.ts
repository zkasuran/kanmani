/**
 * Who uses Kanmani, as far as it can be known without tracking anyone. Read by /api/usage and /status.
 *
 * Three kinds of evidence, strongest first:
 *   on chain   events on our contracts by addresses that are not ours. Anyone can re-derive these.
 *   built      agents registered on chain with a URI our registration check produced.
 *   requests   daily counts from the access log: per surface, per client class, distinct clients.
 *
 * Every figure comes with how it was measured. A table that cannot be read returns null, which the
 * page renders as unknown, never as zero.
 */
import { CHAIN_ID, q } from "./db.ts";

export type Usage = {
  window: { from: string; to: string; days: number } | null;
  requests: { surface: string; class: string; calls: number; clientDays: number }[] | null;
  people: { visitorDays: number; pageViews: number } | null;
  integrators: { kind: string; name: string; calls: number; days: number }[] | null;
  mcpTools: { name: string; calls: number }[] | null;
  onchain: {
    byContract: { contract: string; event: string; ours: number; others: number }[];
    others: { tx: string; block: number; contract: string; event: string; actor: string; agentId: string | null }[];
    scannedTo: Record<string, number>;
  } | null;
  built: { checked: number; registered: number; registeredByOthers: number } | null;
};

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

export async function usage(days = 7): Promise<Usage> {
  const since = `now()::date - ${Math.max(1, Math.min(days, 60)) - 1}`;
  const [win, req, ppl, integ, tools, oc, ocOthers, cursors, built] = await Promise.all([
    safe(() => q<{ f: string; t: string; n: string }>(`SELECT min(day)::text f, max(day)::text t, count(DISTINCT day) n FROM fovea.usage_daily WHERE day >= ${since}`)),
    safe(() => q<{ surface: string; class: string; calls: string; clients: string }>(`SELECT surface, class, sum(calls) calls, sum(clients) clients FROM fovea.usage_daily WHERE day >= ${since} GROUP BY 1,2 ORDER BY 3 DESC`)),
    safe(() => q<{ v: string; p: string }>(`SELECT coalesce(sum(clients),0) v, coalesce(sum(calls),0) p FROM fovea.usage_daily WHERE day >= ${since} AND surface = 'page' AND class = 'browser'`)),
    safe(() => q<{ kind: string; name: string; calls: string; days: string }>(`SELECT kind, name, sum(calls) calls, count(DISTINCT day) days FROM fovea.usage_integrator WHERE day >= ${since} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`)),
    safe(() => q<{ name: string; calls: string }>(`SELECT name, sum(calls) calls FROM fovea.usage_event WHERE day >= ${since} GROUP BY 1 ORDER BY 2 DESC`)),
    safe(() => q<{ contract: string; event: string; ours: string; others: string }>(`SELECT contract, event, count(*) FILTER (WHERE ours) ours, count(*) FILTER (WHERE NOT ours) others FROM fovea.onchain_use GROUP BY 1,2 ORDER BY 1,2`)),
    safe(() => q<{ tx: string; block: string; contract: string; event: string; actor: string; agent_id: string | null }>(`SELECT tx, block, contract, event, actor, agent_id FROM fovea.onchain_use WHERE NOT ours ORDER BY block DESC LIMIT 50`)),
    safe(() => q<{ name: string; block: string }>(`SELECT name, block FROM fovea.usage_cursor`)),
    safe(() =>
      q<{ checked: string; registered: string; others: string }>(
        `SELECT (SELECT count(*) FROM fovea.build_uri) checked,
                count(a.id) registered,
                count(a.id) FILTER (WHERE lower(a.owner) <> '0xdb6c6340342e71a63cd11ebac2185204b7777777') others
           FROM fovea.build_uri b
           JOIN "Agent" a ON a."chainId" = $1 AND a."tokenUri" IS NOT NULL
                         AND encode(sha256(convert_to(a."tokenUri", 'UTF8')), 'hex') = b.uri_sha256`,
        [CHAIN_ID],
      ),
    ),
  ]);
  const w = win?.[0];
  return {
    window: w && w.f ? { from: w.f, to: w.t, days: Number(w.n) } : null,
    requests: req ? req.map((r) => ({ surface: r.surface, class: r.class, calls: Number(r.calls), clientDays: Number(r.clients) })) : null,
    people: ppl?.[0] ? { visitorDays: Number(ppl[0].v), pageViews: Number(ppl[0].p) } : null,
    integrators: integ ? integ.map((r) => ({ kind: r.kind, name: r.name, calls: Number(r.calls), days: Number(r.days) })) : null,
    mcpTools: tools ? tools.map((r) => ({ name: r.name.replace(/^mcp:tool:/, ""), calls: Number(r.calls) })) : null,
    onchain:
      oc && ocOthers && cursors
        ? {
            byContract: oc.map((r) => ({ contract: r.contract, event: r.event, ours: Number(r.ours), others: Number(r.others) })),
            others: ocOthers.map((r) => ({ tx: r.tx, block: Number(r.block), contract: r.contract, event: r.event, actor: r.actor, agentId: r.agent_id })),
            scannedTo: Object.fromEntries(cursors.map((c) => [c.name, Number(c.block)])),
          }
        : null,
    built: built?.[0] ? { checked: Number(built[0].checked), registered: Number(built[0].registered), registeredByOthers: Number(built[0].others) } : null,
  };
}

export const NOT_MEASURED = [
  "Who anyone is. No IP, user agent string or cookie is stored; distinct clients are salted hashes that are unlinkable across days.",
  "Use that never reaches us: someone reading a copy of our data or running the verifier from the repo.",
  "Sites that embed us with a no-referrer policy: their calls count, their name does not.",
  "Registrations built with the studio or the API and then edited before sending: the URI no longer matches.",
  "Self-traffic from our own tests is excluded only where it runs in a headless browser; our own curl calls count as software.",
];
