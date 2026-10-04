/**
 * The pieces every blog post is built from, so the five read as one publication.
 *
 * Every figure here is either a screenshot of the live site (taken by scripts/build-blog-shots.mjs,
 * which records when) or a diagram drawn from facts the post states. Nothing is a stock image. A
 * screenshot is served in the reader's theme: both variants are in the page and CSS shows one, so a
 * figure never flashes white on a dark page and no script is needed to pick.
 */
import type { ReactNode } from "react";

export function Prose({ children }: { children: ReactNode }) {
  return <div className="blog-prose max-w-[46rem] space-y-4 text-[15px] leading-[1.75] text-[var(--color-text)]">{children}</div>;
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 font-display text-[1.35rem] font-semibold tracking-tight text-[var(--color-text)]">
      {children}
    </h2>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
}

/** A screenshot of the live site, in both themes, with a caption that says what to look at. */
export function Shot({
  post,
  name,
  alt,
  caption,
  width,
  height,
  href,
}: {
  post: string;
  name: string;
  alt: string;
  caption: ReactNode;
  width: number;
  height: number;
  href?: string;
}) {
  const img = (theme: "dark" | "light") => (
    // eslint-disable-next-line @next/next/no-img-element -- static PNGs from public/, sized explicitly, no optimiser needed
    <img
      src={`/blog/${post}/${name}-${theme}.png`}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={`shot-${theme} h-auto w-full`}
    />
  );
  const body = (
    <>
      {img("dark")}
      {img("light")}
    </>
  );
  return (
    <figure className="my-7 max-w-[56rem]">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] shadow-[var(--shadow-2)]">
        {href ? (
          <a href={href} aria-label={`${alt}, open the live page`}>
            {body}
          </a>
        ) : (
          body
        )}
      </div>
      <figcaption className="mt-2.5 max-w-[46rem] text-[13px] leading-relaxed text-muted">{caption}</figcaption>
    </figure>
  );
}

/** A command a reader can paste, with what it should print. */
export function Cmd({ cmd, out, note }: { cmd: string; out?: string; note?: ReactNode }) {
  return (
    <figure className="my-6 max-w-[56rem]">
      <pre className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--color-text)]">
        <span className="select-none text-faint">$ </span>
        {cmd}
        {out ? (
          <>
            {"\n"}
            <span className="text-muted">{out}</span>
          </>
        ) : null}
      </pre>
      {note ? <figcaption className="mt-2 text-[13px] text-muted">{note}</figcaption> : null}
    </figure>
  );
}

/** A small table of facts, each with where it came from. */
export function Facts({ rows, caption }: { rows: { k: ReactNode; v: ReactNode; src?: ReactNode }[]; caption?: ReactNode }) {
  return (
    <figure className="my-6 max-w-[56rem]">
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)]">
        <table className="w-full text-left text-[13.5px]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--color-line)] last:border-0">
                <th scope="row" className="w-[38%] px-4 py-2.5 align-top font-mono text-[12px] font-normal uppercase tracking-wide text-faint">
                  {r.k}
                </th>
                <td className="px-4 py-2.5 align-top text-[var(--color-text)]">
                  {r.v}
                  {r.src ? <div className="mt-0.5 font-mono text-[11.5px] text-faint">{r.src}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption ? <figcaption className="mt-2 text-[13px] text-muted">{caption}</figcaption> : null}
    </figure>
  );
}

/** A labelled callout for the one thing a skimming reader should not miss. */
export function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="my-6 max-w-[46rem] rounded-[var(--radius-lg)] border border-[var(--brand-line)] bg-[var(--color-panel)] p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-brand)]">{label}</p>
      <div className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-text)]">{children}</div>
    </aside>
  );
}

/**
 * The verification ladder as a diagram. Each rung answers one question the one below cannot.
 * `stop` marks where a hash-only tool stops. `at` highlights the rung a given claim reached.
 */
export function LadderDiagram({ at }: { at?: "declared" | "resolvable" | "intact" | "parsed" | "true" }) {
  const rungs = [
    { k: "declared", q: "does the record point at anything?" },
    { k: "resolvable", q: "does the document still exist?" },
    { k: "intact", q: "are the bytes the ones committed on chain?" },
    { k: "parsed", q: "can we read what it claims?" },
    { k: "true", q: "did the payment reach the recipient, on the chain it names?" },
  ] as const;
  const H = 52;
  return (
    <figure className="my-7 max-w-[56rem]">
      <svg viewBox={`0 0 760 ${rungs.length * H + 34}`} role="img" aria-label="The five rungs of the verification ladder, from declared up to true" className="h-auto w-full">
        {rungs
          .slice()
          .reverse()
          .map((r, i) => {
            const y = 8 + i * H;
            const hit = at === r.k;
            const top = r.k === "true";
            return (
              <g key={r.k}>
                <rect
                  x="8"
                  y={y}
                  width="744"
                  height={H - 10}
                  rx="9"
                  fill="var(--color-panel)"
                  stroke={hit ? "var(--color-brand)" : top ? "var(--color-true)" : "var(--color-line)"}
                  strokeWidth={hit || top ? 2 : 1}
                />
                <text x="28" y={y + 27} fontFamily="var(--font-mono)" fontSize="15" fill={top ? "var(--color-true)" : "var(--color-text)"}>
                  {r.k}
                </text>
                <text x="168" y={y + 27} fontFamily="var(--font-sans)" fontSize="14.5" fill="var(--color-muted)">
                  {r.q}
                </text>
              </g>
            );
          })}
        <line x1="8" x2="752" y1={8 + 2 * H - 5} y2={8 + 2 * H - 5} stroke="var(--color-false)" strokeDasharray="6 5" />
        <text x="752" y={8 + 2 * H - 11} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11.5" fill="var(--color-false)">
          a hash-only check stops below this line
        </text>
      </svg>
      <figcaption className="mt-2 max-w-[46rem] text-[13px] leading-relaxed text-muted">
        One rung per question, per claim. A claim that fails a rung stops there. A rung that could not be
        checked is <span className="unknown-value">unknown</span>, never false.
      </figcaption>
    </figure>
  );
}
