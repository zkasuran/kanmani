"use client";

import Link from "next/link";

import { Logo } from "@/components/logo.tsx";

/**
 * The page a reader sees when a route throws.
 *
 * Without this file one thrown render blanks the routed view and Next falls back to its own bare
 * screen, outside the site's nav, theme and type. On a site about checkable claims a blank panel is
 * the worst outcome: a reader cannot tell a broken page from a claim that has no answer, which is
 * exactly the confusion between `unknown` and `false` this project exists to remove. So the boundary
 * says plainly that the failure is ours and not a verdict.
 *
 * Scoped to the route, so the header, nav and theme stay mounted and only the panel is replaced.
 * `reset()` re-renders the segment, which is worth offering because most throws here come from a
 * read against the live index that can succeed on a second try.
 *
 * `error.digest` is the only part of the thrown error that reaches the browser in production. Next
 * replaces the message with that hash and logs the real one on the server, so the page prints the
 * digest and nothing else: a reader quoting it gets a server log line, and no internal detail is
 * reflected back to whoever caused the throw.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-14 pt-14 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-10"
      // Announced on mount, because the reader did not ask for this panel and may not be looking
      // at the region that changed.
      role="alert"
      aria-labelledby="error-heading"
    >
      <div className="grid-faint pointer-events-none absolute inset-0" />
      <div className="relative max-w-2xl">
        <Logo size={40} className="hero__in text-[var(--color-brand)]" />
        <p className="hero__in kicker mt-6" style={{ ["--d" as string]: "60ms" }}>
          error · this page did not finish loading
        </p>
        <h1
          id="error-heading"
          className="hero__in mt-4 fluid-3 font-semibold leading-tight tracking-tight"
          style={{ ["--d" as string]: "120ms" }}
        >
          Something on our side failed. This is not a verdict about a claim.
        </h1>
        <p className="hero__in lead mt-4 text-muted" style={{ ["--d" as string]: "220ms" }}>
          Every page here reads the live index when you open it, so a slow or refused read shows up
          as this panel rather than as a stale number. Trying again usually works. If it does not,
          the status page reports how fresh the index is and whether the read path is up.
        </p>
        <div className="hero__in mt-7 flex flex-wrap gap-2.5" style={{ ["--d" as string]: "320ms" }}>
          <button type="button" onClick={reset} className="cta">
            try again →
          </button>
          <Link href="/status" className="cta-ghost">check the index →</Link>
          <Link href="/" className="cta-ghost">home →</Link>
        </div>
        {error.digest ? (
          <p className="hero__in mt-6 text-[12.5px] text-faint" style={{ ["--d" as string]: "420ms" }}>
            Quote this reference and the server log for it can be found:{" "}
            <code className="font-mono text-muted">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
