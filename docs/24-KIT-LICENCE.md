# Licence carve-out for the component layer

**The repository is `LicenseRef-zkasuran-SAND-1.0`: source-available, no derivatives.** That is the right
posture for a hackathon entry, where the point is that the work can be read and checked but not forked
into a competing submission.

It is the wrong posture for two files, and the tension was recorded in
[`docs/14-GAPS.md`](docs/14-GAPS.md) §6 before it was resolved here.

## The two files, and why they are different

| file | why it must be permissive |
|---|---|
| [`components/kit.tsx`](../components/kit.tsx) | It exists to be rendered inside somebody else's product. A component you may read but not copy is not a component, it is a screenshot |
| [`app/embed.js/route.ts`](../app/embed.js/route.ts) | It is served to third-party pages by design. Embedding it needs no grant, because a script tag is a request to our server rather than a copy of our code — but the source is in this repository and a reader should not have to reason about that |

**These two files are released under the MIT licence**, reproduced in full below. Everything else in the
repository stays under SAND-1.0.

## Why permissive rather than a narrower grant

A narrower licence was considered and rejected: "you may copy this for the purpose of displaying Kanmani
verdicts" sounds tighter and is worse. It makes every consumer read a bespoke grant and decide whether
their use qualifies, which is friction on exactly the thing we want adopted, and it invites the question
of what happens if they later stop displaying our verdicts.

More importantly, **the thing being published is a constraint, not an asset.** `kit.tsx` makes three
mistakes unavailable: printing a null as `0`, colouring `unknown` like `false`, and averaging four
outcomes into a score. Those are properties we want propagated as widely as possible, including by people
who never mention us. A restrictive licence on a safety constraint works against its own purpose.

## What this does not license

The measurement, the verdict data, the indexer, the verifier, the contracts, the site and every document
outside those two files remain **SAND-1.0**. Reading, checking, benchmarking and publishing findings about
them is expressly permitted; redistribution and derivative works are not. See
[`LICENSE`](../LICENSE) and [`contracts/NOTICE`](../contracts/NOTICE).

Verdict data served from the API is free to consume and republish, with one request rather than a
condition: carry the `unknown` distinction with it. A verdict reproduced as a zero is worse than one not
reproduced at all.

---

## MIT License

Copyright (c) 2026 zkasuran

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
THE USE OR OTHER DEALINGS IN THE SOFTWARE.
