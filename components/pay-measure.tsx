"use client";

/**
 * Taps and seconds from a cold landing to a confirmed Monad transaction, measured on the page.
 *
 * The honest parts: a tap is one primary `pointerdown`, counted in the capture phase, so a synthetic
 * click or a multi-touch extra does not inflate it. The OS passkey prompt dispatches no DOM event, so
 * it is counted separately and reported apart ("N taps plus 1 passkey confirmation"), never folded in.
 * The clock starts at first mount, which for a cold load of /pay is the moment the judge sees the
 * page, and stops at a confirmed settlement, never at a free "already checked" answer.
 *
 * The parent drives it through a ref: `onCeremony()` on each passkey ceremony, `onReceipt(settlement)`
 * when a settled tx lands. A real mainnet run is posted to /api/pay-runs, which verifies the cited tx
 * on chain before it joins the published median. A testnet or rehearsal run is posted as `ci`.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatRun, secondsOrUnknown, type RunMetric } from "@/lib/pay-run.ts";
import { type Settlement } from "@/lib/pay.ts";
import { type PayNetName } from "@/lib/pay-net.ts";

export type PayMeasureHandle = {
  onCeremony: () => void;
  onReceipt: (s: Settlement) => void;
};

type Block = { count: number; medianMs: number | null; worstMs: number | null; bestMs: number | null; medianTaps: number | null };

export const PayMeasure = forwardRef<PayMeasureHandle, { net: PayNetName }>(function PayMeasure({ net }, ref) {
  const t0 = useRef<number>(0);
  const taps = useRef(0);
  const prompts = useRef(0);
  const [run, setRun] = useState<RunMetric | null>(null);
  const [real, setReal] = useState<Block | null>(null);

  useEffect(() => {
    t0.current = performance.now();
    const onDown = (e: PointerEvent) => {
      if (e.isTrusted && e.isPrimary) taps.current += 1;
    };
    window.addEventListener("pointerdown", onDown, true);
    fetch("/api/pay-runs")
      .then((r) => r.json())
      .then((j) => setReal(j?.data?.real ?? null))
      .catch(() => {});
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      onCeremony: () => {
        prompts.current += 1;
      },
      onReceipt: (s: Settlement) => {
        if (!s.settled || !s.transaction) return;
        const metric: RunMetric = {
          appTaps: taps.current,
          passkeyPrompts: prompts.current,
          elapsedMs: Math.round(performance.now() - t0.current),
        };
        setRun(metric);
        const source = net === "mainnet" ? "real" : "ci";
        fetch("/api/pay-runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, net, ...metric, txHash: s.transaction, payer: s.payer }),
        })
          .then((r) => r.json())
          .then((j) => j?.data?.real && setReal(j.data.real))
          .catch(() => {});
      },
    }),
    [net],
  );

  if (!run && (!real || real.count === 0)) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-faint">
        Time to first transaction is measured on this page. Finish one payment and your run appears
        here, with the median over every real run once there is one.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {run ? (
        <p className="font-mono text-[12.5px] text-[var(--color-text)]">your run: {formatRun(run)}</p>
      ) : null}
      <p className="font-mono text-[12px] text-muted">
        {real && real.count > 0 ? (
          <>
            median {secondsOrUnknown(real.medianMs)}, worst {secondsOrUnknown(real.worstMs)}, over{" "}
            {real.count} real run{real.count === 1 ? "" : "s"}
          </>
        ) : (
          <span className="unknown-value">no real runs recorded yet</span>
        )}
      </p>
    </div>
  );
});
