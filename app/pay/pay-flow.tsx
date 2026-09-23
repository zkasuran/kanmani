"use client";

/**
 * Pay a stranger's way to a confirmed Monad transaction, with Mera as the whole account layer.
 *
 * The flow is two taps after the passkey prompt: connect opens a scoped signing session on the
 * account key the passkey derives, then pay signs one EIP-3009 authorization and posts it to the
 * paid endpoint. The facilitator relays it and pays the gas, so the user needs no MON, no seed
 * phrase, no extension and no server-held key. The session signs with no further prompt until its
 * scope expires. The countdown shows exactly when the next action re-prompts.
 *
 * Nothing is stored. Clearing storage and signing in again rebuilds the same account and reopens the
 * same session, which is the stateless test the bounty runs. The readout for that lives on /account.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import type { IrisKeys } from "@/lib/iris.ts";
import {
  connectAndOpenSession,
  isSessionError,
  type ScopedSession,
} from "@/lib/session.ts";
import { payForVerification, verificationPrice, verificationScope, type PayResult } from "@/lib/pay.ts";

/** Five minutes. Long enough to pay a few times, short enough that a walked-away tab stops signing. */
const SESSION_TTL_MS = 5 * 60_000;
/** The ceiling the user agrees to when opening the session. 0.05 USDC covers a handful of checks. */
const SCOPE_MAX_ATOMIC = 50_000n;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PayFlow() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"connect" | "pay" | null>(null);
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  const [session, setSession] = useState<ScopedSession | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<PayResult | null>(null);
  const [note, setNote] = useState<{ kind: "error" | "info"; cause: string; fix?: string } | null>(null);
  const host = useRef("this site");

  useEffect(() => {
    setAvailable(webAuthnAvailable());
    if (typeof window !== "undefined") host.current = window.location.hostname;
  }, []);

  // The countdown and the moment of expiry: once past the deadline the session is done, so the UI
  // drops it and the next connect re-prompts.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const left = session.remainingMs();
      setRemaining(left);
      if (left <= 0) {
        session.end();
        setSession(null);
        setNote({ kind: "info", cause: "The signing session expired. Connect again to open a new one." });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [session]);

  const price = verificationPrice();
  const scope = verificationScope(SCOPE_MAX_ATOMIC, host.current);

  const connect = useCallback(
    async (kind: "create" | "signin") => {
      setBusy("connect");
      setNote(null);
      setResult(null);
      try {
        const { session: opened, keys: derived } = await connectAndOpenSession({
          connect: async () => {
            const outcome: CeremonyOutcome = kind === "create" ? await createAccount("kanmani") : await signIn();
            if (!outcome.ok) throw outcome;
            return outcome.keys;
          },
          scope,
          ttlMs: SESSION_TTL_MS,
        });
        setKeys(derived);
        setSession(opened);
      } catch (e) {
        const o = e as CeremonyOutcome;
        if (o && typeof o === "object" && "cause" in o) {
          setNote({ kind: "error", cause: o.cause, fix: o.fix });
        } else {
          setNote({ kind: "error", cause: (e as Error).message ?? "The passkey ceremony did not complete." });
        }
      } finally {
        setBusy(null);
      }
    },
    [scope],
  );

  const pay = useCallback(async () => {
    if (!session) return;
    setBusy("pay");
    setNote(null);
    setResult(null);
    const trimmed = target.trim();
    // A document URL checks that document, anything else is treated as a claim id already on the
    // site. A URL always takes the paid path, an already-checked claim comes back free.
    const spec = trimmed.startsWith("http") ? { uri: trimmed } : { id: trimmed };
    try {
      const res = await payForVerification({
        session,
        target: spec,
        resourceUrl: typeof window !== "undefined" ? `${window.location.origin}/api/verify` : "/api/verify",
      });
      setResult(res);
      if (!res.ok) setNote({ kind: "info", cause: res.reason });
    } catch (e) {
      if (isSessionError(e) && (e.code === "SESSION_EXPIRED" || e.code === "SESSION_ENDED")) {
        setSession(null);
        setNote({ kind: "info", cause: "The signing session expired mid-action. Connect again to continue." });
      } else if (isSessionError(e) && e.code === "SCOPE_EXCEEDED") {
        setNote({ kind: "error", cause: e.message, fix: "Open a new session with a higher ceiling." });
      } else {
        setNote({ kind: "error", cause: (e as Error).message ?? "The payment did not complete." });
      }
    } finally {
      setBusy(null);
    }
  }, [session, target]);

  return (
    <PayFlowView
      available={available}
      busy={busy}
      keys={keys}
      session={session}
      remaining={remaining}
      target={target}
      setTarget={setTarget}
      result={result}
      note={note}
      price={price}
      onConnect={connect}
      onPay={pay}
      onEnd={() => {
        session?.end();
        setSession(null);
        setNote(null);
      }}
      mmss={mmss}
    />
  );
}

