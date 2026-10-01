"use client";

/**
 * The user-run cross-chain funding flow (item 3.2). Pick a source chain, asset amount and the agent,
 * see the guaranteed delivery and fee, sign once, then watch the deposit bridge into a funded Monad
 * escrow job. The seven states live in `lib/fund-ui.ts` and this file drives them; the server routes in
 * `app/api/fund/*` hold the Aurora key and talk to Aurora, this component only calls same-origin.
 *
 * The order is create then sign then deposit, confirmed by the organizer (Chris Gutkowski, 2026-09-29):
 * with the signature in, the batch runs by itself once the bridge lands. Verify-don't-trust at create:
 * if the quote moved below the job between quote and create, it drops back rather than sending money to
 * a job that would revert. The poll is bounded and cleaned up on unmount. The deposit address is shown
 * full, never shortened, with its QR and the network and asset label beside it, because it receives money.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Row, TxLink } from "@/components/ui.tsx";
import { useSession, walletProvider } from "@/components/session.tsx";
import { toIntentsSignature } from "@/lib/intents.ts";
import {
  mapAuroraState,
  isTerminal,
  nextPollDelay,
  MAX_POLL_ATTEMPTS,
  type FundUiState,
} from "@/lib/fund-ui.ts";
import { scaleAmount, type FundSource } from "@/lib/fund-sources.ts";
import { qrMatrix } from "@/lib/qr.ts";

const CARD = "elevated panel-hover rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5";
const STEP = "eyebrow";
const INPUT = "mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-brand)]";

function usdc(base: string | bigint | null): string {
  if (base === null) return "unknown";
  let v = typeof base === "bigint" ? base : BigInt(base);
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = (v / 1_000_000n).toLocaleString("en-US");
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

type QuoteData = { minAmountOut: string; networkFee: string | null; intermediary: string | null; depositAddress: string | null; needed: string; shortfall: boolean };
type CreateData = { id: string; wallet: string; depositAddress: string | null; intermediary: string | null; minAmountOut: string; needed: string; messageToSign: string | null; payloadJson: string | null; signingStandard: string | null };
type StatusData = { status: string | null; destinationTx?: string | null; depositAddress?: string | null; intermediary?: string | null };
type Note = { kind: "error" | "info"; cause: string; fix?: string } | null;

/* MARKER-FUNDFLOW */

