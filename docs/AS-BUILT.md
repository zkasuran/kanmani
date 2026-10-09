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
./verify.sh                           # every check below in order, ALL GREEN or the first failure
node --test --experimental-strip-types 'lib/**/*.test.ts'   # the site
cd verifier && npm test               # the verifier, database tests skip without one
cd contracts && forge test            # the contracts, fork and P256 tests skip on this profile
npx next build                        # compiles clean, every data route dynamic
```

**<!-- n:testsPassing -->825<!-- /n --> tests pass across the three suites.** That is the number quoted on the site. Counted rather than
carried forward: <!-- n:testsApp -->486<!-- /n --> of <!-- n:testsAppTotal -->501<!-- /n --> in the site suite, <!-- n:testsVerifier -->215<!-- /n --> of <!-- n:testsVerifierTotal -->242<!-- /n --> in the verifier, <!-- n:testsContracts -->124<!-- /n --> of <!-- n:testsContractsTotal -->133<!-- /n --> in contracts. The
differences are <!-- n:testsSkipped -->51<!-- /n --> deliberate skips: database tests without a database and contract tests that need an
archive node, ffi or the P256 profile. `scripts/refresh-numbers.mjs` keeps these figures in step with `lib/counts.ts`.

---

## Status vocabulary, used everywhere below

Two words and the difference decides whether a claim survives a check.

| word | means | how a stranger checks it |
|---|---|---|
| **live** | deployed and running, on Monad mainnet or at `kanmani.xyz` | a `cast` call or an HTTP request that answers right now |
| **built** | written, tested and readable in this repository, **not** deployed or wired to a live stream | `ls`, `forge test`, `npm test` |

Nothing in this document is called live unless a command in it returns. A layer that is built and
described as live would be the exact failure this project exists to attack.

---

## Shipped

### Retina, the index

Envio HyperIndex over all three ERC-8004 registries on Monad mainnet. Holds **<!-- n:agents -->10,309<!-- /n --> agents** at
census time, matching the registry's own counter slot exactly, **<!-- n:documents -->2,063<!-- /n --> distinct registration
documents** and **<!-- n:feedbacks -->9,291<!-- /n --> feedbacks**.

The slot can only ever grow, so a later read shows the same figure or higher, never lower. We are
inside that count: we registered ourselves as agent 10252 along the way.
[`16-METHOD.md`](16-METHOD.md) section 1 says which figure is which.

Load-bearing rather than an integration: `feedbackURI` and `feedbackHash` exist only as
non-indexed fields of the `NewFeedback` event, `readFeedback()` does not return them and
`eth_getLogs` caps at a 100-block span on every free Monad provider. Without an index there is no
way to reach the evidence at all.

Records are deduplicated by content hash, with `distinctOwners` counted at registration time
through a join table rather than incremented alongside `memberCount`. An earlier version
incremented both, which made them provably equal and destroyed the only interesting number.

### Fovea, the verdict ladder

Five rungs: `declared`, `resolvable`, `intact`, `parsed`, `true`. All **<!-- n:withPointer -->1,295<!-- /n -->** documents carrying
a URI have been taken through it. Four outcomes. `unknown` is never `false`.

| outcome | count |
|---|---|
| `noClaim` | <!-- n:noClaim -->1,095<!-- /n --> |
| `false` | 123 |
| `true` | 59 |
| `unknown` | 15 |
| of those, the bytes no longer match their commitment | 10 |
| of those, no mapping reads the shape | 3 |
| of those, the document would not answer | 2 |

Verdicts are append only, in their own `fovea` Postgres schema rather than Envio's `public`,
because `public` is dropped and recreated on every resync. A re-check writes a new row, so a
document somebody repairs reads as `false` to `true` with both timestamps.

### The registration probe

All **<!-- n:documents -->2,063<!-- /n -->** distinct documents asked once each, deduplicated by record hash so one dead URL is
fetched once rather than <!-- n:oneDocAgents -->8,093<!-- /n --> times. Per host, serial, with a gap, because a handful of hosts carry
most of them.

Eight states rather than a boolean, as a SQL view so page, feed and API cannot disagree. The
headline: **<!-- n:goneAgents -->8,641<!-- /n --> agents point at a document whose host answered and said it is not there**. <!-- n:oneDocAgents -->8,093<!-- /n -->
of those share one URL across <!-- n:oneDocWallets -->7,962<!-- /n --> wallets.

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

One passkey ceremony gives **four** independent keys through HKDF-SHA256 with a distinct info per
namespace: an account key, an attestation key that signs receipts and deliberately cannot move
money, a secp256k1 on-chain attestation key the Sclera bond recovers, plus an AES-256-GCM content key.

Nothing is stored. No cookie, no token, no cached credential id. The passkey is discoverable so the
browser offers it unprompted, which means there is no returning-user path and therefore none that
can break.

The vault round trip is proven over real HTTP, not two tabs: one device seals and stores, another
derives the same address from the same PRF output with nothing shared but 32 bytes, fetches and
decrypts. A stranger holding the ciphertext gets an authentication failure. A forged write is 403.

### Optic: the first row in the Validation Registry

Registered as **agent 10252** with the record written into `tokenURI` rather than hosted, because
we had just measured that <!-- n:oneDocAgents -->8,093<!-- /n --> agents point at one document that returns a deletion.

The registry held **zero** rows against the Reputation Registry's <!-- n:feedbacks -->9,291<!-- /n --> feedbacks. It holds one
now. `getValidatorRequests`, `getAgentValidations` and `getSummary` all confirm it. The index
that follows the contract went from 0 to 1.

### The chain registry, so a new chain is one entry

[`shared/erc8004-chains.json`](../shared/erc8004-chains.json) is the single source of truth for every
chain: EIP-155 id, the aliases documents actually write, the RPC env var, the explorer and whether
ERC-8004 is deployed there. `/chains` publishes it, which is required rather than decorative: a
`false` means "not found on the chains in this registry", so a reader has to be able to see the list.

**Adding a chain is one entry plus one env var**, because the registries are per-chain singletons and
the mainnet deployments share one address set. That was established on chain rather than from a
deployment list, on both 143 and 56: a 130-byte ERC-1967 proxy at all three addresses,
`getVersion()` of `2.0.0` and the reputation and validation registries each answering
`getIdentityRegistry()` with the identity address. The runbook is
[`23-ADDING-A-CHAIN.md`](23-ADDING-A-CHAIN.md).

A third field, `publicRpc`, carries a **browser-usable** endpoint and exists only on chains an agent can
be registered on. Deliberately separate from `rpcEnv`, which names the server's own endpoint and may
carry a key that must never reach a client. `viemChain()` builds the viem definition from the same
registry, so the browser and the server cannot disagree about what chain 143 is and a chain with no
`publicRpc` cannot be written to from the browser, so the studio offers only chains it can actually send
on rather than failing at the last step.

Two dimensions are kept apart on purpose. **Readable** means we can fetch a receipt there.
**Registrable** means ERC-8004 is deployed there. Ethereum is readable and hosts no registry, which
is what makes "registered on Monad, paid on Ethereum" a checkable statement rather than a hope and
it is the topology ERC-8004 itself describes.

```bash
npm test    # lib/chains.test.ts, 17 tests
```

Those tests are the reason this is safe rather than merely tidy. They refuse an alias claimed by two
chains, refuse a chain marked `indexed` that is not registrable, return null rather than plausible
addresses for a chain with no deployment and **read `verifier/src/chains.ts` and
`indexer/config.yaml` to fail naming whatever has drifted.** Chains used to live in three places that
nothing compared, so one could be half-added and still look integrated.

`indexed` is true only for a chain in the live database, not one merely configured.

### Chiasm, the cross-chain merge, with data in it

**BNB Smart Chain was backfilled on 2026-09-23** and the index now holds two chains: **362,682
agents on BSC against <!-- n:agents -->10,309<!-- /n --> on Monad**, a separate population rather than a mirror. BSC grows daily,
so that figure is a 2026-10-03 read of `/chains`.

Chiasm merges the two on the content hash of the registration document, which is the only key that
means the same thing on both chains. 205,597 merged records at the 2026-09-23 backfill and the result
worth reporting:

| documents referenced from | records | agents |
|---|---|---|
| one chain | 205,594 | 355,142 |
| **both Monad and BSC** | **3** | **6** |

No URI conflict on any of the three and **all three are `data:` URIs**, one of them gzip-compressed.
That is the observation rather than the count: the records that appear on two chains are precisely
the ones with no host to ask, because a self-contained document is the only kind that travels.

The resync was the honest cost. Envio refused to start when the chain was added, rather than
destroying data and named the three options. The reset then rebuilt Monad to exactly its previous
figures, 10,256 agents and 9,188 feedbacks on that day (since grown to <!-- n:agents -->10,309<!-- /n --> and <!-- n:feedbacks -->9,291<!-- /n -->), while
**`fovea.verdict` kept all 2,384 rows** because it lives outside the schema Envio drops. That
separation was designed for this and this is the first time it was load-bearing.

```bash
sudo -u postgres psql -d envio-dev -c 'select "chainId", count(*) from public."Agent" group by 1;'
sudo -u postgres psql -d envio-dev -c 'select "chainCount", count(*) from public."ChiasmRecord" group by 1;'
```

### The studio, both onboarding doors

The agents section of `/account` (`/account#agents`, formerly `/studio`, which now redirects there) composes an ERC-8004 registration document and generates the transaction that puts it on
chain. Two doors, the shape the onboarding plan specified:

