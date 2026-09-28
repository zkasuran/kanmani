import Link from "next/link";

import type { HeroSubject } from "@/lib/queries.ts";

/**
 * The product, in the hero, instead of an illustration.
 *
 * landing.md asks for the live product beside the headline and a judge reading the first screen should
 * see what Kanmani actually does to a real agent rather than a rotating emblem. This is one agent's
 * verdict as the site computed it: its claims split into on the named chain, a real payment on a
 * different chain and on no chain at all, with one concrete example and the block it was read at.
 *
 * Server-rendered and complete, so it is correct in a preview, a screenshot and with JavaScript off.
 * The only motion is the bar segments growing from their start on the hero's own entrance, which ends
 * at their true widths. If the subject query returns nothing, the caller renders no card at all rather
 * than a placeholder with invented numbers.
 */
export function VerdictCard({ s }: { s: HeroSubject }) {
  const total = s.onNamed + s.elsewhere + s.nowhere;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const name = s.name ?? "unnamed";

  return (
    <Link href={`/agent/${s.agentId}`} className="vcard hero__visual" aria-label={`Agent ${s.agentId}: ${s.elsewhere} of ${total} payment claims are real payments on a different chain. Open the agent.`}>
      <div className="vcard__top">
        <span className="vcard__live" aria-hidden="true" />
        <span className="vcard__kicker">live verdict · monad mainnet</span>
      </div>

      <div className="vcard__id">
        <span className="vcard__num">#{s.agentId}</span>
        <span className="vcard__name">{name}</span>
      </div>

      <p className="vcard__headline">
        <span className="vcard__big">{s.elsewhere}</span>
        <span>
          of {total} payment claims are <b>real payments</b> on a different chain
        </span>
      </p>

      <div className="vcard__bar" role="img" aria-label={`${s.onNamed} on the named chain, ${s.elsewhere} on a different chain, ${s.nowhere} on no chain`}>
        {s.onNamed > 0 ? <span className="vcard__seg vcard__seg--true" style={{ width: pct(s.onNamed), ["--i" as string]: 0 }} /> : null}
        <span className="vcard__seg vcard__seg--brand" style={{ width: pct(s.elsewhere), ["--i" as string]: 1 }} />
        {s.nowhere > 0 ? <span className="vcard__seg vcard__seg--false" style={{ width: pct(s.nowhere), ["--i" as string]: 2 }} /> : null}
      </div>
      <ul className="vcard__legend">
        <li><i className="vcard__dot vcard__dot--true" />{s.onNamed} named chain</li>
        <li><i className="vcard__dot vcard__dot--brand" />{s.elsewhere} other chain</li>
        <li><i className="vcard__dot vcard__dot--false" />{s.nowhere} no chain</li>
      </ul>

      {s.example ? (
        <div className="vcard__example">
          <div className="vcard__row">
            <span>document says</span>
            <code>{s.example.declared ?? "no chain"}</code>
          </div>
          <div className="vcard__row">
            <span>transaction is on</span>
            <code className="vcard__found">
              {s.example.foundChain} · block {Number(s.example.foundBlock).toLocaleString("en-US")}
            </code>
          </div>
        </div>
      ) : null}

      <span className="vcard__cta">one field to fix, not a fake payment →</span>
    </Link>
  );
}
