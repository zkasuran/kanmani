# 14. Gaps: what this build is missing

**This list is published on purpose and it is maintained rather than written once.** A judge who
finds a gap we did not name has a reason to doubt every other claim on the site. So the rule here is
that anything absent, thin or unproven gets written down before somebody else finds it, including the
items that are embarrassing.

Each entry says what is missing, what exists instead and what it would take to close. Where a
decision has already been made to cut something, the reason is given rather than implied.

**State as of 2026-09-24.** Submission closes 2026-10-14T03:59Z. I am one person.

**What moved on 2026-09-23/24**, so a reader can see which entries are fresh: Sclera passed its gating
security review, which found a real blocker (§3, audit Finding 9), got fixed, deployed to mainnet and
took its first real bond. The authorisation trail went from signed-and-discarded to persisted and
rendered (§7). The `@kanmani/kit` import path stopped naming a package that did not exist (§6). Three
operators were contacted and a forum thread submitted (§8). BSC was indexed beside Monad so the
cross-chain merge has data. And the passkey went from a showcase to the thing that actually sends a
registration.

**Two headings in this document were stale within hours of being written**. §3 said Sclera was not
deployed and §8 said traction was zero, which is the failure mode this page exists to prevent,
happening to the page itself. Both are corrected above rather than left to be found.

---

## 1. The repository is private. That is now the gap. The deployment one is closed

**This section used to say the site was not deployed and that it decided whether there was an entry
at all.** That was true when it was written on 2026-09-21. It is not true now. Leaving it up
would be the same failure this project exists to attack: a published claim that no longer matches
what a check returns.

The site is live at **https://kanmani.xyz**. Verify it the way a judge would, signed out:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/          # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/agents    # 200
curl -sS https://kanmani.xyz/llms.txt | head -5                         # the measurement, in text
```

Every route the docs cite answers 200 to an anonymous fetch, TLS verifies and the index sits at the
chain head. The domain is paid to 2027-09-21, so it outlasts the judging window.

**What is still missing here is the repository.**

| | |
|---|---|
| **Missing** | `github.com/zkasuran/kanmani` answers 404 to anyone who is not me. It is private |
| **Exists** | the full history, plus a site that renders the same numbers the repository produces |
| **Blocks** | any bounty clause asking for public code, plus reproducibility for a judge who wants to run the ladder rather than read about it |

This one is deliberate rather than forgotten. An unfinished build published early is a preview for
rivals. At least one agent operator named in this document has since pushed a Monad project of
their own into the same programme. The flip is scheduled for the day the submission window opens,
2026-10-02, carried as a dated commitment rather than an intention:

```bash
gh api -X PATCH repos/zkasuran/kanmani -F private=false
curl -sS -o /dev/null -w '%{http_code}\n' https://github.com/zkasuran/kanmani    # must be 200
```

The second command is the one that counts. Our own `gh` calls are authenticated and pass either
way, so they prove nothing about what a stranger sees.

**One thing that was blamed on the deployment gap and never belonged to it.** Both Mera gates are
pass-or-fail tests a judge runs on their own device, clearing storage or opening a second phone. A
hosted site is necessary for that and it was never sufficient: what those gates need is a browser
path that a stranger can walk without us in the room. That is tracked in section 4, not here.

---

## 2. Two rungs of the ladder exist in the repository and do not run

**Corrected 2026-09-23.** This section used to say the two rungs were "not implemented". The files
exist with their own tests. What is still true and is the part that matters, is that they are not
wired into the live ladder.

| rung | state |
|---|---|
| `declared`, `resolvable`, `intact`, `parsed`, `true` | shipped, all 1,192 documents through them |
| `payable` | **written and tested, not wired.** A live x402 probe of an agent's own endpoint |
| `settled` | **written and tested, not wired.** Proof that a payment to that agent cleared |

```bash
ls verifier/src/ladder/
# intact  locate  parse  payable  resolve  settled  verdict  (+ a .test.ts for each)

grep -n 'export type Rung' verifier/src/ladder/verdict.ts
# "declared" | "resolvable" | "intact" | "parsed" | "true"

