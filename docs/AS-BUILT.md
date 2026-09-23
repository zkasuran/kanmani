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
npm test                              # 215 tests, 212 pass, 3 skip. the site
cd verifier && npm test               # 189 tests, 172 pass, 17 skip without a database
cd contracts && forge test            # 127 tests, 119 pass, 8 fork tests skipped without a fork URL
npx next build                        # compiles clean, every data route dynamic
```

**503 tests pass across the three suites.** That is the number quoted on the site.

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

### The chain registry, so a new chain is one entry

[`shared/erc8004-chains.json`](../shared/erc8004-chains.json) is the single source of truth for every
chain: EIP-155 id, the aliases documents actually write, the RPC env var, the explorer, and whether
ERC-8004 is deployed there. `/chains` publishes it, which is required rather than decorative: a
`false` means "not found on the chains in this registry", so a reader has to be able to see the list.

**Adding a chain is one entry plus one env var**, because the registries are per-chain singletons and
the mainnet deployments share one address set. That was established on chain rather than from a
deployment list, on both 143 and 56: a 130-byte ERC-1967 proxy at all three addresses,
`getVersion()` of `2.0.0`, and the reputation and validation registries each answering
`getIdentityRegistry()` with the identity address. The runbook is
[`23-ADDING-A-CHAIN.md`](23-ADDING-A-CHAIN.md).

Two dimensions are kept apart on purpose. **Readable** means we can fetch a receipt there.
**Registrable** means ERC-8004 is deployed there. Ethereum is readable and hosts no registry, which
is what makes "registered on Monad, paid on Ethereum" a checkable statement rather than a hope, and
it is the topology ERC-8004 itself describes.

```bash
npm test    # lib/chains.test.ts, 17 tests
```

Those tests are the reason this is safe rather than merely tidy. They refuse an alias claimed by two
chains, refuse a chain marked `indexed` that is not registrable, return null rather than plausible
addresses for a chain with no deployment, and **read `verifier/src/chains.ts` and
`indexer/config.yaml` to fail naming whatever has drifted.** Chains used to live in three places that
nothing compared, so one could be half-added and still look integrated.

`indexed` is true only for a chain in the live database, not one merely configured.

### Chiasm, the cross-chain merge, with data in it

**BNB Smart Chain was backfilled on 2026-09-23** and the index now holds two chains: **356,647
agents on BSC against 10,256 on Monad**, a separate population rather than a mirror.

Chiasm merges the two on the content hash of the registration document, which is the only key that
means the same thing on both chains. 205,597 merged records, and the result worth reporting:

| documents referenced from | records | agents |
|---|---|---|
| one chain | 205,594 | 355,142 |
| **both Monad and BSC** | **3** | **6** |

No URI conflict on any of the three, and **all three are `data:` URIs**, one of them gzip-compressed.
That is the observation rather than the count: the records that appear on two chains are precisely
the ones with no host to ask, because a self-contained document is the only kind that travels.

The resync was the honest cost. Envio refused to start when the chain was added, rather than
destroying data, and named the three options. The reset then rebuilt Monad to exactly its previous
figures, 10,256 agents and 9,188 feedbacks, while **`fovea.verdict` kept all 2,384 rows** because it
lives outside the schema Envio drops. That separation was designed for this and this is the first
time it was load-bearing.

```bash
sudo -u postgres psql -d envio-dev -c 'select "chainId", count(*) from public."Agent" group by 1;'
sudo -u postgres psql -d envio-dev -c 'select "chainCount", count(*) from public."ChiasmRecord" group by 1;'
```

### The studio, both onboarding doors

`/studio` composes an ERC-8004 registration document and generates the transaction that puts it on
chain. Two doors, the shape [`../.hq/plan/06-JOBS-AND-ROUTE.md`](../.hq/plan/06-JOBS-AND-ROUTE.md)
specified:

* **Register a new agent.** A progressive form where every field shows its consequence live: an
  endpoint is what separates a declared skill from a reachable one, a `data:` URI is what cannot
  return a deletion. The JSON, the URI, the byte count and the calldata are all on screen before
  anything is sent.
* **Repoint an agent you own.** `setAgentURI(agentId, newURI)`, which the registry refuses for anyone
  who is not the owner.

**We generate the call and never sign it.** There is no key on the server that could: the operator
either takes the calldata to any wallet, or signs in with a passkey and sends it from the account
that passkey derives. Both paths are offered on equal footing, because a project that publishes
measurements about other people's registrations must not be able to manufacture one, and the honest
guarantee is having no means to.

Two rules are enforced in code rather than asserted here. The calldata decodes back to the document
that was previewed, and a draft that mentions a payment proof fails its own consequence check,
because a registration document is not the place for a payment claim.

```bash
node --test --experimental-strip-types 'lib/registration.test.ts'    # 14 pass
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/studio # 200
```

`register()` with no argument is deliberately not offered. It mints an agent whose URI is empty, and
80 of those already exist on Monad: the one population no verifier can help.

### The kit, the embed, and /developers

**The output used to be a site with eleven nav tabs.** The track this enters asks for *"a protocol,
primitive, or infrastructure layer that other applications build on — not a standalone consumer
product"*, and scores Design as developer experience rather than visuals. Meanwhile
`components/ui.tsx` already was a component library and was private. The architecture existed and was
not the product.

[`components/kit.tsx`](../components/kit.tsx) is now the public boundary. `ui.tsx` stays internal
layout; everything in the kit is meant to be rendered by somebody else, and the distinction matters
because an internal helper can change shape on a Tuesday and a published component cannot. `Verdict`,
`Count`, `Share`, `Ladder`, `Distribution`, `TrustBadge`, `RecordState`, `Reproduce`.

**What it publishes is not the data.** The API has been open and CORS-enabled since the beginning, so
the numbers were never the hard part. The hard part is that three mistakes are available to anyone
consuming `/api/agent/<id>` by hand: printing a null as `0`, colouring `unknown` like `false`, and
averaging the four outcomes into a score. Every component makes all three unavailable and there is no
prop that turns it off. A marketplace embedding `<Verdict>` gets the `unknown` rule whether or not it
has read a word of this documentation. **The primitive is the discipline, not the figures.**

[`app/embed.js`](../app/embed.js/route.ts) is one line for a page that is not ours:

```html
<script src="https://kanmani.xyz/embed.js" data-agent="10182"></script>
```

No framework and no build step, because a host page cannot be asked to adopt our toolchain. It renders
inside a **closed shadow root**, which matters beyond tidiness: a badge that inherited a host page's
error red could show `unknown` in the colour of an accusation. It fails quiet — a network error, a bad
id or a missing agent removes the element rather than drawing an error box in somebody else's page.
Served from a route rather than committed as a static asset so the origin follows
`NEXT_PUBLIC_SITE_URL` instead of being hardcoded twice.

```bash
curl -sS https://kanmani.xyz/embed.js -o /tmp/e.js && node --check /tmp/e.js   # valid, 4,471 bytes
curl -sSI https://kanmani.xyz/embed.js | grep -i access-control-allow-origin   # *
```

`/developers` renders every component against live data from the same functions our own pages use, so
a broken component there means a broken site.

**The navigation is four groups rather than eleven tabs**: explore, build, trust, developers. Nothing
was deleted; depth is one hover away instead of eleven siblings competing for one row. `developers` is
the only group that is a destination in itself, because it is what the product is for.

### Light and dark, with the verdict distinction surviving both

The site was dark only. Two palettes now, defaulting to the reader's system preference, with an
explicit three-state switch (system, light, dark) applied by an inline head script **before first
paint** so a returning light-mode reader does not get a dark flash.

**Two palettes rather than an inversion, for the same reason the colours exist at all.** A hue that
reads as "absence" on near-black does not automatically read as absence on white, and a green legible
on ink fails contrast on paper. Each mode names its own values and both were checked against three
questions: is `false` unmistakably an alarm colour, is `unknown` unmistakably not one, and does
`unknown` stay more present than `noClaim`. Light mode therefore takes darker verdict hues and uses
slate-600 for `unknown` against slate-500 for `noClaim`, so that third relationship survives the
inversion rather than flipping.

`@theme inline` is load-bearing. Without it Tailwind resolves each value at build time and bakes a
literal into every utility, so `text-muted` would freeze to whichever palette compiled first and only
hand-written `var()` call sites would move.

```bash
curl -sS https://kanmani.xyz/_next/static/chunks/*.css | grep -o '\.text-muted{color:var(--muted)}'
```

**Contrast was measured rather than eyeballed, and two failures were found**, one of them
pre-existing: light `noClaim` was 2.56:1 on white and is now 4.76, and dark `faint` was already
failing at 2.86:1 and is now 3.65. Everything else is AA or better in both modes.

Per-mode too, because each was tuned for near-black and reads as dirt or a stray bright stripe on
paper: the drawn field strength, the grid opacity, the elevation shadows, and the inset top edge,
which has to darken on light instead of lighting. `::selection` stopped hardcoding white text, which
would have vanished on the light lilac fill.

### Authority over an agent: the passkey as a protection layer

The passkey layer was a showcase. `/account` demonstrated four keys from one ceremony and `/pay`
opened a scoped session, but the one place authority actually matters — creating an agent and
changing an existing one — treated it as one of two equal options and used it to protect nothing.

**What is actually at risk, stated precisely.** Not "someone repoints an agent they do not own":
`setAgentURI` reverts for anyone who is not the owner, so the chain already refuses that and no
front-end care adds to it. Three real risks remain, and [`lib/authority.ts`](../lib/authority.ts)
answers each:

| risk | answer |
|---|---|
| **Blind signing.** A clone of the studio could preview one document and hand over calldata for another, pointing an agent at a record its author controls | `signAction` signs a statement of intent committing to the URI by keccak256 hash, so a page that previewed one thing and sent another would not match it |
| **Paying gas to learn you are not the owner.** A reverted `setAgentURI` is an expensive way to discover a different passkey | `checkAuthority` reads the owner from our own `/api/agent/<id>`, so no second RPC is configured and no second source of truth can drift. Comparison is lowercased, because EIP-55 casing is a checksum and not an identity |
| **Authority living in one browser profile** | The key comes from the passkey, so the same passkey reaches the same agent on another device |

The receipt is signed by the **attestation** key, which is ed25519 and deliberately cannot move
money, so it proves who authorised a change without granting anything. Canonical bytes with a fixed
field order, the same construction `lib/iris.ts` uses, so two implementations cannot disagree. A null
`agentId` is an empty line rather than the string `null`, so a registration cannot collide with id
parsing.

**The rule this project runs on applies to itself here.** A failure to reach the API is `unknown`,
never `notOwner`. Telling somebody they do not own their own agent on the strength of our network
problem is the same error as rendering a timeout as `false`, and nothing is blocked on it because the
registry still refuses a write nobody is entitled to make. A mismatch reports **both** addresses
rather than only refusing, because it is usually a different passkey rather than an attack.

Sessions are scoped to authority rather than to a spend: `maxAmountAtomic` is `0n`, so a session
opened to pay for a verification cannot silently also repoint an agent.

```bash
node --test --experimental-strip-types 'lib/authority.test.ts'   # 12 pass
```

**A receipt is now an audit trail rather than a personal artifact.** `POST /api/receipt/action`
verifies the signature before writing anything and stores it in `fovea.agent_action`, append only,
with the signature kept so a reader checks it themselves. `GET /api/receipt/action?agentId=<id>` reads
it back and `/agent/<id>` renders the trail in its own panel, separate from the verdicts, because a
verdict is our measurement and a receipt is somebody's statement.

Exercised end to end against the live site: a genuine receipt returns 201 `firstTime: true`, the same
one again returns 200 `firstTime: false` because idempotency is a database constraint rather than a
flag we remember, and a receipt with a mutated `uriHash` is refused with 400 and stored nowhere.

**No real receipt exists yet**, because publishing is optional and every document change predates the
feature. The page says that in words rather than rendering an absence as a clean record. And the
boundary is stated on both the endpoint and the page: a receipt says one identity authorised one
document, not that the transaction landed, that the signer owns the agent, or that the document is
good.

### Cornea, the surface

Eighteen pages, seven machine-readable surfaces and 7 API routes. Every page can print
the SQL behind its numbers. `/verify` imports the verifier's own `judge()` rather than
reimplementing the ladder, so the site and the command line cannot give different answers.

```bash
for p in / /agents /operators /claims /compare /verify /studio /pay /fund /account \
         /method /chains /status /validate /developers; do
  printf '%s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code}' https://kanmani.xyz$p)"
