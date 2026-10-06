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
import { AccountMenu, AccountNav } from "@/components/account.tsx";

type Item = { href: string; label: string; hint: string };
type Group = { label: string; href: string; items: Item[]; /** Renders its own panel instead of items. */ account?: true };

/**
 * The last entry, after the journey: the account, as direct links with no dropdown (AccountNav).
 * Signed out: log in and create account. Signed in: the short address, linking to /account. This
 * object is kept only so the active-state check and the mobile sheet share one definition.
 *
 * Its label turns into the short address, so the one place a reader looks for "am I logged in" is
 * the place that answers it. It shares the groups' hover logic, so moving to it from `developers`
 * behaves like moving between any two groups.
 */
const LOGIN: Group = { label: "account", href: "/account", items: [], account: true };

/**
 * The groups, in the order somebody actually moves through the product.
 *
 * Verify a claim about an agent, settle money against it, explore the population, build on
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
      { href: "/compliance", label: "compliance", hint: "settle only to a verified on-chain identity" },
    ],
  },
  {
    label: "explore",
    href: "/agents",
    items: [
      { href: "/hire", label: "hire", hint: "twelve agents for the checks before money moves" },
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
    label: "blog",
    href: "/blog",
    items: [],
  },
  {
    label: "developers",
    href: "/developers",
    items: [
      { href: "/developers#build", label: "build an agent", hint: "MCP, skill, AGENTS.md, OpenAPI: every way in" },
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
    g.account
      ? path.startsWith("/account") || path.startsWith("/login")
      : g.items.length === 0
      ? path.startsWith(g.href)
      : path === g.href || g.items.some((i) => path === i.href || path.startsWith(`${i.href}/`));

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
  /** A level move across the bar may be a scan, so a neighbour it rests on opens after this short beat. */
  const SCAN_MS = 120;
  /**
   * Opening from closed waits this long. A hand coming up from the page on a diagonal grazes the
   * corner of a neighbouring label on its way to the one it wants. Opened instantly, the neighbour
   * flashed for a frame or two before the target replaced it: traced on 72 scripted panel-to-label
   * climbs, a third of them showed a menu nobody asked for. Resting on a label for 90ms is still
   * well under what reads as a delay. Keyboard focus opens immediately.
   */
  const OPEN_MS = 90;
  /** The label waiting to open plus where the pointer was when its clock last restarted. */
  const opening = useRef<{ label: string; x: number; y: number } | null>(null);
  const openNow = (label: string) => {
    timer.current = null;
    opening.current = null;
    apex.current = { ...pointer.current };
    setHover(label);
  };
  const pointer = useRef({ x: 0, y: 0 });
  const apex = useRef<{ x: number; y: number } | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const pending = useRef<string | null | undefined>(undefined);
  /** Set while the pointer is above the page after leaving an open group through the top edge. */
  const parked = useRef(false);
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hover;

  /** Set while Escape hands focus back to a label, so that focus does not reopen the menu it closed. */
  const returning = useRef(false);
  /**
   * Heading for the open panel. The panel sits directly under the bar, so a triangle from the pointer
   * to the panel's top edge is only a few pixels tall: a real diagonal path slid out of it within one
   * move and 2 of 12 routes still failed. The dependable signal is direction. Over the panel's
   * horizontal span, inside the bar band and moving downward means going for the panel. Scanning
   * sideways across the bar has no downward motion, so it switches instantly as before.
   */
  const aiming = (pt: { x: number; y: number }): false | "descending" | "level" => {
    const a = apex.current;
    const panel = panelEl.current;
    if (!a || !panel || !hoverRef.current) return false;
    // The settled box, not the animated one. `menu-pop` scales and lifts the panel for its first
    // few hundred ms, so its live rect is narrower and higher than where it will sit. Judged on that,
    // a path aimed at the panel's far edge fell outside it and handed the menu to a neighbour.
    const host = (panel.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const r = host
      ? {
          left: host.left + panel.offsetLeft,
          right: host.left + panel.offsetLeft + panel.offsetWidth,
          top: host.top + panel.offsetTop,
          bottom: host.top + panel.offsetTop + panel.offsetHeight,
        }
      : panel.getBoundingClientRect();
    if (pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom) return "descending";
    const inSpan = pt.x >= r.left - 12 && pt.x <= r.right + 12;
    const inBand = pt.y >= a.y - 14 && pt.y <= r.top + 4;
    if (!inSpan || !inBand) return false;
    // Judged on the whole path since the label, not the last step. A hand heading for an item on the
    // far side of a leftward panel travels mostly sideways first. It often wobbles up a pixel or two
    // then drops only near the end. Requiring the last step to be downward handed the menu to each
    // neighbour it crossed: a traced curved path from reports to its first item gave the menu to
    // explore after 247ms. Level movement may still be a sideways scan, so it waits only a short beat
    // before switching. Clearly descending movement waits the full settle time.
    const dy = pt.y - a.y;
    if (dy < -3) return false;
    return dy > 2 ? "descending" : "level";
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
  const defer = (next: string | null, how: "descending" | "level") => {
    pending.current = next;
    clearTimer();
    timer.current = window.setTimeout(resolve, how === "descending" ? SETTLE_MS : SCAN_MS);
  };

  useEffect(() => {
    if (!hover) return;
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (parked.current) {
        // Back from above the page. Over a group or a panel, the enter handlers decide. Anywhere else
        // it is an ordinary exit with the usual grace.
        parked.current = false;
        const t = e.target as Element | null;
        if (!t?.closest?.(".nav-group")) {
          clearTimer();
          timer.current = window.setTimeout(() => setHover(null), 120);
        }
        return;
      }
      if (pending.current === undefined) return;
      // Still heading for the panel: keep waiting, restarting the settle clock on each move.
      const how = aiming(pointer.current);
      if (how) defer(pending.current, how);
      else resolve();
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  const enter = (label: string) => {
    parked.current = false;
    const how = hoverRef.current && hoverRef.current !== label ? aiming(pointer.current) : false;
    if (how) {
      defer(label, how);
      return;
    }
    clearTimer();
    if (!hoverRef.current) {
      // Nothing open: a graze on the way past must not open anything. The apex is seeded when it
      // actually opens, from where the pointer is then.
      pending.current = undefined;
      opening.current = { label, ...pointer.current };
      timer.current = window.setTimeout(() => openNow(label), OPEN_MS);
      return;
    }
    pending.current = undefined;
    // Seed the apex where the pointer entered, so the very first diagonal move is already protected.
    apex.current = { ...pointer.current };
    setHover(label);
  };
  const leave = () => {
    if (opening.current && !hoverRef.current) {
      opening.current = null;
      clearTimer();
      return;
    }
    // Left through the top of the page, into the browser's own tab strip. A hand coming up from the
    // page overshoots the bar and goes there constantly, so this is not leaving the menu: it stays
    // open until the pointer comes back and lands somewhere else. Measured before this: an upward
    // approach that overshot closed the menu on every one of the seven groups.
    if (hoverRef.current && pointer.current.y <= 2) {
      clearTimer();
      pending.current = undefined;
      parked.current = true;
      return;
    }
    const how = hoverRef.current ? aiming(pointer.current) : false;
    if (how) {
      defer(null, how);
      return;
    }
    // An ordinary exit keeps its 120ms grace and is NOT an aim deferral, so the move listener leaves
    // it alone. Treating it as one resolved every close instantly and blinked the menu shut in the
    // four-pixel gap between labels while scanning across the bar.
    clearTimer();
    pending.current = undefined;
    timer.current = window.setTimeout(() => setHover(null), 120);
  };
  /**
   * Leaving a panel is only leaving the menu if the pointer also left the group. Coming up from the
   * page, a hand reaches the bottom edge of a label and the panel's opening animation (it starts 6px
   * high) slides up underneath it. The hand keeps rising, out of the panel and back onto its own
   * label. Treating that as an exit closed the menu under a resting cursor. Nothing re-opened
   * it, because the pointer never left the group, so its enter handler never fired again.
   */
  const leavePanel = (e: React.MouseEvent) => {
    const group = (e.currentTarget as HTMLElement).parentElement;
    const to = e.relatedTarget;
    if (group && to instanceof Node && group.contains(to)) return;
    leave();
  };
  const enterPanel = (label: string) => {
    opening.current = null;
    pending.current = undefined;
    clearTimer();
    setHover(label);
  };
  /**
   * While an open is waiting, a pointer still travelling restarts its clock, so a label only opens
   * once the hand has slowed on it. A fixed delay alone let a long diagonal that spent 90ms crossing
   * a neighbour open that neighbour first. Moves under 3px are a resting hand's tremor and do not count.
   */
  const settleOpen = (e: React.MouseEvent, label: string) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    const o = opening.current;
    if (!o || o.label !== label) return;
    if (Math.abs(e.clientX - o.x) + Math.abs(e.clientY - o.y) < 3) return;
    opening.current = { label, x: e.clientX, y: e.clientY };
    clearTimer();
    timer.current = window.setTimeout(() => openNow(label), OPEN_MS);
  };
  /** The apex follows the pointer only while it is inside the open group's own label. */
  const trackApex = (e: React.MouseEvent, label: string) => {
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
          const hasPanel = g.items.length > 0;
          const shown = hover === g.label && hasPanel;
          return (
            <div
              key={g.label}
              className="nav-group relative"
              onMouseEnter={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY };
                enter(g.label);
              }}
              onMouseMove={(e) => settleOpen(e, g.label)}
              onMouseLeave={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY };
                leave();
              }}
              onFocus={() => {
                if (!returning.current) enterPanel(g.label);
              }}
              onBlur={(e) => {
                const to = e.relatedTarget as Node | null;
                if (e.currentTarget.contains(to)) return;
                // Focus going nowhere while the pointer is still over the group is not leaving it: the
                // login panel swaps its sign-in buttons for the account view once a sign-in succeeds
                // and the focused button unmounting must not close the panel it just filled.
                if (to === null && e.currentTarget.matches(":hover")) return;
                setHover(null);
              }}
            >
              <Link
                href={g.href}
                ref={(el) => {
                  labelRefs.current[g.label] = el;
                }}
                aria-current={active ? "page" : undefined}
                aria-haspopup={hasPanel ? "menu" : undefined}
                aria-expanded={hasPanel ? shown : undefined}
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
                    leavePanel(e);
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
        <AccountNav active={inGroup(LOGIN)} />
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
            {/* The account first on a phone: it is the one thing a reader opens the sheet to check. */}
            <div className="sheet-group sheet-account" style={{ ["--i" as string]: 0 }}>
              <span className="kicker">account</span>
              <div className="mt-2">
                <AccountMenu onNavigate={() => setOpen(false)} />
              </div>
            </div>
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
