/**
 * The pieces every page shares, and the reason each one exists.
 *
 * The load-bearing one is `Num`. Everything else is layout.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { Outcome, Rung } from "@/lib/queries.ts";

/* ------------------------------------------------------------------ unknown is never zero */

/**
 * A number, or the word "unknown" when it could not be read.
 *
 * This is the single most important component in the project and it is four lines long.
 *
 * A count that failed to read is not zero. Rendering `null` as `0` is the exact failure this
 * whole site exists to point at in other people's tools: a confident number standing in for an
 * answer nobody has. So a null never reaches a digit, and the fallback is a word in a different
 * colour rather than a dash, because a dash is quiet enough to scan past.
 */
export function Num({
  value,
  suffix,
  title,
}: {
  value: number | null | undefined;
  suffix?: string;
  title?: string;
}) {
  if (value === null || value === undefined) {
    return (
      <span className="unknown-value" title={title ?? "This value could not be read. It is not zero."}>
        unknown
      </span>
    );
  }
  return (
    <span className="tnum" title={title}>
      {value.toLocaleString("en-US")}
      {suffix ? <span className="text-muted">{suffix}</span> : null}
    </span>
  );
}

/** A percentage that refuses to exist when its denominator is zero or unknown. */
export function Pct({ of, total }: { of: number | null; total: number | null }) {
  if (of === null || total === null || total === 0) return <span className="unknown-value">unknown</span>;
  return <span className="tnum">{((of / total) * 100).toFixed(2)}%</span>;
}

/* ------------------------------------------------------------------ verdict rendering */

const OUTCOME_STYLE: Record<Outcome, { bg: string; fg: string; label: string; meaning: string }> = {
  true: {
    bg: "bg-[var(--color-true-bg)]",
    fg: "text-[var(--color-true)]",
    label: "true",
    meaning: "The cited transaction is on the chain this document names.",
  },
  false: {
    bg: "bg-[var(--color-false-bg)]",
    fg: "text-[var(--color-false)]",
    label: "false",
    meaning: "We read that chain successfully and the cited transaction is not there.",
  },
  noClaim: {
    bg: "bg-[var(--color-noclaim-bg)]",
    fg: "text-[var(--color-noclaim)]",
    label: "no claim",
    meaning: "The document read fine and asserts no payment, so there is nothing to be right or wrong about.",
  },
  unknown: {
    bg: "bg-[var(--color-unknown-bg)]",
    fg: "text-[var(--color-unknown)]",
    label: "unknown",
    meaning: "We could not look or could not read. This is never an accusation.",
  },
};

export function OutcomeBadge({ outcome, size = "sm" }: { outcome: Outcome | null; size?: "sm" | "lg" }) {
  if (!outcome) {
    return (
      <span
        className="unknown-value rounded border border-[var(--color-line)] px-2 py-0.5 text-xs"
        title="No verdict has been recorded for this claim yet. Unchecked is not the same as clean."
      >
        unchecked
      </span>
    );
  }
  const s = OUTCOME_STYLE[outcome];
  return (
    <span
      title={s.meaning}
      className={`${s.bg} ${s.fg} inline-block rounded border border-current/20 font-mono ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      {s.label}
    </span>
  );
}

export function outcomeMeaning(outcome: Outcome): string {
  return OUTCOME_STYLE[outcome].meaning;
}

const RUNGS: Rung[] = ["declared", "resolvable", "intact", "parsed", "true"];

/**
 * How far down the ladder a claim got, drawn as the ladder rather than as a word.
 *
 * A claim that stopped at `resolvable` and one that reached `true` are different in kind, not in
 * degree, and the shape makes that visible without reading. The rungs past where it stopped are
 * drawn faint rather than hidden, so the reader sees what was NOT checked.
 */
export function RungLadder({ rung }: { rung: Rung | null }) {
  const at = rung ? RUNGS.indexOf(rung) : -1;
  return (
    <span className="inline-flex items-center gap-1" title={rung ? `reached: ${rung}` : "not checked"}>
      {RUNGS.map((r, i) => (
        <span
          key={r}
          title={`${r}${i <= at ? " (reached)" : " (not reached)"}`}
          className={`h-1.5 w-4 rounded-sm ${
            i <= at ? "bg-[var(--color-brand)]" : "bg-[var(--color-line)]"
          }`}
        />
      ))}
      <span className="ml-1 font-mono text-[11px] text-muted">{rung ?? "unchecked"}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ layout */

export function Panel({
  title,
  subtitle,
  children,
  right,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]">
      {title ? (
        <header className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] px-4 py-3">
          <div>
            <h2 className="font-mono text-sm tracking-tight text-[var(--color-text)]">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * The query that produced the numbers above it.
 *
 * Every page that states a figure can show the SQL behind it. The claim of this project is that
 * somebody else's evidence should be checkable, so ours is checkable the same way, by the same
 * reader, with the string we printed.
 */
export function Derivation({ sql, note }: { sql: string; note?: string }) {
  return (
    <details className="mt-3 border-t border-[var(--color-line)] pt-2">
      <summary className="font-mono text-[11px] text-faint hover:text-muted">re-derive this</summary>
      <div className="mt-2 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
        {note ? <p className="mb-2 text-[11px] text-muted">{note}</p> : null}
        <pre className="sql">{sql}</pre>
      </div>
    </details>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[13px] ${className}`}>{children}</span>;
}

/** An address, shortened for scanning, complete on hover and on copy. */
export function Addr({ value, href }: { value: string; href?: string }) {
  const short = value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  const body = (
    <Mono className="text-muted hover:text-[var(--color-text)]">
      <span title={value}>{short}</span>
    </Mono>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** A transaction hash on the chain it was actually found on, never assumed to be Monad. */
export function TxLink({ hash, chainId }: { hash: string; chainId: number | null }) {
  const explorer = chainId === 143 ? `https://monadexplorer.com/tx/${hash}` : null;
  const short = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  if (!explorer) return <Mono className="text-muted" >{short}</Mono>;
  return (
    <a href={explorer} target="_blank" rel="noreferrer noopener" className="font-mono text-[13px] text-[var(--color-brand)] hover:underline">
      {short}
    </a>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-[var(--color-line)]/60 py-1.5 last:border-0">
      <dt className="w-44 shrink-0 font-mono text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-sm">{children}</dd>
    </div>
  );
}
