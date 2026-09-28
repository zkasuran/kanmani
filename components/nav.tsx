"use client";

/**
 * The navigation, as a product spine rather than a list of documents.
 *
 * It used to be eleven flat entries: agents, operators, claims, verify, studio, chains, account,
 * validate, compare, method, status. That reads as an index of reports and a reader arriving at it
 * has to build the product's model in their own head before they can choose. Nothing was wrong with
 * any single page; the shape was wrong.
 *
 * Four groups now, each answering one question a visitor actually has:
 *
 *   Explore    what is out there and what is true about it
 *   Build      do something: check a claim, register or repoint an agent
 *   Trust      how a verdict is decided, how fresh it is, what was covered
 *   Developers render this in your own product
 *
 * Nothing is deleted. The pages that were tabs are now reachable inside the group they belong to, so
 * depth is one hover away instead of competing for the same row. `Developers` is new and is the only
 * group that is a destination in itself, because it is the one the product is for.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Item = { href: string; label: string; hint: string };
type Group = { label: string; href: string; items: Item[] };

/**
 * The groups, in the order somebody actually moves through the product.
 *
 * Create an agent, verify a claim about one, settle money against it, explore the population, build on
 * it, then check how fresh any of it is. That sequence is the product's own argument, so the navigation
 * states it rather than making a reader infer it from an alphabetical list.
 *
 * It replaced two worse shapes. First eleven flat tabs, which read as an index of documents. Then four
 * groups whose order was arbitrary. `explore` first meant the first thing a visitor saw was somebody
 * else's data rather than anything they could do.
 *
 * `status` is last and is a destination rather than a group, because it answers a question a reader
 * only has after they have believed something: how old is that number.
 */
