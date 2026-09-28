/**
 * The hero's moving picture: the logo, grown into the thing it stands for.
 *
 * Two counterparties (the rails) close around one proof node. A payment packet leaves the buyer's
 * rail, lands on the node, the node checks it (the scan sweep and the pulse rings) and a receipt
 * leaves toward the agent's rail. Around it, blocks tick past on an orbit, because every verdict is
 * read at a block. It is one loop, eight seconds long, told with nothing but transform and opacity.
 *
 * Purely decorative: `aria-hidden`, no text, no numbers, no verdict colour. Every animated part is
 * a CSS class in globals.css under `.aperture`, so reduced motion reduces it to a still frame of
 * the finished state rather than a frozen mid-step.
 *
 * Server component. Parallax comes from `--px` / `--py`, written on the hero by <PointerField />.
 */
export function Aperture({ className = "" }: { className?: string }) {
  // Twelve blocks around the orbit, every third one brighter, so the ring reads as a sequence.
  const blocks = Array.from({ length: 12 }, (_, i) => i);
  // Sixty ticks on the dial, long every fifth.
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className={`aperture ${className}`} aria-hidden="true">
      <svg viewBox="0 0 400 400" className="aperture__svg" focusable="false">
        <defs>
          <radialGradient id="ap-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-brand-accent)" stopOpacity="0.55" />
            <stop offset="45%" stopColor="var(--color-brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ap-rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
            <stop offset="50%" stopColor="var(--color-brand)" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="ap-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-brand-accent)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--color-brand-accent)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="ap-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--color-brand-accent)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Depth 3: the far dial. Slowest parallax, slowest spin. */}
        <g className="aperture__layer aperture__layer--far">
          <circle cx="200" cy="200" r="186" className="aperture__ring aperture__ring--faint" />
          <g className="aperture__spin aperture__spin--slow">
            {ticks.map((i) => (
              <line
                key={i}
                x1="200"
                y1={i % 5 === 0 ? 22 : 26}
                x2="200"
                y2="30"
                className={i % 5 === 0 ? "aperture__tick aperture__tick--major" : "aperture__tick"}
                transform={`rotate(${i * 6} 200 200)`}
              />
            ))}
          </g>
          <circle cx="200" cy="200" r="150" className="aperture__ring aperture__ring--dashed aperture__spin aperture__spin--rev" />
        </g>

        {/* Depth 2: the block orbit and the scan. */}
        <g className="aperture__layer aperture__layer--mid">
          <g className="aperture__spin aperture__spin--orbit">
            {blocks.map((i) => (
              <rect
                key={i}
                x="195"
                y="81"
                width="10"
                height="10"
                rx="2.5"
                className={`aperture__block${i % 3 === 0 ? " aperture__block--lit" : ""}`}
                transform={`rotate(${i * 30} 200 200)`}
                style={{ ["--b" as string]: i }}
              />
            ))}
          </g>
          <circle cx="200" cy="200" r="119" className="aperture__ring" />
          {/* The scan: a quarter sector sweeping, like a lens reading the field. */}
          <g className="aperture__sweep">
            <path d="M200 200 L200 82 A118 118 0 0 1 318 200 Z" fill="url(#ap-sweep)" />
          </g>
        </g>

        {/* Depth 1: the counterparties, the transfer and the proof node. Fastest parallax. */}
        <g className="aperture__layer aperture__layer--near">
          <circle cx="200" cy="200" r="92" fill="url(#ap-core)" className="aperture__glow" />

          {/* The settlement line the packet travels along. */}
          <line x1="96" y1="200" x2="304" y2="200" className="aperture__wire" />
          <rect x="96" y="199" width="208" height="2" fill="url(#ap-beam)" className="aperture__beam" />

          <path d="M168 110 L88 200 L168 290" className="aperture__rail aperture__rail--l" stroke="url(#ap-rail)" />
          <path d="M232 110 L312 200 L232 290" className="aperture__rail aperture__rail--r" stroke="url(#ap-rail)" />

          {/* Payment in, receipt out. */}
          <circle cx="104" cy="200" r="5" className="aperture__packet aperture__packet--in" />
          <circle cx="200" cy="200" r="5" className="aperture__packet aperture__packet--out" />

          {/* The proof node and the rings it emits when a check lands. */}
          <circle cx="200" cy="200" r="22" className="aperture__pulse" style={{ ["--p" as string]: 0 }} />
          <circle cx="200" cy="200" r="22" className="aperture__pulse" style={{ ["--p" as string]: 1 }} />
          <circle cx="200" cy="200" r="22" className="aperture__pulse" style={{ ["--p" as string]: 2 }} />
          <circle cx="200" cy="200" r="30" className="aperture__halo" />
          <circle cx="200" cy="200" r="15" className="aperture__node" />
          <circle cx="200" cy="200" r="5.5" className="aperture__core" />
        </g>
      </svg>
    </div>
  );
}