grep -nE '^import' verifier/src/ladder/verdict.ts
# intact, parse, locate. Neither payable nor settled is imported.
```

So the ladder **runs** as five rungs and is described as five everywhere on the site, including on
`/method`.

**Considered and declined 2026-09-24.** Wiring them was attempted as a task and stopped on inspection,
which is worth recording as a decision rather than as an omission. The two rungs are not appendable
steps: `payable` probes an agent's **own service endpoint** and `settled` needs proof a payment to that
agent cleared, so neither can be computed from what `judge()` currently receives. Both would change the
function's input shape, the sweep that calls it, the `Rung` type stored on every historical verdict plus
the five-bead ladder the UI draws.

That is a migration touching every published verdict. Doing it in the last hour of a session to
close a checklist item is how a measurement layer acquires a silent inconsistency between old and new
rows. **The honest five-rung ladder is better than a hasty seven-rung one**. The boundary costs
nothing while it is described accurately. **A promised rung that does not run is a claim; an absent one is a boundary.** Having the
code in the tree does not upgrade the claim and this document would be worth less if it did.

**One thing here is easy to misread, so it is stated plainly.** `POST /api/verify` is payable. That
means somebody can pay **us** to check a document. It does not mean we have probed whether a given
agent can be paid. Those are different claims about different parties and the second one is the rung
that is not wired.

---

## 3. Eight of the nine layers are live. One is not

**Corrected twice.** On 2026-09-23 this said Layer 2 and Layer 3 did not exist and Sclera was not
started. On 2026-09-25 the heading still said three layers were absent, by which point Sclera was
deployed with three bonds and Chiasm had been live for two days. Both readings were true when written
and neither survived, which is the failure mode this whole document exists to catch.

**Current, checkable with `./scripts/prove.sh`:** Retina, Fovea, Aqueous, Iris, Optic, Sclera, Chiasm
and Self-heal are live. Intents is not: a real cross-chain attempt moved 0.12 USDT from BSC and landed
119,255 USDC at the intermediary on Monad, then stalled unsigned, so the escrow never funded. Aurora
has been asked how to submit the authorisation (question c23f6578). The layer stays built until the
escrow funds itself, because that is what it promises.

The corrected picture:

```bash
ls contracts/src/          # Aqueous.sol  CleanverseGate.sol  Sclera.sol  TestUSDC.sol
wc -l contracts/src/Sclera.sol                          # 410
cd contracts && forge test --match-path 'test/Sclera*'  # passes
ls indexer/src/handlers/   # Retina.ts  Chiasm.ts
wc -l lib/intents.ts lib/cleanverse.ts                  # 504, 189
```

| planned | what it was for | state |
|---|---|---|
| **Sclera**, SLA bonds | an agent stakes against its promise, failure pays the buyer. This is what makes "trust becomes a price" a mechanism | **LIVE on Monad mainnet 2026-09-24**, [`0x57aF4e4B…`](https://monadexplorer.com/address/0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf), source verified |
| **Chiasm**, cross-chain | BSC's agents indexed beside Monad's, standing merged on record hash | **shipped and live 2026-09-23.** 356,647 BSC agents indexed beside Monad's 10,256, 205,597 merged records, 3 documents referenced from both chains |
| **CleanverseGate**, gated release | release conditioned on a compliance credential | **built, not deployed** |
| **Cone**, odds market | a crowd price on whether an agent delivers | not started |
| **Choroid**, credit | borrowing power from a real settlement history, with a funded lending pool | not started |
| **Lens**, route | Agent Hub services proxied with measured failover | not started |
| jobs board with bidding | post, bid, accept, deliver, release, refund by a real counterparty | not started |

**The pre-deploy security review has run and its blocker is now closed.**
[`17-CONTRACT-AUDIT.md`](17-CONTRACT-AUDIT.md) Finding 9: `postBond` never checks who owns the agent
it is bonding, so anyone can post a bond for any agent. That is a denial of service on bonding and,
worse, it means a bond does not prove the agent staked anything, because a stranger can bond any agent with
`minTruthRateBps = 0`, which can never be slashed and the agent then reads as bonded. A badge that
costs one atomic unit to fake is the thing this project exists to attack.

**Fixed 2026-09-24.** `postBond` reads `ownerOf` from the ERC-8004 Identity Registry, which is an
immutable constructor argument with no setter. Six new tests and the mutation that proves they matter:
replacing the check with `if (false)` turns four of them red. Finding 10 is closed too. The contract
suite is 127 tests, 119 passing, 8 fork tests skipped without a fork URL.

**Deployed 2026-09-24** at `0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf`, source verified `exact_match`, 0.250 MON of gas. The ownership
check is proven on the live contract: `postBond` for an agent we do not own reverts `NotAgentOwner()`.

**The first bond is posted.** Agent 10252 staked 0.02 USDC against an 80% claim-truth floor,
transaction `0x72970dc0…26697e7c` at block 107460188. The contract holds the tokens and the poster's
balance fell by exactly that amount, so the stake is real rather than signalled.

**A live slash was attempted on 2026-09-24 and refused, on purpose.** Two independent things block it
and neither is a missing feature:

1. **We cannot sign a verdict at all.** The attestor is `0x358c591a…7b44A`, derived from a passkey. No key
   in this environment is that key, so there is physically no way for this repository to author a slashing
   verdict. That is the four-key separation working exactly as designed. Discovering it as a blocker is
   the strongest evidence it holds.
2. **There is nothing true to sign.** Agent 10252's real claim-truth sample reads `null`, because our own record
   asserts no payment claims, so an honest verdict carries `sampleSize = 0` and the contract refuses it
   with `SampleTooSmall` before any rate is computed.

Producing a live slash would therefore require either signing numbers that are not a measurement or
publishing false payment claims about our own agent to manufacture a sub-floor rate. **Both are precisely
the thing this project exists to detect.** A demonstration bought that way would be worth less than the
absence, so the absence stays.

**The full happy path IS proven on mainnet, end to end.** The bond posted on 2026-09-24 ran its window
without a slash and was released on 2026-09-25:

| step | transaction | effect |
|---|---|---|
| post | [`0x72970dc0…26697e7c`](https://monadexplorer.com/tx/0x72970dc0428412d04c043877be6b8c979b245797cf275bcae683394026697e7c) | 20,000 units of USDC left the agent and were held by the contract |
| release | [`0x06082587…1fb41b92`](https://monadexplorer.com/tx/0x06082587d73900d91f6dcd16408170dd322f316e9dc0acea27ae2a7d1fb41b92) | 20,000 returned to the agent, contract balance back to 0 |

Verified by balances rather than by events: the contract went 20,000 → 0 and the agent 14,081 → 34,081,
which is exactly the amount back. The bond's state is now `3` (`Released`) and the amount field is zeroed.

An honest note on what the release proves. The window ran with **no verdict submitted at all**, so this
demonstrates the timelock, the state machine and the return path. It does not show that a measurement fed the outcome.
`release` is also callable by anyone, deliberately, because the money can only go to the agent that posted
it; that keeps a bond from being stranded by an operator who has lost access to the gas token.

Three guards, confirmed by call on the deployed contract:

```bash
S=0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf
F=--from\ 0xDB6c6340342e71A63cD11Ebac2185204b7777777

