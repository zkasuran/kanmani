# 19. Nansen: who the registration wallets are

The operators page can say how many wallets registered the same document. 7,962 distinct wallets
point at one deployment that returns 404. What it could not say, until this, is who those wallets
are. Nansen turns an address into its known entity and behavioural labels, so the count becomes a
distribution: exchange wallets, smart money, DeFi users and the ones Nansen holds nothing on. That
last group is the honest one. It renders as `unknown`, never as a zero.

This is Nansen data driving a core feature rather than sitting in a sidebar. The feature is the
operators page. The wallet count it already computes (`AgentRecord.distinctOwners`) is the thing
Nansen turns into intelligence.

## The endpoint

`POST https://api.nansen.ai/api/v1/profiler/address/labels`

Request body is `address` plus `chain`, where `chain` is an enum that includes `monad`. The response
is a list of label objects, each with a `label` string, a `category` and a `kind` array. The
category is one of `smart_money`, `behavioral`, `defi`, `social`, `cefi`, `nft`, `others`. We
normalise `others` to `other` and fold a label with no category into `other` as well.

Read live from Nansen's docs on 2026-09-23:

- `docs.nansen.ai/getting-started/authentication` for the host and the header.
- `docs.nansen.ai/api/profiler/address-labels.md` for the labels request and response schema.
- `docs.nansen.ai/getting-started/agentic-payments/x402-payments.md` for the payment path.

## Data categories used

The label distribution buckets each owner wallet by the category Nansen returns. When a wallet
carries several, the most telling wins, in this order: smart money, exchange or CeFi, DeFi, NFT,
social, behavioural, other. That ordering is a product choice and it lives in one place,
`LABEL_CATEGORY_PRIORITY` in `lib/nansen.ts`, so a reader can disagree with it there.

A wallet the labels endpoint answers nothing for is `unlabeled`. A wallet we could not look up at
all, a rate limit or a 500 or a missing key, is `unknown`. A wallet nobody has asked about yet is
`not looked up`. The page shows all three as `unknown`, because none of them is a fact about the
wallet, but the store keeps them apart so a reader can tell "asked, nothing there" from "never got
an answer". Folding our own outage into a negative label is the exact mistake this whole product
exists to point at.

## How it is paid: x402 where Nansen allows it, apikey where it does not

Nansen supports paying per call over x402 V2, header `PAYMENT-SIGNATURE`, settling on Base, Solana
or Monad. On Monad it settles through the Molandak facilitator, which is the same facilitator this
product pays its own verifier over (see `lib/x402.ts`). Paying Nansen per call over the rail the
verifier itself runs on is the fit we wanted.

One thing decided it. Nansen excludes the labels endpoint from x402: labels needs a Pro
subscription, so it is the apikey path, header name lowercase `apikey`. The profiler endpoints that
do accept x402, related-wallets among them at $0.01 a call, go over the payment path. So the client
in `lib/nansen.ts` speaks both and picks per call. The labels enrichment that drives the operators
page runs on apikey because that is the auth Nansen requires for it. The x402 payment path is
built and exercised by `fetchRelatedWallets`.

## The pieces

| File | What it does |
| --- | --- |
| `lib/nansen.ts` | The typed client. No network of its own: every call goes through an injected transport, so a test drives it with no socket and no key. Handles the apikey header, the x402 402-then-pay-then-retry flow and the classification of labels into a category. |
| `lib/labels.ts` | Reads the enrichment back for the pages. Guarded with `to_regclass`, so a read before the first CLI run shows every wallet as unknown rather than erroring. |
| `fovea.wallet_label` | The cached table, in `verifier/src/store/schema.sql`. Append only, keyed on the lowercased address, same posture as every other fovea table. A wallet that gets a label next month reads as `unlabeled -> labeled` with both timestamps. |
| `verifier/src/cli/nansen-enrich.ts` | Populates the table. One call per distinct wallet, deduplicated because a wallet's label is the same whichever agent it registered. Serial with a gap, under Nansen's 5 per second limit. The fetch goes through the repo's SSRF guard. |

