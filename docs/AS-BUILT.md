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
npm test                              # 56 pass, the site
cd verifier && npm test               # 94 pass
cd contracts && forge test            # 55 pass, 6 fork tests skipped without a fork URL
npx next build                        # compiles clean, every route dynamic
```

---

## Shipped

### Retina, the index

Envio HyperIndex over all three ERC-8004 registries on Monad mainnet. Holds **10,252 agents**,
matching the registry's own counter slot exactly, **2,012 distinct registration documents** and
**9,188 feedbacks**.

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
headline: **8,095 agents point at a document whose host answered and said it is not there**, and
8,093 of those share one URL across 7,962 wallets.

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
we had just measured that 8,095 agents point at a document that returns a deletion.

The registry held **zero** rows against the Reputation Registry's 9,188 feedbacks. It holds one
now. `getValidatorRequests`, `getAgentValidations` and `getSummary` all confirm it. The index
that follows the contract went from 0 to 1.

### Cornea, the surface

Thirteen pages and nine machine-readable surfaces. Every page can print the SQL behind its numbers.
`/verify` imports the verifier's own `judge()` rather than reimplementing the ladder, so the site
and the command line cannot give different answers.

---

## Not shipped

Listed because a plan that only records its successes is a brochure. Each says why.

### The live deployment. This is the largest gap

**The site is not deployed.** It runs on `localhost:3400` against a Postgres in local Docker.
`kanmani.xyz` does not resolve. The repository is still private.

The submission requires a live product link on Monad mainnet with judge access instructions, so
until this is fixed there is no entry, whatever else is built. It is first in
[`14-GAPS.md`](14-GAPS.md) and it is the next thing being worked on.

Everything on chain is real and reachable today without us: the contracts, the settlements and the
validation row are all on mainnet and every command in [`16-METHOD.md`](16-METHOD.md) that hits a
chain works right now. What is missing is the hosted surface over the index.

### Two rungs of the planned ladder

The design had `payable` (a live x402 probe of an agent's own endpoint) and `settled` (a payment to
that agent provably cleared). Neither is implemented. The ladder ships with five rungs and says so
rather than describing six.

`/api/verify` is payable, which is a different claim: it means somebody can pay **us** to check a
document. It does not mean we have probed whether a given agent can be paid.

### Integrations that were planned and are absent

| planned | state |
|---|---|
| Chainlink CRE | not started |
| Aurora Intents | not started |
| Nansen, paid per call over x402 | not started |
| Cleanverse, Qwen, Alchemy, Kimi | not started |
| Bonds and SLA markets | not started |
| A jobs board with escrowed bounties and bidding | not started |
| Agent onboarding doors | not started, the closest thing that exists is `/validate` and `agents.md` |
| Cross-chain merge | not started |
| Credit scoring from on-chain history | not started |

Each was real scope. None of them shipped. A document claiming otherwise would be caught in
five minutes by anyone reading the repository.

### Submission artifacts

The demo video, the pitch video and the logo do not exist yet. The repository visibility flip has
not happened.

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
