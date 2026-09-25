/**
 * The mark, as a component rather than an image file.
 *
 * ## Why inline SVG and not `<img src="/brand/mark.svg">`
 *
 * Three reasons, in order of how much they matter.
 *
 * It follows the theme. The stroke is `currentColor`, so the mark picks up whatever colour its parent
 * has in light or dark mode. A PNG or an external SVG is baked at build time and would need two files
 * and a media query to do the same job badly.
 *
 * It cannot flash. An external asset is a second request that lands after first paint, so the header
 * would render a gap and then a logo. Inline, it arrives with the markup.
 *
 * It cannot drift. The path here is the same 32-unit geometry `scripts/build-media.py` uses for every
 * raster, so the favicon, the X header and this cannot disagree about what the logo is.
 *
 * ## The two variants
 *
 * `full` is five rungs. `small` is three with a heavier stroke, for anything under about 48px, because
 * at 16px five rungs is two pixels each and reads as a smudge. Callers pick by intent rather than by
 * measuring, so the choice is a prop and not a guess about rendered size.
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

const FULL = "M5 25L10 25L10 21L15 21L15 17L20 17L20 13L25 13L25 9L27 9";
const SMALL = "M5 26L13 26L13 18L21 18L21 10L27 10";

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
        strokeWidth={small ? 3.4 : 2.1}
        strokeLinecap="square"
      />
      <circle cx={small ? 27 : 27} cy={small ? 10 : 9} r={small ? 3 : 2.2} fill="currentColor" />
    </svg>
  );
}