* **Register a new agent.** A progressive form where every field shows its consequence live: an
  endpoint is what separates a declared skill from a reachable one, a `data:` URI is what cannot
  return a deletion. The JSON, the URI, the byte count and the calldata are all on screen before
  anything is sent.
* **Repoint an agent you own.** `setAgentURI(agentId, newURI)`, which the registry refuses for anyone
  who is not the owner.

**We never sign for the operator and we hold no key that could.** There are two paths and both are
theirs: take the calldata to any wallet or sign in with a passkey and **send it from the browser**,
from the account that passkey derives. A project that publishes measurements about other people's
registrations must not be able to manufacture one and the honest guarantee is having no means to.

**The passkey path sends the transaction, as of 2026-09-24.** It did not at first: the passkey derived
the account, checked ownership and signed an intent receipt and then stopped, while the page implied it
would send. That was an unbacked claim on the page that teaches people how to use this, so it is
recorded rather than quietly patched. What it does now:

* `openSession` with `agentScope`, whose `maxAmountAtomic` is `0n`, so a session opened to pay for a
  verification cannot silently also register an agent. `ScopedSession.account` is already a viem
  `LocalAccount`, so it drops into `createWalletClient` unchanged. The session is ended in a `finally`,
  so the key is zeroed whether the send succeeded or threw.