cast call $S 'release(uint256)' 10252 $F --rpc-url https://rpc.monad.xyz   # 0xde4168ba WrongState()
cast call $S 'release(uint256)' 99999 $F --rpc-url https://rpc.monad.xyz   # 0x27d46a91 NoSuchBond()
# and before maturity it reverted 0xa4229fab WindowOpen(), which is why the release waited a day
```

**A correction worth recording.** An earlier draft of this section claimed `release(10252)` reverts
`WindowOpen`. By the time it was checked, the window had matured and the call succeeded, so the claim was
true when written and false within hours. It was caught by re-running the command before publishing rather
than by a reader, which is the only reason it is a footnote instead of a defect.

**What remains unproven is a live slash.** Our own record asserts no payment claims, so the sample sits
below the minimum and nothing can fall below the floor. The slashing path is covered by the test suite
and by fork tests against real mainnet state, not by a slash of our own money on chain. Those are
different strengths of evidence and the difference is not collapsed here.

**What "built, not deployed" costs, stated exactly.** No Sclera address is recorded anywhere and no
`SCLERA` variable is set in the running environment, so no bond has ever been posted or slashed with
real money. The thesis sentence "trust becomes a price" is therefore **demonstrable in tests and not
yet demonstrable on chain.** The site labels that layer `built` for this reason and a judge reading
the repository will find exactly what this paragraph describes.

The one remaining join is named rather than glossed: a signature produced by our signing code,
accepted by the deployed contract, inside one test. The signing side and the checking side were each
built from the same spec and each verifies on its own. Closing that join is the first thing after
deployment.

**The decision date is 2026-10-02**, when each remaining layer is asked one question: finishing or
limping? Limping gets cut whole into this document the same day. **There is no thin tier**, because a
half-built surface costs more credibility than an absent one.

---

## 4. Integrations: what is wired, what is written, what is absent

**Corrected 2026-09-23.** This section used to list every integration as "not started" and offered a
grep as proof. That grep now returns matches, so the table is rewritten against the tree.

```bash
wc -l lib/intents.ts lib/cleanverse.ts cre/kanmani-oracle/slashing/main.ts \
      app/api/webhooks/alchemy/route.ts
