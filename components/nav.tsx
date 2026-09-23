"use client";

/**
 * The navigation, as a product spine rather than a list of documents.
 *
 * It used to be eleven flat entries: agents, operators, claims, verify, studio, chains, account,
 * validate, compare, method, status. That reads as an index of reports, and a reader arriving at it
 * has to build the product's model in their own head before they can choose. Nothing was wrong with
 * any single page; the shape was wrong.
 *
 * Four groups now, each answering one question a visitor actually has:
 *
 *   Explore    what is out there, and what is true about it
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

type Item = { href: string; label: string; hint: string };
type Group = { label: string; href: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "explore",
    href: "/agents",
    items: [
      { href: "/agents", label: "agents", hint: "every registered agent, filterable" },
      { href: "/operators", label: "operators", hint: "clustered by the document they registered" },
      { href: "/claims", label: "claims", hint: "every evidence document and what checking it found" },
      { href: "/compare", label: "compare", hint: "two to four agents, rung first" },
    ],
  },
  {
    label: "build",
    href: "/verify",
    items: [
      { href: "/verify", label: "verify", hint: "paste anything, get a verdict" },
      { href: "/studio", label: "studio", hint: "register an agent, or fix one you own" },
      { href: "/pay", label: "pay", hint: "settle a job without a wallet" },
      { href: "/fund", label: "fund", hint: "pay from another chain" },
      { href: "/account", label: "account", hint: "one passkey, four keys" },
    ],
  },
  {
    label: "trust",
    href: "/method",
    items: [
      { href: "/method", label: "method", hint: "how each rung is decided" },
      { href: "/chains", label: "chains", hint: "what we can read, and what hosts agents" },
      { href: "/status", label: "status", hint: "how fresh every number is" },
      { href: "/validate", label: "validate", hint: "the on-chain validation registry" },
    ],
  },
  { label: "developers", href: "/developers", items: [] },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

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

  /* A short close delay, so moving the pointer from the label into the panel does not dismiss it. */
  const enter = (label: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setHover(label);
  };
  const leave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(null), 120);
  };

  return (
    <>
      <nav className="ml-auto hidden items-center gap-x-1 md:flex">
        {GROUPS.map((g) => {
          const active = inGroup(g);
          const shown = hover === g.label && g.items.length > 0;
          return (
            <div key={g.label} className="relative" onMouseEnter={() => enter(g.label)} onMouseLeave={leave}>
              <Link
                href={g.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block rounded px-2.5 py-1.5 font-mono text-[12px] transition-colors ${
                  active ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"
                }`}
              >
                {g.label}
              </Link>
              {shown ? (
                <div
                  className="absolute left-0 top-full z-30 w-[19rem] rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-1.5 shadow-[var(--shadow-2)]"
                  onMouseEnter={() => enter(g.label)}
                  onMouseLeave={leave}
                >
                  {g.items.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      className={`block rounded px-2.5 py-2 transition-colors hover:bg-[var(--color-panel-2)] ${
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

      {open ? (
        <div
          id="mobile-nav"
          className="field field-live fixed inset-x-0 top-[var(--header-h,3.25rem)] z-30 max-h-[80vh] overflow-y-auto border-b border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur-md md:hidden"
        >
          <nav className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 py-4">
            {GROUPS.map((g) => (
              <div key={g.label}>
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
        </div>
      ) : null}
    </>
  );
}
