# 41. The blog

Five short pieces under `/blog`, one per integration, each a narrative companion to one of the
integration notes in this directory. `/blog` is the index and nothing more: one card per post, so it
stays scannable.

The registry is `lib/blog.ts`. The index is `app/blog/page.tsx` and each post is
`app/blog/<slug>/page.tsx`. Adding a post means adding its entry to the registry and its page under
that folder. Both read one list, so a post cannot exist as an orphan page the index does not link to.

## The five posts

| post | companion doc | what it argues |
|---|---|---|
| [`/blog/claim-truth`](https://kanmani.xyz/blog/claim-truth) | [02-THESIS](02-THESIS.md) | every tool checks the evidence was not tampered with. None checks the thing it describes happened |
| [`/blog/cleanverse`](https://kanmani.xyz/blog/cleanverse) | [20-CLEANVERSE](20-CLEANVERSE.md), [36-COMPLIANCE](36-COMPLIANCE.md) | Access USDC gates every transfer on an on-chain identity and we read the exact rule off the chain |
| [`/blog/mera-prf`](https://kanmani.xyz/blog/mera-prf) | [32-PRF-PRIMITIVES](32-PRF-PRIMITIVES.md) | a passkey derives four unrelated keys that reconstruct on any device, with nothing on disk or a server |
| [`/blog/nansen`](https://kanmani.xyz/blog/nansen) | [19-NANSEN](19-NANSEN.md) | a cluster of thousands at one dead document traces back through Nansen to a single first funder |
| [`/blog/qwen`](https://kanmani.xyz/blog/qwen) | [27-ATLAS-INDUCTION](27-ATLAS-INDUCTION.md) | Qwen maps unfamiliar evidence shapes and the real parser still gets the final say over every verdict |

Four were written on 2026-10-01 and the Qwen piece on 2026-09-30. The date on a post is the day the
work it describes was done rather than the day the prose was edited.

## What a post is for and what it is not

The integration notes in this directory are reference: every claim carries a `file:line`, an address
or a command. A post is the argument, in order, for a reader who has not decided yet whether the
reference is worth opening.

The rule for a post is the rule for everything else here. Every figure traces to a transaction, a
recorded run or a live query, with the command to re-derive it. A post that moved a number without
moving the query behind it would be the one place on the site where a reader has to take our word for
something.

## `/writing/*` is now `/blog/*`

The posts used to live under `/writing`. They moved. `/writing` and `/writing/qwen` both return 404
today, so an old link is broken rather than silently redirected. Anything that still points at
`/writing/<slug>` should point at `/blog/<slug>`.

All six paths are in `/sitemap.xml`.

## Related

- [README](README.md) the index of every doc, including the companions above.
- [35-MACHINE-SURFACES](35-MACHINE-SURFACES.md) `/sitemap.xml` and the other surfaces served for
  software.