* **The agent id is read, not assumed.** A registration has no return value a transaction can carry, so
  the ERC-721 mint's `Transfer` log is located by address and topic count and the id taken from the
  fourth topic. A reverted receipt is reported as reverted.
* `insufficient funds` gets its own message, because the cause is structural: a registration **cannot be
  relayed**, since the registry records `msg.sender` as the owner and a relayer would end up owning the
  agent. That is why this is the one action here that is not gasless.

Proven before shipping rather than asserted: a browser-style viem client reaches Monad at block
107471803 and simulating the exact `register()` call the studio builds returns agent id `10256`, the
next id the registry would mint at that block.

Two rules are enforced in code rather than asserted here. The calldata decodes back to the document
that was previewed and a draft that mentions a payment proof fails its own consequence check,
because a registration document is not the place for a payment claim.

```bash
node --test --experimental-strip-types 'lib/registration.test.ts'    # 24 pass
curl -sS -o /dev/null -w '%{http_code}\n' https://kanmani.xyz/account # 200
```

`register()` with no argument is deliberately not offered. It mints an agent whose URI is empty and
80 of those already exist on Monad: the one population no verifier can help.

### The kit, the embed and /developers

**The output used to be a site with eleven nav tabs.** The track this enters asks for *"a protocol,
primitive or infrastructure layer that other applications build on, not a standalone consumer
product"* and scores Design as developer experience rather than visuals. Meanwhile
`components/ui.tsx` already was a component library and was private. The architecture existed and was
not the product.

[`components/kit.tsx`](../components/kit.tsx) is now the public boundary. `ui.tsx` stays internal
layout; everything in the kit is meant to be rendered by somebody else and the distinction matters
because an internal helper can change shape on a Tuesday and a published component cannot. `Verdict`,
`Count`, `Share`, `Ladder`, `Distribution`, `TrustBadge`, `RecordState`, `Reproduce`.

**What it publishes is not the data.** The API has been open and CORS-enabled since the beginning, so
the numbers were never the hard part. The hard part is that three mistakes are available to anyone
consuming `/api/agent/<id>` by hand: printing a null as `0`, colouring `unknown` like `false` and
averaging the four outcomes into a score. Every component makes all three unavailable and there is no
prop that turns it off. A marketplace embedding `<Verdict>` gets the `unknown` rule whether or not it
has read a word of this documentation. **The primitive is the discipline, not the figures.**

[`app/embed.js`](../app/embed.js/route.ts) is one line for a page that is not ours:

```html
<script src="https://kanmani.xyz/embed.js" data-agent="10182"></script>
```

No framework and no build step, because a host page cannot be asked to adopt our toolchain. It renders
inside a **closed shadow root**, which matters beyond tidiness: a badge that inherited a host page's
error red could show `unknown` in the colour of an accusation. It fails quiet. A network error, a bad
id or a missing agent removes the element rather than drawing an error box in somebody else's page.
Served from a route rather than committed as a static asset so the origin follows
`NEXT_PUBLIC_SITE_URL` instead of being hardcoded twice.

```bash
curl -sS https://kanmani.xyz/embed.js -o /tmp/e.js && node --check /tmp/e.js   # valid, 4,470 bytes
curl -sSI https://kanmani.xyz/embed.js | grep -i access-control-allow-origin   # *
```

`/developers` renders every component against live data from the same functions our own pages use, so
a broken component there means a broken site.

**The navigation is grouped rather than eleven flat tabs**: create, verify, settle, explore, reports,
blog and developers. Nothing was deleted; depth is one hover away instead of eleven siblings competing
for one row. `developers` is the only group that is a destination in itself, because it is what the
product is for.

### Light and dark, with the verdict distinction surviving both

