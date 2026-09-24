import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/nav.tsx";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="no-js">
      <head>
        {/*
          Pointed at from the head as well as served at the path, because an agent reading this
          site is likelier to parse the head than to guess a filename. The whole machine-readable
          surface is discoverable from any page.
        */}
        <link rel="alternate" type="text/plain" href="/llms.txt" title="Summary for a language model" />
        <link rel="alternate" type="application/json" href="/feed.json" title="The verified population" />
        <link rel="alternate" type="application/schema+json" href="/schema.json" title="Response schemas" />
        {/*
          Two things, both before first paint, which is the whole reason they are inline.

          The theme is read from storage and applied as `data-theme` on <html>. Waiting for
          hydration would paint the default palette first, so every returning light-mode reader
          would get a dark flash on a dark-default site. No stored choice means no attribute, which
          hands the decision to the prefers-color-scheme block in globals.css.

          Then `no-js` is removed, which the motion layer uses to decide whether it may animate.
          Both are wrapped so a storage exception in private browsing cannot stop the second one.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('kanmani.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}" +
              "document.documentElement.classList.remove('no-js');",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <header
          className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-ink)]/80 backdrop-blur-md"
          style={{ ["--header-h" as string]: "3.25rem" }}
        >
          <div className="shell flex items-center gap-x-6 gap-y-2 py-3">
            <Link href="/" className="group flex items-baseline gap-2">
              <span className="font-mono text-base font-semibold tracking-tight text-[var(--color-text)]">
                kanmani
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-faint group-hover:border-[var(--brand-line)] group-hover:text-muted">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-true)]" />
                <span className="hidden xs:inline">monad mainnet · 143</span>
                <span className="xs:hidden">143</span>
              </span>
            </Link>
            <Nav />
            <ThemeToggle />
          </div>
        </header>

        <main className="shell py-[var(--section-gap)]">{children}</main>

        <footer className="mt-[var(--section-gap)] border-t border-[var(--color-line)]">
          <div className="shell py-8 text-[12px] text-faint">
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
              <a href="/llms.txt" target="_blank" rel="noopener" className="hover:text-muted">
                llms.txt
              </a>
              <a href="/agents.md" target="_blank" rel="noopener" className="hover:text-muted">
                agents.md
              </a>
              <a href="/feed.json" target="_blank" rel="noopener" className="hover:text-muted">
                feed.json
              </a>
              <a href="/schema.json" target="_blank" rel="noopener" className="hover:text-muted">
                schema.json
              </a>
              <a href="/.well-known/agent-registration.json" target="_blank" rel="noopener" className="hover:text-muted">
                our own record
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
