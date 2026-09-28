/**
 * Where the 73 went.
 *
 * Every one of the 73 `false` verdicts declares Monad. This draws that single declaration splitting into
 * the chains the cited transactions actually live on, with each stream's thickness proportional to its
 * count. It is the finding that reversed the project's own headline, so it is drawn rather than listed:
 * 64 real payments on the wrong network and 9 hashes that exist nowhere read as one number for months,
 * and the picture is what makes the difference impossible to miss.
 *
 * ## Encoding and why it is this plain
 *
 * One colour for all 64 mislabelled streams. They are the same finding on different chains, so giving
 * Arbitrum and Base their own hues would spend the colour channel on identity that the direct label
 * already carries, which is the value-ramp-on-nominal-categories mistake. The 9 that exist nowhere take
 * the `false` colour because that is exactly what they are: every chain we can read was read and the
 * transaction is on none of them. Status colour only where the colour means the status.
 *
 * Direct labels at every destination, no legend. Position and label do the work.
 *
 * ## Motion
 *
 * Server-rendered and complete. With no JavaScript, reduced motion or a full-page capture the diagram
 * is fully drawn, because the draw-in is only attached under `[data-reveal="in"]`, which is set from the
 * client. The animation's end state is the natural state, so it can only ever arrive at the truth.
 */

type Dest = { key: string; label: string; count: number; kind: "elsewhere" | "nowhere" };

type Geometry = {
  width: number;
  height: number;
  srcX: number;
  srcW: number;
  dstX: number;
  dstW: number;
  top: number;
  bottom: number;
  gap: number;
  labelSize: number;
  countSize: number;
};

const WIDE: Geometry = {
  width: 1000, height: 430, srcX: 40, srcW: 14, dstX: 700, dstW: 10,
  top: 30, bottom: 400, gap: 14, labelSize: 15, countSize: 15,
};
const TALL: Geometry = {
  width: 420, height: 560, srcX: 10, srcW: 12, dstX: 250, dstW: 10,
  top: 24, bottom: 536, gap: 16, labelSize: 17, countSize: 17,
};

function layout(dests: Dest[], total: number, g: Geometry) {
  const span = g.bottom - g.top;
  const usable = span - g.gap * (dests.length - 1);
  // A floor so a count of 3 is still a visible ribbon rather than a hairline. Recorded rather than
  // hidden: at these sizes the floor only ever widens, never narrows, so no stream looks smaller than
  // it is relative to the one above it.
  const unit = usable / total;
  const minH = 6;
  const heights = dests.map((d) => Math.max(d.count * unit, minH));
  const scale = usable / heights.reduce((a, b) => a + b, 0);
  const hs = heights.map((h) => h * scale);

  // The source band is the same total height, centred, with no gaps: one declaration, not six.
  const srcH = hs.reduce((a, b) => a + b, 0);
  const srcTop = g.top + (span - srcH) / 2;

  let sy = srcTop;
  let dy = g.top;
  return dests.map((d, i) => {
    const h = hs[i];
    const s0 = sy;
    const t0 = dy;
    sy += h;
    dy += h + g.gap;
    const x0 = g.srcX + g.srcW;
    const x1 = g.dstX;
    const mx = x0 + (x1 - x0) * 0.5;
    // A filled ribbon: top edge curves from source slice to destination slice, bottom edge back.
    const path =
      `M${x0},${s0} C${mx},${s0} ${mx},${t0} ${x1},${t0} ` +
      `L${x1},${t0 + h} C${mx},${t0 + h} ${mx},${s0 + h} ${x0},${s0 + h} Z`;
    return { ...d, path, t0, h, i };
  });
}