## Commands

```bash
# Enrich the distinct registration wallets, most-connected first.
NANSEN_API_KEY=... ENVIO_PG_PASSWORD=... \
  node --experimental-strip-types verifier/src/cli/nansen-enrich.ts --limit 500 --gap 400

# A single wallet, classify and print, write nothing.
NANSEN_API_KEY=... node --experimental-strip-types verifier/src/cli/nansen-enrich.ts --only 0xabc --dry
```

The key is read at runtime from `NANSEN_API_KEY` in `.env.local`. It is never committed and never
defaulted. With no key the CLI refuses to run rather than make an unauthenticated call.

## The fetch is guarded

Even though `api.nansen.ai` is a fixed host we chose, the request still goes through the same SSRF
guard the verifier uses on documents strangers put on chain. The URL is screened, the host is
resolved, every answer is checked against the private ranges and the socket connects to the exact
address that was screened. A poisoned DNS answer pointing at a private address is refused rather than
fetched. See `verifier/src/net/guard.ts`.

## What is verified and what is not

The client, the classifier and the store are unit tested against the injected transport and against
a throwaway Postgres, all with no network. Three failure modes are proven catchable by breaking the
code and watching a test fail: a not-found answer turned into a label, the SSRF screen dropped, a
Nansen error swallowed into a plausible answer. Each was restored.

The live call is not verified, because there is no Nansen key in this environment. The path is built
and typed against Nansen's documented request and response. It degrades safely: a failed call is
recorded as `unknown`, never as a fabricated label. Do not read a label count on the operators page
as live until the CLI has run against a real key.

## 2026-09-30: switched to first funders and what they showed

The labels endpoint costs 100 credits a wallet. The account is on Nansen's free plan (100 trial credits,
then 10 a day), so labels could not cover even one wallet. `profiler/address/related-wallets` costs 1
credit and its `First Funder` relation answers the question the operators page could not: are the
7,962 wallets behind one dead document 7,962 operators or a few funders?

Run: `node --experimental-strip-types verifier/src/cli/nansen-enrich.ts --funders --clusters 1 --per-cluster 55`
(the sample is ordered by md5(address), wallets already answered are skipped, it stops before the credit
balance falls under `--reserve`). Stored in `fovea.wallet_funder`, append only; rendered at
`/operators#funders` by `lib/funders.ts`.

Result, 71 credits spent: 62 random wallets from the 7,962-owner eve-8004 cluster were asked and all 62
answered. **60 of 62 were first funded by one address, `0x97cd97cf…0996`, with 11 MON each.** The other
two came from one further funder. Six funding transactions were checked on Monad directly (from = funder,
to = wallet, 11 MON). The page states this as a sample and describes set-up, not intent.

### The related-wallets request shape and what it costs

Primary source, read 2026-10-01: `docs.nansen.ai/api/profiler/address-related-wallets.md`.

- Method and path: `POST /api/v1/profiler/address/related-wallets`.
- Body: `{ address, chain: "monad" }`. Nansen's current field name is `wallet_address`; `address` is a
  documented deprecated alias that still works, which is what the client sends. Only `chain` is
  required and its enum includes `monad`.
- The relation the sample reads is the string `First Funder`. Nansen returns it but does not document
  it as an enum value, so if the wording ever changes the sample degrades to `none` (Nansen saw no
  First Funder) rather than to a wrong claim. The code treats a missing relation as `none`, never a
  false "no shared funder".

Credits. Related-wallets is a Basic endpoint at $0.01 a call over x402. On the free API-key plan it
cost 1 credit a call (observed: 71 credits for 71 calls, confirmed by the `X-Nansen-Credits-Cost`
response header). The labels endpoint costs 100 credits a wallet and is Pro-only and excluded from
x402, which is why the build switched off it. The counterparties endpoint (the richer second category,
below) costs 5 credits. Cite `docs.nansen.ai/getting-started/agentic-payments/x402-payments.md` for
the $0.01, the excluded-labels line and the `PAYMENT-SIGNATURE` header.

