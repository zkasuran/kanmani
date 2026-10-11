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
import type { PayNetName } from "@/lib/pay-net.ts";
import { SessionScope } from "@/components/session-scope.tsx";
import { PayMeasure, type PayMeasureHandle } from "@/components/pay-measure.tsx";

/** Five minutes. Long enough to pay a few times, short enough that a walked-away tab stops signing. */
const SESSION_TTL_MS = 5 * 60_000;
/** The ceiling the user agrees to when opening the session. 0.05 USDC covers a handful of checks. */
const SCOPE_MAX_ATOMIC = 50_000n;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PayFlow({ net = "mainnet" }: { net?: PayNetName }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"connect" | "pay" | null>(null);
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  const [session, setSession] = useState<ScopedSession | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<PayResult | null>(null);
  const [note, setNote] = useState<{ kind: "error" | "info"; cause: string; fix?: string } | null>(null);
  const [funding, setFunding] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const host = useRef("this site");
  const measure = useRef<PayMeasureHandle>(null);

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
        setExpired(true);
        setNote({ kind: "info", cause: "The signing session expired. Renew it to carry on without going back to the top." });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [session]);

  const price = verificationPrice(net);
  const scope = verificationScope(SCOPE_MAX_ATOMIC, host.current, net);

  /** Testnet only: the house mints a little tUSDC to the new account so the judge funds nothing. */
  const sponsorMint = useCallback(async (address: `0x${string}`) => {
    setFunding({ kind: "info", text: "funding this account with testnet tUSDC, on the house…" });
    try {
      const r = await fetch("/api/testnet/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.data) {
        setFunding({
          kind: "ok",
          text: j.data.minted
            ? "funded by the house, testnet only. This account can pay now with no funding step."
            : "already funded. This account can pay now with no funding step.",
        });
      } else {
        setFunding({ kind: "error", text: j?.detail ?? "the sponsored mint is not available right now." });
      }
    } catch (e) {
      setFunding({ kind: "error", text: (e as Error).message });
    }
  }, []);

  const connect = useCallback(
    async (kind: "create" | "signin") => {
      setBusy("connect");
      setNote(null);
      setResult(null);
      setFunding(null);
      setExpired(false);
      try {
        const { session: opened, keys: derived } = await connectAndOpenSession({
          connect: async () => {
            measure.current?.onCeremony();
            const outcome: CeremonyOutcome = kind === "create" ? await createAccount("kanmani") : await signIn();
            if (!outcome.ok) throw outcome;
            return outcome.keys;
          },
          scope,
          ttlMs: SESSION_TTL_MS,
        });
        setKeys(derived);
        setSession(opened);
        if (net === "testnet") void sponsorMint(derived.account.address);
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
    [scope, net, sponsorMint],
  );

  /** One sign-in ceremony reopens a session with the same scope, so expiry is one tap not a restart. */
  const renew = useCallback(async () => {
    setBusy("connect");
    setNote(null);
    try {
      const { session: opened, keys: derived } = await connectAndOpenSession({
        connect: async () => {
          measure.current?.onCeremony();
          const outcome = await signIn();
          if (!outcome.ok) throw outcome;
          return outcome.keys;
        },
        scope,
        ttlMs: SESSION_TTL_MS,
      });
      setKeys(derived);
      setSession(opened);
      setExpired(false);
    } catch (e) {
      const o = e as CeremonyOutcome;
      setNote({ kind: "error", cause: o && typeof o === "object" && "cause" in o ? o.cause : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, [scope]);

  const pay = useCallback(async () => {
    if (!session) return;
    setBusy("pay");
    setNote(null);
    setResult(null);
    const trimmed = target.trim();
    // Testnet always takes the paid path against the testnet verifier, defaulting to a self-contained
    // demo document when no URL is given. Mainnet treats a URL as a document and anything else as a
    // claim id already on the site.
    const spec =
      net === "testnet"
        ? { uri: trimmed.startsWith("http") ? trimmed : "" }
        : trimmed.startsWith("http")
          ? { uri: trimmed }
          : { id: trimmed };
    const endpoint = net === "testnet" ? "/api/testnet/verify" : "/api/verify";
    try {
      const res = await payForVerification({
        session,
        target: spec,
        endpoint,
        resourceUrl: typeof window !== "undefined" ? `${window.location.origin}${endpoint}` : endpoint,
        net,
      });
      setResult(res);
      if (res.ok && res.settlement.settled && res.settlement.transaction) {
        measure.current?.onReceipt(res.settlement);
      }
      if (!res.ok) setNote({ kind: "info", cause: res.reason });
    } catch (e) {
      // A mid-action expiry becomes a one-tap renew rather than a trip back to the top.
      if (isSessionError(e) && (e.code === "SESSION_EXPIRED" || e.code === "SESSION_ENDED")) {
        setSession(null);
        setExpired(true);
        setNote({ kind: "info", cause: "The signing session expired mid-action. Renew it and pay again." });
      } else if (isSessionError(e) && e.code === "SCOPE_EXCEEDED") {
        setNote({ kind: "error", cause: e.message, fix: "Open a new session with a higher ceiling." });
      } else {
        setNote({ kind: "error", cause: (e as Error).message ?? "The payment did not complete." });
      }
    } finally {
      setBusy(null);
    }
  }, [session, target, net]);

  return (
    <PayFlowView
      net={net}
      available={available}
      busy={busy}
      keys={keys}
      session={session}
      remaining={remaining}
      target={target}
      setTarget={setTarget}
      result={result}
      note={note}
      funding={funding}
      price={price}
      expired={expired}
      measureRef={measure}
      onConnect={connect}
      onRenew={renew}
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
  net: PayNetName;
  available: boolean | null;
  busy: "connect" | "pay" | null;
  keys: IrisKeys | null;
  session: ScopedSession | null;
  remaining: number;
  target: string;
  setTarget: (v: string) => void;
  result: PayResult | null;
  note: { kind: "error" | "info"; cause: string; fix?: string } | null;
  funding: { kind: "ok" | "info" | "error"; text: string } | null;
  price: { atomic: bigint; usdc: string };
  expired: boolean;
  measureRef: React.RefObject<PayMeasureHandle | null>;
  onConnect: (kind: "create" | "signin") => void;
  onRenew: () => void;
  onPay: () => void;
  onEnd: () => void;
  mmss: (ms: number) => string;
};

const CARD = "elevated panel-hover rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5";
const STEP = "eyebrow";

function PayFlowView(p: ViewProps) {
  const connected = p.session !== null;

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
            className="cta disabled:opacity-40"
          >
            {p.busy === "connect" ? "waiting for the prompt…" : "connect a new passkey"}
          </button>
          <button
            onClick={() => p.onConnect("signin")}
            disabled={p.busy !== null || p.available === false}
            className="cta-ghost disabled:opacity-40"
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

      {/* ---------------------------------------------------------------- the session, in plain language */}
      {connected && p.session ? (
        <section className={`${CARD} border-[var(--color-brand)]/40`}>
          <SessionScope
            session={p.session}
            remaining={p.remaining}
            mmss={p.mmss}
            onEnd={p.onEnd}
            onRenew={p.onRenew}
            busy={p.busy !== null}
          />
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- expired: renew in one tap */}
      {!p.session && p.expired ? (
        <section className={`${CARD} border-[var(--color-unknown)]/40`}>
          <p className="eyebrow">session expired</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            The signing session ended, which is the safe default for a key held in memory. Renew runs
            one sign-in and reopens the same scope. Nothing was lost, the account comes back from the
            passkey.
          </p>
          <button onClick={p.onRenew} disabled={p.busy !== null} className="cta mt-3 disabled:opacity-40">
            {p.busy === "connect" ? "waiting for the prompt…" : "renew session"}
          </button>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- testnet: funded by the house */}
      {p.net === "testnet" && p.funding ? (
        <section
          className={`${CARD} ${
            p.funding.kind === "error"
              ? "border-[var(--color-false)]/40"
              : p.funding.kind === "ok"
                ? "border-[var(--color-true)]/40"
                : "border-[var(--color-unknown)]/40"
          }`}
        >
          <p className="eyebrow">testnet, free judge path</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">{p.funding.text}</p>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- step 2: pay */}
      <section className={CARD}>
        <p className={STEP}>
          step 2 &middot; pay {p.price.usdc} {p.net === "testnet" ? "tUSDC" : "USDC"}, gasless
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={p.target}
            onChange={(e) => p.setTarget(e.target.value)}
            placeholder={p.net === "testnet" ? "optional document URL, or leave blank for the demo" : "a claim id or a document URL to check"}
            className="min-w-[16rem] flex-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-line-bright)]"
          />
          <button
            onClick={p.onPay}
            disabled={!connected || p.busy !== null || (p.net !== "testnet" && p.target.trim() === "")}
            className="cta disabled:opacity-40"
          >
            {p.busy === "pay" ? "signing and settling…" : `pay ${p.price.usdc} and verify`}
          </button>
        </div>
        {p.net === "testnet" ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            The session signs one EIP-3009 authorization with no prompt. The facilitator relays it and
            pays the gas, and the house minted the tUSDC above, so a brand-new passkey reaches a
            confirmed testnet transaction with zero funding steps. Leave the box blank for a
            self-contained demo document.
          </p>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            The session signs one EIP-3009 authorization with no prompt. The facilitator relays it and
            pays the gas, so your account never needs MON. Your account does need the {p.price.usdc}{" "}
            USDC it is paying, so fund the address above before the first paid check. A claim already
            checked comes back free, a document URL is fetched and settled on chain.
          </p>
        )}
        {/* Taps and seconds, measured on this page. The widget holds the counters and the aggregate. */}
        <PayMeasure ref={p.measureRef} net={p.net} />
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
            className="mt-2 block break-all font-mono text-[12px] text-[var(--color-brand)] ilink"
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
        <Link href="/account" className="text-[var(--color-brand)] ilink">
          The live storage readout is on the account page →
        </Link>
      </p>
    </div>
  );
}