done
```

**The surface is fully adaptive.** One fluid `clamp()` scale for type and rhythm rather than a
handful of breakpoints, container-query-ready shells, auto-fitting grids, and a navigation that
folds into a sheet on a phone. Motion follows monad.xyz's language — a drifting aurora behind the
hero, a one-shot brand sweep, a marquee of the machine-readable surfaces, scroll-reveal and a
count-up on the headline figure — and all of it is neutralised under `prefers-reduced-motion`.

One defect in that layer is worth recording because it shipped and had to be fixed: the reveal
originally hid every wrapped section with `opacity: 0` and relied on JavaScript to reveal it. When
that did not arm as expected the page rendered **blank** while the server HTML and every asset were
correct. It is inverted now — content is visible by default and only a JS-armed `pending` state
hides it, with a failsafe that force-reveals anything still hidden after 1.2s. A motion layer must
not be able to swallow the page.

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

**The pre-deploy security review has run and its blocker is closed.**
[`17-CONTRACT-AUDIT.md`](17-CONTRACT-AUDIT.md) Finding 9 found that `postBond` never checked who owned
the agent, so anyone could bond anyone and a bond proved nothing. `postBond` now reads `ownerOf` from
the Identity Registry, the registry is an immutable constructor argument with no setter, and the fix is
mutation-tested: disabling the check turns four tests red. Finding 10, six unreachable refusal emits, is
also closed.

**What is missing is the deployment itself.** No Sclera address is recorded and no `SCLERA` variable is
set in the running environment, so the site calls this layer `built` rather than `live`. The one
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