export function FundFlow({ sources }: { sources: readonly FundSource[] }) {
  const { session, keys } = useSession();
  const [state, setState] = useState<FundUiState>("form");
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "base");
  const [amount, setAmount] = useState("0.12");
  const [agent, setAgent] = useState("");
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [created, setCreated] = useState<CreateData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<"quote" | "create" | "sign" | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);

  const source = sources.find((s) => s.key === sourceKey) ?? sources[0]!;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPoll, [stopPoll]);

  async function resolveWallet(): Promise<string> {
    if (session?.address) return session.address;
    const w = walletProvider();
    if (!w) throw new Error("Connect a browser wallet or sign in with a passkey first.");
    const accts = (await w.request({ method: "eth_requestAccounts" })) as string[];
    if (!accts?.[0]) throw new Error("The wallet did not share an address.");
    return accts[0];
  }

  async function signMessage(message: string, wallet: string): Promise<string> {
    const acct = keys?.account as { signMessage?: (a: { message: string }) => Promise<`0x${string}`> } | undefined;
    if (acct && typeof acct.signMessage === "function") {
      return toIntentsSignature(await acct.signMessage({ message }));
    }
    const w = walletProvider();
    if (!w) throw new Error("No signer available.");
    const hex = (await w.request({ method: "personal_sign", params: [message, wallet] })) as `0x${string}`;
    return toIntentsSignature(hex);
  }

  const onQuote = useCallback(async () => {
    setBusy("quote");
    setNote(null);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(agent.trim())) {
        setNote({ kind: "error", cause: "Enter the agent address to hire.", fix: "A 0x address the funded job pays." });
        setBusy(null);
        return;
      }
      const wallet = await resolveWallet();
      const originAmount = scaleAmount(amount.trim(), source.decimals).toString();
      const res = await fetch("/api/fund/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, originAsset: source.assetId, amount: originAmount, agent: agent.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { data?: QuoteData } | null;
      if (!res.ok || !body?.data || !/^\d+$/.test(body.data.minAmountOut)) {
        setState("error");
        setNote({ kind: "error", cause: "The quote did not come back with a usable number.", fix: "Try again, or pick another source chain." });
        return;
      }
      setQuote(body.data);
      setState("quote");
    } catch (e) {
      setState("error");
      setNote({ kind: "error", cause: (e as Error).message || "The quote failed." });
    } finally {
      setBusy(null);
    }
  }, [agent, amount, source, session, keys]);

  const onCreateAndSign = useCallback(async () => {
    if (!quote) return;
    setBusy("create");
    setNote(null);
    try {
      const wallet = await resolveWallet();
      const jobAmount = quote.minAmountOut; // the job is sized to the guaranteed delivery
      const res = await fetch("/api/fund/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, originAsset: source.assetId, amount: scaleAmount(amount.trim(), source.decimals).toString(), agent: agent.trim(), jobAmount }),
      });
      const body = (await res.json().catch(() => null)) as { data?: CreateData } | null;
      // Verify-don't-trust: a 409, or a create whose delivery dropped below the job, means the quote moved.
      if (res.status === 409 || (res.ok && body?.data && BigInt(body.data.minAmountOut) < BigInt(jobAmount))) {
        setState("quote");
        setNote({ kind: "info", cause: "The quote moved below the job between quote and create, so nothing was created.", fix: "Re-quote and try again." });
        return;
      }
      if (!res.ok || !body?.data?.id) {
        setState("error");
        setNote({ kind: "error", cause: "The execution could not be created." });
        return;
      }
      const data = body.data;
      setCreated(data);
      setState("signing");
      const message = data.messageToSign ?? data.payloadJson;
      if (!message) {
        setState("error");
        setNote({ kind: "error", cause: "The create response carried no message to sign, so the steps could not run." });
        return;
      }
      setBusy("sign");
      const signature = await signMessage(message, data.wallet);
      const sub = await fetch("/api/fund/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: data.wallet, executionId: data.id, signature }),
      });
      if (!sub.ok) {
        setState("error");
        setNote({ kind: "error", cause: "Aurora did not accept the signature.", fix: "The execution is unchanged. Try signing again." });
        return;
      }
      setState("awaiting-deposit");
      startPoll(data.id, data.wallet);
    } catch (e) {
      setState("error");
      setNote({ kind: "error", cause: (e as Error).message || "Creating or signing failed." });
    } finally {
      setBusy(null);
    }
  }, [quote, source, amount, agent, session, keys]);

  function startPoll(id: string, wallet: string) {
    stopPoll();
    attemptsRef.current = 0;
    const tick = async () => {
      attemptsRef.current += 1;
      if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
        stopPoll();
        setNote({ kind: "info", cause: "Still pending after the poll window. Check back later; the execution runs on its own." });
        return;
      }
      try {
        const res = await fetch(`/api/fund/${id}?wallet=${wallet}`, { cache: "no-store" });
        if (!res.ok) return; // a failed poll is retried next tick, never read as terminal
        const body = (await res.json()) as { data?: StatusData };
        const data = body.data;
        if (!data?.status) return;
        setStatus(data);
        const next = mapAuroraState(data.status);
        setState(next);
        if (isTerminal(next)) stopPoll();
      } catch {
        // Transient; retried on the next tick.
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), nextPollDelay());
  }

  const reset = useCallback(() => {
    stopPoll();
    setState("form");
    setQuote(null);
    setCreated(null);
    setStatus(null);
    setNote(null);
  }, [stopPoll]);

  return (
    <FundFlowView
      sources={sources}
      source={source}
      state={state}
      sourceKey={sourceKey}
      setSourceKey={setSourceKey}
      amount={amount}
      setAmount={setAmount}
      agent={agent}
      setAgent={setAgent}
      quote={quote}
      created={created}
      status={status}
      note={note}
      busy={busy}
      onQuote={onQuote}
      onCreateAndSign={onCreateAndSign}
      onReset={reset}
    />
  );
}