const GROUPS: Group[] = [
  {
    label: "create",
    href: "/studio",
    items: [
      { href: "/studio", label: "studio", hint: "register an agent or repoint one you own" },
      { href: "/account", label: "account", hint: "one passkey, four keys, nothing stored" },
    ],
  },
  {
    label: "verify",
    href: "/verify",
    items: [
      { href: "/verify", label: "verify", hint: "paste anything, get a verdict" },
      { href: "/claims", label: "claims", hint: "every evidence document and what checking it found" },
    ],
  },
  {
    label: "settle",
    href: "/pay",
    items: [
      { href: "/pay", label: "pay", hint: "settle a job without a wallet" },
      { href: "/bond", label: "bond", hint: "stake on your own claim-truth rate" },
      { href: "/fund", label: "fund", hint: "pay from another chain" },
    ],
  },
  {
    label: "explore",
    href: "/agents",
    items: [
      { href: "/agents", label: "agents", hint: "every registered agent, filterable" },
      { href: "/operators", label: "operators", hint: "clustered by the document they registered" },
      { href: "/compare", label: "compare", hint: "two to four agents, rung first" },
      { href: "/chains", label: "chains", hint: "what we read and what hosts agents" },
    ],
  },
  {
    label: "reports",
    href: "/status",
    items: [
      { href: "/method", label: "method", hint: "how each rung is decided, reproducible by hand" },
      { href: "/validate", label: "validate", hint: "the on-chain validation registry" },
      { href: "/status", label: "coverage", hint: "what is measured, how fresh it is, what is missing" },
      { href: "/status#corrections", label: "corrections", hint: "every published claim we have had to withdraw" },
    ],
  },
  {
    label: "developers",
    href: "/developers",
    items: [
      { href: "/developers#components", label: "components", hint: "the kit, rendering live data on the page" },
      { href: "/developers#embed", label: "embed", hint: "one script tag, no build step" },
      { href: "/developers#api", label: "api", hint: "open, no key, every response carries its own proof" },
      { href: "/developers#chains", label: "add a chain", hint: "one registry entry and the tests name what is missing" },
    ],
  },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  /* Item anchors per group, so arrow keys can move focus without querying the DOM by selector. */
  const itemRefs = useRef<Record<string, (HTMLAnchorElement | null)[]>>({});
  const labelRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    setOpen(false);
    setHover(null);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const inGroup = (g: Group) =>
    g.items.length === 0 ? path.startsWith(g.href) : g.items.some((i) => path === i.href || path.startsWith(`${i.href}/`));

  /**
   * Hover intent, so a diagonal path to an item is not hijacked by the labels it crosses.
   *
   * The panels open leftward from their label (see the className note below), so reaching an item on
   * the left of a panel means travelling diagonally down-left, across the NEIGHBOURING labels. With
   * instant switching, the pointer crossed "settle" on its way to the settle panel's first item and the
   * verify panel replaced it. Leaving the label sideways before reaching the panel's top edge also
   * outlasted the 120ms close delay. Measured with scripted mouse paths: 6 of 12 diagonal routes landed
   * on the wrong menu or none.
   *
   * While a panel is open, moving downward over its horizontal span counts as "aiming" for it. A switch or close requested from inside it is deferred and it only
   * happens if the pointer stops moving there for SETTLE_MS or leaves the triangle. Entering the panel
   * cancels it. Outside the triangle everything is immediate, so scanning across the bar still feels
   * instant.
   */
  // 300ms: long enough that a diagonal is never hijacked by the labels it crosses, short enough that
  // deliberately resting on a neighbour still opens it without feeling sluggish.
  const SETTLE_MS = 300;
  const pointer = useRef({ x: 0, y: 0 });
  const apex = useRef<{ x: number; y: number } | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const pending = useRef<string | null | undefined>(undefined);
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hover;

  const lastDy = useRef(0);
  /** Set while Escape hands focus back to a label, so that focus does not reopen the menu it closed. */
  const returning = useRef(false);
  /**
   * Heading for the open panel. The panel sits directly under the bar, so a triangle from the pointer
   * to the panel's top edge is only a few pixels tall: a real diagonal path slid out of it within one
   * move and 2 of 12 routes still failed. The dependable signal is direction. Over the panel's
   * horizontal span, inside the bar band and moving downward means going for the panel. Scanning
   * sideways across the bar has no downward motion, so it switches instantly as before.
   */
  const aiming = (pt: { x: number; y: number }) => {
    const a = apex.current;
    const panel = panelEl.current;
    if (!a || !panel || !hoverRef.current) return false;
    const r = panel.getBoundingClientRect();
    if (pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom) return true;
    const inSpan = pt.x >= r.left - 12 && pt.x <= r.right + 12;
    const inBand = pt.y >= a.y - 14 && pt.y <= r.top + 4;
    return inSpan && inBand && lastDy.current > 0;
  };

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const resolve = () => {
    clearTimer();
    if (pending.current !== undefined) setHover(pending.current);
    pending.current = undefined;
  };
  const defer = (next: string | null) => {
    pending.current = next;
    clearTimer();
    timer.current = window.setTimeout(resolve, SETTLE_MS);
  };

  useEffect(() => {
    if (!hover) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientY !== pointer.current.y) lastDy.current = e.clientY - pointer.current.y;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (pending.current === undefined) return;
      // Still heading for the panel: keep waiting, restarting the settle clock on each move.
      if (aiming(pointer.current)) defer(pending.current);
      else resolve();
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  const enter = (label: string) => {
    if (hoverRef.current && hoverRef.current !== label && aiming(pointer.current)) {
      defer(label);
      return;
    }
    pending.current = undefined;
    clearTimer();
    // Seed the apex where the pointer entered, so the very first diagonal move is already protected.
    apex.current = { ...pointer.current };
    setHover(label);
  };
  const leave = () => {
    if (hoverRef.current && aiming(pointer.current)) {
      defer(null);
      return;
    }
    // An ordinary exit keeps its 120ms grace and is NOT an aim deferral, so the move listener leaves
    // it alone. Treating it as one resolved every close instantly and blinked the menu shut in the
    // four-pixel gap between labels while scanning across the bar.
    clearTimer();
    pending.current = undefined;
    timer.current = window.setTimeout(() => setHover(null), 120);
  };
  const enterPanel = (label: string) => {
    pending.current = undefined;
    clearTimer();
    setHover(label);
  };
  /** The apex follows the pointer only while it is inside the open group's own label. */
  const trackApex = (e: React.MouseEvent, label: string) => {
    if (e.clientY !== pointer.current.y) lastDy.current = e.clientY - pointer.current.y;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (hoverRef.current === label) apex.current = { x: e.clientX, y: e.clientY };
  };

  /**
   * Keyboard parity with the pointer. Touch has no hover and a keyboard has no pointer, so the
   * submenu has to open from focus as well, otherwise every item in it is unreachable without a mouse.
   * Down opens and enters, Up enters at the end, Escape closes and hands focus back to the label.
   */
  const onLabelKey = (e: React.KeyboardEvent, g: Group) => {
    if (g.items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      enter(g.label);
      const idx = e.key === "ArrowDown" ? 0 : g.items.length - 1;
      window.setTimeout(() => itemRefs.current[g.label]?.[idx]?.focus(), 0);
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const onItemKey = (e: React.KeyboardEvent, g: Group, i: number) => {
    const list = itemRefs.current[g.label] ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setHover(null);
      returning.current = true;
      labelRefs.current[g.label]?.focus();
      returning.current = false;
    }
  };

  return (
    <>
      <nav className="ml-auto hidden items-center gap-x-1 md:flex">
        {GROUPS.map((g) => {
          const active = inGroup(g);
          const shown = hover === g.label && g.items.length > 0;
          return (
            <div
              key={g.label}
              className="relative"
              onMouseEnter={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY };
                enter(g.label);
              }}
              onMouseLeave={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY };
                leave();
              }}
              onFocus={() => {
                if (!returning.current) enterPanel(g.label);
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
              }}
            >
              <Link
                href={g.href}
                ref={(el) => {
                  labelRefs.current[g.label] = el;
                }}
                aria-current={active ? "page" : undefined}
                aria-haspopup={g.items.length > 0 ? "menu" : undefined}
                aria-expanded={g.items.length > 0 ? shown : undefined}
                onKeyDown={(e) => onLabelKey(e, g)}
                onMouseMove={(e) => trackApex(e, g.label)}
                className={`nav-link inline-block rounded px-2.5 py-1.5 font-mono text-[12px] transition-colors ${
                  active ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"
                }`}
              >
                {g.label}
              </Link>
              {shown ? (
                <div
                  role="menu"
                  aria-label={g.label}
                  /**
                   * Anchored to the RIGHT edge of its label, not the left.
                   *
                   * The nav sits flush right (`ml-auto`), so a 19rem panel opening rightward from the
                   * last groups ran off the viewport: `developers` is the final label, so its panel had
                   * almost no room to its right at all. Opening inward means the panel grows back across
                   * the page, where there is always space because the nav is the rightmost thing in a
                   * centred container.
                   *
                   * `max-w` is the belt to that braces: at a narrow desktop width the leftmost group
                   * could otherwise push past the left gutter, so the panel shrinks rather than
                   * overflowing on the other side.
                   */
                  ref={panelEl}
                  className="menu-pop absolute right-0 top-full z-30 w-[19rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-1.5 shadow-[var(--shadow-2)]"
                  onMouseEnter={() => enterPanel(g.label)}
                  onMouseLeave={(e) => {
                    pointer.current = { x: e.clientX, y: e.clientY };
                    leave();
                  }}
                >
                  {g.items.map((i, idx) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      role="menuitem"
                      ref={(el) => {
                        if (!itemRefs.current[g.label]) itemRefs.current[g.label] = [];
                        itemRefs.current[g.label][idx] = el;
                      }}
                      onKeyDown={(e) => onItemKey(e, g, idx)}
                      style={{ ["--i" as string]: idx }}
                      className={`menu-item block rounded px-2.5 py-2 transition-colors hover:bg-[var(--color-panel-2)] ${
                        path === i.href ? "bg-[var(--color-panel-2)]" : ""
                      }`}
                    >
                      <span
                        className={`font-mono text-[12px] ${
                          path === i.href ? "text-[var(--color-brand)]" : "text-[var(--color-text)]"
                        }`}
                      >
                        {i.label}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{i.hint}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--color-line-bright)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-faint)] hover:text-[var(--color-text)] md:hidden"
      >
        <span className="relative block h-3.5 w-4">
          <span className="absolute left-0 h-[1.5px] w-full bg-current transition-all duration-200" style={{ top: open ? "6px" : "1px", transform: open ? "rotate(45deg)" : "none" }} />
          <span className="absolute left-0 top-[6px] h-[1.5px] w-full bg-current transition-opacity duration-200" style={{ opacity: open ? 0 : 1 }} />
          <span className="absolute left-0 h-[1.5px] w-full bg-current transition-all duration-200" style={{ top: open ? "6px" : "11px", transform: open ? "rotate(-45deg)" : "none" }} />
        </span>
      </button>

      {/* Portalled to <body>: inside the header, its backdrop-filter would become the containing block
          of this `fixed` sheet and pin it inside the header shell. `open` is client-only state, so
          `document` always exists when this renders. */}
      {open ? createPortal(
        <div
          id="mobile-nav"
          className="mobile-sheet sheet-in field field-live fixed inset-x-0 top-[var(--header-h,4.5rem)] z-30 max-h-[80vh] overflow-y-auto border-b border-[var(--color-line)] md:hidden"
        >
          <nav className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 py-4">
            {GROUPS.map((g, gi) => (
              <div key={g.label} className="sheet-group" style={{ ["--i" as string]: gi }}>
                <Link href={g.href} className="kicker">
                  {g.label}
                </Link>
                {g.items.length ? (
                  <div className="mt-2 flex flex-col">
                    {g.items.map((i) => (
                      <Link
                        key={i.href}
                        href={i.href}
                        className={`border-b border-[var(--color-line)]/60 py-2.5 font-mono text-[13px] last:border-0 ${
                          path === i.href ? "text-[var(--color-brand)]" : "text-muted"
                        }`}
                      >
                        {i.label}
                        <span className="ml-2 font-sans text-[11px] text-faint">{i.hint}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