## Reproduce the 60-of-62 finding

Prerequisites: a Nansen API key with credits and read access to the indexer Postgres. The result is
also public, no key needed, at `https://kanmani.xyz/operators#funders` and per cluster at
`https://kanmani.xyz/operators/<uriHash>#funders`.

1. The biggest cluster is the eve-8004 dead document: 8,093 agents across 7,962 distinct wallets. Open
   `https://kanmani.xyz/operators`; it is the top row. Follow "see who shares it" to
   `https://kanmani.xyz/operators/<uriHash>`. The `<uriHash>` in that URL is the record id you pass next.
2. Sample 62 of those wallets, ordered by `md5(address)` so the sample is reproducible, then ask Nansen
   for each wallet's First Funder (1 credit a wallet):

   ```bash
   NANSEN_API_KEY=... ENVIO_PG_PASSWORD=... \
     node --experimental-strip-types verifier/src/cli/nansen-enrich.ts --funders --clusters 1 --per-cluster 62
   ```

3. Read the result back:

   ```bash
   curl -sS 'https://kanmani.xyz/operators' | grep -A2 'sampled wallets'
   ```

   Expected: 60 of 62 sampled wallets were first funded by `0x97cd97cfe21799bacbf39d0a53469e5f82f30996`,
   11 MON each; the other 2 came from one further funder.
4. Verify any funding tx on chain, from = funder, to = wallet, value 11 MON:

   ```bash
   cast tx <txHash> --rpc-url https://rpc.monad.xyz
   ```

The flags are the worker's own: `--clusters`, `--per-cluster`, `--budget`, `--reserve`, `--funder-reach`,
`--gap` and `--dry` (classify and print, write nothing). This is a sample of 62, never a claim about all
7,962 wallets.

## The daily sample timer

The sample grows on its own. `kanmani-nansen.timer` runs the worker once a day at 05:00 UTC
(`ops/systemd/`), after the free plan's daily credit top-up:

```
--funders --funder-reach --clusters 20 --per-cluster 10 --budget 5 --reserve 5 --gap 400
```

The free plan refills to 10 credits a day and does not accrue, so the sustainable spend is 5 a day with
a 5-credit reserve held back for a manual call. Two guards run on every run and whichever trips first
stops it: `--budget` is a call-based cap, so it holds even when Nansen's account read fails and the
balance is unknown; `--reserve` is balance-based. The cap is the one the unattended timer leans on,
because a failed balance read would otherwise disable the reserve check. The sample climbs about 5
wallets a day. The 100-credit labels endpoint and the 5-credit counterparties endpoint are never put on
this timer. To grow faster, raise `--budget` toward 9 and drop `--reserve` toward 1.

## The funder's own funder and the counterparties upgrade

`--funder-reach` asks one more Nansen fact per cluster, one step up the funding graph: who first funded
that cluster's own top funder. It is the same 1-credit related-wallets endpoint applied to a new subject
(the funder, not the sampled wallets), so it adds no new network code and shares the daily budget, which
means it can never push a run over. It is a handful of calls total (one per top cluster) and a funder
with a reach row is skipped, so it barely touches the budget. The finding becomes "the 60 wallets trace
to one funder and that funder was itself first funded by X". Stored append-only in `fovea.wallet_funder`
under the sample tag `funder:<address>`, read back by `lib/funder-reach.ts`.

The richer category, `profiler/address/counterparties` (entity-labelled counterparties with USD
volumes), is built and typed (`fetchAddressCounterparties`, `summarizeCounterparties` in `lib/nansen.ts`;
`fovea.funder_counterparty` in the schema) but it is budget-gated and NOT scheduled. At 5 credits a call
one request is the whole spendable daily budget. Its Monad coverage is not stated in Nansen's docs.
So it runs as a one-off manual command on a day the balance can take it. A render is wired only after
one live call comes back for Monad. If it returns empty for Monad the shipped second use stays the
1-credit funder-reach.