# 504, 189, 280, 45
```

| integration | state |
|---|---|
| Alchemy self-healing re-verification | **written and tested, not fed by a live stream.** HMAC-SHA256 over the raw body in constant time, refusing every delivery when no key is configured rather than failing open; delivery id is a primary key so retries are idempotent. No delivery has yet come from a webhook created in Alchemy's own dashboard |
| Chainlink CRE slashing workflow | **written, not deployed to the CRE network.** The bounty accepts a CLI simulation or a live deployment, so approval does not gate it |
| Aurora Intents funding path | **written, not exercised on mainnet.** `/fund` renders it |
| Cleanverse gated release | **contract and client written, not deployed** |
| Qwen schema atlas | **shipped.** Versioned, rendered on `/method`, every mapping carries its induced date. The before-and-after coverage article does not exist |
| Nansen underwriting, paid per call over x402 | **not started.** Falls with Choroid |

**The honest summary is that the integration code is real and the live wiring is the gap.** Every row
above says which half is which, because "we integrated Alchemy" and "a webhook Alchemy created has
delivered to us" are different claims and only the first is currently true.

---

## 5. Onboarding: both doors are open, the skill.md import is not

**Door A closed 2026-09-24.** `/studio` now loads an operator's **own** record rather than showing an
empty form: enter an agent id, press *load my record*, then the existing document is fetched, parsed and
prefilled, with the consequence list retitled *"what your record currently does"* so the diagnosis is of
the record they have rather than of a draft they typed.

Retyping a document you already published is the friction that made a one-field fix feel like a project,
which is exactly the barrier standing between three contacts and one integration.

Two details that make it safe rather than merely convenient:

* **Fields this form does not model are carried through unchanged** and written back in place.
  `image`, `registrations`, `supportedTrust`, anything vendor-specific. Dropping somebody's field because
  we have no input for it would be a worse edit than the one they came to make. The page names how many
  are being carried. A round-trip test asserts adoption changes nothing it did not need to.
* **Skills are read from `skills`, `services` or `endpoints`**, because all three occur in the live
  corpus and `services` is what Monad's own Agent Hub writes. A reader that only knew `skills` would adopt
  nothing from most real records and look broken.

A `data:` document decodes locally with no network. A hosted one is fetched. When the host refuses a
browser the page says it is a CORS setting rather than a fault and offers the paste.

| | |
|---|---|
| **Missing** | The `skill.md` / agent-card import. An operator with an existing card still retypes it, though they no longer retype an existing *registration* |
| **Exists** | Door A, Door B, `/agent/<id>`, `/validate`, `agents.md` plus a re-check that fires on `MetadataUpdate` |
| **Closes** | a parser from the Agent Hub format into a `RegistrationDraft`. `adopt()` is already that shape, so this is a mapping rather than new machinery |

---

## 6. The kit is MIT, but there is still no package

**Licence resolved 2026-09-24.** `components/kit.tsx` and `app/embed.js/route.ts` are released under
**MIT**, the only two files in the repository that are, since everything else stays SAND-1.0,
source-available with no derivatives. The reasoning is in [`24-KIT-LICENCE.md`](24-KIT-LICENCE.md) and it
is short: a component that exists to be rendered inside somebody else's product cannot be read-only, because
**what the kit publishes is a constraint rather than an asset.** It makes three mistakes unavailable. It also
a restrictive licence on a safety property works against its own purpose.

A narrower grant was considered and rejected: "you may copy this to display Kanmani verdicts" sounds
tighter and is worse, because it makes every consumer read a bespoke licence and decide whether they
qualify, which is friction on the exact thing we want adopted.

| | |
|---|---|
| **Missing** | A published npm package. Copying one file works and does not version: a consumer has no way to learn that `Verdict` changed |
| **Exists** | MIT-licensed components with honest import paths plus `embed.js`, which needs no install at all |
| **Closes** | `npm publish`. Not done. It is the smaller half now that the licence no longer blocks it |

---

## 7. The authorisation trail is live and nobody has used it

**Closed 2026-09-23.** This section previously said a receipt was signed and then went nowhere, so it
proved something to its holder and to nobody else. That is fixed.

`POST /api/receipt/action` accepts a receipt, **verifies the signature before writing anything** and
stores it in `fovea.agent_action`. `GET /api/receipt/action?agentId=<id>` reads it back with the
signature included and `/agent/<id>` renders an authorisation trail beside the verdicts, kept in a
separate panel because a verdict is our measurement and a receipt is somebody's statement and mixing
them would blur who said what.

Exercised end to end against the live site:

```bash
POST a genuine receipt   -> 201, firstTime true
POST the same one again  -> 200, firstTime false     # idempotent by a database constraint
POST a mutated uriHash   -> 400 "Signature does not verify", nothing stored
GET  ?agentId=10252      -> the row, with its signature
```

**What remains is honest emptiness rather than a gap.** No real receipt exists, because publishing is
optional and every document change on Monad predates the feature. The agent page says so in those
words rather than rendering an absence as a clean record: *"nobody has offered proof of who authorised
this document, so there is nothing here to verify rather than something that failed to."*

One boundary worth keeping visible and it is stated on the endpoint and on the page: a receipt says
one identity authorised one document. It does **not** say the transaction landed, that the signer owns
the agent or that the document is good. The registry decides ownership and the ladder decides truth.
An endpoint implying otherwise would be manufacturing standing out of a signature, which is the shape
of claim this project exists to check rather than to produce.

## 8. Traction is three contacts, zero integrations and two agents of our own

Traction is 20% of the score. The honest count today, 2026-09-24:

| | count |
|---|---|
| operators contacted | **3** |
| operators integrated | **0** |
| jobs settled that we did not create ourselves | **0** |
| forum threads | **1 submitted, held for moderation** |
| progress updates posted | 6 |
| mentor questions asked / fielded / answered | 6 / 6 / 4 |
| forum threads | 1 submitted, awaiting moderation |

**Four of six mentor questions are answered, read 2026-09-25.** This document said one, which was stale:
three answers had arrived and had not been read.

| mentor | answered | what it settled |
|---|---|---|
| Kai Jun Eer, Category Labs | 2026-09-18 | HKDF namespacing from one PRF output is sound |
| Darby, Chainlink Labs | 2026-09-20 | **CLI simulation is what they judge**, no testnet DON exists for participants, plus both Monad forwarder addresses |
| Denham, Envio | 2026-09-21 | `@crossChain` is correct and putting `chainId` in the id is the right shape |
| Kai Jun Eer, Category Labs | 2026-09-21 | PRF output is deterministic per passkey, so cross-device needs no enrolment and no persisted key |

Every one confirmed a decision already shipped rather than forcing a change. One produced a correction
to our own audit: Chainlink's answer revealed **two** forwarders on Monad mainnet where we had read one, so
the permissionless-`report` finding was about the mock. The conclusion held because Sclera trusts neither.

**All four are replied to, 2026-09-25.** The reply to Chainlink carries the two-forwarder correction
back, since Darby said he would feed the addresses to his team. It asks the one question left worth
asking: whether the real `KeystoneForwarder` validates the DON signature set before calling, so that a
consumer gating on `msg.sender` would be safe. Our design does not depend on the answer, because the signature
check stays either way, but the audit should state the reason correctly rather than assert a property of
a contract we have not read.

**Two remain unanswered**, both fielded: the x402 `upto` scheme with Axal plus Aurora Intents
short-landing behaviour.

The three targets are named because the whole population was measured, which is the one advantage
here: I can name every payable agent on Monad because I checked all 10,253 and there are three.

1. **Execution Market / Ultravioleta DAO**, `ultravioletadao@gmail.com`, published in their own
   `/.well-known/x402`. Their claims are the majority of the 73 that do not resolve on the named chain, and 64 of those 73 are real transactions on a different chain rather than missing payments. A per-document
   pass or fail costs them nothing and fixes their record.
2. **ADEXTO**, agent 10247, `adexto-x402-edge.cucuvirtual.workers.dev`, returns a real x402 challenge.
3. **Mogmatic**, agents 8391 and 8392, one endpoint behind two registrations.

**Three contacts made, 2026-09-23 to 09-24.** All on GitHub, because `gh` is authenticated, a public
issue is re-derivable where private mail is not and there are no mail credentials in this environment.

| target | agents | issue |
|---|---|---|
| Ultravioleta / Execution Market | 49 | [uvd-describe-sdk-typescript#4](https://github.com/UltravioletaDAO/uvd-describe-sdk-typescript/issues/4) |
| The Agora | 32 | [The-Agora#3](https://github.com/SakshiShah29/The-Agora/issues/3) |
| Envio HyperIndex | n/a | [hyperindex#1659](https://github.com/enviodev/hyperindex/issues/1659) |

Each message was checked against the chain or the live host **before** posting, because a public claim
about somebody else's work has to survive them checking it. For Ultravioleta, both cited transactions
were read from `rpc.monad.xyz` directly rather than only through our own API. For The Agora, all eight
documents were confirmed answering 200 and the commit-pinned URL I recommended was verified to return
byte-identical content, so the fix is a genuine drop-in rather than advice. For Envio the arithmetic was
re-checked (356,647 + 10,256 = 366,903).

Two of the three are not findings against the recipient, which matters for the tone rule. The Agora's
records are healthy and the note is preventive, about a mutable branch pointer rather than a defect.
Envio is a contribution offer with two `@crossChain` notes and a caution and it credits their resync
refusal as correct behaviour.

**Original first contact, 2026-09-23**, as
[UltravioletaDAO/uvd-describe-sdk-typescript#4](https://github.com/UltravioletaDAO/uvd-describe-sdk-typescript/issues/4).

Target 1, via a public GitHub issue on the org's own ERC-8004 reputation SDK rather than by email,
because that repo reads reputation across chains so its maintainers are the people the distinction
matters to and because a public channel is re-derivable in a way a private mail is not.

Both cited transactions were verified **directly against `rpc.monad.xyz`** before posting, not merely
through our own API: `0x6004e1bd…3c1cc7` returns a null receipt, `0xd0df2994…fcf1847` is found at block
97684606, matching the block recorded in the verdict. A public claim about somebody else's records has
to survive being checked by them.

The tone rule was applied literally: the finding is framed as a field that is probably not set from the
chain the settlement landed on, the one claim that *does* resolve is cited as evidence their pipeline
can write a correct reference and the message states plainly that no misstatement is being alleged.
It also offers to be corrected if `network` means something we have misread.

**Targets 2 and 3 are not yet approached** and the honest reason is channel rather than intent: ADEXTO
and Mogmatic publish no contact beyond an endpoint and there are no mail credentials in this
environment, so an email to `ultravioletadao@gmail.com` could not be sent either. Drafts for all three
are ready in `.hq/outreach/DRAFTS-2026-09-23.md` and need a person with a mailbox, not more work. Outreach was scheduled to start 2026-10-01 and that is late for
the criterion least fixable at the end. **There is no cut trigger on this one:** if no integration
lands, the outreach record ships with what happened stated plainly, because a documented attempt beats
an invented number and an invented one would be caught.

---

**Two agents of our own are live, 2026-09-25.** Sentinel (10256) and Assay (10257), both registered on
Monad mainnet with inline `data:` records, both bonded at 10,000 atomic USDC against a floor of 8000bps,
both answering over x402. This is not traction. It is dogfooding and the distinction matters: payer and
payee are the same wallet, so USDC did not move and nothing here shows demand. What it does show is that
the stack is usable by an agent rather than only by a reader and it found three real bugs that the test
suite had not.

The weakest part is unchanged. Three operators contacted, one forum post held for moderation, zero
external integrations.

## 9. Submission artifacts: two made, two videos outstanding

| artifact | state |
|---|---|
| technical demo video, max 3 min, live product on screen | not made |
| pitch video, max 2 min, human on camera | not made and it needs a real person scheduled rather than discovered on the day |
| logo under 3 MB | **done 2026-09-25.** Drawn rather than generated, one 32-unit geometry shared by the SVG and every raster, with a three-rung variant below 48px because five rungs is a smudge at 16. `public/brand/` |
| repository flipped public and verified anonymously | not done |
| live product link plus judge access instructions | link is live at kanmani.xyz. Access instructions exist as `./scripts/prove.sh`, 12 checks a judge can run from a clean machine with no key. The repository flip is still gap 1 |

These are tracked as deliverables with their own deadline rather than as an afterthought, because a
previous entry of mine shipped a working paid service and died anyway on an unfiled form.

---

## 10. Measurement we cannot complete and why it stays unknown

Twelve of the 1,192 documents have no verdict beyond `unknown`. Each stays that way deliberately.

**Ten documents whose bytes no longer match their on-chain commitment.** All on one host. Five
feedbacks cite the same URL with five different committed hashes while the URL serves one identical
thing today and four more do the same with a second path. The URL is stable, the bytes are not, so
every historical commitment to that endpoint is now unverifiable.

The ladder stops at `resolvable` there on purpose. Parsing onward would read a claim out of bytes the
author never committed to and attribute it to them. **This is an argument about how ERC-8004 evidence
should be stored rather than about anybody's conduct:** a live endpoint cannot keep a promise about
its bytes, content addressing can. It is never written as an accusation.

**Two `ipfs://` documents no gateway would serve.** `ipfs.io` did not answer. A working gateway would
close these two and nothing else, so it is small and it is still open.