The site was dark only. Two palettes now, defaulting to the reader's system preference, with an
explicit three-state switch (system, light, dark) applied by an inline head script **before first
paint** so a returning light-mode reader does not get a dark flash.

**Two palettes rather than an inversion, for the same reason the colours exist at all.** A hue that
reads as "absence" on near-black does not automatically read as absence on white and a green legible
on ink fails contrast on paper. Each mode names its own values and both were checked against three
questions: is `false` unmistakably an alarm colour, is `unknown` unmistakably not one and does
`unknown` stay more present than `noClaim`. Light mode therefore takes darker verdict hues and uses
slate-600 for `unknown` against slate-500 for `noClaim`, so that third relationship survives the
inversion rather than flipping.

`@theme inline` is load-bearing. Without it Tailwind resolves each value at build time and bakes a
literal into every utility, so `text-muted` would freeze to whichever palette compiled first and only
hand-written `var()` call sites would move.

```bash
curl -sS https://kanmani.xyz/_next/static/chunks/*.css | grep -o '\.text-muted{color:var(--muted)}'
```

**Contrast was measured rather than eyeballed and two failures were found**, one of them
pre-existing: light `noClaim` was 2.56:1 on white and is now 4.76 and dark `faint` was already
failing at 2.86:1 and is now 3.65. Everything else is AA or better in both modes.

Per-mode too, because each was tuned for near-black and reads as dirt or a stray bright stripe on
paper: the drawn field strength, the grid opacity, the elevation shadows and the inset top edge,
which has to darken on light instead of lighting. `::selection` stopped hardcoding white text, which
would have vanished on the light lilac fill.

### Authority over an agent: the passkey as a protection layer

The passkey layer was a showcase. `/account` demonstrated four keys from one ceremony and `/pay`
opened a scoped session, but the one place authority actually matters (creating an agent and
changing an existing one) treated it as one of two equal options and used it to protect nothing.

**What is actually at risk, stated precisely.** Not "someone repoints an agent they do not own":
`setAgentURI` reverts for anyone who is not the owner, so the chain already refuses that and no
front-end care adds to it. Three real risks remain and [`lib/authority.ts`](../lib/authority.ts)
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
problem is the same error as rendering a timeout as `false` and nothing is blocked on it because the
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
flag we remember and a receipt with a mutated `uriHash` is refused with 400 and stored nowhere.

**No real receipt exists yet**, because publishing is optional and every document change predates the
feature. The page says that in words rather than rendering an absence as a clean record. And the
boundary is stated on both the endpoint and the page: a receipt says one identity authorised one
document, not that the transaction landed, that the signer owns the agent or that the document is
good.

### Cornea, the surface

Thirty pages, twelve machine-readable GET surfaces and thirty-eight route handlers. Every page can
print the SQL behind its numbers. `/verify` imports the verifier's own `judge()` rather than
reimplementing the ladder, so the site and the command line cannot give different answers. `/blog`
carries the write-ups and `/compliance` reads the Cleanverse gate live.

```bash
for p in / /agents /operators /claims /compare /verify /login /pay /fund /account \
         /method /chains /status /validate /developers /blog /bond /compliance /hire; do
  printf '%s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code}' https://kanmani.xyz$p)"
done
```

**The surface is fully adaptive.** One fluid `clamp()` scale for type and rhythm rather than a
handful of breakpoints, container-query-ready shells, auto-fitting grids and a navigation that
folds into a sheet on a phone. Motion follows monad.xyz's language: a drifting aurora behind the
hero, a one-shot brand sweep, a marquee of the machine-readable surfaces, scroll-reveal and a
count-up on the headline figure. All of it is neutralised under `prefers-reduced-motion`.

**The navigation states the product's order rather than an index.** Seven categorised groups with hover
menus, sequenced the way somebody moves through the thing: `create`, `verify`, `settle`, `explore`,
`reports`, `blog`, `developers`. It replaced two worse shapes. First eleven flat tabs, which read as a
filing cabinet, then four groups whose order was arbitrary, so `explore` came first and the first thing
a visitor saw was somebody else's data instead of anything they could do. `reports` sits late because
"how old is that number" is a question a reader only has after they have believed something. The hero
offers the same four actions in the same order, so the page and the navigation cannot teach different
sequences.

`/bond` is the surface for Sclera and was written the day Sclera went live, because a `settle → bond`
menu entry pointing at nothing would have been exactly the clumsiness the reordering was meant to
remove. It carries the contract address, the first bond transaction, the floor and window committed to,
the command to check the stake by where the money is, why the CRE forwarder is not trusted and what
has not been proven.

One defect in that layer is worth recording because it shipped and had to be fixed: the reveal
originally hid every wrapped section with `opacity: 0` and relied on JavaScript to reveal it. When
that did not arm as expected the page rendered **blank** while the server HTML and every asset were
correct. It is inverted now. Content is visible by default and only a JS-armed `pending` state
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
chip and those chips deliberately borrow neither the verdict green nor the verdict red, because a
statement about our build must never be readable as a verdict about an agent.

