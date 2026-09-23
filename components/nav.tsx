"use client";

/**
 * The top navigation, split out so it can mark the current page and collapse on a phone.
 *
 * A server layout cannot read the active path, so this one small piece is a client component. On a
 * wide viewport it lays the links out in a row, brighter for the current page so a reader always
 * knows where they are. Below the point where nine monospace links stop fitting, it collapses into
 * a single disclosure button that opens a full-width sheet — the monad.xyz pattern of a clean bar
 * that folds down on small screens. It holds one piece of state, the open flag, and nothing else.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV: [string, string][] = [
  ["/agents", "agents"],
  ["/operators", "operators"],
  ["/claims", "claims"],
  ["/verify", "verify"],
  ["/account", "account"],
  ["/validate", "validate"],
  ["/compare", "compare"],
  ["/method", "method"],
  ["/status", "status"],
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Close the sheet whenever the route changes, so a tap that navigates never leaves it hanging.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Lock the page behind the sheet while it is open, and let Escape close it.
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

  const isActive = (href: string) => path === href || (href !== "/" && path.startsWith(href));

  return (
    <>
      {/* Wide viewport: the links inline, wrapping only as a last resort. */}
      <nav className="ml-auto hidden items-center gap-x-4 gap-y-1 md:flex md:flex-wrap">
        {NAV.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={`font-mono text-[12px] transition-colors ${
              isActive(href) ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Narrow viewport: one button that opens the sheet. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--color-line-bright)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-faint)] hover:text-[var(--color-text)] md:hidden"
      >
        <span className="relative block h-3.5 w-4">
          <span
            className="absolute left-0 h-[1.5px] w-full bg-current transition-all duration-200"
            style={{ top: open ? "6px" : "1px", transform: open ? "rotate(45deg)" : "none" }}
          />
          <span
            className="absolute left-0 top-[6px] h-[1.5px] w-full bg-current transition-opacity duration-200"
            style={{ opacity: open ? 0 : 1 }}
          />
          <span
            className="absolute left-0 h-[1.5px] w-full bg-current transition-all duration-200"
            style={{ top: open ? "6px" : "11px", transform: open ? "rotate(-45deg)" : "none" }}
          />
        </span>
      </button>

      {/* The sheet. Full width below the header, brand-tinted field, one link per row. */}
      {open ? (
        <div
          id="mobile-nav"
          className="field field-live fixed inset-x-0 top-[var(--header-h,3.25rem)] z-30 border-b border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur-md md:hidden"
        >
          <nav className="mx-auto flex max-w-[1180px] flex-col px-5 py-3">
            {NAV.map(([href, label], i) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                data-reveal="in"
                style={{ ["--reveal-delay" as string]: `${i * 24}ms` }}
                className={`border-b border-[var(--color-line)]/60 py-3 font-mono text-sm transition-colors last:border-0 ${
                  isActive(href)
                    ? "text-[var(--color-brand)]"
                    : "text-muted hover:text-[var(--color-text)]"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
