import Link from "next/link";
import { txUrl } from "@/lib/chains.ts";
import { COMPOSE, type ComposeRow } from "@/lib/compose.ts";

/**
 * The stack, each layer linked to the Monad mainnet transaction that proves it runs.
 *
 * Distinct from the homepage `STACK`/`Proof` on purpose: same on-chain facts, a different frame. Here
 * the point is composability, that the four pieces fit together and each one is load-bearing. Every
 * live row links the real tx through the shared `txUrl`, so the explorer base is single-sourced. The
 * Mera-account row is hollow until plan 1.5 fills its hash, which keeps the panel honest at three of
 * four rather than drawing a dead link.
 */
export function ComposabilityPanel() {
  const live = COMPOSE.filter((r) => r.txHash !== null).length;
  return (
    <section className="elevated overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-panel-2)]/40 px-5 py-3.5">
        <h2 className="font-mono text-sm tracking-tight text-[var(--color-text)]">
          one stack, {live} of {COMPOSE.length} pieces live on Monad mainnet
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Mera account, x402 upto, Aqueous escrow and the AgentPasskey precompile. Each row links the
          transaction that proves the piece runs on chain 143. On the upto and escrow runs the payer
          and the payee are both the house wallet, so these prove the machinery, not that a stranger
          paid us.
        </p>
      </header>
      <ol className="divide-y divide-[var(--color-line)]/60">
        {COMPOSE.map((row) => (
          <ComposeRowView key={row.name} row={row} />
        ))}
      </ol>
    </section>
  );
}

function ComposeRowView({ row }: { row: ComposeRow }) {
  const live = row.txHash !== null;
  const href = live ? txUrl(row.chainId, row.txHash!) : null;
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span
          className={`h-2 w-2 shrink-0 self-center rounded-full ${
            live ? "bg-[var(--color-true)]" : "border border-[var(--color-unknown)] bg-transparent"
          }`}
        />
        <span className="text-[14px] font-semibold tracking-tight text-[var(--color-text)]">{row.name}</span>
        <span className="font-mono text-[11px] text-[var(--color-brand)]">{row.codename}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted">{row.why}</p>
      {live && href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-[11.5px] text-[var(--color-brand)] ilink"
        >
          {row.txHash}
        </a>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-[var(--color-unknown)]/40 bg-[var(--color-unknown-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-unknown)]">
            pending, fund to activate
          </span>
          {row.href ? (
            <>
              <Link href={row.href} className="font-mono text-[11.5px] text-[var(--color-brand)] ilink">
                {row.href}
              </Link>
              <Link href="/account" className="font-mono text-[11.5px] text-[var(--color-brand)] ilink">
                /account
              </Link>
            </>
          ) : null}
        </div>
      )}
      {row.contract ? (
        <p className="font-mono text-[11px] text-faint">contract {row.contract}</p>
      ) : null}
    </li>
  );
}
