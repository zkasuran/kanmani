import Link from "next/link";
import { PageHeader, Prize } from "@/components/ui.tsx";
import { POSTS } from "@/lib/writing.ts";

/**
 * The writing index: one card per post, each led by the money the work is for. This is a listing,
 * not an essay, so it stays scannable. The cards and the nav submenu both come from lib/writing.ts,
 * so adding a post in one place shows it in both.
 */

export const metadata = {
  title: "Writing",
  description:
    "Short pieces on what Kanmani built and what each piece is worth: the claim-truth thesis, the Cleanverse compliance gate, Mera PRF key derivation, the Nansen funder trace and the Qwen mapping loop.",
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

export default function WritingIndex() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="writing"
        title="What we built and what each piece is worth"
        lead="One short read per integration. Every figure traces to a transaction, a recorded run or a live query. The money the work is for sits at the top of each page."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {POSTS.map((p) => (
          <Link
            key={p.slug}
            href={`/writing/${p.slug}`}
            className="elevated panel-hover group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <Prize post={p} />
              <span className="font-mono text-[11px] text-faint">{fmtDate(p.date)}</span>
            </div>
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
