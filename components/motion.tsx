"use client";

/**
 * Craft-only motion, progressively enhanced.
 *
 * Nothing here changes meaning. The server already renders the real content and the real numbers;
 * these components add monad.xyz-style entrance motion on top and remove themselves entirely when
 * the reader has asked for reduced motion. If JavaScript never runs, the CSS fallbacks in
 * globals.css keep every section fully visible, so no measurement is ever trapped behind an
 * animation.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Should entry motion play for this element, right now?
 *
 * Only when the element entered view because the reader SCROLLED to it, with a normal viewport. A
 * full-page capture (link previews, screenshot tools, a judge's full-page grab) instead grows the
 * viewport to the whole document, which makes every observed element intersect at once without any
 * scroll and the capture fires mid-animation: 64 rendered as 18 and 8,093 as 1,647 on 2026-09-28.
 * So entry motion is refused when the viewport is taller than a real screen or no scroll has
 * happened since load. In those cases the element simply appears settled, which is the true state.
 */
let scrolledSinceLoad = false;
if (typeof window !== "undefined") {
  window.addEventListener("scroll", () => { scrolledSinceLoad = true; }, { passive: true, once: true });
}
export function mayAnimateEntry(): boolean {
  if (typeof window === "undefined") return false;
  if (prefersReducedMotion()) return false;
  // No real screen is this tall. A capture tool that sized the viewport to the page is.
  if (window.innerHeight > 1600 || window.innerHeight > window.screen.height + 200) return false;
  return scrolledSinceLoad;
}

/**
 * Reveals its children as they enter the viewport. Sets `data-reveal="in"` once, then stops
 * observing. `delay` staggers a row of siblings. `as` picks the element so this can wrap a section
 * without adding a wrapper div where one is not wanted.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-reveal", "in");
      return;
    }
    /**
     * Content is NEVER hidden while waiting.
     *
     * The earlier design armed every below-fold section as "pending" (opacity 0) until its observer
     * fired. A reader scrolling never noticed, but a stitched full-page screenshot, which scrolls the
     * document without moving the viewport, saw every section below the hero as blank. Now an element
     * stays fully visible until the moment it is actually entering because of a real scroll and only
     * then drops to the start pose for ONE frame and animates in. Anything that never sees a real
     * scroll-caused entry is simply shown, settled, from the start.
     */
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.disconnect();
          if (!mayAnimateEntry()) {
            el.setAttribute("data-reveal-static", "");
            el.setAttribute("data-reveal", "in");
            return;
          }
          el.setAttribute("data-reveal", "pending");
          requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute("data-reveal", "in")));
          return;
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      className={className}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/**
 * One pointer listener for the whole document that lets any card answer the cursor.
 *
 * Instead of a hook per card, this finds the nearest `.spot`-style surface under the pointer and
 * writes the pointer position into it as `--spot-x` / `--spot-y`. CSS draws a brand-tinted rim that
 * follows the cursor from those two variables. One passive listener, one rAF per frame at most and
 * nothing at all on touch screens or under reduced motion, where a hover light means nothing.
 */
const SPOT_SELECTOR = ".spot, .layer, .glow-lift, .rail__step, .flow__step, .finding";

export function Spotlight() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const e = last;
      if (!e || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>(SPOT_SELECTOR);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
      el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

/**
 * Makes its parent a pointer-reactive field. Writes `--px` / `--py` (0..1, eased toward the
 * pointer) onto the parent element, which CSS uses for a slow parallax of the hero's aurora and
 * aperture. Renders an empty, hidden span so it can sit inside a server-rendered section without
 * turning that section into a client component. The easing runs only while the values are
 * still settling, then the loop stops.
 */
export function PointerField() {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0.5, ty = 0.5, x = 0.5, y = 0.5, frame = 0;
    const step = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      host.style.setProperty("--px", x.toFixed(4));
      host.style.setProperty("--py", y.toFixed(4));
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      tx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      ty = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
      kick();
    };
    const onLeave = () => {
      tx = 0.5;
      ty = 0.5;
      kick();
    };
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <span ref={ref} hidden aria-hidden="true" />;
}

