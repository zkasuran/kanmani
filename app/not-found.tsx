import Link from "next/link";

import { Logo } from "@/components/logo.tsx";

export const metadata = { title: "Not found" };

/**
 * The page a reader sees on a dead link.
 *
 * Next's default was a bare "404 | This page could not be found" on black, outside the site's nav,
 * theme and type. The most likely way to arrive here is a claim or agent URL copied from somewhere
 * else, so the useful thing is to say that plainly and hand the reader the three places that answer
 * the question they probably had. It does not guess what they meant: a wrong guess on a site about
 * checkable claims would be worse than an honest miss.
 */
export default function NotFound() {
  return (
    <section className="field field-live beam rise -mx-[var(--gutter)] -mt-[var(--section-gap)] overflow-hidden border-b border-[var(--color-line)] px-[var(--gutter)] pb-14 pt-14 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-10">
      <div className="grid-faint pointer-events-none absolute inset-0" />
      <div className="relative max-w-2xl">
        <Logo size={40} className="hero__in text-[var(--color-brand)]" />
        <p className="hero__in kicker mt-6" style={{ ["--d" as string]: "60ms" }}>
          404 · nothing at this address
        </p>
        <h1 className="hero__in mt-4 fluid-3 font-semibold leading-tight tracking-tight" style={{ ["--d" as string]: "120ms" }}>
          This page does not exist. The claim you were looking for might.
        </h1>
        <p className="hero__in lead mt-4 text-muted" style={{ ["--d" as string]: "220ms" }}>
          Agent and claim addresses change shape when they are copied between tools. Search the
          registry by id, name or wallet or paste the document straight into the checker.
        </p>
        <div className="hero__in mt-7 flex flex-wrap gap-2.5" style={{ ["--d" as string]: "320ms" }}>
          <Link href="/agents" className="cta">find an agent →</Link>
          <Link href="/verify" className="cta-ghost">check a claim →</Link>
          <Link href="/" className="cta-ghost">home →</Link>
        </div>
      </div>
    </section>
  );
}
