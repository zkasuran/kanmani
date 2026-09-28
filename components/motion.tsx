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
    // Arm from JS only. The server rendered this element visible; we hide it now, on the client,
    // knowing the observer below will reveal it. If this effect never runs the element simply stays
    // visible, so the page can never be trapped blank by the reveal layer.
    el.setAttribute("data-reveal", "pending");
    // If it is already in view on mount (above the fold), reveal on the next frame so the transition
    // still plays from hidden to shown rather than snapping.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.setAttribute("data-reveal", "in");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    // Safety net: whatever happens with the observer, never leave an element armed-but-hidden for
    // more than a moment. If it has not been revealed shortly after mount, reveal it.
    const failsafe = window.setTimeout(() => {
      if (el.getAttribute("data-reveal") !== "in") el.setAttribute("data-reveal", "in");
    }, 1200);
    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
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
 * follows the cursor from those two variables. One passive listener, one rAF per frame at most, and
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
 * its index as `--w`, and `.split` staggers a masked rise from that. The words stay separated by
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
 * Counts up to `value` once, when it scrolls into view. The formatted final value is always the
 * initial server-rendered text, so a screen reader and a reduced-motion reader see the true number
 * immediately; the tween is decoration layered on afterwards.
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
  const [display, setDisplay] = useState<number>(value);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    // Start from 0 only once we know we will animate.
    setDisplay(0);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            io.disconnect();
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min((now - start) / durationMs, 1);
              // easeOutCubic
              const eased = 1 - Math.pow(1 - t, 3);
              setDisplay(Math.round(eased * value));
              if (t < 1) requestAnimationFrame(tick);
              else setDisplay(value);
            };
            requestAnimationFrame(tick);
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, durationMs]);

  return (
    <span ref={ref} className={`tnum ${className}`}>
      {display.toLocaleString("en-US")}
    </span>
  );
}
