import Link from "next/link";
import { Mono, PageHeader, Panel, StatTile } from "@/components/ui.tsx";
import { bondsFor, usdc } from "@/lib/bonds.ts";
import OUTREACH from "@/docs/outreach.json" with { type: "json" };
import TRACTION from "@/docs/traction.json" with { type: "json" };

/** Bond state is read from Sclera on every load. Everything else comes from the two docs files. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "With other teams",
  description:
    "Every project Kanmani has contacted, what was offered, what came back and the Monad mainnet transactions behind each settled case. Bond state read live from Sclera.",
};

type Evidence = { label: string; url: string };
type Contact = {
  project: string;
  repo: string | null;
  number?: number;
  date: string;
  offered: string;
  outcome: string;
  result: string | null;
  evidence: Evidence[];
  buyer: string | null;
  bondAsk?: { agents: number[]; url: string; sent?: string };
};
type Live = { project: string; status: string; replies: number | null; url: string | null; pr: { number: number; state: string; url: string } | null };

const contacts = (OUTREACH as { contacts: Contact[] }).contacts;
const live = TRACTION as { generatedAt: string; counts: { contacted: number; replied: number; settled: number; outsideBuyer: number; weBought: number }; rows: Live[] };
const statusOf = (p: string) => live.rows.find((r) => r.project === p);

/**
 * The Dissent case, step by step. These are fixed facts on chain 143, so they are typed here
 * rather than fetched. Each one links the explorer, where a reader can check it in one click.
 */
const DISSENT: { step: string; who: "ours" | "theirs"; tx: string; what: string }[] = [
  { step: "0", who: "ours", tx: "0x6a9ffa61a411edcf6248c139c90ae55263f82a52ded1622122411d82f0e4be39", what: "agent tops up the buyer's gas, 0.1 MON" },
  { step: "2", who: "ours", tx: "0x4284ed5b816aa0ca6dad02a7105f9c3c7e9ff67851427577a9e917abece45087", what: "buyer approves 0.10 USDC to Aqueous" },
  { step: "3", who: "ours", tx: "0xc8b31057c9b5735021f9e32e17b7fafb4de24bcdb3c94580ceef218427d4e2ee", what: "buyer opens the flat job" },
  { step: "4", who: "ours", tx: "0xc6cb96c6e8d7b7d81193ffe6b94faaf743c6c89ffceb4775115a23ba1a9b1ee9", what: "agent commits a 0.75 MON bounty: no job of ours is paid out before delivery" },
  { step: "5", who: "ours", tx: "0x654e8d70f57fa6640eecb893cbf5f737a113db4bea7c4447f02acb10b2e9e91e", what: "buyer releases early, with no delivery recorded" },
  { step: "6", who: "theirs", tx: "0x1f514e1254f47bc5947f4c9eb86f609013ab38d0d3db567fba59dde7bd502758", what: "challenger seals, 0.1 MON deposit" },
  { step: "7", who: "theirs", tx: "0x005fafd9cd2dac481ce8bcfab5b44b00bca1e4d429b3d673bc35e703a48e6f42", what: "challenger reveals: ChallengeSucceeded, 1 against a threshold of 0" },
  { step: "8", who: "theirs", tx: "0x76525e54404a680d50e1ecdf7f3e0c4836684eb5831c98da7fcdcda92b42be53", what: "challenger withdraws 0.85 MON, the bounty plus the deposit" },
];

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const ext = { target: "_blank", rel: "noreferrer noopener" } as const;
const linkCls = "text-[var(--color-brand)] hover:underline";

