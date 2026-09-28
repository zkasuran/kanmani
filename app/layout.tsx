import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/logo.tsx";
import { Spotlight } from "@/components/motion.tsx";
import { Nav } from "@/components/nav.tsx";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import "./globals.css";

/**
 * Fonts are self-hosted by next/font at build time, not linked from Google at runtime.
 *
 * The CSP in next.config.ts is `style-src 'self'` and `font-src 'self' data:`, so a
 * fonts.googleapis.com stylesheet is refused by the browser and every face silently falls back.
 * Served from our own origin they pass the policy, cost no third-party request and ship with a
 * size-adjusted fallback so the swap does not shift layout.
 */
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Kanmani. Every payment claim on Monad, checked against the chain it names." }],
  },
  /**
   * summary_large_image, because the card carries a real measurement (85 claims checked, 73 did not
   * resolve) and a thumbnail would make that unreadable. The figures are drawn at build time from our
   * own feed, so the card cannot quote a number the site contradicts.
   */
  twitter: {
    card: "summary_large_image",
    title: "Kanmani",
    description: "Every payment claim in Monad's agent registry, checked against the chain it names.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`no-js ${sans.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
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
        {/* Skip link: the first tab stop, invisible until focused. */}
        <a href="#main" className="skip-link">skip to content</a>
        {/* Pointer spotlight for cards. Client-only, pointer:fine only, off under reduced motion. */}
        <Spotlight />
        <header className="site-header sticky top-0 z-20">
          <div className="header-shell shell flex items-center gap-x-6 gap-y-2">
            {/* Reading progress, driven by the scroll timeline in CSS. No JS. Absent where unsupported. */}
            <span className="scroll-progress" aria-hidden="true" />
            <Link href="/" className="group flex items-center gap-2">
              {/* Brand colour on the mark, text colour on the word, so the pair reads as one lockup
                  without the logo competing with the nav for attention. */}
              <Logo size={22} animated className="brand-logo shrink-0 text-[var(--color-brand)]" />
              <span className="font-display text-base font-semibold tracking-tight text-[var(--color-text)]">
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

        <main id="main" className="site-main shell py-[var(--section-gap)]">{children}</main>

        <footer className="site-footer mt-[var(--section-gap)] border-t border-[var(--color-line)]">
          <div className="shell py-8 text-[12px] text-faint">
            <Logo size={26} className="mb-3 text-[var(--color-brand-dim)]" label="Kanmani" />
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
