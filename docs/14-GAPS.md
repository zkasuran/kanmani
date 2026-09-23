# 14. Gaps: what this build is missing

**This list is published on purpose and it is maintained rather than written once.** A judge who
finds a gap we did not name has a reason to doubt every other claim on the site. So the rule here is
that anything absent, thin or unproven gets written down before somebody else finds it, including the
items that are embarrassing.

Each entry says what is missing, what exists instead and what it would take to close. Where a
decision has already been made to cut something, the reason is given rather than implied.

**State as of 2026-09-23.** Submission closes 2026-10-14T03:59Z. I am one person.

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

## 2. Two rungs of the ladder that the design promised

The plan described six rungs. Five are implemented.

| rung | state |
|---|---|
| `declared`, `resolvable`, `intact`, `parsed`, `true` | shipped, all 1,192 documents through them |
| `payable` | **not implemented.** A live x402 probe of an agent's own endpoint |
| `settled` | **not implemented.** Proof that a payment to that agent cleared |

```bash
ls verifier/src/ladder/    # intact  locate  parse  resolve  verdict
```

The ladder ships as five rungs and is described as five everywhere, rather than as six with two
marked "coming soon". **A promised rung that does not exist is worse than an absent one**, because the
first is a claim and the second is a boundary.

**One thing here is easy to misread, so it is stated plainly.** `POST /api/verify` is payable. That
means somebody can pay **us** to check a document. It does not mean we have probed whether a given
agent can be paid. Those are different claims about different parties and the second one is the rung
that is missing.

---

## 3. Layer 2 and Layer 3 do not exist

The plan has four layers. Layers 0 and 1 shipped. The rest is absent and not partially.

```bash
ls contracts/src/          # Aqueous.sol  TestUSDC.sol
grep -rliE "sclera|cone|choroid|chiasm|lens" app lib contracts/src verifier/src indexer/src
# no matches
```

| planned | what it was for | state |
|---|---|---|
| **Sclera**, SLA bonds | an agent stakes against its promise, failure pays the buyer. This is what makes "trust becomes a price" true rather than asserted | not started |
| **Cone**, odds market | a crowd price on whether an agent delivers | not started |
| **Choroid**, credit | borrowing power from a real settlement history, with a funded lending pool | not started |
| **Chiasm**, cross-chain | BSC's agents indexed beside Monad's, standing merged on record hash | not started |
| **Lens**, route | all 66 Agent Hub services proxied with measured failover | not started |
| jobs board with bidding | post, bid, accept, deliver, release, refund by a real counterparty | not started |

**Sclera is the loss that actually hurts the thesis.** Without bonds, "trust becomes a price" is a
sentence rather than a mechanism and Chainlink CRE falls with it because CRE was the slashing oracle
and had no other job here. The pre-decided cut order in the roadmap protects Sclera above the other
four for exactly this reason, so if anything in this block survives it will be that one.

**The decision date is 2026-10-02**, when each remaining layer is asked one question: finishing or
limping? Limping gets cut whole into this document the same day. **There is no thin tier**, because a
half-built surface costs more credibility than an absent one and a judge who finds one shallow page
assumes the rest.

---

## 4. Integrations named in the plan that are absent

Each was real scope with a bounty attached. Listing them as "planned" without this section would be
the kind of claim this project exists to attack.

| integration | state | falls with |
|---|---|---|
| Chainlink CRE | not started | Sclera |
| Nansen | not started | Choroid |
| Aurora Intents | not started | the cross-chain funding path |
| Cleanverse | not started | compliance-gated release |
| Alchemy self-healing re-verification | not started | nothing, it is standalone |
| Qwen schema atlas as a published artifact | **partly.** The atlas exists, is versioned, is rendered on `/method` and every mapping carries its induced date. The before-and-after coverage article does not exist | nothing |

```bash
grep -rliE "webhook|alchemy" app lib verifier/src indexer/src     # no matches
```

