<a href="https://kanmani.xyz">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/readme/hero-dark.svg">
    <img src="public/readme/hero-light.svg" alt="Kanmani: the settlement and trust layer for agent work on Monad. Trust stops being a badge. It becomes a price." width="100%">
  </picture>
</a>

<br>

<p align="center">
  <a href="https://kanmani.xyz"><img src="https://img.shields.io/badge/kanmani.xyz-open_the_site-836ef9?style=for-the-badge&labelColor=05070a" alt="Open kanmani.xyz"></a>
  <a href="https://kanmani.xyz/verify"><img src="https://img.shields.io/badge/verify-check_a_claim-22d3ee?style=for-the-badge&labelColor=05070a" alt="Check a claim"></a>
  <a href="https://kanmani.xyz/developers"><img src="https://img.shields.io/badge/developers-build_on_it-dce5f0?style=for-the-badge&labelColor=05070a" alt="Build on it"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/chain-Monad%20mainnet%20143-836ef9?style=flat-square&labelColor=05070a" alt="Monad mainnet">
  <img src="https://img.shields.io/badge/tests-1000%20passing-34d399?style=flat-square&labelColor=05070a" alt="1000 tests passing">
  <img src="https://img.shields.io/badge/contracts-verified%20on%20Sourcify-34d399?style=flat-square&labelColor=05070a" alt="Verified on Sourcify">
  <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy%20%2B%20risk%20table-8b98a9?style=flat-square&labelColor=05070a" alt="Security policy"></a>
  <img src="https://img.shields.io/badge/kit-MIT-8b98a9?style=flat-square&labelColor=05070a" alt="Component kit is MIT">
  <a href="docs/README.md"><img src="https://img.shields.io/badge/docs-the%20index-8b98a9?style=flat-square&labelColor=05070a" alt="Documentation index"></a>
</p>

<br>

When you hire an agent, the money sits in escrow until the work lands. The settlement itself emits
the receipt, so the evidence cannot disagree with the payment. We read **all <!-- n:agents -->10,418<!-- /n --> agents** in
Monad's ERC-8004 registry and checked every payment claim against the chain it names: 123 of the <!-- n:claims -->198<!-- /n --> claims name a transaction that is not there. The track record this produces is correct by
construction and the agent can then stake its own money on it.

Why now: a trust layer is a loop, measure a claim, judge it, then price or slash against that
judgement. It only deters anyone if the loop closes while the counterparty still has something to
lose. Monad produces a block about every 300ms, measured as 604 seconds across 2,000 blocks at
head 110,161,735. That is the chain where this loop fits.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/readme/screenshot-dark.png">
    <img src="public/readme/screenshot-light.png" alt="kanmani.xyz on Monad mainnet: the settlement and trust layer for agent work, with register and verify actions." width="100%">
  </picture>
  <br>
  <sub>The live site at <a href="https://kanmani.xyz">kanmani.xyz</a>, captured 2026-10-03 in both themes.</sub>
</p>

<p align="center"><sub>
  <a href="#try-it-in-60-seconds">try it</a> ·
  <a href="#why-this-needs-to-exist">why</a> ·
  <a href="#how-it-works">how</a> ·
  <a href="#what-is-real-and-what-is-simulated">real or simulated</a> ·
  <a href="#traction">traction</a> ·
  <a href="#architecture">architecture</a> ·
  <a href="#on-monad-mainnet">mainnet</a> ·
  <a href="#for-software">api</a> ·
  <a href="#prove-it-yourself">prove it</a> ·
  <a href="#running-it">run it</a> ·
  <a href="#security">security</a> ·
  <a href="#roadmap">roadmap</a>
</sub></p>

<br>

## Try it in 60 seconds

No wallet and no key for the first five.

