/**
 * The writing section, as a small registry rather than a pile of orphan pages.
 *
 * One page per integration, each tied to the money it is for, so a reader (and a judge) sees the
 * value at the top. This module is pure data with no server imports, so the client nav and the
 * server-rendered index and pages all read the same list. Newest or most load-bearing first, which
 * is the order both the nav submenu and the index use.
 *
 * Every post is a real page under app/writing/<slug>/. Add a post by adding its entry here and its
 * page file, nothing else: the nav group and the index both derive from POSTS.
 */

export type Post = {
  /** The route under /writing. Lowercase, dash-separated, matches the folder name. */
  slug: string;
  /** The headline, also the nav submenu label when short enough. */
  title: string;
  /** A short nav label when the title is long. Falls back to the title. */
  navLabel?: string;
  /** One line: the nav hint and the index card subtitle. House voice, no em dash, no comma before and or or. */
  hook: string;
  /** Display date, ISO, the day the work it describes was done. */
  date: string;
  /** The money this writing is tied to, in whole US dollars. */
  prizeUsd: number;
  /** Cash prize or a credit grant, which changes the wording of the badge. */
  prizeKind: "cash" | "credits";
  /** The program the money comes from, shown beside the amount. */
  program: string;
};

export const POSTS: Post[] = [
  {
    slug: "claim-truth",
    title: "Hash integrity is not claim truth",
    navLabel: "claim truth",
    hook: "Every tool checks the evidence was not tampered with. None checks the thing it describes happened.",
    date: "2026-10-01",
    prizeUsd: 10000,
    prizeKind: "cash",
    program: "Trust, Identity and AI track",
  },
  {
    slug: "cleanverse",
    title: "A dollar that checks both sides before it moves",
    navLabel: "cleanverse",
    hook: "Access USDC gates every transfer on an on-chain identity. We read the exact rule off the chain.",
    date: "2026-10-01",
    prizeUsd: 2000,
    prizeKind: "cash",
    program: "Cleanverse bounty",
  },
  {
    slug: "mera-prf",
    title: "One passkey, four keys, nothing stored",
    navLabel: "mera prf",
    hook: "A passkey derives four unrelated keys that reconstruct on any device, with nothing on disk or a server.",
    date: "2026-10-01",
    prizeUsd: 2500,
    prizeKind: "cash",
    program: "Mera PRF bounty",
  },
  {
    slug: "nansen",
    title: "Sixty of sixty-two wallets share one funder",
    navLabel: "nansen",
    hook: "A cluster of thousands at one dead document traces back through Nansen to a single first funder.",
    date: "2026-10-01",
    prizeUsd: 5000,
    prizeKind: "cash",
    program: "Nansen bounty",
  },
  {
    slug: "qwen",
    title: "How Qwen 3.8 Max reads evidence nobody wrote a parser for",
    navLabel: "qwen",
    hook: "Qwen maps unfamiliar evidence shapes. The real parser still gets the final say over every verdict.",
    date: "2026-09-30",
    prizeUsd: 5000,
    prizeKind: "credits",
    program: "Qwen 3.8 Max",
  },
];

export function postBySlug(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** The badge text for a post's money value: "$5,000 in credits" or "$2,000". */
export function prizeAmount(p: Pick<Post, "prizeUsd" | "prizeKind">): string {
  return `$${p.prizeUsd.toLocaleString("en-US")}${p.prizeKind === "credits" ? " in credits" : ""}`;
}