**The Alchemy one is worth calling out separately** because it is cheap and it is not blocked by any
other layer. The design was a webhook on `MetadataUpdate` that re-runs the ladder for that agent, so
a repaired document flips `false` to `true` within minutes with nobody watching. The append-only
verdict store already supports exactly this: the history renders, the timestamps are there, `/status`
lists every changed verdict. **What is missing is only the trigger.** Today a re-check has to be
started by hand.

---

## 5. Traction is zero and this is the weakest part of the entry

Traction is 20% of the score. The honest count today:

| | count |
|---|---|
| operators contacted | **0** |
| operators integrated | **0** |
| jobs settled that we did not create ourselves | **0** |
| progress updates posted | 6 |
| mentor questions asked / fielded / answered | 6 / 5 / 1 |
| forum threads | 0 |

The three targets are named because the whole population was measured, which is the one advantage
here: I can name every payable agent on Monad because I checked all 10,253 and there are three.

1. **Execution Market / Ultravioleta DAO**, `ultravioletadao@gmail.com`, published in their own
   `/.well-known/x402`. Their claims are the majority of the 73 that do not resolve. A per-document
   pass or fail costs them nothing and fixes their record.
2. **ADEXTO**, agent 10247, `adexto-x402-edge.cucuvirtual.workers.dev`, returns a real x402 challenge.
3. **Mogmatic**, agents 8391 and 8392, one endpoint behind two registrations.

**None of them has been approached.** Outreach was scheduled to start 2026-10-01 and that is late for
the criterion least fixable at the end. **There is no cut trigger on this one:** if no integration
lands, the outreach record ships with what happened stated plainly, because a documented attempt beats
an invented number and an invented one would be caught.

---

## 6. Submission artifacts that do not exist yet

| artifact | state |
|---|---|
| technical demo video, max 3 min, live product on screen | not made |
| pitch video, max 2 min, human on camera | not made and it needs a real person scheduled rather than discovered on the day |
| logo under 3 MB | not made |
| repository flipped public and verified anonymously | not done |
| live product link plus judge access instructions | blocked by gap 1 |

These are tracked as deliverables with their own deadline rather than as an afterthought, because a
previous entry of mine shipped a working paid service and died anyway on an unfiled form.

---

## 7. Measurement we cannot complete and why it stays unknown

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

## 8. Known debt inside what did ship

Small, real and better written here than discovered by a reader.

* **A dead type in the indexer schema.** `Verdict` is still declared in `indexer/schema.graphql` at
  lines 11, 117 and 123, left over from when verdicts lived in Envio's `public` schema. The real table
  is `fovea.verdict`, outside Envio, which is what lets it survive a resync. Nothing reads the dead
  one. **Removing it forces a full resync**, so it is batched with the next schema change rather than
  done alone. Verify with `grep -n Verdict indexer/schema.graphql`.
* **Six contract tests skip without a fork URL.** `forge test` reports 55 passing and 6 skipped. They
  are the fork tests and they are skipped rather than silently passing, but a reader should know the
  55 is not the whole suite.
* **Five verifier tests skip without a database.** Same shape: 94 tests, 89 pass, 5 need Postgres and
  say so.
* **Census figures and live figures differ by one agent.** Documents written at census time say 10,252
  agents and 2,012 distinct records. The live index reads 10,253 and 2,013 because we registered
  ourselves as agent 10252 afterwards. Section 1 of [`16-METHOD.md`](16-METHOD.md) explains which
  number is which and why re-running the census against a moving registry would change every derived
  percentage in `03-POPULATION.md`.

---

## 9. Things that look like gaps and are findings

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

## 10. How this list is meant to be used

Three ways and the third is the one that matters.

1. **As a boundary.** Anything not claimed on the site should be findable here.
2. **As a schedule.** Gap 1 is the next thing being worked on. Gap 5 should have started already.
3. **As a test of everything else.** If you find something missing that is not on this page, then this
   page is incomplete and the rest of the documentation earns less trust for it. That is the correct
   response. Defects found in our own work go in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md) with the
   evidence rather than being quietly fixed and four are already there including one where our own
   check was wrong rather than the chain.
