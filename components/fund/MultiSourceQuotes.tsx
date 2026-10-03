"use client";

/**
 * A live quote per source chain, so a judge sees the cross-chain claim is real across several chains at
 * once, including a genuinely non-EVM one (Solana). Each row calls the same `POST /api/fund/quote` dry
 * route agent 09 holds, in parallel with a small concurrency cap. A chain that cannot be priced shows an
 * honest "no live quote" rather than a fabricated number, the same posture as unknown-is-never-zero.
 *
 * The quote is a dry run, so it uses a demo wallet and agent (no funds move). Until the key is deployed
 * server-side the route answers 503, which every row shows as "no live quote": correct, not broken.
 */
import { useCallback, useEffect, useState } from "react";
import { SOURCE_QUOTE_CHAINS, scaleAmount, type FundSource } from "@/lib/fund-sources.ts";

const DEMO_WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const CONCURRENCY = 3;

type RowState =
  | { kind: "loading" }
  | { kind: "quoted"; minAmountOut: string; networkFee: string | null; shortfall: boolean }
  | { kind: "none"; reason: string };

function usdc(base: string | null): string {
  if (base === null) return "unknown";
  const v = BigInt(base);
  const whole = (v / 1_000_000n).toLocaleString("en-US");
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}`;
}

export function MultiSourceQuotes({
  wallet = DEMO_WALLET,
  agent = DEMO_WALLET,
  sources = SOURCE_QUOTE_CHAINS,
}: {
  wallet?: string;
  agent?: string;
  sources?: readonly FundSource[];
}) {
  const [amount, setAmount] = useState("0.12");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const run = useCallback(async () => {
    setRows(Object.fromEntries(sources.map((s) => [s.key, { kind: "loading" } as RowState])));
    const queue = [...sources];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        let next: RowState;
        try {
          const res = await fetch("/api/fund/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ wallet, agent, originAsset: s.assetId, amount: scaleAmount(amount.trim() || "0", s.decimals).toString() }),
          });
          const body = (await res.json().catch(() => null)) as {
            data?: { minAmountOut: string; networkFee: string | null; shortfall: boolean };
            minAmount?: string;
          } | null;
          // A 422 is Aurora refusing this source. With a minimum named it is the amount, otherwise the
          // route itself is not being quoted right now.
          if (res.ok && body?.data && /^\d+$/.test(body.data.minAmountOut)) {
            next = { kind: "quoted", minAmountOut: body.data.minAmountOut, networkFee: body.data.networkFee, shortfall: body.data.shortfall };
          } else {
            next = {
              kind: "none",
              reason:
                res.status === 503
                  ? "funding not configured"
                  : res.status === 422
                    ? body?.minAmount
                      ? "below this route's minimum"
                      : "Aurora is not quoting this route now"
                    : "no live quote",
            };
          }
        } catch {
          next = { kind: "none", reason: "no live quote" };
        }
        setRows((prev) => ({ ...prev, [s.key]: next }));
      }
    });
    await Promise.all(workers);
  }, [amount, wallet, agent, sources]);

  useEffect(() => {
    void run();
    // Run once on mount; the button re-runs on an amount change.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="multisource" className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">amount, source USDC</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-40 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-brand)]"
          />
        </label>
        <button type="button" onClick={() => void run()} className="cta-ghost">
          re-quote all
        </button>
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)]">
        {sources.map((s) => {
          const r = rows[s.key] ?? { kind: "loading" };
          return (
            <div key={s.key} data-testid="multisource-row" className="flex items-center justify-between gap-3 border-b border-[var(--color-line)]/60 px-4 py-2.5 last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-[var(--color-text)]">{s.label}</span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${s.evm ? "border-[var(--color-line)] text-faint" : "border-[var(--color-brand)]/50 text-[var(--color-brand)]"}`} data-testid={s.evm ? "tag-evm" : "tag-nonevm"}>
                  {s.evm ? "EVM" : "non-EVM"}
                </span>
              </div>
              <div className="flex items-center gap-4 text-right">
                {r.kind === "loading" ? (
                  <span className="font-mono text-[12px] text-faint">pricing…</span>
                ) : r.kind === "none" ? (
                  <span className="unknown-value font-mono text-[12px]" data-testid="multisource-none">{r.reason}</span>
                ) : (
                  <>
                    <span data-testid="multisource-min" className="font-mono text-[12.5px] text-[var(--color-text)]">{usdc(r.minAmountOut)}</span>
                    <span data-testid="multisource-fee" className="font-mono text-[12px] text-muted">fee {usdc(r.networkFee)}</span>
                    <span
                      data-testid="multisource-chip"
                      className={`rounded px-2 py-0.5 font-mono text-[11px] ${r.shortfall ? "bg-[var(--color-false-bg)] text-[var(--color-false)]" : "bg-[var(--color-true-bg)] text-[var(--color-true)]"}`}
                    >
                      {r.shortfall ? "refuse" : "pass"}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
