/**
 * Kanmani's verification aperture: two counterparties close around one proof node.
 *
 * Inline SVG keeps the violet rails and cyan evidence node crisp at navigation and favicon sizes,
 * follows the site without an extra request, and shares geometry with every generated brand asset.
 * The small variant uses the same silhouette with a heavier stroke for legibility below 48px.
 */

type Props = {
  /** Rendered size in px. Both axes: the mark is square. */
  size?: number;
  /** `small` below about 48px. See the note above. */
  variant?: "full" | "small";
  className?: string;
  /** Decorative next to a wordmark, so it is hidden from screen readers by default. */
  label?: string;
};

const FULL = "M13 7L4.5 16L13 25M19 7L27.5 16L19 25";
const SMALL = "M12.5 8L5 16L12.5 24M19.5 8L27 16L19.5 24";

export function Logo({ size = 22, variant = "full", className, label }: Props) {
  const small = variant === "small";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      // Decorative by default. The header pairs this with the word "kanmani", so announcing it again
      // would read the brand twice to anyone using a screen reader.
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path
        d={small ? SMALL : FULL}
        fill="none"
        stroke="currentColor"
        strokeWidth={small ? 3.2 : 2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r={small ? 2.8 : 2.35} fill="var(--color-logo-node, currentColor)" />
    </svg>
  );
}