/* MARKER-FUNDVIEW */

function QrSvg({ text }: { text: string }) {
  let matrix: boolean[][];
  try {
    matrix = qrMatrix(text);
  } catch {
    return <span className="unknown-value">unknown</span>;
  }
  const n = matrix.length;
  const rects: ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y]![x]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  }
  return (
    <svg
      data-testid="fund-deposit-qr"
      viewBox={`0 0 ${n} ${n}`}
      width={176}
      height={176}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code of the deposit address"
      style={{ background: "#ffffff", borderRadius: 8 }}
    >
      <g fill="#000000">{rects}</g>
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" onClick={copy} className="cta-ghost text-[12px]">
      {done ? "copied" : label}
    </button>
  );
}

type ViewProps = {
  sources: readonly FundSource[];
  source: FundSource;
  state: FundUiState;
  sourceKey: string;
  setSourceKey: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  agent: string;
  setAgent: (v: string) => void;
  quote: QuoteData | null;
  created: CreateData | null;
  status: StatusData | null;
  note: Note;
  busy: "quote" | "create" | "sign" | null;
  onQuote: () => void;
  onCreateAndSign: () => void;
  onReset: () => void;
};

function FundFlowView(p: ViewProps) {
  const deposit = p.created?.depositAddress ?? p.status?.depositAddress ?? null;
  const label = `${p.source.label} to Monad USDC`;

  return (
    <div data-testid="fund-flow" data-state={p.state} className="space-y-5">
      {/* -------------------------------------------------------------- step 1: the form */}
      <section className={CARD}>
        <p className={STEP}>step 1 &middot; pick the source and the agent</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-faint">pay from</span>
            <select value={p.sourceKey} onChange={(e) => p.setSourceKey(e.target.value)} className={INPUT} disabled={p.state !== "form" && p.state !== "quote" && p.state !== "error"}>
              {p.sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.evm ? "" : " (non-EVM)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-faint">amount, {p.source.label} USDC</span>
            <input value={p.amount} onChange={(e) => p.setAmount(e.target.value)} inputMode="decimal" className={INPUT} data-testid="fund-amount" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-faint">agent to hire</span>
            <input value={p.agent} onChange={(e) => p.setAgent(e.target.value)} placeholder="0x…" className={INPUT} data-testid="fund-agent" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={p.onQuote} disabled={p.busy !== null} className="cta disabled:opacity-40" data-testid="fund-quote-btn">
            {p.busy === "quote" ? "pricing…" : "get a live quote"}
          </button>
          {p.state !== "form" ? (
            <button type="button" onClick={p.onReset} className="cta-ghost">
              start over
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          The quote is a dry run against Aurora Intents Connect. The source amount is what you fix; the
          guaranteed delivery is the USDC the Monad job will hold after the bridge fee.
        </p>
      </section>

      {/* -------------------------------------------------------------- the quote */}
      {p.quote ? (
        <section className={`${CARD} border-[var(--color-brand)]/40`}>
          <p className={STEP}>step 2 &middot; review the guaranteed delivery</p>
          <dl className="mt-3">
            <Row label="guaranteed delivery">
              <span data-testid="fund-quote-min" className="font-mono text-[13px] text-[var(--color-text)]">
                {usdc(p.quote.minAmountOut)} USDC
              </span>
            </Row>
            <Row label="bridge fee">
              <span data-testid="fund-quote-fee" className="font-mono text-[13px] text-muted">
                {p.quote.networkFee === null ? "unknown" : `${usdc(p.quote.networkFee)} USDC`}
              </span>
            </Row>
            <Row label="lands at intermediary">
              <span className="break-all font-mono text-[12px] text-muted">{p.quote.intermediary ?? "unknown"}</span>
            </Row>
          </dl>
          {p.quote.networkFee === null ? (
            <p className="mt-2 text-[12.5px] text-[var(--color-unknown)]">
              The fee could not be priced, so this quote is not safe to fund. Re-quote.
            </p>
          ) : null}
          <button
            type="button"
            onClick={p.onCreateAndSign}
            disabled={p.busy !== null || p.quote.networkFee === null || p.state === "signing"}
            className="cta mt-4 disabled:opacity-40"
            data-testid="fund-sign"
          >
            {p.busy === "create" ? "creating…" : p.busy === "sign" ? "waiting for your signature…" : "create and sign once"}
          </button>
        </section>
      ) : null}
      {/* MARKER-FUNDVIEW2 */}

      {/* -------------------------------------------------------------- deposit + QR + live status */}
      {(p.state === "awaiting-deposit" || p.state === "bridging") && deposit ? (
        <section className={CARD}>
          <p className={STEP}>step 3 &middot; {p.state === "bridging" ? "bridging, the steps run on arrival" : "send the deposit"}</p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrSvg text={deposit} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] uppercase tracking-wide text-faint">{label}</div>
              <div data-testid="fund-deposit-address" className="mt-1 break-all font-mono text-[13px] text-[var(--color-text)]">
                {deposit}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyButton value={deposit} label="copy address" />
                <span className="text-[12px] text-muted">send {p.source.label} USDC only, to this address, on {p.source.label}</span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                {p.state === "bridging"
                  ? "The deposit was seen. Intents Connect is bridging it and will run approve then createJob as one batch."
                  : "Your signature is in. The moment the deposit lands, the batch runs by itself. This screen updates on its own."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- funded */}
      {p.state === "funded" ? (
        <section className={`${CARD} border-[var(--color-true)]/40`}>
          <p className="font-mono text-[12px] text-[var(--color-true)]">funded on Monad</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            The bridge delivered and the escrow job is funded with {usdc(p.created?.minAmountOut ?? p.quote?.minAmountOut ?? null)} USDC, with nothing done on Monad by you.
          </p>
          <div className="mt-2">
            <Row label="destination tx">
              {p.status?.destinationTx ? <TxLink hash={p.status.destinationTx} chainId={143} /> : <span className="unknown-value" data-testid="fund-tx">unknown</span>}
            </Row>
          </div>
          {p.status?.destinationTx ? (
            <a
              data-testid="fund-tx"
              href={`https://monadexplorer.com/tx/${p.status.destinationTx}`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block break-all font-mono text-[12px] text-[var(--color-brand)] hover:underline"
            >
              {p.status.destinationTx}
            </a>
          ) : null}
        </section>
      ) : null}

      {/* -------------------------------------------------------------- short landing (OPERATION_FAILED) */}
      {p.state === "short-landing" ? (
        <section className={`${CARD} border-[var(--color-unknown)]/40`}>
          <p className="font-mono text-[12px] text-[var(--color-unknown)]">short landing</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            The bridge delivered less than the job needs, so createJob reverted and the money waits in an
            intermediary account only you control. Re-fund a right-sized job or withdraw it in one click.
          </p>
          <Row label="intermediary">
            <span className="break-all font-mono text-[12px] text-muted">{p.status?.intermediary ?? p.created?.intermediary ?? "unknown"}</span>
          </Row>
          <p className="mt-2 text-[12px] text-muted">The recovery panel below reads the live balance and signs the steps-only recovery.</p>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- expired / deposit failed (refund) */}
      {p.state === "expired" ? (
        <section className={`${CARD} border-[var(--color-unknown)]/40`}>
          <p className="font-mono text-[12px] text-[var(--color-unknown)]">expired</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            The deposit was not completed in time, so the execution expired and the transferred funds are
            refunded. Nothing is stuck. Start over to fund again.
          </p>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- a note */}
      {p.note ? (
        <section className={`${CARD} ${p.note.kind === "error" ? "border-[var(--color-false)]/40" : "border-[var(--color-unknown)]/40"}`}>
          <p className="text-[13.5px] leading-relaxed">{p.note.cause}</p>
          {p.note.fix ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              <span className="text-[var(--color-text)]">What to do:</span> {p.note.fix}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