Neither group is counted as `false`. A failure to look is not evidence that a payment did not happen.

---

## 11. Known debt inside what did ship

Small, real and better written here than discovered by a reader.

* **A dead type in the indexer schema.** `Verdict` is still declared in `indexer/schema.graphql` at
  lines 11, 117 and 123, left over from when verdicts lived in Envio's `public` schema. The real table
  is `fovea.verdict`, outside Envio, which is what lets it survive a resync. Nothing reads the dead
  one. **Removing it forces a full resync**, so it is batched with the next schema change rather than
  done alone. Verify with `grep -n Verdict indexer/schema.graphql`.
* **Eight contract tests skip without a fork URL.** `forge test` reports 127 tests, 119 passing and 8
  skipped. They are the fork tests and they are skipped rather than silently passing, but a reader
  should know the 119 is not the whole suite.
* **Seventeen verifier tests skip without a database.** Same shape: 189 tests, 172 pass, 17 need
  Postgres and say so. The site suite is 215 tests, 212 passing, 3 skipped. **503 pass in total.**
* **Census figures and live figures differ by one agent.** Documents written at census time say 10,252
  agents and 2,012 distinct records. The live index reads 10,253 and 2,013 because we registered
  ourselves as agent 10252 afterwards. Section 1 of [`16-METHOD.md`](16-METHOD.md) explains which
  number is which and why re-running the census against a moving registry would change every derived
  percentage in `03-POPULATION.md`.

