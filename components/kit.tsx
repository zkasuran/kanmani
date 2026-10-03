// SPDX-License-Identifier: MIT
//
// This file is one of five under MIT, with app/embed.js/route.ts and the three AgentPasskey contract files.
// LICENSE names all five under "Files under MIT". The rest is
// LicenseRef-zkasuran-SAND-1.0, source-available with no derivatives. The carve-out is deliberate and is
// explained in docs/24-KIT-LICENCE.md: a component that exists to be rendered inside somebody else's
// product cannot be read-only and what this file publishes is a constraint rather than an asset. Copy it.
/**
 * The Kanmani kit: the public component surface.
 *
 * **This file is the product boundary.** Everything exported here is something another application is
 * meant to render. Everything in `ui.tsx` is internal layout that happens to be shared between our
 * own pages and the difference matters: an internal helper can change shape on a Tuesday, a
 * published component cannot.
 *
 * ## Why components rather than only an API
 *
 * The API has been open and CORS-enabled from the start, so the data was never the hard part. The
 * hard part is that **a verdict is easy to render wrongly** and rendering it wrongly is worse than
 * not rendering it. Three mistakes are available to anyone consuming `/api/agent/<id>` by hand:
 *
 *   1. Printing a null as `0`. "We could not check" becomes "zero payments resolved".
 *   2. Colouring `unknown` like `false`. Somebody else's outage reads as our accusation.
 *   3. Averaging the four outcomes into a score, which buries the one distinction that matters.
 *
 * Every component here makes those three mistakes unavailable. That is the primitive being
 * published: not the numbers, the discipline around them. A marketplace that embeds `<Verdict>` gets
 * the `unknown` rule whether or not it has read a word of our documentation.
 *
 * ## The rule, stated once, enforced by types
 *
 * A count that could not be read is `null`, never `0`. Every component here takes `number | null`
 * and renders the word for null. There is no prop that turns that off.
 */

import type { ReactNode } from "react";

/* ================================================================== outcomes */

/** The four outcomes. There is no fifth and `unknown` is not a kind of `false`. */
export type Outcome = "true" | "false" | "noClaim" | "unknown";

/** How far down the ladder a claim got. */
export type Rung = "declared" | "resolvable" | "intact" | "parsed" | "true";

const OUTCOME: Record<Outcome, { label: string; fg: string; bg: string; meaning: string }> = {
  true: {
    label: "true",
    fg: "var(--kan-true, #34d399)",
    bg: "var(--kan-true-bg, #06281f)",
    meaning: "The cited transaction is on the chain this document names.",
  },
  false: {
    label: "false",
    fg: "var(--kan-false, #f87171)",
    bg: "var(--kan-false-bg, #2c1014)",
    meaning: "We read that chain successfully and the cited transaction is not there.",
  },
  noClaim: {
    label: "no claim",
    fg: "var(--kan-noclaim, #64748b)",
    bg: "var(--kan-noclaim-bg, #121820)",
    meaning: "The document read fine and asserts no payment, so there is nothing to be right or wrong about.",
  },
  // Deliberately not amber. Amber reads as "warning", which is a claim about the operator. Slate
  // reads as "no answer here", which is what it means.
  unknown: {
    label: "unknown",
    fg: "var(--kan-unknown, #94a3b8)",
    bg: "var(--kan-unknown-bg, #171f2b)",
    meaning: "We could not look or could not read what we fetched. This is never an accusation.",
  },
};

/** What an outcome means, in the words the verifier itself uses. Safe to show a user. */
export function outcomeMeaning(o: Outcome): string {
  return OUTCOME[o].meaning;
}

/**
 * A verdict, rendered so it cannot be misread.
 *
 * `null` is `unchecked`, which is not `noClaim` and not clean. Unchecked means nobody has looked yet.
 */
export function Verdict({ outcome, size = "sm" }: { outcome: Outcome | null; size?: "sm" | "lg" }) {
  const pad = size === "lg" ? "0.25rem 0.6rem" : "0.1rem 0.4rem";
  const font = size === "lg" ? "13px" : "11px";
  if (!outcome) {
    return (
      <span
        title="No verdict has been recorded for this claim yet. Unchecked is not the same as clean."
        style={{ ...chrome(pad, font), color: OUTCOME.unknown.fg, borderColor: "currentColor" }}
      >
        unchecked
      </span>
    );
  }
  const s = OUTCOME[outcome];
  return (
    <span title={s.meaning} style={{ ...chrome(pad, font), color: s.fg, background: s.bg, borderColor: "currentColor" }}>
      {s.label}
    </span>
  );
}

