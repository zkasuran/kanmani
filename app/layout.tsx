import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Kanmani",
    template: "%s · Kanmani",
  },
  description:
    "Every payment claim in Monad's agent registry, checked against the chain it names. Hash integrity is not claim truth.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3400"),
  openGraph: {
    title: "Kanmani",
    description: "Every payment claim in Monad's agent registry, checked against the chain it names.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

const NAV = [
  ["/", "measurement"],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Pointed at from the head as well as served at the path, because an agent reading this
          site is likelier to parse the head than to guess a filename. The whole machine-readable
          surface is discoverable from any page.
        */}
        <link rel="alternate" type="text/plain" href="/llms.txt" title="Summary for a language model" />
        <link rel="alternate" type="application/json" href="/feed.json" title="The verified population" />
        <link rel="alternate" type="application/schema+json" href="/schema.json" title="Response schemas" />
      </head>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
            <Link href="/" className="group flex items-baseline gap-2">
              <span className="font-mono text-base font-semibold tracking-tight text-[var(--color-text)]">
                kanmani
              </span>
              <span className="text-[11px] text-faint group-hover:text-muted">monad mainnet · 143</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {NAV.slice(1).map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="font-mono text-[12px] text-muted transition-colors hover:text-[var(--color-text)]"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1180px] px-5 py-8">{children}</main>

        <footer className="mt-16 border-t border-[var(--color-line)]">
          <div className="mx-auto max-w-[1180px] px-5 py-6 text-[12px] text-faint">
            <p className="max-w-3xl leading-relaxed">
              Kanmani reads Monad&apos;s ERC-8004 registries and checks whether what each evidence
              document says actually happened. A verdict describes what was observed, never what
              anyone intended. A failure to look is recorded as <span className="unknown-value">unknown</span>,
              never as false.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono">
              <Link href="/method" className="hover:text-muted">
                method
              </Link>
              <Link href="/status" className="hover:text-muted">
                status
              </Link>
              <a href="/llms.txt" className="hover:text-muted">
                llms.txt
              </a>
              <a href="/agents.md" className="hover:text-muted">
                agents.md
              </a>
              <a href="/feed.json" className="hover:text-muted">
                feed.json
              </a>
              <a href="/schema.json" className="hover:text-muted">
                schema.json
              </a>
              <a href="/.well-known/agent-registration.json" className="hover:text-muted">
                our own record
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