/**
 * A headline that arrives word by word. Pure CSS once rendered: each word is an inline-block with
 * its index as `--w` and `.split` staggers a masked rise from that. The words stay separated by
 * real spaces, so the heading reads and copies exactly as the plain string does.
 */
export function SplitWords({ text, className = "" }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={`split ${className}`}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span className="split__mask">
            <span className="split__word" style={{ ["--w" as string]: i }}>
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

/**
 * A number that is never wrong, even for one frame.
 *
 * The previous version counted up from zero. On mount it set the display to 0 and waited for an
 * IntersectionObserver at 40% visibility. Anything that rendered the page without scrolling that exact
 * element into view saw zero: screenshot tools, link previews, reader mode, print, a judge who scrolls
 * fast. On 2026-09-28 the landing's lead finding read "0 of those payments are real" when the truth was
 * 64, which is the opposite claim. For a project whose whole argument is that published numbers must
 * survive being checked, that is the worst bug the motion layer can have.
 *
 * So the rule now: the true digits are ALWAYS in the DOM, in order, at rest. Motion only decides how
 * each digit arrives. Each digit sits in a one-character window over a vertical strip 0 to 9 and the
 * strip is translated to the correct row. On entry the strips start a few rows off and settle with a
 * stagger, which reads as an odometer. If JavaScript never runs, if the observer never fires, if the
 * reader prefers reduced motion, every strip is already at its true row.
 *
 * Screen readers get the formatted value once through aria-label and never see the strips, so a
 * counter is announced as "8,093", not as forty digits.
 */
export function CountUp({
  value,
  className = "",
  durationMs = 1100,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const text = value.toLocaleString("en-US");
  const ref = useRef<HTMLSpanElement | null>(null);
  // Resting state is "settled" and it STAYS settled until the instant the counter becomes visible.
  //
  // The first version armed off-screen counters on mount, offsetting each strip and waiting for the
  // observer. That was invisible to a scrolling reader and fatal to a full-page capture: a screenshot
  // tool, print or a link previewer reads the whole document without scrolling and saw the offset
  // digits, so 8,093 rendered as 1,647. Measured, not guessed, by reading each strip's computed
  // translate in a headless browser. So nothing is offset until the frame it enters view and the
  // roll plays from there. An element that is never observed is never moved.
  const [phase, setPhase] = useState<"settled" | "armed" | "rolling">("settled");

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // Stay settled unless the reader scrolled here with a real viewport.
        if (!mayAnimateEntry()) return;
        // Offset and release in consecutive frames: the offset is painted for one frame at most,
        // and only while the element is actually on screen, which is the roll the reader sees.
        setPhase("armed");
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => setPhase("rolling"));
        });
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  let digitIndex = 0;
  const digits = [...text].filter((c) => c >= "0" && c <= "9").length;

  /**
   * The ONLY text node in here is the true number, digit by digit, in order.
   *
   * An earlier cut rendered each strip as ten real <span>0</span>..<span>9</span> children. A person saw
   * the right digits, but textContent read "80123456789,0012345678990123..." for 8,093, which is what a
   * search engine indexes, what copy and paste produces and what any agent reading the HTML gets. The
   * strip is now CSS generated content on an aria-hidden element, so it is drawn and never read. The
   * glyph underneath is the real digit, transparent so the strip shows through, still selectable and
   * copyable and it is what gives each cell its exact width so layout cannot shift while rolling.
   */
  return (
    <span
      ref={ref}
      className={`odometer tnum ${className}`}
      data-phase={phase}
      data-value={text}
      style={{ ["--roll-ms" as string]: `${durationMs}ms` }}
    >
      {[...text].map((ch, i) => {
        if (ch < "0" || ch > "9") {
          return (
            <span key={i} className="odometer__sep">
              {ch}
            </span>
          );
        }
        const d = Number(ch);
        const order = digitIndex++;
        const travel = 3 + ((digits - order) % 4);
        return (
          <span key={i} className="odometer__cell">
            <span className="odometer__glyph">{ch}</span>
            <span
              className="odometer__strip"
              aria-hidden="true"
              style={{
                ["--d" as string]: d,
                ["--from" as string]: (d + travel) % 10,
                ["--i" as string]: order,
              }}
            />
          </span>
        );
      })}
    </span>
  );
}
