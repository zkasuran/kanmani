# As built

**Read this first.** It says what shipped against what was planned, including what did not ship and
why. Every line is checkable, with the checks given.

A plan describes intent. This describes the artifact. Where the two disagree, this one is right.

---

## How to check any line here

Claims about chain state carry a `cast` command. Claims about measurements carry the SQL or the
CLI that produces them. [`16-METHOD.md`](16-METHOD.md) reproduces every published number by
hand. Claims about tests carry the command that runs them.

```bash
npm test                              # 172 tests, 169 pass, 3 skip. the site
cd verifier && npm test               # 189 tests, 172 pass, 17 skip without a database
cd contracts && forge test            # 121 tests, 113 pass, 8 fork tests skipped without a fork URL
npx next build                        # compiles clean, every data route dynamic
```

**454 tests pass across the three suites.** That is the number quoted on the site.

---

## Status vocabulary, used everywhere below

Two words, and the difference decides whether a claim survives a check.

| word | means | how a stranger checks it |
|---|---|---|
| **live** | deployed and running, on Monad mainnet or at `kanmani.xyz` | a `cast` call or an HTTP request that answers right now |
| **built** | written, tested and readable in this repository, **not** deployed or wired to a live stream | `ls`, `forge test`, `npm test` |

Nothing in this document is called live unless a command in it returns. A layer that is built and
described as live would be the exact failure this project exists to attack.

---

## Shipped

### Retina, the index

Envio HyperIndex over all three ERC-8004 registries on Monad mainnet. Holds **10,252 agents** at
census time, matching the registry's own counter slot exactly, **2,012 distinct registration
documents** and **9,188 feedbacks**.

The live index reads **10,253** and **2,013** today, because we then registered ourselves as agent
10252. That is the registry growing rather than a corrected error, it can only ever grow, and
[`16-METHOD.md`](16-METHOD.md) section 1 says which figure is which.

Load-bearing rather than an integration: `feedbackURI` and `feedbackHash` exist only as
non-indexed fields of the `NewFeedback` event, `readFeedback()` does not return them, and
`eth_getLogs` caps at a 100-block span on every free Monad provider. Without an index there is no
way to reach the evidence at all.

Records are deduplicated by content hash, with `distinctOwners` counted at registration time
through a join table rather than incremented alongside `memberCount`. An earlier version
incremented both, which made them provably equal and destroyed the only interesting number.

### Fovea, the verdict ladder

Five rungs: `declared`, `resolvable`, `intact`, `parsed`, `true`. All **1,192** documents carrying
a URI have been taken through it. Four outcomes. `unknown` is never `false`.

| outcome | count |
|---|---|
| `noClaim` | 1,095 |
| `false` | 73 |
| `true` | 12 |
| `unknown` | 12 |

Verdicts are append only, in their own `fovea` Postgres schema rather than Envio's `public`,
because `public` is dropped and recreated on every resync. A re-check writes a new row, so a
document somebody repairs reads as `false` to `true` with both timestamps.

### The registration probe

All **2,012** distinct documents asked once each, deduplicated by record hash so one dead URL is
fetched once rather than 8,093 times. Per host, serial, with a gap, because three hosts carry
1,771 of them.

Eight states rather than a boolean, as a SQL view so page, feed and API cannot disagree. The
headline: **8,640 agents point at a document whose host answered and said it is not there**. 8,093
of those share one URL across 7,962 wallets.

### Aqueous, the escrow