function Flow({ dests, total, g, variant }: { dests: Dest[]; total: number; g: Geometry; variant: "wide" | "tall" }) {
  const rows = layout(dests, total, g);
  const clipId = `flow-clip-${variant}`;
  const srcH = rows.reduce((a, r) => a + r.h, 0);
  const srcTop = g.top + (g.bottom - g.top - srcH) / 2;
  const elsewhere = dests.filter((d) => d.kind === "elsewhere").reduce((a, d) => a + d.count, 0);
  const nowhere = dests.filter((d) => d.kind === "nowhere").reduce((a, d) => a + d.count, 0);

  return (
    <svg
      className={`flow wflow--${variant}`}
      viewBox={`0 0 ${g.width} ${g.height}`}
      role="img"
      aria-labelledby={`flow-title-${variant} flow-desc-${variant}`}
    >
      <title id={`flow-title-${variant}`}>Where the {total} claims that name Monad actually settled</title>
      <desc id={`flow-desc-${variant}`}>
        {`All ${total} cite a transaction on Monad that is not there. ${elsewhere} are real transactions on another chain: ` +
          dests.filter((d) => d.kind === "elsewhere").map((d) => `${d.label} ${d.count}`).join(", ") +
          `. ${nowhere} exist on no chain we can read.`}
      </desc>

      <defs>
        <clipPath id={clipId}>
          <rect className="wflow__wipe" x="0" y="0" width={g.width} height={g.height} />
        </clipPath>
        {/* One gradient per kind. A single shared gradient with currentColor resolved against <defs>,
            not the path using it, so every stream rendered in the text colour and the 9 that exist
            nowhere lost the one colour that says what they are. Caught by looking at the render. */}
        {(["elsewhere", "nowhere"] as const).map((k) => (
          <linearGradient key={k} id={`flow-fade-${k}-${variant}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className={`wflow__stop wflow__stop--${k}`} stopOpacity="0.18" />
            <stop offset="1" className={`wflow__stop wflow__stop--${k}`} stopOpacity="0.62" />
          </linearGradient>
        ))}
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {rows.map((r) => (
          <path
            key={r.key}
            d={r.path}
            className={`wflow__stream wflow__stream--${r.kind}`}
            fill={`url(#flow-fade-${r.kind}-${variant})`}
            style={{ ["--i" as string]: r.i }}
          />
        ))}
      </g>

      {/* The source: one declaration, drawn as a single bar so it reads as one claim splitting. */}
      <rect className="wflow__source" x={g.srcX} y={srcTop} width={g.srcW} height={srcH} rx={2} />

      {rows.map((r) => {
        const cy = r.t0 + r.h / 2;
        const lx = g.dstX + g.dstW + 12;
        return (
          <g key={`${r.key}-label`} className="wflow__label" style={{ ["--i" as string]: r.i }}>
            <rect className={`wflow__dest wflow__dest--${r.kind}`} x={g.dstX} y={r.t0} width={g.dstW} height={r.h} rx={2} />
            <text x={lx} y={cy} dominantBaseline="middle" fontSize={g.labelSize} className="wflow__name">
              {r.label}
            </text>
            <text
              x={g.width - 4}
              y={cy}
              dominantBaseline="middle"
              textAnchor="end"
              fontSize={g.countSize}
              className={`wflow__count wflow__count--${r.kind}`}
            >
              {r.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function WhereItWent({
  byChain,
  nowhere,
}: {
  byChain: { chain: string; count: number }[];
  nowhere: number;
}) {
  const dests: Dest[] = [
    ...byChain
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((c) => ({ key: c.chain, label: c.chain, count: c.count, kind: "elsewhere" as const })),
    ...(nowhere > 0 ? [{ key: "nowhere", label: "on no chain", count: nowhere, kind: "nowhere" as const }] : []),
  ];
  const total = dests.reduce((a, d) => a + d.count, 0);
  if (total === 0) return null;

  return (
    <figure className="where">
      <div className="where__head">
        <span className="where__src-label">
          document says <span className="font-mono text-[var(--color-text)]">monad</span>
          <span className="where__src-n">{total}</span>
        </span>
        <span className="where__dst-label">transaction is actually on</span>
      </div>
      {/* Two renders of one layout, chosen by width in CSS, so labels stay legible on a phone. */}
      <Flow dests={dests} total={total} g={WIDE} variant="wide" />
      <Flow dests={dests} total={total} g={TALL} variant="tall" />
    </figure>
  );
}
