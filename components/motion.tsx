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
    // visible — the page can never be trapped blank by the reveal layer.
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