### Sclera, the bond that makes "trust becomes a price" a mechanism

An agent stakes USDC against a floor on its own claim-truth rate over a block window, with a
minimum sample below which nothing can slash. Stay above the floor and the stake returns when the
window matures. Fall below it and the bond is forfeit.

```bash
wc -l contracts/src/Sclera.sol                    # 453
cd contracts && forge test --match-path 'test/Sclera*'   # 46 tests, 44 pass, 2 skip (39 in Sclera.t.sol, 2 in ScleraCrossSign.t.sol, 5 in ScleraFork.t.sol)
```

The slash is authorised by a signature, not by the caller. Monad's CRE forwarder
`0x9eF6468C5f37b976E57d52054c693269479A784d` reports `MockKeystoneForwarder 1.0.0` and its `report`
function is permissionless, so a contract gating on `msg.sender == forwarder` would be gating on
nothing. Sclera recovers the signer and requires one key fixed at deploy. That key is derived from
the same passkey ceremony as everything else and is pinned in two independent implementations:

**Corrected 2026-09-25, from Chainlink's own answer.** There are **two** forwarders on Monad mainnet
and we had read only one. Darb at Chainlink Labs supplied both and both were then checked on chain:

| address | `typeAndVersion()` | bytes |
|---|---|---|
| `0x76c9cf548b4179F8901cda1f8623568b58215E62` | `KeystoneForwarder 1.0.0` | 8,591 |
| `0x9eF6468C5f37b976E57d52054c693269479A784d` | `MockKeystoneForwarder 1.0.0` | 4,579 |

Our permissionless-`report` finding was read off the **mock**, so calling it "the forwarder" was
imprecise. **The security conclusion does not move**, which is the point of the design: Sclera trusts
neither address. It authorises on the attestor's signature, so it is safe whichever forwarder a report
arrives through, including one we have never read. A consumer that had gated on
`msg.sender == forwarder` would now have to know which of the two it meant.

```bash
grep -rn 0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf contracts/ lib/
# contracts/script/DeploySclera.s.sol, contracts/test/ScleraCrossSign.t.sol, lib/iris.test.ts
```

