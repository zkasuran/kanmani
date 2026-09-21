import { SITE } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * The safe-access contract, addressed to an agent rather than to a person.
 *
 * It says what is free, what costs, what the rate limits are and what we do with what you send.
 * An agent that reads this should never have to guess whether a 402 means "broken" or "pay me",
 * and should never be surprised by a limit it could have read first.
 */
const BODY = `# agents.md

You are reading the access contract for ${SITE}. It is addressed to software.

## What this service does

It decides whether the payment an ERC-8004 evidence document describes actually happened, by
reading the cited transaction on the chain the document names.

It answers with one of four outcomes and they are not interchangeable:

| outcome | meaning |
|---|---|
| \`true\` | the cited transaction is on the chain the document names |
| \`false\` | we read that chain successfully and it is not there |
| \`noClaim\` | the document read fine and asserts no payment, so there is nothing to check |
| \`unknown\` | we could not look or could not read what we fetched. Never an accusation |

**Do not collapse \`unknown\` into \`false\`.** If you build on this API and treat them as the same,
you will publish accusations on the strength of a rate limit. Every response keeps them apart and
so should yours.

## Endpoints

### Free, no payment, no key

\`\`\`
GET ${SITE}/api/claims?outcome=false&limit=100
GET ${SITE}/api/agent/<agentId>
GET ${SITE}/feed.json
GET ${SITE}/schema.json
GET ${SITE}/llms.txt
\`\`\`

These read what has already been checked. They cost us a database query and they are free.

### Paid, because it costs somebody else's bandwidth

\`\`\`
POST ${SITE}/api/verify
     { "uri": "<document uri>", "feedbackHash": "0x… optional" }
\`\`\`

This fetches a document you name and reads a chain. That spends a request on a third party's
server and an RPC call, so it is priced rather than free. It answers **HTTP 402** with an x402
challenge describing exactly what to pay and to whom. Pay it, repeat the request with the
\`X-PAYMENT\` header and you get the verdict.

402 here means "pay me", not "broken". The challenge body names the asset, the amount, the
network and the address.

## Rate limits

Free endpoints: no hard limit today. If that changes it will be announced in this file before it
is enforced and the response will carry \`retry-after\`.

Paid verification: one document per payment. There is no burst allowance to discover by hitting
a wall.

## What we do with what you send

A \`POST /api/verify\` fetches the URI you give us. We record the verdict, the URI and the time,
because the whole site is an append-only record of checks. We do not record who asked.

We follow redirects and re-screen every hop against the same guard, we refuse private and
loopback addresses and we cap the document at 64 KB. If you point us at something large or
internal you get a refusal with the reason, not a hang.

## What we will not do

- We will not tell you an agent is fraudulent. We report what was observed.
- We will not return a score. There is no ranking number here to optimise against.
- We will not return \`false\` for something we failed to fetch.

## Reproducing anything here

Every JSON response carries a \`reproduce\` field with the exact command that produces the same
answer without us. If our answer and that command ever disagree, ours is wrong.

## Contact

Open an issue on the repository linked from ${SITE}. Corrections are appended, never edited over,
so a document you repair shows as a change with both timestamps rather than as a quiet rewrite.
`;

export async function GET() {
  return new Response(BODY, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
  });
}
