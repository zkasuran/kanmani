"use client";

/**
 * Recover funds left at the intermediary after a short landing or an expiry (item 3.3). It reads the
 * live intermediary balance from the keyless `/api/fund/intermediary` route, classifies it, and when
 * there is money to recover offers two one-click steps-only recoveries: re-fund a right-sized job, or
 * withdraw to your own wallet. Both preview with a dry call; the signing and the on-chain run are the
 * owner's wallet (a hard stop), so this panel stops at the signing payload.
 *
 * When the fund settled or the intermediary is empty, the panel stays collapsed: there is nothing to
 * recover and saying so loudly would be noise.
 */
import { useCallback, useEffect, useState } from "react";
import { StatTile } from "@/components/ui.tsx";

type Intermediary = { intermediary: string; balance: string | null; balanceHuman: string | null; state: string | null };
type RecoverResult = { mode: string; dry: boolean; networkFee: string | null; messageToSign: string | null } | null;

export function RecoveryPanel({ wallet, agent, needed }: { wallet: string; agent?: string; needed?: string }) {
  const [info, setInfo] = useState<Intermediary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<RecoverResult>(null);
  const [busy, setBusy] = useState<"refund" | "withdraw" | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ wallet });
      if (needed) qs.set("needed", needed);
      const res = await fetch(`/api/fund/intermediary?${qs.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { data?: Intermediary } | null;
      if (res.ok && body?.data) setInfo(body.data);
      else setNote("The intermediary balance could not be read.");
    } catch {
      setNote("The intermediary balance could not be read.");
    }
  }, [wallet, needed]);

  useEffect(() => {
    void load();
  }, [load]);

  const recover = useCallback(
    async (mode: "refund" | "withdraw") => {
      if (!info?.balance) return;
      setBusy(mode);
      setNote(null);
      setResult(null);
      try {
        const res = await fetch("/api/fund/recover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet, mode, balance: info.balance, agent, dry: true }),
        });
        const body = (await res.json().catch(() => null)) as { data?: { mode: string; dry: boolean; networkFee: string | null; messageToSign: string | null } } | null;
        if (res.ok && body?.data) {
          setResult(body.data);
          setNote("Recovery previewed. Signing and the on-chain run are done from your own wallet; this page does not move funds.");
        } else {
          setNote(res.status === 503 ? "Recovery is not configured on this instance yet." : "The recovery could not be previewed.");
        }
      } catch {
        setNote("The recovery could not be previewed.");
      } finally {
        setBusy(null);
      }
    },
    [info, wallet, agent],
  );

  const state = info?.state ?? null;
  const recoverable = state === "short" || state === "expired" || state === "recoverable";

  if (info && !recoverable && (state === "funded" || state === "empty")) {
    return null; // nothing to recover
  }

  return (
    <div data-testid="recovery-panel" data-state={state ?? "reading"} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label="at the intermediary" value={info?.balanceHuman ? Number(info.balanceHuman) : null} suffix=" USDC" hint="Read live from Monad USDC. A null value means the chain could not be read, never zero." />
        <div className="spot rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3.5">
          <div className="font-mono text-[11px] uppercase tracking-wide text-faint">intermediary</div>
          <div className="mt-1 break-all font-mono text-[12px] text-muted">{info?.intermediary ?? "reading…"}</div>
        </div>
      </div>

      {state === "short" ? (
        <p data-testid="recovery-explain-short" className="text-[13px] leading-relaxed text-muted">
          If the bridge delivers less than the job needs, createJob reverts and the money waits in an
          intermediary account only you control; re-fund a right-sized job or withdraw it in one click.
        </p>
      ) : null}
      {state === "expired" ? (
        <p data-testid="recovery-explain-expired" className="text-[13px] leading-relaxed text-muted">
          If the deadline passes before the steps run there is no automatic refund; the money waits in
          that same intermediary account and you recover it with a one-click re-fund or withdrawal.
        </p>
      ) : null}

      {recoverable ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void recover("refund")} disabled={busy !== null || !agent} className="cta disabled:opacity-40" data-testid="recover-refund">
            {busy === "refund" ? "previewing…" : "re-fund a right-sized job"}
          </button>
          <button type="button" onClick={() => void recover("withdraw")} disabled={busy !== null} className="cta-ghost disabled:opacity-40" data-testid="recover-withdraw">
            {busy === "withdraw" ? "previewing…" : "withdraw to my wallet"}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3" data-testid="recovery-result">
          <div className="font-mono text-[11px] uppercase tracking-wide text-faint">{result.mode} preview</div>
          <div className="mt-1 font-mono text-[12px] text-muted">estimated fee {result.networkFee ?? "unknown"}</div>
        </div>
      ) : null}

      {note ? <p className="text-[12.5px] leading-relaxed text-muted">{note}</p> : null}
    </div>
  );
}
