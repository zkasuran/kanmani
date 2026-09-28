/**
 * Kanmani's verification aperture: two counterparties close around one proof node.
 *
 * Inline SVG keeps the violet rails and cyan evidence node crisp at navigation and favicon sizes,
 * follows the site without an extra request, and shares geometry with every generated brand asset.
 * The small variant uses the same silhouette with a heavier stroke for legibility below 48px.
 *
 * ## Motion
 *
 * `animated` splits the two rails into separate paths so the mark can tell its own story: the
 * counterparties slide in from outside, the proof node lands between them and one ring of light
 * leaves it. On hover of the enclosing `.group` the aperture tightens a hair, the way a lens
 * focuses. All of it is CSS in globals.css under `.logo-anim` and all of it is removed under
 * reduced motion, leaving the exact static geometry.
 */

type Props = {
  size?: number;
  variant?: "full" | "small";
  className?: string;
  /** Decorative next to a wordmark, so it is hidden from screen readers by default. */
  label?: string;
  /** Play the entrance and respond to hover. Header only; favicons and footers stay still. */
  animated?: boolean;
};

const FULL = "M13 7L4.5 16L13 25M19 7L27.5 16L19 25";
const SMALL = "M12.5 8L5 16L12.5 24M19.5 8L27 16L19.5 24";
const FULL_L = "M13 7L4.5 16L13 25";
const FULL_R = "M19 7L27.5 16L19 25";

export function Logo({ size = 22, variant = "full", className, label, animated = false }: Props) {
  const small = variant === "small";
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: small ? 3.2 : 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const r = small ? 2.8 : 2.35;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`${animated ? "logo-anim " : ""}${className ?? ""}`}
      overflow="visible"
      // Decorative by default. The header pairs this with the word "kanmani", so announcing it again
      // would read the brand twice to anyone using a screen reader.
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {animated && !small ? (
        <>
          <path className="logo__rail logo__rail--l" d={FULL_L} {...stroke} />
          <path className="logo__rail logo__rail--r" d={FULL_R} {...stroke} />
          <circle className="logo__ring" cx="16" cy="16" r={r} fill="none" stroke="var(--color-logo-node, currentColor)" strokeWidth="1" />
          <circle className="logo__node" cx="16" cy="16" r={r} fill="var(--color-logo-node, currentColor)" />
        </>
      ) : (
        <>
          <path d={small ? SMALL : FULL} {...stroke} />
          <circle cx="16" cy="16" r={r} fill="var(--color-logo-node, currentColor)" />
        </>
      )}
    </svg>
  );
}
