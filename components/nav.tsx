"use client";

/**
 * The top navigation, split out so it can mark the current page.
 *
 * A server layout cannot read the active path, so this one small piece is a client component. It
 * does nothing else: no state, no effects, just the current route drawn brighter than the rest so a
 * reader always knows where they are.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {NAV.map(([href, label]) => {
        const active = path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`font-mono text-[12px] transition-colors ${
              active ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
