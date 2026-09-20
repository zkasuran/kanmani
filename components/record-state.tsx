/**
 * Rendering what a registration document does when you ask it.
 *
 * Eight states and a ninth for never-asked, and the colours are chosen the same way the verdict
 * colours are: the ones that describe an operator's document being gone look different from the
 * ones that describe our own failure to find out. A rate limit on our side must never render in
 * the colour we use for a deletion.
 */
import type { RecordState } from "@/lib/queries.ts";
import { STATE_MEANING } from "@/lib/queries.ts";

const STYLE: Record<RecordState, { label: string; cls: string }> = {
  // The document is on chain. The strongest state here and it gets the product's own colour,
  // because nothing can take it away.
  onchain: { label: "on chain", cls: "text-[var(--color-brand)] bg-[var(--color-brand-dim)]/25" },
  answered: { label: "answered", cls: "text-[var(--color-true)] bg-[var(--color-true-bg)]" },
  gone: { label: "gone", cls: "text-[var(--color-false)] bg-[var(--color-false-bg)]" },
  // Alive and asking for payment. Not a failure, so not red.
  paywalled: { label: "402", cls: "text-[var(--color-brand)] bg-[var(--color-brand-dim)]/20" },
  refused: { label: "refused", cls: "text-[var(--color-false)] bg-[var(--color-false-bg)]/60" },
  nohost: { label: "no host", cls: "text-[var(--color-false)] bg-[var(--color-false-bg)]" },
  malformed: { label: "malformed", cls: "text-[var(--color-noclaim)] bg-[var(--color-noclaim-bg)]" },
  // Ours, not theirs. Flat slate, never amber and never red.
  unknown: { label: "unknown", cls: "text-[var(--color-unknown)] bg-[var(--color-unknown-bg)]" },
};

export function RecordStateBadge({ state }: { state: RecordState | null }) {
  if (!state) {
    return (
      <span
        title={STATE_MEANING["not probed"]}
        className="unknown-value inline-block rounded border border-[var(--color-line)] px-2 py-0.5 font-mono text-[11px]"
      >
        not asked
      </span>
    );
  }
  const s = STYLE[state];
  return (
    <span
      title={STATE_MEANING[state]}
      className={`${s.cls} inline-block rounded border border-current/20 px-2 py-0.5 font-mono text-[11px]`}
    >
      {s.label}
    </span>
  );
}