---

## 12. Things that look like gaps and are findings

Listed because each one reads like a hole in the data until you know what it is and two of them cost
real time to understand.

* **80 agents in no probe bucket.** They carry no `tokenURI` at all, so there is no document to ask
  about. The eight states sum to 10,173 and only reach 10,253 when those 80 are added. A registration
  that says nothing about itself is a finding, not a join failure. The page prints its own sum beside
  the total so this cannot hide again.
* **One record marked `not probed`.** It is ours, written on chain after the probe pass ran. Unknown
  rather than assumed, including about ourselves.
* **`noClaim` is 0 among the HTTP documents.** Agent cards are the only `noClaim` shape there and they
  are exactly the documents failing the intact check, so they stop before parse. It reads like a parser
  that never fires. It is not.
* **The Validation Registry held zero rows against 9,188 feedbacks.** Not low adoption.
  `validationRequest` reverts `Not authorized` for anyone who is not the agent's owner, so nobody can
  publish a verdict about somebody else unilaterally. The constraint explains the empty registry better
  than any theory about uptake and learning it cost a reverted transaction.
* **Every one of the 85 claims names Monad.** The build expected documents citing one chain while the
  payment sat elsewhere, which is why `locate` reads seven chains. That is not what happens. The
  multi-chain reader stays anyway, because a "not found" means nothing without the published list of
  places it was looked for.

---

## 13. How this list is meant to be used

Three ways and the third is the one that matters.

1. **As a boundary.** Anything not claimed on the site should be findable here.
2. **As a schedule.** Gap 1 flips on 2026-10-02. Gap 8, traction, should have started already; Gap 5 (Door A) and Gap 6 (packaging the kit) are the two cheapest things that would move it, because both lower what an operator has to do to adopt this from a project to a paste.
3. **As a test of everything else.** If you find something missing that is not on this page, then this
   page is incomplete and the rest of the documentation earns less trust for it. That is the correct
   response. Defects found in our own work go in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md) with the
   evidence rather than being quietly fixed and four are already there including one where our own
   check was wrong rather than the chain.
