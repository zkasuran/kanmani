"use client";

/**
 * The live "is this wallet cleared" lookup for the compliance page.
 *
 * It calls `GET /api/compliance/<address>`, which reads `cviStatus` on chain for both Monad chains,
 * and renders one row per chain with a tri-state badge. The `initial` prop is the server-side read of
 * the default wallet, so the first paint already shows a real answer and the box is pre-filled: that
 * is how "reads the chain on load" is visible without a click.
 *
 * `unknown` is never styled as a refusal. A refusal (`not cleared`) stays red, which matches the house
 * rule that a refusal reads as a refusal.
 */
import { useState } from "react";

type CviOnchainState = "verified" | "unverified" | "unknown";
export type ChainCvi = {
  chainId: number;
  key: string;
  displayName: string;
  gate: string;
  registered: boolean;
  state: CviOnchainState;
  reason: string;
  raw: number | null;
};
export type ComplianceLookupData = { address: string; chains: ChainCvi[] };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const BADGE: Record<CviOnchainState, { bg: string; fg: string; label: string; title: string }> = {
  verified: { bg: "bg-[var(--color-true-bg)]", fg: "text-[var(--color-true)]", label: "verified", title: "valid active CVI, cleared to receive the CVA" },
  unverified: { bg: "bg-[var(--color-false-bg)]", fg: "text-[var(--color-false)]", label: "not cleared", title: "the validator answered and this wallet is not cleared" },
  unknown: { bg: "bg-[var(--color-unknown-bg)]", fg: "text-[var(--color-unknown)]", label: "not checkable", title: "could not read the chain or the pool is not registered on it" },
};

export function CviBadge({ state }: { state: CviOnchainState }) {
  const s = BADGE[state];
  return (
    <span title={s.title} className={`${s.bg} ${s.fg} inline-block rounded border border-current/20 px-2 py-0.5 font-mono text-xs`}>
      {s.label}
    </span>
  );
}

function ChainRow({ c }: { c: ChainCvi }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-line)]/60 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-40 shrink-0 font-mono text-[12px] text-muted">
        {c.displayName}
        <span className="ml-1 text-faint">({c.chainId})</span>
      </span>
      <span className="w-28 shrink-0">
        <CviBadge state={c.state} />
      </span>
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted">{c.reason}</span>
    </div>
  );
}

export function ComplianceLookup({ initial }: { initial: ComplianceLookupData | null }) {
  const [value, setValue] = useState(initial?.address ?? "");
  const [data, setData] = useState<ComplianceLookupData | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = ADDRESS_RE.test(value.trim());

  async function lookup() {
    const addr = value.trim();
    if (!ADDRESS_RE.test(addr)) {
      setError("Enter a 20-byte hex address, 0x followed by 40 hex characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/${addr}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Lookup failed with HTTP ${res.status}.`);
        setData(null);
        return;
      }
      const body = await res.json();
      setData(body.data as ComplianceLookupData);
    } catch (e) {
      setError(`Lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          inputMode="text"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x… any wallet"
          aria-label="wallet address"
          aria-invalid={value.length > 0 && !valid}
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 font-mono text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
        />
        <button
          type="submit"
          disabled={!valid || loading}
          className="cta shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "reading the chain…" : "check CVI status"}
        </button>
      </form>
      {error ? <p className="mt-2 text-[12px] text-[var(--color-false)]">{error}</p> : null}
      {data ? (
        <div className="mt-4">
          <p className="mb-1 break-all font-mono text-[11.5px] text-faint">cviStatus for {data.address}</p>
          {data.chains.map((c) => (
            <ChainRow key={c.chainId} c={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