type ViewProps = {
  available: boolean | null;
  busy: "connect" | "pay" | null;
  keys: IrisKeys | null;
  session: ScopedSession | null;
  remaining: number;
  target: string;
  setTarget: (v: string) => void;
  result: PayResult | null;
  note: { kind: "error" | "info"; cause: string; fix?: string } | null;
  price: { atomic: bigint; usdc: string };
  onConnect: (kind: "create" | "signin") => void;
  onPay: () => void;
  onEnd: () => void;
  mmss: (ms: number) => string;
};

const CARD = "rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4";
const STEP = "font-mono text-[11px] uppercase tracking-wide text-faint";

function PayFlowView(p: ViewProps) {
  const connected = p.session !== null;
  const address = p.session?.address ?? p.keys?.account.address ?? null;

  return (
    <div className="space-y-5">
      {p.available === false ? (
        <p className="rounded border border-[var(--color-unknown)]/40 bg-[var(--color-unknown-bg)] p-3 text-[13px] text-[var(--color-unknown)]">
          This browser does not expose WebAuthn to this page. Nothing here will work until it does
          and that is the browser rather than the site.
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- step 1: connect */}
      <section className={CARD}>
        <p className={STEP}>step 1 &middot; one passkey prompt</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => p.onConnect("create")}
            disabled={p.busy !== null || p.available === false}
            className="rounded border border-[var(--color-brand)] bg-[var(--color-brand-dim)]/25 px-4 py-2 font-mono text-[13px] hover:bg-[var(--color-brand-dim)]/40 disabled:opacity-40"
          >
            {p.busy === "connect" ? "waiting for the prompt…" : "connect a new passkey"}
          </button>
          <button
            onClick={() => p.onConnect("signin")}
            disabled={p.busy !== null || p.available === false}
            className="rounded border border-[var(--color-line-bright)] px-4 py-2 font-mono text-[13px] text-muted hover:text-[var(--color-text)] disabled:opacity-40"
          >
            {p.busy === "connect" ? "…" : "sign in with an existing one"}
          </button>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Connect opens a signing session on the account key the passkey derives. No seed phrase, no
          extension, no wallet popup. Signing in on a fresh browser or a second device reaches the
          same account, because the key comes from the passkey rather than from anything stored here.
        </p>
      </section>

      {/* ---------------------------------------------------------------- the session */}
      {connected && p.session ? (
        <section className={`${CARD} border-[var(--color-brand)]/40`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={STEP}>signing session, open</p>
            <span className="font-mono text-[12px] text-faint">
              re-prompts in <span className="text-[var(--color-text)]">{p.mmss(p.remaining)}</span>
            </span>
          </div>
          <p className="mt-3 text-[13.5px] leading-relaxed">{p.session.scope.label}</p>
          <dl className="mt-3 space-y-1 font-mono text-[12px] text-muted">
            <div className="flex gap-2">
              <dt className="text-faint">account</dt>
              <dd className="break-all">{address}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-faint">ceiling</dt>
              <dd>{p.session.scope.maxAmountAtomic.toString()} atomic units</dd>
            </div>
          </dl>
          <button
            onClick={p.onEnd}
            className="mt-3 rounded border border-[var(--color-line-bright)] px-3 py-1.5 font-mono text-[12px] text-muted hover:text-[var(--color-text)]"
          >
            end session now
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            The session key lives in this tab and is zeroed on expiry or when you end it. The next
            action after that re-runs the one-prompt ceremony.
          </p>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- step 2: pay */}
      <section className={CARD}>
        <p className={STEP}>step 2 &middot; pay {p.price.usdc} USDC, gasless</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={p.target}
            onChange={(e) => p.setTarget(e.target.value)}
            placeholder="a claim id or a document URL to check"
            className="min-w-[16rem] flex-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-line-bright)]"
          />
          <button
            onClick={p.onPay}
            disabled={!connected || p.busy !== null || p.target.trim() === ""}
            className="rounded border border-[var(--color-brand)] bg-[var(--color-brand-dim)]/25 px-4 py-2 font-mono text-[13px] hover:bg-[var(--color-brand-dim)]/40 disabled:opacity-40"
          >
            {p.busy === "pay" ? "signing and settling…" : `pay ${p.price.usdc} and verify`}
          </button>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          The session signs one EIP-3009 authorization with no prompt. The facilitator relays it and
          pays the gas, so your account never needs MON. Your account does need the {p.price.usdc}{" "}
          USDC it is paying, so fund the address above before the first paid check. A claim already
          checked comes back free, a document URL is fetched and settled on chain.
        </p>
      </section>

      {/* ---------------------------------------------------------------- the result */}
      {p.result?.ok && p.result.settlement.settled && p.result.settlement.transaction ? (
        <section className={`${CARD} border-[var(--color-true)]/40`}>
          <p className="font-mono text-[12px] text-[var(--color-true)]">settled on Monad</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            One transaction, signed by the passkey account, relayed and paid for by the facilitator.
          </p>
          <a
            href={p.result.settlement.txUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block break-all font-mono text-[12px] text-[var(--color-brand)] hover:underline"
          >
            {p.result.settlement.transaction}
          </a>
        </section>
      ) : p.result?.ok && p.result.settlement.paid === false ? (
        <section className={CARD}>
          <p className="font-mono text-[12px] text-faint">free, already checked</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            This claim is already in the index with a recorded verdict, so nothing was fetched and
            nothing was charged. Check a document URL to exercise a paid on-chain settlement.
          </p>
        </section>
      ) : p.result?.ok && !p.result.settlement.settled ? (
        <section className={CARD}>
          <p className="font-mono text-[12px] text-[var(--color-unknown)]">verified, not settled</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            The payment was accepted and the check ran. Settlement did not confirm, which is reported
            rather than hidden. The authorization is still yours to spend.
          </p>
        </section>
      ) : null}

      {p.note ? (
        <section
          className={`${CARD} ${
            p.note.kind === "error" ? "border-[var(--color-false)]/40" : "border-[var(--color-unknown)]/40"
          }`}
        >
          <p className="text-[13.5px] leading-relaxed">{p.note.cause}</p>
          {p.note.fix ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              <span className="text-[var(--color-text)]">What to do:</span> {p.note.fix}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- stateless footer */}
      <p className="max-w-3xl text-[12.5px] leading-relaxed text-faint">
        Nothing on this page is stored. Clear local storage, close the tab, open a fresh profile,
        then sign in again with the same passkey and the account and the session come back the same.{" "}
        <Link href="/account" className="text-[var(--color-brand)] hover:underline">
          The live storage readout is on the account page →
        </Link>
      </p>
    </div>
  );
}

