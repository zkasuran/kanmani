import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { POSTS } from "@/lib/blog.ts";

/**
 * The blog index: one card per post. This is a listing, not an essay, so it stays scannable. The
 * cards come from lib/blog.ts, so adding a post there shows it here.
 */

export const metadata = {
  title: "Blog",
  description:
    "Short pieces on what Kanmani built: the claim-truth thesis, the Cleanverse compliance gate, Mera PRF key derivation, the Nansen funder trace and the Qwen mapping loop.",
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

export default function BlogIndex() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog"
        title="What we built, in short reads"
        lead="One piece per integration. Every figure traces to a transaction, a recorded run or a live query, with the command to re-derive it."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {POSTS.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="elevated panel-hover group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5 transition-colors"
          >
            <span className="font-mono text-[11px] text-faint">{fmtDate(p.date)}</span>
            <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-[var(--color-text)] group-hover:text-[var(--color-brand)]">
              {p.title}
            </h2>
            <p className="text-[13.5px] leading-relaxed text-muted">{p.hook}</p>
            <span className="mt-auto pt-1 font-mono text-[12px] text-[var(--color-brand)]">read &rarr;</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