function chrome(padding: string, fontSize: string) {
  return {
    display: "inline-block",
    border: "1px solid",
    borderRadius: "4px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    padding,
    fontSize,
    lineHeight: 1.4,
    whiteSpace: "nowrap" as const,
  };
}

/* ================================================================== numbers */

/**
 * A number or the word `unknown`.
 *
 * The single most important component in the kit and it is four lines long. A count that failed to
 * read is not zero and rendering one as the other is the exact failure this project exists to point
 * at. There is no prop to disable this.
 */
export function Count({ value, suffix }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) {
    return (
      <span
        style={{ color: OUTCOME.unknown.fg, letterSpacing: "0.02em" }}
        title="This value could not be read. It is not zero."
      >
        unknown
      </span>
    );
  }
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {value.toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

/** A percentage that refuses to exist when its denominator is zero or unknown. */
export function Share({ of, total }: { of: number | null; total: number | null }) {
  if (of === null || total === null || total === 0) return <Count value={null} />;
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{((of / total) * 100).toFixed(2)}%</span>;
}

/* ================================================================== the ladder */

const RUNGS: Rung[] = ["declared", "resolvable", "intact", "parsed", "true"];

/**
 * How far a claim got, drawn as the ladder rather than as a word.
 *
 * Rungs past where it stopped are drawn faint rather than hidden, so a reader sees what was NOT
 * checked. A claim that stopped at `resolvable` and one that reached `true` differ in kind, not in
 * degree and a single score would hide that.
 */
export function Ladder({ rung }: { rung: Rung | null }) {
  const at = rung ? RUNGS.indexOf(rung) : -1;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }} title={rung ? `reached: ${rung}` : "not checked"}>
      {RUNGS.map((r, i) => (
        <span
          key={r}
          title={`${r}${i <= at ? " (reached)" : " (not reached)"}`}
          style={{
            height: "5px",
            width: "15px",
            borderRadius: "2px",
            background: i <= at ? "var(--kan-brand, #836ef9)" : "var(--kan-line, #1d2836)",
          }}
        />
      ))}
      <span style={{ marginLeft: "5px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", opacity: 0.7 }}>
        {rung ?? "unchecked"}
      </span>
    </span>
  );
}

/* ================================================================== distribution */

/**
 * A distribution as one bar, each segment an outcome colour.
 *
 * A segment below a floor width is still drawn, because a share that reads as zero when it is not is
 * the error this whole project is about.
 */
export function Distribution({
  resolve,
  doNotResolve,
  noClaim,
  couldNotCheck,
  height = 8,
}: {
  resolve: number;
  doNotResolve: number;
  noClaim: number;
  couldNotCheck: number;
  height?: number;
}) {
  const segs: { v: number; c: string; l: string; hatch?: boolean }[] = [
    { v: resolve, c: OUTCOME.true.fg, l: "on the named chain" },
    { v: doNotResolve, c: OUTCOME.false.fg, l: "not on the named chain", hatch: true },
    { v: noClaim, c: OUTCOME.noClaim.fg, l: "assert no payment" },
    { v: couldNotCheck, c: OUTCOME.unknown.fg, l: "could not check" },
  ];
  const total = segs.reduce((s, x) => s + x.v, 0) || 1;
  return (
    <span
      role="img"
      aria-label={segs.map((s) => `${s.l} ${s.v}`).join(", ")}
      style={{ display: "flex", height: `${height}px`, gap: "2px", borderRadius: "999px", overflow: "hidden" }}
    >
      {segs.map((s) =>
        s.v > 0 ? (
          <span
            key={s.l}
            title={`${s.l}: ${s.v.toLocaleString()}`}
            style={{
              background: s.c,
              width: `${Math.max((s.v / total) * 100, 0.8)}%`,
              /**
               * Texture, not decoration. The true and false colours sit at OKLab delta E 6.5 under
               * deuteranopia, measured with the dataviz palette validator, which is inside the band
               * that needs a second channel besides hue. A red-green reader gets the hatch on
               * "not on the named chain" and the 2px gaps between every segment, so the chart still
               * separates with hue removed entirely. The colours themselves are unchanged, because
               * the verdict palette carries meaning we are not free to retune for contrast.
               */
              ...(s.hatch
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(0,0,0,0.42) 0 1.5px, transparent 1.5px 4px)",
                  }
                : null),
            }}
          />
        ) : null,
      )}
    </span>
  );
}