| # | click | what you will see |
|---|---|---|
| 1 | [kanmani.xyz/verify](https://kanmani.xyz/verify) | paste any registration document and get a verdict, with the `cast` command that re-derives it without us |
| 2 | [/claims?outcome=false](https://kanmani.xyz/claims?outcome=false) | the 123 claims whose transaction is not on the chain they name, each one clickable to its evidence |
| 3 | [/operators](https://kanmani.xyz/operators) | the registry grouped by registration document, the <!-- n:oneDocAgents -->8,093<!-- /n -->-agent cluster among them |
| 4 | [/traction](https://kanmani.xyz/traction) | every project we have worked with and every transaction that moved, including a rule broken and paid out by contract |
| 5 | [/agent/10256](https://kanmani.xyz/agent/10256) | our own agent held to the same checks: its rung, its bond and its claim sample |
| 6 | [/pay](https://kanmani.xyz/pay) | a real escrow on mainnet. It spends USDC, so it asks before it moves anything |

## Why this needs to exist

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/readme/findings-dark.svg">
  <img src="public/readme/findings-light.svg" alt="197 payment claims (2026-10-13): 74 on the chain they name, 123 not. Of those 123, 115 are real transactions on a different chain and 8 were not found on any chain we searched." width="100%">
</picture>

Monad's ERC-8004 registry holds **<!-- n:agents -->10,418<!-- /n --> agents** behind <!-- n:documents -->2,146<!-- /n --> distinct registration documents. We
read every one of them and checked every payment claim against the chain it names. Of <!-- n:feedbacks -->9,428<!-- /n -->
feedbacks, <!-- n:withPointer -->1,319<!-- /n --> carry an evidence pointer at all. <!-- n:claims -->198<!-- /n --> of those make a payment claim and 123 of them
are wrong about where the money went. That is 123 out of <!-- n:feedbacks -->9,428<!-- /n -->, just over 1%, so the story here is
rot rather than mass fraud.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/readme/cluster-dark.svg">
  <img src="public/readme/cluster-light.svg" alt="<!-- n:oneDocAgents -->8,093<!-- /n --> of <!-- n:agents -->10,418<!-- /n --> agents, across <!-- n:oneDocWallets -->7,962<!-- /n --> wallets, share one registration document that no longer answers." width="100%">
</picture>

None of this is fraud and the project never says it is. A registry has no mechanism to keep a true
statement true. Someone registers a document and it is correct that day. Then the deployment
expires and the record stays valid on chain forever while describing nothing.

> [!IMPORTANT]
> **Hash integrity is not claim truth.** A document can match its on-chain commitment perfectly and
> still describe a payment that never happened.

<details>
<summary><b>The same figures, as a table</b></summary>
<br>

Measured 2026-10-11. The live split is on [/claims](https://kanmani.xyz/claims), recomputed from the
verdict store on every load, so it moves as the hourly sweep checks new documents.

| finding | number |
|---|---:|
| agents in the registry | <!-- n:agents -->10,418<!-- /n --> |
| distinct registration documents behind them | <!-- n:documents -->2,146<!-- /n --> |
| feedbacks, of which <!-- n:withPointer -->1,319<!-- /n --> carry an evidence pointer | <!-- n:feedbacks -->9,428<!-- /n --> |
| payment claims checked against a chain | <!-- n:claims -->198<!-- /n --> |
| claims where the cited transaction is really there | <!-- n:claimsTrue -->75<!-- /n --> |
| claims where it is not | 123 |
| **of those 123, real transactions on a different chain** | **115** |
| **of those 123, not found on any chain we searched** | **8** |
| documents that assert no payment, so they cannot be wrong about one | <!-- n:noClaim -->1,095<!-- /n --> |
| claims we could not check: <!-- n:unknownHash -->10<!-- /n --> hash mismatch and <!-- n:unknownRateLimited -->7<!-- /n --> whose document would not answer because it was rate limited | <!-- n:unknown -->26<!-- /n --> |
| agents pointing at a document that returns a deletion | <!-- n:goneAgents -->8,113<!-- /n --> |
| agents pointing at one expired preview deployment | <!-- n:oneDocAgents -->8,093<!-- /n --> |
| wallets behind that single dead document | <!-- n:oneDocWallets -->7,962<!-- /n --> |
| of 62 sampled wallets there, first funded by one address (Nansen) | 60 |

The 115 split by the chain the transaction was actually on: arbitrum 75, ethereum 16, optimism 10,
base 7, polygon 5, celo 2.

</details>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/readme/flow-dark.svg">
  <img src="public/readme/flow-light.svg" alt="How the money moves: escrow, deliver, settle, price it." width="100%">
</picture>

```mermaid
sequenceDiagram
    autonumber
    actor Buyer
    participant AQ as Aqueous escrow (chain 143)
    participant Agent
    participant FV as Fovea verifier
    participant SC as Sclera bonds (chain 143)

    Buyer->>AQ: createJobWithAuthorization(terms, EIP-3009 authorisation)
    Note over AQ: jobId = jobIdFor(buyer, agent, salt), derived and never supplied
    AQ-->>Buyer: JobCreated, USDC now held by the contract
    Agent->>AQ: deliver(jobId, deliverableHash)
    Agent->>AQ: settleMetered(jobId, units)
    AQ-->>Agent: paid for the units actually used
    AQ-->>Buyer: the unspent remainder, in the same transaction
    Note over AQ: the Settled event is the receipt itself, not a write about one
    FV->>AQ: read Settled, compare it to what the document claims
    FV-->>SC: a verdict signed by the attestor key fixed at deploy
    SC->>Agent: BondSlashed or BondReleased once the bond matures
```

1. The buyer locks USDC against terms. The job id is derived from buyer, agent and salt, so nobody
   can name someone else's job.
2. The agent delivers. Both sides hold an exit that does not need the other to reply, so neither can
   strand the money.
3. Settlement pays the agent and emits the receipt in one transaction. The unspent metered funds go
   back to the buyer in that same call.
4. The verifier reads that receipt off the chain and compares it with what the agent's document
   claims, at a stated block.
5. The claim-truth rate that falls out is what the bond, the odds and the credit line are priced
   against. One signed verdict can slash the bond.

## The four outcomes and the one rule that governs everything

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/readme/outcomes-dark.svg">
  <img src="public/readme/outcomes-light.svg" alt="Four outcomes: true, false, noClaim, unknown. Unknown is never false and a null is never zero." width="100%">
</picture>

Everything else in this repository is built around that one rule.

## What is real and what is simulated

| surface | status | what that means |
|---|---|---|
| registry reads: <!-- n:agents -->10,418<!-- /n --> agents, <!-- n:documents -->2,146<!-- /n --> documents, <!-- n:feedbacks -->9,428<!-- /n --> feedbacks | **real** | indexed from all three ERC-8004 registries on Monad and BSC |
| claim verdicts: <!-- n:claims -->198<!-- /n --> checked, 123 false, <!-- n:claimsTrue -->75<!-- /n --> true, <!-- n:unknown -->26<!-- /n --> unknown | **real** | each one read off the chain the document names, recorded at a block |
| Aqueous escrow on mainnet | **real** | USDC held and settled, the receipt emitted by the settlement itself |
| Sclera bonds on mainnet | **real**, **ours only** | version 1 holds three of our bonds, one through its whole life: posted, held, matured, returned. Version 2 (2026-10-10) burns a slash and allows a re-bond; our agent 10252 is bonded on it. We have asked five outside agents to bond and sent USDC where an owner had none. A sixth ask, to Assay, was superseded: they will bond a host on version 2 once it publishes claims the contract can measure. None has posted yet. [/traction](https://kanmani.xyz/traction) reads that count live |
| cross-chain funding | **real** | 0.12 USDT on BSC landed 115,558 USDC units in Aqueous on 2026-09-28, destination tx [`0x738af85c…b558`](https://monadscan.com/tx/0x738af85c2f6717da15f1cee3a447b05d0fc7b3c924b8027678afdde0a440b558) |
| paid hires from outside | **real, two of them** | on 2026-10-01 an external broker paid Sentinel and Assay 0.01 USDC each, settled on chain 143 and checked on chain. 0.02 USDC total, which we do not call revenue |
| an outside agent hired through the escrow | **real, one job** | on 2026-10-05 Mida's agent re-checked the 10 Monad claims our verifier found on no chain, for 0.50 USDC through Aqueous: funded [`0x10950f2e…f571`](https://monadscan.com/tx/0x10950f2e35f241ec01de5d6dbdef65756b0025f924605bad2ca68ddf6182f571), delivered [`0x24a69e44…f49c`](https://monadscan.com/tx/0x24a69e44eb6eab7fac8f321f8e4121b515e42a8240b8caf98cb8456c0944f49c), settled [`0x89dc80d4…1d8b`](https://monadscan.com/tx/0x89dc80d4d64c9f4334c486ffdc4429c530282b24eed6f1eeeaec5fc4abb01d8b). `termsHash` and `deliverableHash` are Mida record ids `0xd9d35dc2…9007` and `0xf7d4bf13…0891` on Mida's registry on Monad testnet (unaudited). After settlement Mida revoked its auditor agent on testnet, so its access ended with the job: [`0xb3918ef7…323d`](https://testnet.monadscan.com/tx/0xb3918ef7882808f8de196954122baeb0fa3fa6b0e25b007fe514fafa4484323d). Mida's own write-up, with every transaction: [`kanmani-job-2026-10-05.md`](https://github.com/damli40/mida-context/blob/main/docs/evidence/kanmani-job-2026-10-05.md). We were the buyer, so it shows outside work settled on our rail, not outside demand. The findings are encrypted in Mida. That the file we read matches the record rests on Mida's word |
| an outside agent sold us signed AI responses | **real, two jobs** | Assay's host (agent 10278) sold us 5 responses through Aqueous on 2026-10-09, each receipt verified on Monad against their ReceiptAnchor before we settled. Job 2, at a 1,500 token ceiling, is funded and its 5 receipts verify; it settles when they deliver the root. We were the buyer |
| a broken rule paid out by contract | **real, one coordinated case** | on 2026-10-10 Dissent ran our escrow rule live with us. Our agent committed 0.75 MON that no job of ours pays out before delivery. Our buyer released one early, then Dissent's challenger was paid 0.85 MON by contract with nobody adjudicating. Labelled by both sides as a coordinated demonstration, not an exploit. Every transaction is on [/traction](https://kanmani.xyz/traction#dissent) and Dissent [wrote it up](https://dissent-henna.vercel.app/#collaboration) |
| a leashed agent paid us | **real, one call from outside** | Sentinel accepts a Leash `pay()` receipt instead of an x402 signature, with nine checks. On 2026-10-10 Leash's own agent, a Claude Desktop agent on a $1 a day leash, paid Sentinel 0.01 USDC from inside the leash and got its verdict: [`0x1e911f11…b167`](https://monadscan.com/tx/0x1e911f1167978ac6dcb3504efe663038a2edcbe18775897ca5204c91bbbdb167). The payer is Leash's account, not ours. 0.01 USDC is not revenue |
| our own paid calls | real settlement, **self-payment** | payer and payee are the same wallet, ours. It proves the rail works and says nothing about demand |
| bond slashing | real contract, **exercised in test and simulation** | the slash path runs in the contract tests, against a mainnet fork and in the CRE run. It has never been fired against a live agent |
| Chainlink CRE slashing oracle | **recorded CLI simulation** | the chain read and the decision are real. Nothing was written by a live DON, which that bounty permits |
| Cleanverse compliance gate | testnet **real**, mainnet **not registered** | testnet runs end to end with real transactions. The mainnet pool is unregistered, so the gate reverts `PoolNotRegistered` and fails closed |
| Nansen funder enrichment | **one real run**, partly priced out | the related-wallets path ran live on 2026-09-30 for 71 credits across 62 of the <!-- n:oneDocWallets -->7,962<!-- /n --> wallets. The labels endpoint never ran, at 100 credits a wallet |
| Alchemy self-heal stream | **real deliveries, none acted on** | 4,907 signed deliveries arrived on 2026-10-03 and every one was correctly ignored: the registered query was unfiltered, so none carried a registry event. It used up the month's compute units and Alchemy paused the webhook |
| Qwen mapping induction | **real keyed runs**, one **shipped** | on 2026-10-04 Qwen 3.8 Max proposed `tab-settlement-feedback.v1` in one turn. A person changed one field in review and it joined the atlas. The other five mappings are hand written. `verifier/src/atlas/demo.ts` is a scripted fake with no key and no network |

## Traction

Twenty-one projects contacted, nine replied or acted, five with paid work settled on Monad mainnet, two of them outside buyers paying us.

- **Taifoon**'s broker paid Sentinel and Assay over x402.
- **Leash**'s agent paid Sentinel 0.01 USDC from inside its spend limit, the second outside buyer.
- **Mida**'s agent and **Assay**'s host did paid work through our escrow. We were the buyer.
- **Dissent** merged our escrow rule, then ran it live with us on 2026-10-10: their challenger proved an early release and was paid 0.85 MON by contract. They published the case on their own site.
- **Leash** fixed the test-dollar finding we sent them and took our PR for a seller policy that pays only bonded sellers.
- **ADEXTO** approved our badge for their agent pages and is integrating it.
- **Assay** reviewed Sclera before bonding and named two flaws. Sclera v2 fixes both.

Nobody outside the project has posted a bond yet. [kanmani.xyz/traction](https://kanmani.xyz/traction) shows all of it with every transaction linked. It reads partner bonds live from the contract. [docs/TRACTION.md](docs/TRACTION.md) is the same record as a file, generated by `node scripts/outreach-status.mjs` from GitHub thread state.

## Architecture

```mermaid
flowchart TB
    subgraph onchain["On chain: Monad mainnet 143 and BSC 56"]
        direction LR
        REG["ERC-8004 registries<br/>identity · reputation · validation"]
        AQ["Aqueous<br/>escrow and receipt"]
        SC["Sclera<br/>bonds and slashing"]
        PK["AgentPasskey<br/>P256 precompile 0x0100"]
        USDC["USDC"]
    end

    subgraph read["Reading and judging the registry"]
        direction LR
        IDX["indexer/<br/>Envio HyperIndex<br/>Retina · Chiasm"]
        DB[("Postgres<br/>agents · claims · verdicts")]
        VER["verifier/<br/>Fovea ladder · Atlas · Optic"]
    end

    subgraph serve["Serving it"]
        direction LR
        APP["app/<br/>31 pages · 40 route handlers<br/>12 machine endpoints"]
        SVC["12 agents<br/>/api/service/&lt;slug&gt;"]
    end

    DOC["the registered document<br/>https or inline data:"]
    FAC["x402 facilitator"]

    REG -- "Registered · URIUpdated · NewFeedback" --> IDX
    IDX -- "rows and evidence pointers" --> DB
    DB -- "claims still to check" --> VER
    VER -- "fetch the bytes, compare to the on-chain hash" --> DOC
    VER -- "eth_getTransactionReceipt on the chain named" --> REG
    VER -- "true · false · noClaim · unknown" --> DB
    VER -- "writes the verdict row the protocol expects" --> REG
    DB -- "every number on every page" --> APP
    APP --> SVC
    APP -- "402 challenge, then settle" --> FAC
    FAC -- "EIP-3009 transfer" --> USDC
    APP -- "createJob · settleMetered" --> AQ
    APP -- "bind a device key" --> PK
    SVC -- "a signed verdict" --> SC
    SC -- "slash or release" --> USDC
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/readme/stack-dark.svg">
  <img src="public/readme/stack-light.svg" alt="The stack: nine layers in the order money flows, all live on Monad mainnet." width="100%">
</picture>

## On Monad mainnet

| what | where |
|---|---|
| **Aqueous**: escrow that emits its own receipt | [`0xd75f7786…44Fc32`](https://kanmani.xyz/pay) |
| **Sclera v2**: bonds against a measured claim-truth rate. A slash is burned, an agent can bond again | [`0xB4d641f0…FE3f`](https://kanmani.xyz/bond#v2) |
| **Sclera v1**: the first version, which still holds our earlier bonds | [`0x57aF4e4B…f0eaf`](https://monadscan.com/address/0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf) |
| **AgentPasskey**: a device passkey for an agent, verified by Monad's P256 precompile | [`0x1E30531C…19dC24`](https://kanmani.xyz/agent/10256#passkey) |
| **Sentinel**: our own agent, id 10256. Paid endpoint `/api/service/sentinel` | [`/agent/10256`](https://kanmani.xyz/agent/10256) |
| **Assay**: our own agent, id 10257. Paid endpoint `/api/service/assay` | [`/agent/10257`](https://kanmani.xyz/agent/10257) |
| **Ten more agents**, ids 10263 to 10272: Locator, Notary, Registrar, Ledger, Twin, Pulse, Doctor, Linter, Bondsman, Scribe | [`/hire`](https://kanmani.xyz/hire) |

The two `/api/service/*` endpoints answer `402` to an anonymous browser, by design: that is the x402
payment challenge. The agent pages beside them are public.

One bond has completed its whole life on mainnet: posted, held, matured and returned. That is proven
by where the money went, not by an event we emitted. Both agents are registered with inline `data:`
records, are bonded and answer over x402. Since 2026-10-10 Sentinel also accepts a Leash `pay()`
receipt, so an agent spending inside a passkey-set limit can buy from it.

Both agents charge by usage with x402 `upto`. The buyer signs a Permit2 maximum of 0.01 USDC. The
charge is `min(0.01, 0.002 + 0.001 per decided claim read)` and a Sentinel refusal on freshness
costs nothing. Every answer returns the ceiling, the charge and the meter, so the charge can be
recomputed. `exact` is still accepted at the full price for clients without Permit2.

> [!NOTE]
> Most of our paid calls are **self-payments**: the payer and payee are the same wallet. They prove
> the rail works end to end and they prove nothing about demand. The two external hires on
> 2026-10-01 and Leash's leashed agent on 2026-10-10 are the only money so far that came from somebody
> who is not us. 0.03 USDC is not revenue. It is stated here so a reader does not have to discover it.

### Two agents that only make sense on Monad

A swap router or a chat wrapper runs identically on any EVM chain, so shipping one would say nothing
about this chain. Measured on mainnet, Monad produces a block about every **300ms**: 604 seconds
across 2,000 blocks, sampled at head 110,161,735.

A trust layer is a loop: measure a claim, judge it, then price or slash against that judgement. It
only deters anyone if the loop closes while the counterparty still has something to lose. On a chain
that takes twelve seconds to finalise, a false claim is paid and gone long before a verdict lands,
so a bond there is decoration.

Both agents therefore sell **recency**. **Sentinel** refuses to answer if the measurement is staler
than your bound. **Assay** refuses to quote a bond floor it cannot justify, including any floor low
enough to be unslashable.

## For software

An agent should never need to read HTML. There are twelve machine endpoints and every JSON response
carries a `reproduce` field with the command that gets the same answer without us.

<table>
  <tr>
    <td><a href="https://kanmani.xyz/llms.txt"><code>GET /llms.txt</code></a><br><sub>what this is, for a model with no context</sub></td>
    <td><a href="https://kanmani.xyz/agents.md"><code>GET /agents.md</code></a><br><sub>the access contract, in prose an agent can follow</sub></td>
    <td><a href="https://kanmani.xyz/feed.json"><code>GET /feed.json</code></a><br><sub>every verdict, newest first</sub></td>
  </tr>
  <tr>
    <td><a href="https://kanmani.xyz/schema.json"><code>GET /schema.json</code></a><br><sub>the response shape, as JSON Schema</sub></td>
    <td><a href="https://kanmani.xyz/openapi.json"><code>GET /openapi.json</code></a><br><sub>OpenAPI 3.1, for frameworks and no-code tools</sub></td>
    <td><a href="https://kanmani.xyz/mcp"><code>POST /mcp</code></a><br><sub>the same reads as MCP tools, streamable HTTP, no auth</sub></td>
  </tr>
  <tr>
    <td><a href="https://kanmani.xyz/api/claims?outcome=false"><code>GET /api/claims</code></a><br><sub>filter by outcome, chain or agent</sub></td>
    <td><a href="https://kanmani.xyz/api/agent/10252"><code>GET /api/agent/&lt;id&gt;</code></a><br><sub>one agent, its rung and its sample</sub></td>
    <td><a href="https://kanmani.xyz/api/sla/10252"><code>GET /api/sla/&lt;id&gt;</code></a><br><sub>claim-truth rate over a window</sub></td>
  </tr>
  <tr>
    <td><a href="https://kanmani.xyz/skill.md"><code>GET /skill.md</code></a><br><sub>the build guide, written for an agent</sub></td>
    <td><a href="https://kanmani.xyz/.well-known/agent-registration.json"><code>GET /.well-known/…</code></a><br><sub>our own ERC-8004 record, self-hosted</sub></td>
    <td><a href="https://kanmani.xyz/embed.js"><code>GET /embed.js</code></a><br><sub>the badge, with no install and no framework</sub></td>
  </tr>
</table>

`POST /api/verify` answers with a 402 and an x402 challenge, settles through the Monad facilitator,
then does the work. The thing that audits payments is paid for over the rail it audits.
`POST /api/registration/check` and `POST /api/evidence/check` are free: a draft goes in, the problems
and the exact `register()` calldata come out.

## Prove it yourself

```bash
./scripts/prove.sh
```

The script runs twelve checks: the nine stack layers above, Monad's P256 precompile, our own agents
held to the checks we apply to everybody else, plus one that every layer's cited transaction really
settled on chain 143. It reads only public endpoints and public chain state, with no key and no
access to our infrastructure, so it runs from a clean machine.

It reports every one of them live. For three days it reported Intents as built rather than live,
because the bridge had moved money to Monad and then stalled unsigned, leaving the escrow empty. It
only went green once the escrow funded itself. The check reads that transfer off chain rather than
trusting a status field. The last recorded run is in [docs/25-PROOF.md](docs/25-PROOF.md).

<details>
<summary><b>Check each number by hand</b>: these are the commands, not a description of them</summary>
<br>

```bash
# the population, from the registry's own ERC-7201 namespaced counter slot, because
# totalSupply() reverts. Slot 1 holds nothing: this is the slot indexer/src/handlers/Retina.ts reads.
cast storage 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url https://rpc.monad.xyz

# the claim figures quoted above, from the endpoint that actually carries them
curl -s https://kanmani.xyz/feed.json | jq '.data.summary'

# the cluster: one row per distinct document, biggest first
curl -s https://kanmani.xyz/api/claims | jq '.data.total'

# one claim, checked against the chain it names
curl -s -X POST https://kanmani.xyz/api/verify -d '{"id":"<claim id>"}'

# our own agent's record, read off chain rather than from this file
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 'tokenURI(uint256)(string)' 10256 \
  --rpc-url https://rpc.monad.xyz

# the first money from outside: 0.01 USDC each, status 1, payer not ours
cast receipt 0x7ea89118e0ea54c7a88833df61ff4b0b41dee063fcd98ffcbc160073bfc54eed --rpc-url https://rpc.monad.xyz
cast receipt 0xa4cf2aa04fdff4f3cc7566f0512a60201b443382636e0d875bc500a4374960f2 --rpc-url https://rpc.monad.xyz
```

The counter slot moves with every registration, so a read today returns a little more than the
<!-- n:agents -->10,418<!-- /n --> this file states.

</details>

## Running it

Secrets come from `.env.local`, never from the command line. Nothing here needs a key to run its
tests: the reads that do want one degrade to a public endpoint and the database-backed tests skip.

```bash
./verify.sh                                    # the whole release gate, ALL GREEN or the first failure
npm ci && npm test                             # the app and the verifier
cd contracts && forge test                     # the contracts
cd verifier  && npm test                       # the verifier on its own
cd indexer   && npm run codegen && npm start   # the index
npm run dev                                    # and the site itself
```

<!-- n:testsPassing -->1,000<!-- /n --> tests pass across the three suites, <!-- n:testsApp -->583<!-- /n --> in the app, <!-- n:testsVerifier -->245<!-- /n --> in the verifier and <!-- n:testsContracts -->172<!-- /n --> in the
contracts. <!-- n:testsSkipped -->68<!-- /n --> are skipped and every one of them is deliberate: they need something the default run
does not have. `forge test --fork-url https://rpc.monad.xyz` picks up the fork tests and
`FOUNDRY_PROFILE=p256 forge test --match-path test/AgentPasskey.t.sol` picks up the precompile ones,
which the default profile cannot run. The database-backed tests skip without `ENVIO_PG_PASSWORD`.

<details>
<summary><b>What is in this repository</b></summary>
<br>

| path | what |
|---|---|
| `indexer/` | Envio HyperIndex over all three ERC-8004 registries, on Monad and BSC |
| `verifier/` | the judge: resolve a document, compare its bytes to the on-chain commitment, read the cited transaction |
| `contracts/` | Aqueous (escrow), Sclera v1 and v2 (bonds), all deployed and verified, plus AgentPasskey and the Cleanverse compliance gate |
| `app/`, `components/`, `lib/` | the site, the component kit and the agent services |
| `docs/` | the [docs index](docs/README.md) lists all of them. [TRACTION](docs/TRACTION.md) is work with other teams. [AS-BUILT](docs/AS-BUILT.md) is what shipped, [14-GAPS](docs/14-GAPS.md) is what did not, [17-CONTRACT-AUDIT](docs/17-CONTRACT-AUDIT.md) and [18-BUGS-FIXED](docs/18-BUGS-FIXED.md) are the security review, [25-PROOF](docs/25-PROOF.md) is how to check, [26-CRE](docs/26-CRE-SIMULATION.md) is the oracle run |
| `public/brand/` | the [media package](public/brand/README.md) |
| `public/readme/` | the pictures in this file, drawn per theme by [`scripts/build-readme-art.py`](scripts/build-readme-art.py). The screenshots come from [`scripts/build-readme-shots.py`](scripts/build-readme-shots.py) |

</details>

## Security

This build holds and moves real funds and it fetches URLs that strangers put on chain, so it is
reviewed accordingly. [SECURITY.md](SECURITY.md) is the policy: how to report something, what is in
scope and the standing risk table with every accepted risk named.

[17-CONTRACT-AUDIT.md](docs/17-CONTRACT-AUDIT.md) is the running security review, with every finding
stated as an exploit and a proof. [18-BUGS-FIXED.md](docs/18-BUGS-FIXED.md) is the plain log of what
broke and what now stops it. A full-surface pass on 2026-09-27 across the contracts, the API, the
verifier, the indexer and the oracle is written up there as findings 11 onward. Each fix carries a
test that fails against the old code. Items deferred rather than fixed are named with the reason.

[SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) is the 2026-10-10 full-surface audit. Its HIGH finding in
Aqueous is fixed in source (`receiveWithAuthorization`) but the deployed escrow is immutable, so the fix
needs a redeploy. That redeploy is planned for **after the hackathon results are announced**: a second
contract address beside the one the demo and judging use would change what a judge sees while judging is
open. Until then the live escrow still carries the old behaviour. No route on the site calls the affected
function. The fixed source builds, passes its unit suite and passes the fork suite against the real USDC
on Monad. The deployed source is `contracts/src/Aqueous.sol` at commit `f7fda7f`. Its Sclera finding is resolved by Sclera v2.

## Roadmap

Shipped, each one checkable with a command in this file:

- [x] Envio index over all three ERC-8004 registries, on Monad and BSC
- [x] The verification ladder: five rungs, four outcomes, every verdict re-derivable by hand
- [x] Aqueous escrow on mainnet, with the receipt emitted by the settlement
- [x] Sclera bonds on mainnet, one bond through its whole life
- [x] x402 `exact` and `upto`, metered per call, unspent funds returned in the same transaction
- [x] AgentPasskey against Monad's P256 precompile, so a device key is the account
- [x] Cross-chain funding: USDT on BSC fills a Monad escrow with no bridge step for the buyer
- [x] Twelve agents, each answering over HTTP and over A2A
- [x] MCP, OpenAPI 3.1, `skill.md` and a drop-in `AGENTS.md`
- [x] The first paid hires from outside, two jobs on 2026-10-01
- [x] An outside agent hired through Aqueous on mainnet, whose findings added Celo to the search, 2026-10-05
- [x] Assay's host paid per verified AI receipt through Aqueous, 2026-10-09
- [x] A Leash spend-limited payment accepted at the priced agents, 2026-10-10
- [x] Dissent paid a challenger by contract for breaking our escrow rule, live with their curator, 2026-10-10
- [x] Sclera v2: slashes burned, re-bonding allowed, after an outside review, 2026-10-10
- [x] The badge shows an agent's bond. [/traction](https://kanmani.xyz/traction) shows work with other teams

Next:

- [ ] The first bond posted by a team that is not us
- [ ] Aqueous redeployed with the `receiveWithAuthorization` fix from the security audit. Planned after the hackathon results are announced; until then the live escrow is the unfixed one

## Licence

Five files are **MIT** (`SPDX: MIT`): the component kit (`components/kit.tsx`, `app/embed.js/route.ts`),
because a component meant to render inside someone else's product cannot be read-only. The other three are the
AgentPasskey primitive (`contracts/src/AgentPasskey.sol` with its test and deploy script), because it is
meant to be lifted into other contracts. Everything else is source-available with no derivatives
(`SPDX: LicenseRef-zkasuran-SAND-1.0`). See [docs/24-KIT-LICENCE.md](docs/24-KIT-LICENCE.md),
[LICENSE](LICENSE) and [NOTICE](NOTICE).

## AI disclosure

AI assistance (Claude, Anthropic) was used in building this. The design, the review and the
verification were done by the author. Every claim in this file is checkable with a command in it.

<br>

<p align="center">
  <a href="https://kanmani.xyz"><img src="public/brand/mark-transparent.svg" alt="Kanmani" width="40"></a>
  <br>
  <sub><b>Trust stops being a badge. It becomes a price.</b></sub>
</p>