**Deployed to Monad mainnet 2026-09-24** at
[`0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf`](https://monadexplorer.com/address/0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf), 8,477 bytes, source verified `exact_match`,
immutable with no admin function and no setter on any of its three constructor arguments.

```bash
cast call 0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf 'attestor()(address)'         --rpc-url https://rpc.monad.xyz
cast call 0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf 'slashBeneficiary()(address)' --rpc-url https://rpc.monad.xyz
cast call 0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf 'identityRegistry()(address)' --rpc-url https://rpc.monad.xyz
# 0x358c591aD7D60aC36bC223472B41518A7FA7b44A
# 0xDB6c6340342e71A63cD11Ebac2185204b7777777
# 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
```

Deployment 0xa2fbbe20…c8a18793 at block 107455772, 2,452,175 gas at 102 gwei = 0.250 MON.

**Finding 9 is proven closed on the live contract, not only in tests.** Calling `postBond` for agent
10182 from an address that does not own it reverts with `0x390772fc`, which is
`cast sig 'NotAgentOwner()'`. Agent 10182 is owned by
`0x350Ef06F11e87731476D567b3e5E5d865dcd6657`, not by us:

```bash
cast call 0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf 'postBond(uint256,address,uint128,uint16,uint64,uint32)' \
  10182 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 1000000 8000 100 5 \
  --from 0xDB6c6340342e71A63cD11Ebac2185204b7777777 --rpc-url https://rpc.monad.xyz
# execution reverted: 0x390772fc == NotAgentOwner()
```

So "an agent stakes against its own promise" is now enforced by a deployed contract rather than
asserted by a sentence.

**The first bond is posted, in real USDC, on mainnet.** Agent 10252, which we own, staked 0.02 USDC
against a floor of 80% claim truth over roughly one day of blocks with a minimum sample of 5:

| | |
|---|---|
| transaction | [`0x72970dc0…26697e7c`](https://monadexplorer.com/tx/0x72970dc0428412d04c043877be6b8c979b245797cf275bcae683394026697e7c) |
| block | 107460188, 261,828 gas |
| locked | 20,000 units of USDC, held by the contract |
| matures | block 107676188 |

Verified by where the money is rather than by an event:

```bash
cast call 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 'balanceOf(address)(uint256)' \
  0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf --rpc-url https://rpc.monad.xyz    # 20000
cast call 0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf 'maturesAt(uint256)(uint64)' 10252 \
  --rpc-url https://rpc.monad.xyz                                               # 107676188
```

The house balance moved 34,081 to 14,081, so the tokens left the poster and are held by the contract.
A second bond on the same agent is refused with `BondExists()` (`0x2e01e311`), which is the
one-bond-per-agent rule working on the live contract.

**The bond completed its lifecycle on 2026-09-25.** It ran the full window with no slash and was
released: [`0x06082587…1fb41b92`](https://monadexplorer.com/tx/0x06082587d73900d91f6dcd16408170dd322f316e9dc0acea27ae2a7d1fb41b92),
block 107719555, 137,697 gas. The contract's USDC balance went 20,000 to 0 and the agent's 14,081 to
34,081, so the exact amount came back. State reads `3` (`Released`), the amount field is zeroed. A
second release reverts `WrongState()`.

So post, hold, mature and return are all proven on mainnet by balance rather than by event.

**What this does and does not prove.** It proves the stake is real: money is locked by an immutable
contract against a floor its poster chose and only the ownership check let that poster in. It does not
prove a slash, because our own record asserts no payment claims, so the sample is below the minimum and
nothing can fall below the floor. The slashing path is proven in the test suite and against a fork of
mainnet, not by a live slash of our own money. Both sentences belong together.

**The attestor is a passkey-derived key that owns nothing.** It is the fourth Iris key, namespace
`kanmani.optic-onchain.v1`, secp256k1 because `ecrecover` is the only scheme the EVM verifies cheaply.
It signs verdicts and cannot move money and it is deliberately not the deployer: the deploy script
refuses `attestor == msg.sender` and refuses the demo attestor by address because that key derives
from a test vector committed to this repository.

**The original pre-deploy review and its blocker.**
[`17-CONTRACT-AUDIT.md`](17-CONTRACT-AUDIT.md) Finding 9 found that `postBond` never checked who owned
the agent, so anyone could bond anyone and a bond proved nothing. `postBond` now reads `ownerOf` from
the Identity Registry, the registry is an immutable constructor argument with no setter and the fix is
mutation-tested: disabling the check turns four tests red. Finding 10, six unreachable refusal emits, is
also closed.

---

## Built, not yet live

**This section replaces one that said these were "not started". That was true when it was written
and it is now false.** Leaving it up would be a published claim that no longer matches what a check
returns, which is the failure this project exists to attack. Each line below says what exists, what
does not and the command that shows which.

### The claim-truth endpoint a slashing oracle reads

`GET /api/sla/<agentId>?fromBlock=&toBlock=` is live. It is a pure function of the agent id and the
block range, because a CRE workflow reaches consensus by having independent nodes compute the same
answer and anything keyed on a wall clock drifts between them.

```bash
curl -sS 'https://kanmani.xyz/api/sla/10182' | jq '{rateBps, sample, true: .trueCount}'
```

`rateBps` is null on an empty sample rather than 0, because 0 reads as "every claim was false" and
would slash an agent nobody has rated yet.

### The CRE slashing workflow

```bash
wc -l cre/kanmani-oracle/slashing/main.ts     # 318
```

Written against `@chainlink/cre-sdk`. It reads the endpoint above and signs a verdict. Not deployed
to the CRE network, which the bounty explicitly permits: a CLI simulation or a live deployment is
accepted and the workflow is real either way.

### Alchemy self-healing re-verification

```bash
wc -l app/api/webhooks/alchemy/route.ts       # 45
```

A `MetadataUpdate`, which is the ERC-4906 event an agent emits when it repoints its own document,
re-runs the exact ladder the command line runs and appends a fresh verdict. The store was always
append only, so a repaired document reads as `false` then `true` with both timestamps. What was
missing was only the trigger.

Signature verification is HMAC-SHA256 over the raw body, compared in constant time and the route
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
wc -l contracts/src/CleanverseGate.sol          # 347
ls indexer/src/handlers/                        # Retina.ts  Chiasm.ts
wc -l lib/cleanverse.ts lib/intents.ts          # 189, 977
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
chain while the payment sat on another. Every one of the <!-- n:claims -->187<!-- /n --> payment claims names Monad. The
failure is simpler than the one designed for, so the site says the simpler thing.

**The denominator moved from <!-- n:feedbacks -->9,291<!-- /n --> to <!-- n:claims -->187<!-- /n -->.** Most ERC-8004 feedback on Monad is not a payment claim.
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
registry of 10,252 at census time. No query failed and no test went red. The page now prints its own
sum next to the total.

---

## Defects found in our own work

Published in [`18-BUGS-FIXED.md`](18-BUGS-FIXED.md) rather than quietly fixed, including the ones
that were our own reasoning rather than our own code: a bytecode mismatch that was our check being
wrong, a root-cause theory that measurement killed, a test that deleted the live index, plus a
`Buffer` reference that passed 35 green tests and would have thrown on a judge's machine during a
live gate.

## Two agents of our own and why these two

Shipped 2026-09-25 and live on Monad mainnet.

| agent | id | sells | bond |
|---|---|---|---|
| Sentinel | 10256 | A pre-hire verdict stamped with the block it was measured at, refused if staler than the caller's bound | 10,000 atomic USDC, floor 8000bps |
| Assay | 10257 | The bond an agent should post: a floor in bps plus a premium, from its measured claim-truth rate | 10,000 atomic USDC, floor 8000bps |

The registry has <!-- n:agents -->10,309<!-- /n --> agents and most are not worth hiring, so adding another generic one would have
been noise. A swap router or a chat wrapper also runs identically on any EVM chain, which is why neither
is here: shipping one would demonstrate nothing about Monad beyond that it executes bytecode.

**The filter was latency.** A trust layer is a loop. Measure a claim, judge it, then price or slash
against the judgement. The loop only deters anything if it closes while the counterparty still has
something to lose. Measured on mainnet while building this, 15 blocks in 4 seconds, about 266ms each. At
12-second finality a false claim is paid and gone long before a verdict lands and a bond is decoration.
Both agents therefore sell **recency**, which is only a product where blocks are cheap and fast enough
to re-read constantly.

Sentinel enforces its freshness bound rather than reporting it: outside the bound it returns
`withinBound: false` with no verdict, because a caller who asked for fresh and got stale received the
opposite of what they paid for. 64 blocks is about 17 seconds here and about 13 minutes at 12-second
finality.

Assay refuses more often than it quotes and the refusals are the point. Under a sample of 5 it returns
nulls, matching the `minSample` the deployed contract enforces. It also refuses when the computed floor
would fall below 100bps, because beneath a very low rate a floor cannot bite and above it the next
measurement slashes.

Neither invents a measurement. Both read the same corpus and judge the website uses, so an agent answer
and a page cannot disagree. Both records are inline `data:` URIs, so they cannot rot the way the 8,093
hosted ones did.

### Using them found three bugs that reading the code had not

This is the argument for paying your own endpoint.

1. Sentinel reported `ageBlocks 4,053,760` on a fresh answer. The bound was measured as head minus
   `latestFeedbackBlock`, which answers a different question: how long since anyone anywhere left
   feedback. A true subtraction of two real numbers that meant nothing a buyer wants, which is the worst
   kind of wrong number because it looks computed. It is index lag now.
2. Then `ageSeconds 1,788,507,850`, about 56 years. `indexStateUpdatedAt` is Unix seconds and was read
   as milliseconds.
3. Assay quoted `floorBps 0` for an agent measured at 2.4% claim truth. No verdict can fall below zero,
   so that is a bond nobody can ever slash: the unslashable-bond defect of audit Finding 9, recreated in
   the thing that advises people what to post and worse than useless because the caller paid for it.

### Six paid calls and the disclosure that belongs with them

All six settled over x402 on Monad. `PAY_TO` is the deployer wallet and that is the only funded wallet,
so **payer and payee are the same address**. USDC is unchanged at 34,081 across all six, which proves the
circularity rather than hiding it. This shows the rail works end to end and shows nothing about demand.

Bonds verified by balance rather than by event: the contract went to 20,000 and the wallet went 34,081
to 14,081, exactly 20,000 moved. Both read back `state 1` Active. `postBond` against an agent we do not
own still reverts.

## Inline documents are parsed on ingest

Our own two agents were indexed in 38 seconds and rendered as `unnamed`, because `name`, `endpoints` and
`declaresX402` came only from the probe that runs every 10,000 blocks, about 44 minutes.

That wait is owed to a **hosted** document: the probe is serial and spaced per host because it fetches
from somebody else's server. It is not owed to a `data:` URI, which is inline in the transaction already
being decoded. We were applying HTTP-fetch latency to a document in memory, which on a 266ms chain is
the wrong clock and is the same latency argument the two agents exist to make.

`parseInlineRecord()` reads inline documents at index time. Unreadable input leaves the fields undefined
rather than writing a guess, because a wrong name is worse than an absent one. Hosted URIs still belong
to the probe. A one-off backfill using the handler's own parser filled 59 of 60 existing rows and left
one malformed document alone. A first attempt as a single SQL statement aborted on invalid UTF8, which
was the correct outcome and the reason the backfill is a script.

## Built to landing.md

Audited against the house frontend recipe rather than assumed compliant. Light and dark, the split into
real pages and an action-first hero already matched. Five things did not.

* **Reports is its own category.** `method`, `validate` and `corrections` had been scattered under
  `verify` with `status` as an orphan tab.
* **Developers has a submenu**, deep-linking to components, embed, api and add-a-chain. It was declared
  with an empty item list, so hovering it did nothing.
* **The nav works from a keyboard.** It opened on hover and tap but had no `onFocus`, so every submenu
  item was unreachable without a mouse. Arrow keys, Home, End and Escape now move focus and
  `aria-haspopup`, `role="menu"` and `role="menuitem"` were all missing.
* **Nothing can tuck under the header.** `scroll-padding-top` and `scroll-margin-top` were both absent.
  Invisible until the submenus above created the first five anchor targets.
* **The charts went through the dataviz skill.** Measured with its validator: light mode passes at OKLab
  delta E 8.4 under deuteranopia, dark warned at 6.5 for true against false, so the false segment carries
  a hatch. The verdict colours themselves are unchanged. The validator also flagged our lightness band
  and chroma floor and both are refusals rather than misses, since those checks score categorical
  identity palettes and ours is a status palette where `noClaim` and `unknown` are deliberately gray.

## Every published figure is queried

Two numbers on the site were contradicted by our own database: `/chains` said 356,647 BSC agents against
a real 357,444 and `/studio` said 2,012 distinct documents against 2,016. Neither was a calculation
error. They were true on the day somebody typed them into a sentence, which is the same mechanism this
project publishes findings about in other people's records. Both populations have grown since: the
distinct-document count is <!-- n:documents -->2,063<!-- /n --> today.

Every population figure now comes from a query, including one a client component had been asserting
inline. `agentsByChain()` was added because no per-chain count existed, which is the root cause: the
figure was typed in for want of a function. Frozen counts were removed from the chain registry note and
`/operators` metadata describes the finding instead of quoting a number, because static metadata cannot
hold a live one.

Three things stay hardcoded on purpose. 216,000 blocks and 20,000 units are the parameters of the bond
actually posted, so they are history. The 10,000-block sweep cadence is configuration. Agent ids in a
compare link are identifiers.

## The writing gate is a command

The gate lives in the workspace that drives this build rather than in this repository.
`bin/voice-gate.mjs` there checks em dashes, comma-before-and and the AI tells in CLAUDE.md.
`bin/portal-post.sh` runs it before a request is built and refuses to POST on a hit.

It exists because the rule was already written down and relied on being remembered. A dashboard update
and four mentor replies went out dirty and the replies cannot be edited: `PATCH` and `PUT` on a reply
both return 404 and an answered question returns 409. It has caught violations in its author's own work
four times since, including 11 in the draft of the next dashboard update.

### One account, 2026-10-06

There used to be two kinds of account, agent and user, picked at sign-up and stored as a `kind` flag in
the tab. Both were the same address proved the same way. The split only made people choose. Now there
is one account: an address proved with a passkey or a wallet. What it can do follows from what it owns
on chain. The nav has one `account` entry. Signed out, its menu links to the two tabs of `/login` (log in,
create account). Signed in, `/account` is the dashboard: overview and balances, payments, the agents
section (the old studio) and the four-keys passkey demo. `/create`, `/create/agent`, `/create/user` and
`/studio` redirect with 308. A session stored before the change still reads with `kind` dropped. Any other
unexpected field still rejects the record. `scripts/e2e/account-unified.e2e.mjs` runs the whole path
with a real passkey ceremony, including clearing storage and logging back into the same address.

### Aqueous source verification, 2026-10-09

Aqueous was not on Sourcify until today, although Sclera and the Cleanverse gate were. It is now an exact match on
both creation and runtime bytecode: https://sourcify.dev/#/lookup/0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32
(chain 143). Compiler 0.8.24, evm shanghai, optimizer 20,000 runs, constructor `claimWindow = 259200`, deployed
from commit `190e91f`. `contracts/src/Aqueous.sol` is unchanged since that commit.

### Dissent recomputer for Aqueous, 2026-10-09

`AqueousFlatDeliveryRecomputer` lets an agent stake MON on Dissent behind the claim "no eligible flat Aqueous job
paid this agent without an onchain delivery record". The scope is an explicit list of job ids fixed at commit,
because Aqueous stores no creation block and anyone can open a job naming any agent. It lives in Dissent's repo
(PR https://github.com/alnitak34/dissent/pull/7), not ours. It only reads Aqueous. Deployed by the house wallet at
`0x008652FF29d575F4009657805A1D0A0b161DCCd8` (tx `0xbba4bf45…62bc`), Sourcify verified. 22 fork tests pass with
Foundry 1.8.1 at block 111,776,000, including the whole commit, challenge and reveal flow through the real
DissentCore. Base gas is 34,406 for 1 listed job and 565,849 for 32. It is not live until Dissent's curator
registers a policy. All four real Aqueous jobs so far are metered, which this rule excludes.

Review round, same day. Alnitak reproduced the 22 fork tests and found that the claim admitted any token.
Aqueous trusts a token's `transfer` return value, so a token that returns true without paying could make a
job Settled while the agent received nothing. The revision (Dissent PR commit `8defcdd`) pins Circle USDC
as an immutable `token` in both base and evidence paths. It also documents that release is the buyer's
call, so a successful challenge shows a buyer paid early rather than agent misconduct. A 32-job commit and
reveal now runs under the proposed caps: DissentCore measured 550,559 base gas. The new instance is
`0x4d1A62869D16AB2Bac95408445129C4927f88457`. The first instance, `0x008652FF…CCd8`, has no token check
and must not be registered. 28 fork tests pass, 195 in their repo.

