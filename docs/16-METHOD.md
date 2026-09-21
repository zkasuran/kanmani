# 16. Method: reproducing every published number by hand

Every figure on the site and in these documents is derived from one of two things: a read against
Monad mainnet or a query against the index. This document gives the exact command for each one,
beside the output it returned when it was last run. If a command here disagrees with a page, the
page is wrong.

[`/method`](https://kanmani.xyz/method) is the companion surface. It explains how each **rung** of
the ladder decides. This explains where each **number** comes from. Between them nothing published
should require taking our word for it.

**Last full re-run: 2026-09-21, index at block 106700000.**

---

## 0. What you need and what you do not

The chain reads need only `cast` from [Foundry](https://getfoundry.sh) plus a public RPC. There is
no key, no account, no allowlist. **Run section 1, 6, 7 and 8 right now without installing this
project at all.** They are the sections that carry the claims about money.

The index queries need the indexer running locally, because Envio HyperIndex is self-hosted here.
Sections 2 through 5 are those. Bringing it up is `cd indexer && pnpm install && pnpm dev` plus the
sync time, which is the honest cost of reproducing a population census over 10,253 agents.

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

**Published as: 10,253 agents.**

`totalSupply()` reverts on this registry, so the token interface cannot answer how many agents
exist. The count lives in a storage slot:

```bash
cast call $ID "totalSupply()(uint256)" --rpc-url $R    # reverts, empty revert data

cast storage $ID \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url $R
# 0x000000000000000000000000000000000000000000000000000000000000280d

cast to-dec 0x280d    # 10253
```

The slot is not self-evidently the right slot, so do not take it on faith. Ids are dense from zero,
which makes the claim falsifiable in both directions at once: a counter of `N` means id `N-1` exists
while id `N` does not.

```bash
cast call $ID "ownerOf(uint256)(address)" 0 --rpc-url $R
# 0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029

cast call $ID "ownerOf(uint256)(address)" 10252 --rpc-url $R
# 0xDB6c6340342e71A63cD11Ebac2185204b7777777

cast call $ID "ownerOf(uint256)(address)" 10253 --rpc-url $R
# reverts: 0x7e273289…280d, which is ERC721NonexistentToken(10253)
```

Both halves agree. A wrong slot would not produce a boundary that lands exactly where the counter
says.

### Why you may read 10,253 where an older document says 10,252

**This number grows and one of the increments is ours.** The population census ran when the slot
read `10252`, so it covers ids `0` through `10251`. We then registered Optic as id `10252` in
[`0x07f7211e…`](https://monadexplorer.com/tx/0x07f7211e2699b9516bfb746c5d5bf2c8c1fe3768a7d2dc5b09cfd5e7e2b3c394)
at block 106470711, which is why the slot reads `10253` today and why the distinct-document count
moved from 2,012 to 2,013.

So `03-POPULATION.md` says 10,252 and means it: that was the registry at census time and rerunning
the census against a moving registry would change every derived percentage in the document. The
figure on the live site comes from the index and tracks the chain. **A reader who sees a number here
larger than one in a census document is seeing the registry grow, never a corrected error.** You will
never see it go down.

---

## 2. The population, from the index

**Published as: 10,253 agents, 2,013 distinct registration documents, 9,188 feedbacks, 1,192 of them
carrying an evidence document, 1 validation.**

This is `POPULATION_SQL` in `lib/queries.ts`, unedited:

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
          10253 |             2013 |      9188 |               1192 |           1 |            10253 | 106700000
```

**`agents_indexed` and `counterSlotCount` are published side by side on purpose.** One is derived
from logs, the other read from chain state. Equal means the index is current. A gap means the index
is behind, which is a different and much less alarming statement than "these agents do not exist",
so the page must be able to say which of the two is happening. `counterSlotCount` is nullable in
`indexer/schema.graphql` because a failed slot read has to publish as unknown rather than as a zero
that would be a fabricated population.

**1,192 of 9,188 is the number that governs the whole thesis.** Only 13.0% of Monad's ERC-8004
feedback carries an evidence document at all. The other 87% is a score with nothing behind it, which
is a rung below `declared` and therefore never appears in any ratio about evidence.

---

## 3. The measurement

**Published as: 85 payment claims, 12 resolve, 73 do not, 1,095 assert no payment, 12 unknown.**

`MEASUREMENT_SQL`, against the `fovea.verdict_latest` view:

```sql
SELECT count(*)                                                     AS verdicts,
  count(*) FILTER (WHERE outcome IN ('true','false'))               AS payment_claims,
  count(*) FILTER (WHERE outcome = 'true')                          AS resolve,
  count(*) FILTER (WHERE outcome = 'false')                         AS do_not_resolve,
  count(*) FILTER (WHERE outcome = 'noClaim')                       AS no_claim,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'declared')   AS unk_unreachable,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'resolvable') AS unk_bytes_moved,
  count(*) FILTER (WHERE outcome = 'unknown' AND rung = 'intact')     AS unk_unparsed
FROM fovea.verdict_latest;
```

```
 verdicts | payment_claims | resolve | do_not_resolve | no_claim | unk_unreachable | unk_bytes_moved | unk_unparsed
----------+----------------+---------+----------------+----------+-----------------+-----------------+--------------
     1192 |             85 |      12 |             73 |     1095 |               2 |              10 |            0
```

Check the arithmetic yourself: 85 + 1095 + 2 + 10 + 0 = 1192, which is every document carrying a
URI from section 2. Nothing is dropped between the two.

**Read the denominator correctly.** The finding is about **85 documents that assert a payment**. It
is not about 1,192 documents, not about 9,188 feedbacks and not about 10,253 agents. Any wider
phrasing is an overclaim and it is one I made myself before the full corpus was measured. The
correction is in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md).

**The 12 unknowns are split by how far the ladder got, because the two causes are different.** Ten
stopped at `resolvable`: the URL still answers, the bytes no longer match the hash committed on
chain, so reading a claim out of them would attribute it to an author who committed to something
else. Two stopped at `declared`: `ipfs://` documents no gateway would serve. Zero are unparsed,
meaning every document shape on this chain is in the published atlas.

**`unknown` is never counted as `false` and never rendered as `0`.** Collapsing them would let
somebody else's outage publish as our accusation, at scale, with their name attached.

---

## 4. Which chain the claims name

**Published as: every one of the 85 claims names Monad.**

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
 monad   |      12 |             73
```

One row. **This killed the hypothesis the project was designed around.** The build expected
documents citing one chain while the payment sat on another, which is why `locate` reads seven
chains rather than one. It does not happen here. The failure is simpler: the transaction is not
anywhere, including on the chain the author named.

The multi-chain reader stays and the chain list stays published on `/method`, for a reason that is
about falsifiability rather than about coverage. **A "not found" means nothing without the list of
places it was looked for.** A chain with no endpoint configured returns null rather than a client
pointed at a default, because a silent fallback would make an unconfigured chain look checked.

---

## 5. Parse coverage, in the open

**Published as: six mappings, zero unparsed.**

```sql
SELECT coalesce(mapping, '(no mapping reached)') AS mapping, outcome, count(*)
FROM fovea.verdict_latest GROUP BY 1, 2 ORDER BY 3 DESC;
```

```
             mapping              | outcome | count
----------------------------------+---------+-------
 elo-record.v1                    | noClaim |  1026
 plain-text-comment.v1            | noClaim |    66
 execution-market.v1              | false   |    60
 execution-market-transactions.v1 | false   |    13
 (no mapping reached)             | unknown |    12
 execution-market-transactions.v1 | true    |    10
 conversation-score.v1            | noClaim |     3
 execution-market.v1              | true    |     2
```

**1,026 of the documents are chess ELO records.** That single row is why the denominator is 85 and
not 1,192 and why sampling the head of a list gave the opposite impression: ordering by block
descending showed mostly HTTP documents, while the population is 92% `data:` URIs that decode
locally and assert no payment at all.

**Publishing the 12 as a coverage gap rather than folding them into `noClaim` is load bearing.** The
first version of the atlas left 23 documents unparsed, all one shape: an older Execution Market
layout with the hash under `transactions.payment_tx` instead of `proof_of_payment`. Adding that one
mapping moved `true` from 2 to 12. **An incomplete parser does not merely produce unknowns, it
distorts the found-to-not-found ratio, which is the number the entire thesis rests on.** A softer
label on those 23 would have hidden a sixfold error in our own headline.

Every mapping is in `verifier/src/ladder/parse.ts` with the date it was induced, is rendered on
`/method` and two mappings matching one document is refused rather than resolved by array order.

---

## 6. The registry health and the document 8,093 agents share

**Published as: 8,095 agents point at a document whose host answered and said it is not there.**

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
 gone       |       3 |   8095 | 2026-09-20 11:21:59.325+00
 answered   |    1308 |   1358 | 2026-09-20 11:29:58.766+00
 paywalled  |     539 |    545 | 2026-09-20 11:26:07.614+00
 onchain    |     129 |    137 | 2026-09-20 11:21:53.654+00
 unknown    |      17 |     18 | 2026-09-20 11:22:09.582+00
 nohost     |       7 |     10 | 2026-09-20 11:22:17.895+00
 malformed  |       9 |      9 | 2026-09-20 11:22:07.506+00
 not probed |       1 |      1 |
```

**A boolean could not have carried this.** 545 agents are `paywalled`, meaning HTTP 402: a host that
is alive and asking for payment, which is the opposite of dead. 18 are `unknown`, mostly our own
rate limiting rather than anyone's failure. Publishing those as dead would have been wrong about 563
agents.

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
 10253 |          80
```

8095 + 1358 + 545 + 137 + 18 + 10 + 9 + 1 = **10,173**, plus **80** agents holding no document at
all, is **10,253** exactly. **Those 80 were falling out of a join silently.** No query failed and no
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

**8,093 agents registered by 7,962 distinct wallets describe themselves with one file.** Ask it
yourself, no index required:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://eve-8004.vercel.app/metadata/b.json    # 404
```

`distinctOwners` is counted at registration time through a join table rather than incremented
alongside `memberCount`. An earlier version incremented both, which made them provably equal and
destroyed the only interesting number in the row: 8,093 agents behind 7,962 wallets says something
that 8,093 behind 8,093 would not.

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

### The buyer held zero MON throughout

Not "started with none and was topped up". Zero at every point, while creating an escrow and
settling it:

```bash
cast balance 0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92 --rpc-url $R    # 0
```

The escrow is funded through EIP-3009 `receiveWithAuthorization`, so the buyer signs and a relayer
pays the gas. The test asserts the zero balance rather than printing it, because a demo that
happens to work with a funded account proves nothing about a buyer who has never touched Monad.

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

`locate` answers found, not found or unknown and an unknown says which chain it looked on and why
it could not decide. `/verify` on the site imports the same `judge()` function this CLI does, so the
page and the command line cannot give different answers. That is the reason the import exists rather
than a reimplementation.

---

## 10. Numbers that move and how to tell drift from error

Four of the figures here are live and will not match a document written last week. Knowing which is
part of reading the site correctly.

| figure | moves | why |
|---|---|---|
| agents, distinct records | **grows** | the registry is open. Ours is one of the increments |
| feedbacks, feedbacks with a URI | **grows** | anyone can write one |
| the 85 / 12 / 73 split | **can move either way** | a repaired document flips `false` to `true`. That is the point |
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

## 11. What this document cannot give you

The site itself is not deployed yet, so `kanmani.xyz` does not resolve and the URLs in section 0 and
section 9 will not answer. Every chain command here works today against public infrastructure, and
every SQL command works against a local index. **The hosted surface is the gap and it is first in
[`14-GAPS.md`](14-GAPS.md).** Until it is closed, reproduce the measurements from this document
rather than from the site.
