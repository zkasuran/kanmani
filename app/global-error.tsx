"use client";

import { Logo } from "@/components/logo.tsx";

import "./globals.css";

/**
 * The last resort: a throw in the root layout itself.
 *
 * `app/error.tsx` is mounted inside the root layout, so it cannot catch a failure in the layout that
 * renders it. This file replaces the whole document instead, which is why it writes its own `<html>`
 * and `<body>` rather than inheriting them.
 *
 * It is deliberately thin. Anything it depends on is something that can also be the thing that
 * broke, so there is no nav, no session provider, no data read and no font loader here: only the
 * stylesheet and the inline mark. Fonts fall back through the chain in `--font-sans`, since the
 * `next/font` variables are set by the layout that is not running.
 *
 * The theme is whatever `prefers-color-scheme` says. The layout's stored-theme script runs under a
 * per-request CSP nonce that a client component cannot read, so an inline script here would be
 * refused by the policy. Honouring the OS preference is the correct degradation.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <main
          id="main"
          className="shell flex min-h-screen flex-col justify-center py-16"
          role="alert"
          aria-labelledby="global-error-heading"
        >
          <Logo size={40} className="text-[var(--color-brand)]" />
          <p className="kicker mt-6">error · the page could not be built</p>
          <h1
            id="global-error-heading"
            className="mt-4 max-w-2xl fluid-3 font-semibold leading-tight tracking-tight"
          >
            This site failed to render. Nothing here is a verdict about a claim.
          </h1>
          <p className="lead mt-4 max-w-2xl text-muted">
            The failure is on our side, not in the data. No number on this screen should be read as a
            measurement. Reload to try again.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <button type="button" onClick={reset} className="cta">
              reload →
            </button>
            {/*
              A plain anchor on purpose, so eslint's next/link rule is waived here and nowhere else.
              `next/link` does a client-side navigation, and the thing that just failed is the root
              layout, so the router and the shell it would navigate within are the broken parts. A
              full document load is the only exit that rebuilds them.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="cta-ghost">home →</a>
          </div>
          {error.digest ? (
            <p className="mt-6 max-w-2xl text-[12.5px] text-faint">
              Quote this reference and the server log for it can be found:{" "}
              <code className="font-mono text-muted">{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
