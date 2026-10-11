# 16. Method: reproducing every published number by hand

Every figure on the site and in these documents is derived from one of two things: a read against
Monad mainnet or a query against the index. This document gives the exact command for each one,
beside the output it returned when it was last run. If a command here disagrees with a page, the
page is wrong.

[`/method`](https://kanmani.xyz/method) is the companion surface. It explains how each **rung** of
the ladder decides. This explains where each **number** comes from. Between them nothing published
should require taking our word for it.

**Last full re-run: 2026-10-02, index at block 109750000.**

---

## 0. What you need and what you do not

The chain reads need only `cast` from [Foundry](https://getfoundry.sh) plus a public RPC. There is
no key, no account, no allowlist. **Run section 1, 6, 7 and 8 right now without installing this
project at all.** They are the sections that carry the claims about money.

The index queries need the indexer running locally, because Envio HyperIndex is self-hosted here.
Sections 2 through 5 are those. Bringing it up is `cd indexer && npm ci && npm run dev` plus the
sync time, which is the honest cost of reproducing a population census over <!-- n:agents -->10,375<!-- /n --> agents.

```bash
export R=https://rpc.monad.xyz                                # chain 143, Monad mainnet
export ID=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432          # ERC-8004 Identity Registry
export REP=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63         # ERC-8004 Reputation Registry
export VAL=0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58         # ERC-8004 Validation Registry
export U=0x754704Bc059F8C67012fEd69BC8A327a5aafb603           # USDC
export ESCROW=0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32      # Aqueous
```

Confirm you are on the right chain before trusting anything below:

```bash
cast chain-id --rpc-url $R          # 143
cast call $U "decimals()(uint8)" --rpc-url $R    # 6
```

**Six decimals matters.** Every USDC figure in this project is in whole tokens. A reader assuming 18
would read our 1.40 settlement as dust and conclude we demonstrated nothing.

For the SQL sections:

```bash
export PGPASSWORD=<your ENVIO_PG_PASSWORD>
alias fovea='psql -h 127.0.0.1 -p 5434 -U postgres -d envio-dev -X'
```

Port 5434 rather than 5432 is deliberate, set in `lib/db.ts`, so this index cannot collide with
another Postgres already on the machine. There is no default password.

---

## 1. The population, from the registry's own counter slot

**Published as: <!-- n:agents -->10,375<!-- /n --> agents.**

`totalSupply()` reverts on this registry, so the token interface cannot answer how many agents
exist. The count lives in a storage slot:

```bash
cast call $ID "totalSupply()(uint256)" --rpc-url $R    # reverts, empty revert data

cast storage $ID \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url $R
# 0x0000000000000000000000000000000000000000000000000000000000002824

cast to-dec 0x2824    # 10276
```

The slot is not self-evidently the right slot, so do not take it on faith. Ids are dense from zero,
which makes the claim falsifiable in both directions at once: a counter of `N` means id `N-1` exists
while id `N` does not.

```bash
cast call $ID "ownerOf(uint256)(address)" 0 --rpc-url $R
# 0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029

cast call $ID "ownerOf(uint256)(address)" 10275 --rpc-url $R
# 0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5

cast call $ID "ownerOf(uint256)(address)" 10276 --rpc-url $R
# reverts: 0x7e273289…2824, which is ERC721NonexistentToken(10276)
```

Both halves agree. A wrong slot would not produce a boundary that lands exactly where the counter
says.

### Why you may read <!-- n:agents -->10,375<!-- /n --> where an older document says 10,252

**This number grows and one of the increments is ours.** The population census ran when the slot
read `10252`, so it covers ids `0` through `10251`. We then registered Optic as id `10252` in
[`0x07f7211e…`](https://monadscan.com/tx/0x07f7211e2699b9516bfb746c5d5bf2c8c1fe3768a7d2dc5b09cfd5e7e2b3c394)
at block 106470711, which took the slot from `10252` to `10253` and the distinct-document count from
2,012 to 2,013 at that moment. By block 109,750,000 the slot read `10276` with 2,053 distinct
documents. The live site shows <!-- n:agents -->10,375<!-- /n --> agents and <!-- n:documents -->2,112<!-- /n --> documents now, the
rest of the growth being other people registering after us.

So `03-POPULATION.md` says 10,252 and means it: that was the registry at census time and rerunning
the census against a moving registry would change every derived percentage in the document. The
figure on the live site comes from the index and tracks the chain. **A reader who sees a number here
larger than one in a census document is seeing the registry grow, never a corrected error.** You will
never see it go down.

---

## 2. The population, from the index

**Published as: <!-- n:agents -->10,375<!-- /n --> agents, <!-- n:documents -->2,112<!-- /n --> distinct registration documents, <!-- n:feedbacks -->9,300<!-- /n --> feedbacks, <!-- n:withPointer -->1,300<!-- /n --> of them
carrying an evidence document, 1 validation.**

This is `POPULATION_SQL` from `lib/queries.ts`, with the chain id inlined and the `updatedAt` column
dropped for brevity. The reading below is from block 109,750,000. The counts climb with every
registration, so the live figures are the markers above and this shows the query shape rather than
today's totals:

```sql
SELECT
  (SELECT count(*) FROM "Agent"        WHERE "chainId" = 143)                         AS agents_indexed,
  (SELECT count(*) FROM "AgentRecord"  WHERE "chainId" = 143)                         AS distinct_records,
  (SELECT count(*) FROM "Feedback"     WHERE "chainId" = 143)                         AS feedbacks,
  (SELECT count(*) FROM "Feedback"     WHERE "chainId" = 143 AND "feedbackUri" <> '') AS feedbacks_with_uri,
  (SELECT count(*) FROM "Validation"   WHERE "chainId" = 143)                         AS validations,
  s."counterSlotCount", s."atBlock"
FROM (SELECT * FROM "IndexState" WHERE "chainId" = 143 LIMIT 1) s;
```

```
 agents_indexed | distinct_records | feedbacks | feedbacks_with_uri | validations | counterSlotCount |  atBlock
----------------+------------------+-----------+--------------------+-------------+------------------+-----------
          10276 |             2053 |      9288 |               1292 |           1 |            10276 | 109750000
```

**`agents_indexed` and `counterSlotCount` are published side by side on purpose.** One is derived
from logs, the other read from chain state. Equal means the index is current. A gap means the index
is behind, which is a different and much less alarming statement than "these agents do not exist",
so the page must be able to say which of the two is happening. `counterSlotCount` is nullable in
`indexer/schema.graphql` because a failed slot read has to publish as unknown rather than as a zero
that would be a fabricated population.

**<!-- n:withPointer -->1,300<!-- /n --> of <!-- n:feedbacks -->9,300<!-- /n --> is the number that governs the whole thesis.** Only 13.9% of Monad's ERC-8004
feedback carries an evidence document at all. The other 86% is a score with nothing behind it, which
is a rung below `declared` and therefore never appears in any ratio about evidence.

---

## 3. The measurement

**Published as: <!-- n:claims -->187<!-- /n --> payment claims, <!-- n:claimsTrue -->64<!-- /n --> resolve, 123 do not, <!-- n:noClaim -->1,095<!-- /n --> assert no payment, <!-- n:unknown -->18<!-- /n --> unknown.**

`MEASUREMENT_SQL`, against the `fovea.verdict_latest` view:

```sql
SELECT count(*)                                                     AS verdicts,
  count(*) FILTER (WHERE outcome IN ('true','false'))               AS payment_claims,
  count(*) FILTER (WHERE outcome = 'true')                          AS resolve,
  count(*) FILTER (WHERE outcome = 'false')                         AS do_not_resolve,
  count(*) FILTER (WHERE outcome = 'noClaim')                       AS no_claim,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'declared')   AS unknown_unreachable,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'resolvable') AS unknown_bytes_moved,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'intact')     AS unknown_unparsed
FROM fovea.verdict_latest;
```

Read on 2026-10-04, after the tab-settlement mapping shipped. Run the query for today's figures:

```
 verdicts | payment_claims | resolve | do_not_resolve | no_claim | unknown_unreachable | unknown_bytes_moved | unknown_unparsed
----------+----------------+---------+----------------+----------+---------------------+---------------------+------------------
          1292 |            185 |      62 |            123 |     1095 |                   2 |                  10 |                0
```

Check the arithmetic on that reading yourself: 185 + 1095 + 2 + 10 + 0 = 1292, which is every document carrying a
URI from section 2. Nothing is dropped between the two.

**Read the denominator correctly.** The finding is about **<!-- n:claims -->187<!-- /n --> documents that assert a payment**. It
is not about <!-- n:withPointer -->1,300<!-- /n --> documents, not about <!-- n:feedbacks -->9,300<!-- /n --> feedbacks and not about <!-- n:agents -->10,375<!-- /n --> agents. Any wider
phrasing is an overclaim and it is one I made myself before the full corpus was measured. The
correction is in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md).

**The <!-- n:unknown -->18<!-- /n --> unknowns are split by how far the ladder got, because the causes are different.** <!-- n:unknownHash -->13<!-- /n -->
stopped at `resolvable`: the URL still answers, the bytes no longer match the hash committed on
chain, so reading a claim out of them would attribute it to an author who committed to something
else. <!-- n:unknownRateLimited -->5<!-- /n --> stopped at `declared`: the document's host would not answer. None stop at `intact` today. Three did until 2026-10-04: their bytes matched the on-chain hash but no published mapping read the shape. A Qwen-proposed mapping for that shape was reviewed and shipped. All three now read `true`.

**`unknown` is never counted as `false` and never rendered as `0`.** Collapsing them would let
somebody else's outage publish as our accusation, at scale, with their name attached.

---

## 4. Which chain the claims name

**Published as: every one of the <!-- n:claims -->187<!-- /n --> claims names Monad.**

```sql
SELECT coalesce(declared_network, '(none stated)') AS network,
       count(*) FILTER (WHERE outcome = 'true')  AS resolve,
       count(*) FILTER (WHERE outcome = 'false') AS do_not_resolve
FROM fovea.verdict_latest
WHERE outcome IN ('true','false')
GROUP BY 1 ORDER BY 2 + 3 DESC;
```

```
 network | resolve | do_not_resolve
---------+---------+----------------
 monad   |      64 |            123
```

One row. Every claim names Monad. **The transaction usually is not on Monad, it is on another
chain.** Of the 123 that do not resolve on the named chain, 115 cite a transaction that is a real
mined transaction somewhere else, arbitrum, ethereum, optimism, base, polygon and celo among them, while 8 are
found on no chain we read. That is the hypothesis the project was designed around and it is
confirmed rather than killed, which is why `locate` reads seven chains rather than one.

The multi-chain reader earns its place twice. It is what surfaces the 115, so it pays for itself on
coverage. It is also what makes the 8 reportable at all, because **a "not found" means nothing
without the list of places it was looked for.** A chain with no endpoint configured returns null
rather than a client pointed at a default, because a silent fallback would make an unconfigured chain
look checked, so the 8 are reported as not found where we looked rather than as fabricated.

---

## 5. Parse coverage, in the open

**Published as: six mappings, three unparsed.**

```sql
SELECT coalesce(mapping, '(no mapping reached)') AS mapping, outcome, count(*)
FROM fovea.verdict_latest GROUP BY 1, 2 ORDER BY 3 DESC;
```

```
             mapping              | outcome | count
----------------------------------+---------+-------
 elo-record.v1                    | noClaim |  1026
 execution-market.v1              | false   |   110
 plain-text-comment.v1            | noClaim |    66
 execution-market.v1              | true    |    54
 (no mapping reached)             | unknown |    18
 execution-market-transactions.v1 | false   |    13
 execution-market-transactions.v1 | true    |    10
 conversation-score.v1            | noClaim |     3
```

**1,026 of the documents are game ELO records, every one naming the game `melee`.** That single row is why the denominator is <!-- n:claims -->187<!-- /n --> and
not <!-- n:withPointer -->1,300<!-- /n --> and why sampling the head of a list gave the opposite impression: ordering by block
descending showed mostly HTTP documents, while the population is 85% `data:` URIs that decode
locally and assert no payment at all.

**Publishing the <!-- n:unknown -->18<!-- /n --> as a coverage gap rather than folding them into `noClaim` is load bearing.** The
first atlas, measured 2026-09-19, left 23 documents unparsed, all one shape: an older Execution
Market layout with the hash under `transactions.payment_tx` instead of `proof_of_payment`. Adding
that one mapping moved `true` from 2 to 12 at the time. **An incomplete parser does not merely produce unknowns, it
distorts the found-to-not-found ratio, which is the number the entire thesis rests on.** A softer
label on those 23 would have hidden a sixfold error in our own headline.

Every mapping is in `verifier/src/ladder/parse.ts`, written or reviewed by a person, with the date in a field named
`induced`, is rendered on
`/method` and two mappings matching one document is refused rather than resolved by array order.

---

## 6. The registry health and the document <!-- n:oneDocAgents -->8,093<!-- /n --> agents share

**Published as: <!-- n:goneAgents -->8,113<!-- /n --> agents point at a registration document whose host answered and said it is not there.**

Eight states rather than a boolean, as a SQL view so the page, the feed and the API cannot disagree:

```sql
SELECT coalesce(p.state, 'not probed') AS state,
       count(*) AS records, sum(r."memberCount") AS agents, max(p.checked_at) AS probed_at
FROM "AgentRecord" r
LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
WHERE r."chainId" = 143 GROUP BY 1 ORDER BY agents DESC;
```

```
   state    | records | agents |         probed_at
------------+---------+--------+----------------------------
 gone       |     543 |   8641 | 2026-10-03 03:39 ...
 answered   |    1316 |   1366 | 2026-10-03 03:39 ...
 onchain    |     143 |    151 | 2026-10-03 03:39 ...
 unknown    |      35 |     36 | 2026-10-03 03:39 ...
 nohost     |       7 |     10 | 2026-10-03 03:39 ...
 malformed  |       9 |      9 | 2026-10-03 03:39 ...
 not probed |       1 |      1 |
```

**A boolean could not have carried this.** <!-- n:goneAgents -->8,113<!-- /n --> agents are `gone`, the host answered and the
document is not there. The probe table above is the 2026-10-03 reading, where that bucket stood at
8,641. The site reads the live count on every load, so the marker here and the dated snapshot differ
by design. 36 are `unknown`, mostly our own rate limiting rather than anyone's failure. Publishing
the unknowns as dead would have been wrong about them. The probe pass ran later than the section-2
census, so its total is 10,277 against section 2's 10,276. That is one more registration arriving
between two reads, which is the only direction this moves. Both reads print their own total, so a
lost row could not hide in the difference.

**We got the 402 classification wrong first. This is how it was caught.** An earlier pass read
539 records as `paywalled`, meaning a host alive and asking for payment, because they answered HTTP
402 and x402 uses 402 to mean pay me. Re-probing with the response headers recorded showed all 539
carry `x-vercel-error: DEPLOYMENT_DISABLED` and a `text/plain` body. They are one suspended hosting
account, 545 agents behind it, not a payment surface. A status code is not a protocol. `record_state`
now calls a 402 `paywalled` only when it carries a real challenge (`www-authenticate: x402` or a JSON
body). A vendor-error 402 falls through to `gone`. So `paywalled` reads 0 today and the payable
third-party surface on Monad is one endpoint, ADEXTO, not three.

The buckets must sum to the registry and they do not on their own:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE "uriHash" IS NULL OR "tokenUri" IS NULL OR "tokenUri" = '')
         AS no_document
FROM "Agent" WHERE "chainId" = 143;
```

```
 total | no_document
-------+-------------
 10277 |          63
```

8641 + 1366 + 151 + 36 + 10 + 9 + 1 = **10,214**, plus **63** agents holding no document at
all, is **10,277** exactly. **Those no-document agents were falling out of a join silently, 80 of
them when it was caught.** No query failed and no
test went red; the buckets simply summed to less than the registry. A registration that says nothing
about itself is a finding rather than a gap in a join, so the page now prints its own sum next to the
total and this document shows the addition.

The single `not probed` record is Optic's, written on chain after the probe pass ran. Unknown rather
than assumed, including about ourselves.

Now the cluster itself:

```sql
SELECT "memberCount", "distinctOwners", uri FROM "AgentRecord"
WHERE "chainId" = 143 ORDER BY "memberCount" DESC LIMIT 2;
```

```
 memberCount | distinctOwners |                     uri
-------------+----------------+---------------------------------------------
        8093 |           7962 | https://eve-8004.vercel.app/metadata/b.json
          25 |              1 | https://execution.market/workers/0x52e05c8e…
```

**<!-- n:oneDocAgents -->8,093<!-- /n --> agents registered by <!-- n:oneDocWallets -->7,962<!-- /n --> distinct wallets describe themselves with one file.** Ask it
yourself, no index required:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://eve-8004.vercel.app/metadata/b.json    # 404
```

`distinctOwners` is counted at registration time through a join table rather than incremented
alongside `memberCount`. An earlier version incremented both, which made them provably equal and
destroyed the only interesting number in the row: <!-- n:oneDocAgents -->8,093<!-- /n --> agents behind <!-- n:oneDocWallets -->7,962<!-- /n --> wallets says something
that <!-- n:oneDocAgents -->8,093<!-- /n --> behind <!-- n:oneDocAgents -->8,093<!-- /n --> would not.

---

## 7. The money, on Monad mainnet

Four transactions, all chain 143, all status 1. No testnet.

```bash
cast receipt 0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e --rpc-url $R
cast receipt 0xc259c7a6067c051c01ed75a2b12d5c64380216275a43417ddf407913582a6724 --rpc-url $R
cast receipt 0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5 --rpc-url $R
cast receipt 0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a --rpc-url $R
```

| step | block | USDC moved |
|---|---|---|
| escrow | 106463264 | `1.400000` buyer `0x27a8ae37…1F92` to Aqueous |
| deliver | 106463280 | none, the receipt is committed here |
| settle | 106463284 | `0.600000` to agent `0xafa4b628…3b52`, `0.800000` back to buyer |
| x402 | 106462031 | `0.010000` for one verification |

**The settlement arithmetic is the point of the contract.** 1.40 escrowed at 2 cents a call for 70
calls, 30 used, so 0.60 is earned and 0.80 is unspent. `0.600000 + 0.800000 = 1.400000` and the
remainder returns in the same transaction that pays the agent, so **0 is retained**. There is no
sweep function and no admin path that could retain it.

Decode the transfers rather than trusting the table. `mwei` is 6 decimals, which is USDC:

```bash
cast receipt 0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5 \
  --rpc-url $R --json \
| jq -r '.logs[] | select(.topics[0]=="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
         | "0x\(.topics[1][26:]) 0x\(.topics[2][26:]) \(.data)"' \
| while read -r from to raw; do
    echo "$from -> $to  $(cast to-unit "$(cast to-dec "$raw")" mwei) USDC"
  done
# 0xd75f7786…1044fc32 -> 0xafa4b628…7f663b52  0.600000 USDC
# 0xd75f7786…1044fc32 -> 0x27a8ae37…697c1f92  0.800000 USDC
```

### The buyer paid no gas

Not "started with none and was topped up". The escrow is funded through EIP-3009
`receiveWithAuthorization`, so the buyer signs an authorization and a relayer submits it and pays the
gas. Both transactions for this job read `from` the relayer, never the buyer:

```bash
cast tx 0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5 from --rpc-url $R
# 0xdb6c6340…b7777777, the relayer, not the buyer
```

The buyer wallet was reused for later jobs, so its live MON balance has moved on since. What proves
the gasless path is the sender of the transaction, which cannot change, not a balance that can.

### The x402 payment was a self-payment, which limits what it proves

Run the same decoder over the x402 transaction:

```bash
cast receipt 0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a \
  --rpc-url $R --json \
| jq -r '.logs[] | select(.topics[0]=="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
         | "0x\(.topics[1][26:]) 0x\(.topics[2][26:]) \(.data)"' \
| while read -r from to raw; do
    echo "$from -> $to  $(cast to-unit "$(cast to-dec "$raw")" mwei) USDC"
  done
# 0xdb6c6340…b7777777 -> 0xdb6c6340…b7777777  0.010000 USDC
```

Sender and recipient are the same address. **Net USDC movement is zero.** It proves the x402 v2
challenge, the facilitator verification and the settlement path all work end to end against the live
Monad facilitator. It does not prove a stranger paid us and it is labelled that way everywhere it
appears rather than only here.

The contract is immutable, with no proxy and no admin function:

```bash
cast codesize $ESCROW --rpc-url $R    # 10901
```

Two fund-loss bugs were found and fixed before it went on chain, one a full theft of the escrow by
any relayer. Both are published with working exploits in
[`17-CONTRACT-AUDIT.md`](17-CONTRACT-AUDIT.md).

---

## 8. The Validation Registry row

**Published as: the registry held zero rows. It holds one now.**

```bash
cast call $VAL "getAgentValidations(uint256)(bytes32[])" 10252 --rpc-url $R
# [0x72c07ee9c59badfa32fefb18126a356fc0bf0f8dfdce2a3e6c471470899f23bd]

cast call $VAL "getSummary(uint256,address[],string)(uint64,uint64)" \
  10252 "[0xDB6c6340342e71A63cD11Ebac2185204b7777777]" "kanmani.payment-claim.v1" --rpc-url $R
# 1
# 100
```

One validation, score 100, under the tag `kanmani.payment-claim.v1`.

**The empty registry has a cause and it is not adoption.** `validationRequest` reverts
`Not authorized` for anyone who is not the agent's owner, so nobody can publish a verdict about
somebody else unilaterally. That is a deliberate property of the contract rather than a gap and it
is why Optic answers validation requests instead of broadcasting judgements. Learning it cost a
reverted transaction, which is recorded in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md).