Live on Monad mainnet at
[`0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32`](https://monadexplorer.com/address/0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32),
10,901 bytes, immutable, no proxy, no admin function. Also on testnet with a test token, because
neither USDC nor any registry exists on chain 10143.

**One complete job settled in real USDC**, five transactions, blocks 106463256 to 106463284. 1.40
escrowed at 2 cents a call, 30 of 70 used, 0.60 to the agent, 0.80 returned in the settling
transaction, 0 retained. The buyer held zero MON at both ends and the script asserts that rather
than printing it.

Two fund-loss bugs were found and fixed before it went on chain, one a full theft of the escrow by
any relayer. Both are published with their exploits in
[`17-CONTRACT-AUDIT.md`](17-CONTRACT-AUDIT.md).

### x402: the verifier is payable

`POST /api/verify` answers 402 with an x402 v2 challenge, verifies through the Monad facilitator,
does the work, then settles. Proven end to end against the live facilitator:
[`0xf044c754…ee526d8a`](https://monadexplorer.com/tx/0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a),
block 106462031, submitted by the signer the facilitator's own `/supported` advertises.

Then our own verifier read our own payment back and found it on Monad.

**It was a self-payment.** Net USDC movement is zero. It proves the machinery, not that a stranger
paid us. That is stated everywhere it appears.

### Iris and Vitreous, the account layer

One passkey ceremony gives three independent keys through HKDF-SHA256 with a distinct info per
namespace: an account key, an attestation key that signs receipts and deliberately cannot move
money, plus an AES-256-GCM content key.

Nothing is stored. No cookie, no token, no cached credential id. The passkey is discoverable so the
browser offers it unprompted, which means there is no returning-user path and therefore none that
can break.

The vault round trip is proven over real HTTP, not two tabs: one device seals and stores, another
derives the same address from the same PRF output with nothing shared but 32 bytes, fetches and
decrypts. A stranger holding the ciphertext gets an authentication failure. A forged write is 403.

### Optic: the first row in the Validation Registry

Registered as **agent 10252** with the record written into `tokenURI` rather than hosted, because
we had just measured that 8,093 agents point at one document that returns a deletion.

The registry held **zero** rows against the Reputation Registry's 9,188 feedbacks. It holds one
now. `getValidatorRequests`, `getAgentValidations` and `getSummary` all confirm it. The index
that follows the contract went from 0 to 1.

### Cornea, the surface

Thirteen pages and nine machine-readable surfaces. Every page can print the SQL behind its numbers.
`/verify` imports the verifier's own `judge()` rather than reimplementing the ladder, so the site
and the command line cannot give different answers.

**It is live at [https://kanmani.xyz](https://kanmani.xyz).** Verify the way a judge would, signed
out:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/          # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/verify    # 200
curl -sS https://kanmani.xyz/llms.txt | head -5
```

Self-hosted on a dedicated box behind Caddy, systemd unit `kanmani-web.service`, with the Envio
indexer running alongside it so the displayed count tracks the chain rather than a snapshot. The
site has no dependency on a laptop. The domain is paid to 2027-09-21, so it outlasts judging.

**The landing page leads with the product, not the measurement.** It reads: what Kanmani is, why
the market needs it, how the money moves, the stack it composes into, then the evidence underneath.
The measurement is proof the engine works rather than the pitch, which is the tone this project set
for itself: a clearing house, never an exposé. Every layer on the stack carries a `live` or `built`
chip, and those chips deliberately borrow neither the verdict green nor the verdict red, because a
statement about our build must never be readable as a verdict about an agent.

---

## Built, not yet live

**This section replaces one that said these were "not started". That was true when it was written
and it is now false.** Leaving it up would be a published claim that no longer matches what a check
returns, which is the failure this project exists to attack. Each line below says what exists, what
does not, and the command that shows which.

### Sclera, the bond that makes "trust becomes a price" a mechanism

An agent stakes USDC against a floor on its own claim-truth rate over a block window, with a
minimum sample below which nothing can slash. Stay above the floor and the stake returns when the
window matures. Fall below it and the bond is forfeit.

```bash
wc -l contracts/src/Sclera.sol                    # 410
cd contracts && forge test --match-path 'test/Sclera*'   # 33 pass in ScleraCrossSign, plus Sclera.t.sol and ScleraFork.t.sol
```

The slash is authorised by a signature, not by the caller. Monad's CRE forwarder
`0x9eF6468C5f37b976E57d52054c693269479A784d` reports `MockKeystoneForwarder 1.0.0` and its `report`
function is permissionless, so a contract gating on `msg.sender == forwarder` would be gating on
nothing. Sclera recovers the signer and requires one key fixed at deploy. That key is derived from
the same passkey ceremony as everything else and is pinned in two independent implementations:

```bash
grep -rn 0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf contracts/ lib/
# contracts/script/DeploySclera.s.sol, contracts/test/ScleraCrossSign.t.sol, lib/iris.test.ts
```

**What is missing is the deployment.** No Sclera address is recorded and no `SCLERA` variable is set
in the running environment, so the site calls this layer `built` rather than `live`. The one
remaining join is a signature produced by our code, accepted by the deployed contract, in a single
test. Everything up to that line is green.

### The claim-truth endpoint a slashing oracle reads

`GET /api/sla/<agentId>?fromBlock=&toBlock=` is live. It is a pure function of the agent id and the
block range, because a CRE workflow reaches consensus by having independent nodes compute the same
answer, and anything keyed on a wall clock drifts between them.

```bash
curl -sS 'https://kanmani.xyz/api/sla/10182' | jq '{rateBps, sample, true: .trueCount}'
```

`rateBps` is null on an empty sample rather than 0, because 0 reads as "every claim was false" and
would slash an agent nobody has rated yet.

### The CRE slashing workflow

```bash
wc -l cre/kanmani-oracle/slashing/main.ts     # 280
```

Written against `@chainlink/cre-sdk`. It reads the endpoint above and signs a verdict. Not deployed
to the CRE network, which the bounty explicitly permits: a CLI simulation or a live deployment is
accepted, and the workflow is real either way.

### Alchemy self-healing re-verification

```bash
wc -l app/api/webhooks/alchemy/route.ts       # 45
```

A `MetadataUpdate`, which is the ERC-4906 event an agent emits when it repoints its own document,
re-runs the exact ladder the command line runs and appends a fresh verdict. The store was always
append only, so a repaired document reads as `false` then `true` with both timestamps. What was
missing was only the trigger.

Signature verification is HMAC-SHA256 over the raw body, compared in constant time, and the route
**refuses every delivery when no signing key is configured** rather than skipping the check, because
a webhook that fails open is worse than one that is down. The delivery id is a primary key, so a
retry after success appends nothing.

**What has not happened is a delivery from a webhook created in Alchemy's own dashboard.** It is
wired and tested, not yet fed by a live stream.

### The two ladder rungs the design promised

```bash
ls verifier/src/ladder/    # intact locate parse payable resolve settled verdict (+ .test.ts each)
grep -n 'export type Rung' verifier/src/ladder/verdict.ts
# "declared" | "resolvable" | "intact" | "parsed" | "true"
```

`payable.ts` and `settled.ts` exist with their own tests. **They are not wired into `verdict.ts`,
so the live ladder is five rungs and is described as five everywhere.** A promised rung that does
not run is a claim; an absent one is a boundary.

### CleanverseGate and Chiasm

```bash
wc -l contracts/src/CleanverseGate.sol          # 326
ls indexer/src/handlers/                        # Retina.ts  Chiasm.ts
wc -l lib/cleanverse.ts lib/intents.ts          # 189, 504
```

The compliance-gated release contract, the cross-chain handler and the Aurora Intents funding path
all exist as real code with no stubs. None has a recorded mainnet deployment, so all are `built`.

---

## Not shipped

Listed because a plan that only records its successes is a brochure.

### Layers that remain absent, not partial

| planned | what it was for | state |
|---|---|---|
| **Cone**, odds market | a crowd price on whether an agent delivers | not started |
| **Choroid**, credit | borrowing power from real settlement history, with a funded pool | not started |
| **Lens**, route | Agent Hub services proxied with measured failover | not started |
| jobs board with bidding | post, bid, accept, deliver, release by a real counterparty | not started |

### Traction

| | count |
|---|---|
| operators contacted | 0 |
| operators integrated | 0 |
| jobs settled that we did not create ourselves | 0 |

Outreach targets three agents named in [`14-GAPS.md`](14-GAPS.md), chosen because the whole
population was measured. This is the weakest part of the entry and it is not fixable at the end.

### Submission artifacts

The demo video, the pitch video and the logo do not exist yet. The repository is still private; the
flip is scheduled for the day the submission window opens, 2026-10-02.


---

## What the measurement changed

The most useful entries, because each is a place the build was wrong and the data corrected it.

**The thesis got narrower and more accurate.** This was designed expecting documents citing one
chain while the payment sat on another. Every one of the 85 payment claims names `monad`. The
failure is simpler than the one designed for, so the site says the simpler thing.

**The denominator moved from 9,188 to 85.** Most ERC-8004 feedback on Monad is not a payment claim.
1,026 documents are chess ELO records. Sampling recent-first had given the opposite impression,
because the head of a list is never a random sample.

**A published claim turned out to be unbacked.** "78.94% point at a dead URL" was being repeated
from an indexer field that was never written. The probe was built to actually measure it. The
number held. The habit that produced it did not.

**A boolean could not carry the result.** 539 documents answer HTTP 402, which is a host alive and
asking for payment rather than a death. 14 answer 429, which is our rate limit rather than
their failure. Eight states, not two.

**Unilateral validation turned out to be impossible.** `validationRequest` reverts `Not authorized`
for anyone who is not the agent's owner. Optic became a responder rather than a publisher. The
constraint explains the empty registry better than any theory about adoption.

**80 agents were falling out of a join silently.** The state buckets summed to 10,172 against a
registry of 10,252. No query failed and no test went red. The page now prints its own sum next to
the total.

---

## Defects found in our own work

Published in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md) rather than quietly fixed, including the ones
that were our own reasoning rather than our own code: a bytecode mismatch that was our check being
wrong, a root-cause theory that measurement killed, a test that deleted the live index, plus a
`Buffer` reference that passed 35 green tests and would have thrown on a judge's machine during a
live gate.