export default async function Traction() {
  const asks = contacts.filter((c) => c.bondAsk);
  const askIds = asks.flatMap((c) => c.bondAsk!.agents);
  const bonds = await bondsFor(askIds);
  const posted = askIds.filter((id) => bonds.has(id)).length;
  const c = live.counts;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="with other teams · monad mainnet"
        title="Who we have worked with. What moved on chain."
        lead={
          <>
            Every project we have contacted, what we offered and what came back. Reply counts are read from GitHub by{" "}
            <Mono>node scripts/outreach-status.mjs</Mono>, last run {live.generatedAt}. Paid work links the transaction. Work we paid for
            is kept apart from work somebody paid us for, because only the second is demand that is not ours.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="projects contacted" value={c.contacted} />
        <StatTile label="replied or acted" value={c.replied} tone="brand" />
        <StatTile label="settled on chain" value={c.settled} tone="true" />
        <StatTile label="an outside buyer paid our agents" value={c.outsideBuyer} />
        <StatTile label="outside bonds posted, read live" value={posted} hint={`of ${askIds.length} agents asked`} tone={posted ? "true" : "unknown"} />
      </div>

      <Panel
        id="dissent"
        title="dissent · a broken rule paid out by contract, two parties, live"
        subtitle={
          <>
            10 October 2026. Dissent pays a challenger who proves an agent broke a rule it committed to. We wrote the rule for our
            escrow and Dissent merged it after review. Then we ran it live with their curator, each side signing its own steps. It
            was a coordinated early release by one operator, labelled as such by both sides. It was not a discovered exploit and not
            agent misconduct.
          </>
        }
      >
        <ol className="space-y-1.5">
          {DISSENT.map((s) => (
            <li key={s.tx} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
              <Mono className="w-5 shrink-0 text-muted">{s.step}</Mono>
              <span className={`w-14 shrink-0 font-mono text-[11.5px] ${s.who === "ours" ? "text-muted" : "text-[var(--color-brand)]"}`}>{s.who}</span>
              <a href={`https://monadvision.com/tx/${s.tx}`} {...ext} className={`font-mono text-[12.5px] ${linkCls}`}>
                {short(s.tx)}
              </a>
              <span className="text-[var(--color-text)]">{s.what}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Nobody adjudicated anything. The recomputer read the job back from Aqueous, counted one payout before delivery against a
          claim of at most zero. The contract then paid the challenger from our own bounty. Their curator confirmed every receipt{" "}
          <a href="https://github.com/alnitak34/dissent/pull/7#issuecomment-6094099779" {...ext} className={linkCls}>
            in the thread
          </a>
          . Recomputer <Mono>0x4d1A…8457</Mono>, verified on{" "}
          <a href="https://sourcify.dev/#/lookup/0x4d1A62869D16AB2Bac95408445129C4927f88457" {...ext} className={linkCls}>
            Sourcify
          </a>
          .
        </p>
      </Panel>

      <Panel
        id="bonds"
        title={`bonds asked of other teams · ${posted} of ${askIds.length} posted`}
        subtitle={
          <>
            We asked every partner with an ERC-8004 agent on Monad to stake on <Link href="/bond" className={linkCls}>Sclera</Link>. Where an
            owner held no USDC we sent it first, so posting costs them gas only. State is read from the contract on every load, so
            this line changes the moment one lands.
          </>
        }
      >
        <div className="space-y-px">
          {asks.flatMap((a) =>
            a.bondAsk!.agents.map((id) => {
              const b = bonds.get(id);
              return (
                <div key={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-2 text-[13px]">
                  <Link href={`/agent/${id}`} className={`w-16 shrink-0 font-mono ${linkCls}`}>
                    #{id}
                  </Link>
                  <span className="w-44 shrink-0 text-[var(--color-text)]">{a.project.split(" (")[0]}</span>
                  {b ? (
                    <span className="font-mono text-[12.5px] text-[var(--color-true)]">
                      {b.state} · {usdc(b.amountAtomic)} USDC · floor {(b.minTruthRateBps / 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="font-mono text-[12.5px] text-[var(--color-unknown)]">asked, not posted</span>
                  )}
                  <a href={a.bondAsk!.url} {...ext} className={`text-[12px] ${linkCls}`}>
                    the ask
                  </a>
                  {a.bondAsk!.sent ? (
                    <a href={`https://monadvision.com/tx/${a.bondAsk!.sent.split("tx ")[1]}`} {...ext} className={`text-[12px] ${linkCls}`}>
                      {a.bondAsk!.sent.split(",")[0]}
                    </a>
                  ) : null}
                </div>
              );
            }),
          )}
        </div>
      </Panel>

      <Panel title={`every contact · ${contacts.length}`} subtitle="Newest first. Status is GitHub's, not ours: whether a thread has a reply and who spoke last.">
        <div className="space-y-5">
          {[...contacts].sort((x, y) => y.date.localeCompare(x.date)).map((x) => {
            const s = statusOf(x.project);
            return (
              <article key={x.project} className="border-t border-[var(--color-line)] pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-[14px] font-semibold text-[var(--color-text)]">{x.project}</h3>
                  <Mono className="text-[11.5px] text-muted">{x.date}</Mono>
                  {s?.url ? (
                    <a href={s.url} {...ext} className={`font-mono text-[11.5px] ${linkCls}`}>
                      {x.repo}#{x.number}
                    </a>
                  ) : (
                    <span className="font-mono text-[11.5px] text-muted">direct</span>
                  )}
                  <span className={`font-mono text-[11.5px] ${x.outcome === "settled" ? "text-[var(--color-true)]" : "text-muted"}`}>
                    {s?.status ?? x.outcome}
                    {s?.replies != null ? ` · ${s.replies} repl${s.replies === 1 ? "y" : "ies"}` : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                  <span className="text-[var(--color-text)]">Offered:</span> {x.offered}
                </p>
                {x.result ? <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{x.result}</p> : null}
                {x.evidence.length || s?.pr ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                    {s?.pr ? (
                      <a href={s.pr.url} {...ext} className={linkCls}>
                        PR #{s.pr.number}, {s.pr.state}
                      </a>
                    ) : null}
                    {x.evidence.map((e) => (
                      <a key={e.url} href={e.url} {...ext} className={linkCls}>
                        {e.label}
                      </a>
                    ))}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
