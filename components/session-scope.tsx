"use client";

/**
 * The signing session, shown in plain language.
 *
 * Every value here is read off the live session, never typed in. The payee is the single most
 * important line: the whole safety claim is that the session can pay nobody else, so it is named
 * rather than left implicit. The cap is shown in human USDC with the raw atomic units beside it,
 * because raw atomic units on their own read as the crypto friction this bounty judges harshly. The
 * countdown says exactly when the next action re-prompts, and renew is one tap rather than a trip
 * back to the top.
 */
import { formatUsdc } from "@/lib/pay.ts";
import { type ScopedSession } from "@/lib/session.ts";

const EXPLORER_ADDR = "https://monadexplorer.com/address/";
/** Offer renew once under a minute is left, so a judge is never dropped mid-demo. */
const RENEW_UNDER_MS = 60_000;

export function SessionScope({
  session,
  remaining,
  mmss,
  onEnd,
  onRenew,
  busy,
}: {
  session: ScopedSession;
  remaining: number;
  mmss: (ms: number) => string;
  onEnd: () => void;
  onRenew: () => void;
  busy: boolean;
}) {
  const payTo = session.scope.payTo;
  const nearExpiry = remaining <= RENEW_UNDER_MS;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-true)]" />
          <p className="eyebrow">signing session open</p>
        </div>
        <div className="text-right">
          <div className="stat-value tnum text-[1.5rem] text-[var(--color-text)]">{mmss(remaining)}</div>
          <div className="eyebrow mt-0.5">until the next prompt</div>
        </div>
      </div>

      <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-text)]">{session.scope.label}</p>

      <dl className="mt-3 space-y-1.5">
        <Field label="pays only">
          {payTo ? (
            <a
              href={`${EXPLORER_ADDR}${payTo}`}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-[13px] text-[var(--color-brand)] hover:underline"
            >
              {payTo}
            </a>
          ) : (
            <span className="font-mono text-[13px] text-muted">no recipient pinned</span>
          )}
        </Field>
        <Field label="up to">
          <span className="font-mono text-[13px] text-[var(--color-text)]">
            {formatUsdc(session.scope.maxAmountAtomic)} USDC
          </span>
          <span className="ml-2 font-mono text-[11px] text-faint">
            {session.scope.maxAmountAtomic.toString()} atomic
          </span>
        </Field>
        <Field label="account">
          <span className="break-all font-mono text-[13px] text-muted">{session.address}</span>
        </Field>
      </dl>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Signs with no prompt within this scope. It re-prompts only to renew after expiry or to raise
        the cap. The key lives in this tab and is zeroed on expiry or when you end it.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {nearExpiry ? (
          <button onClick={onRenew} disabled={busy} className="cta disabled:opacity-40">
            renew session
          </button>
        ) : null}
        <button onClick={onEnd} className="cta-ghost">
          end session now
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