All three registries answer with 130 bytes of code, which is the shape of a minimal proxy:

```bash
for a in $ID $REP $VAL; do cast codesize $a --rpc-url $R; done    # 130, 130, 130
```

---

## 9. One claim, end to end, without this project

The shortest honest path from a feedback to a verdict, using only the chain plus the verifier CLI:

```bash
node --experimental-strip-types verifier/src/cli/locate.ts monad <txHash>
```

`locate` answers found, not found or unknown and an unknown says which chain it looked on and why it
could not decide. It is the same `locate` that [`/verify`](https://kanmani.xyz/verify) runs: the
site's verdict goes through `judge()` in `verifier/src/ladder/verdict.ts`, which calls this exact
`locate`, so the page and the command line cannot place a transaction differently. The site imports
the verifier rather than reimplementing it.

The CLI reads its endpoints from the environment, so source `.env.local` first
(`set -a && . .env.local && set +a`). Without it Monad falls back to the public RPC and a hash on any
other chain reads `unknown` for want of an endpoint rather than because the chain said no.

---

## 10. Numbers that move and how to tell drift from error

Four of the figures here are live and will not match a document written last week. Knowing which is
part of reading the site correctly.

| figure | moves | why |
|---|---|---|
| agents, distinct records | **grows** | the registry is open. Ours is one of the increments |
| feedbacks, feedbacks with a URI | **grows** | anyone can write one |
| the <!-- n:claims -->187<!-- /n --> / <!-- n:claimsTrue -->64<!-- /n --> / 123 split | **can move either way** | a repaired document flips `false` to `true`. That is the point |
| the eight probe states | **moves on re-probe** | a host that was down can answer next week |

**Verdicts are append only. There is no update path anywhere in the code.** A re-check writes a new
row, so a document somebody fixes reads as `false` then `true` with both timestamps rather than as a
number quietly improving with no trace we ever said otherwise. `/status` lists every claim whose
verdict has changed and every claim page carries its full history.

So the test for whether a difference is drift or an error is mechanical: **drift moves in the
direction the chain moves and leaves both rows visible. An error does not.** If you find a number on
the site that no command in this document reproduces, that is a defect and it belongs in
[`18-BUGS-FIXED.md`](18-BUGS-FIXED.md) with the evidence. Four entries are already there, including
one where our own check was wrong rather than the chain.

## 11. Two ways to check this

The site is live at [`kanmani.xyz`](https://kanmani.xyz). Every URL in section 0 and section 9
answers an anonymous request over valid TLS, so there are two independent ways to check any number
here. You can read it off the live page, which is served from the same index these queries run
against. You can also reproduce it from scratch: every chain command runs against public
infrastructure with no account, every SQL command runs against a local index you bring up yourself.
If the two ever disagree the commands win. That gap is then a defect for
[`18-BUGS-FIXED.md`](18-BUGS-FIXED.md).
