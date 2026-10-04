/**
 * The blog, as a small registry rather than a pile of orphan pages.
 *
 * Pure data, no server imports, so the server-rendered index reads the same list the pages belong to.
 * Newest or most load-bearing first, which is the order the index uses. Add a post by adding its entry
 * here and its page under app/blog/<slug>/.
 */

export type Post = {
  /** The route under /blog. Lowercase, dash-separated, matches the folder name. */
  slug: string;
  /** The headline shown on the index card and on the page. */
  title: string;
  /** One line for the index card. House voice, no em dash, no comma before and or or. */
  hook: string;
  /** Display date, ISO, the day the work it describes was done. */
  date: string;
};

export const POSTS: Post[] = [
  {
    slug: "claim-truth",
    title: "Hash integrity is not claim truth",
    hook: "Every tool checks the evidence was not tampered with. None checks the thing it describes happened.",
    date: "2026-10-01",
  },
  {
    slug: "cleanverse",
    title: "Money that cannot reach a wallet that is not cleared",
    hook: "The escrow reads a Cleanverse identity on chain at the moment it pays. One real pass, one real refuse.",
    date: "2026-10-01",
  },
  {
    slug: "mera-prf",
    title: "One passkey, four keys, nothing stored",
    hook: "A passkey derives four unrelated keys that reconstruct on any device, with nothing on disk or a server.",
    date: "2026-10-01",
  },
  {
    slug: "nansen",
    title: "Sixty of sixty-two wallets share one funder",
    hook: "A cluster of thousands at one dead document traces back through Nansen to a single first funder.",
    date: "2026-10-01",
  },
  {
    slug: "qwen",
    title: "Qwen 3.8 Max wrote a parser we shipped",
    hook: "It converged in one turn against our own parser. One field changed in review. Three unknown claims became checkable.",
    date: "2026-10-04",
  },
];