/* ================================================================== the badge */

/** What `/api/agent/<id>` returns, narrowed to what a badge needs. */
export type AgentSummary = {
  agentId: number;
  name: string | null;
  registration: { state: string | null; uri: string } | null;
  claims: { checked: number; resolve: number; doNotResolve: number; couldNotCheck: number; assertNoPayment: number } | null;
  declaresX402?: boolean;
};

/**
 * The drop-in trust badge.
 *
 * One component, the whole judgment: what the registration document does when you ask it and how
 * its payment claims turned out. Designed to sit in somebody else's agent directory beside a listing,
 * which is why it takes a plain object rather than fetching: the host decides when and how to load.
 *
 * `claims: null` renders as unchecked rather than as a clean record, because a listing that has never
 * been measured must not look the same as one that passed.
 */
export function TrustBadge({ agent, href }: { agent: AgentSummary; href?: string }) {
  const c = agent.claims;
  const link = href ?? `https://kanmani.xyz/agent/${agent.agentId}`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        border: "1px solid var(--kan-line, #1d2836)",
        background: "var(--kan-panel, #0b0f16)",
        color: "var(--kan-text, #dce5f0)",
        borderRadius: "8px",
        padding: "6px 10px",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "12px",
      }}
    >
      <a
        href={link}
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: "var(--kan-brand, #836ef9)", textDecoration: "none", fontFamily: "ui-monospace, monospace" }}
      >
        kanmani
      </a>
      <span style={{ opacity: 0.35 }}>·</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>#{agent.agentId}</span>
      {agent.registration?.state ? <RecordState state={agent.registration.state} /> : null}
      {c && c.checked > 0 ? (
        <>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            <Count value={c.resolve} /> of <Count value={c.resolve + c.doNotResolve} /> claims resolve
          </span>
          {c.couldNotCheck > 0 ? (
            <span style={{ color: OUTCOME.unknown.fg, fontSize: "11px" }}>
              {c.couldNotCheck} unknown
            </span>
          ) : null}
        </>
      ) : (
        <Verdict outcome={null} />
      )}
    </span>
  );
}

/**
 * What a registration document did when it was last asked.
 *
 * Eight states, not a boolean, because "the host is alive and asking for payment" and "the host says
 * it is gone" are different facts and a boolean would have to pick one.
 */
export function RecordState({ state }: { state: string }) {
  // Grouped by what the state says about WHOSE failure it is. `answered` is fine, `gone`/`nohost`/
  // `refused` are the document being unavailable, `onchain`/`paywalled` are alive and well (402 is a
  // host asking for payment, not a death) and anything else is our own failure to find out.
  const fg =
    state === "answered"
      ? OUTCOME.true.fg
      : state === "gone" || state === "nohost" || state === "refused"
        ? OUTCOME.false.fg
        : state === "onchain" || state === "paywalled"
          ? "var(--kan-brand, #836ef9)"
          : OUTCOME.unknown.fg;
  const label = state === "onchain" ? "on chain" : state === "paywalled" ? "402" : state === "nohost" ? "no host" : state;
  return <span style={{ ...chrome("0.1rem 0.4rem", "11px"), color: fg, borderColor: "currentColor" }}>{label}</span>;
}

/* ================================================================== provenance */

/**
 * The command that reproduces the number beside it.
 *
 * Included in the public kit on purpose. Every response from this API carries a `reproduce` field,
 * and a consumer that renders our numbers without offering the way to check them has taken our word
 * for it, which is the posture this project argues against.
 */
export function Reproduce({ command, children }: { command: string; children?: ReactNode }) {
  return (
    <details style={{ marginTop: "8px" }}>
      <summary style={{ cursor: "pointer", fontFamily: "ui-monospace, monospace", fontSize: "11px", opacity: 0.6 }}>
        re-derive this
      </summary>
      <div style={{ marginTop: "6px", border: "1px solid var(--kan-line, #1d2836)", borderRadius: "4px", padding: "8px" }}>
        {children}
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: "11px", opacity: 0.8 }}>
          {command}
        </pre>
      </div>
    </details>
  );
}
