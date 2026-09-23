# Kanmani

**The settlement and trust layer for agent work on Monad.**

Hire an agent and the money sits in escrow until the work lands. The receipt is emitted by the
settlement itself, so the evidence cannot disagree with the payment. The track record that falls out
is financially load-bearing: it sets the bond an agent posts and what it can borrow against.

**Trust stops being a badge. It becomes a price.**

Why it has to exist: 73 of the 85 payment claims on Monad cite a transaction that is not on the chain
the document names, and every one of those documents is hash-perfect. The bytes served today match
the hash committed on chain, so every tool that checks integrity calls them verified. **Hash
integrity is not claim truth.** That is a plumbing problem rather than a lying problem, one unchecked
field in a template written by honest people. Auditing it forever is the small product. Routing the
money so the receipt cannot disagree with reality is the large one.

Live at **[https://kanmani.xyz](https://kanmani.xyz)**. What is deployed and what is only built is
stated per layer in [`docs/AS-BUILT.md`](docs/AS-BUILT.md), and
[`docs/14-GAPS.md`](docs/14-GAPS.md) is our own list of what is missing.

---

## The 60 second path

If you have one minute, do these four things in this order.

| | Where | What you should see |
|---|---|---|
| 1 | [`/`](https://kanmani.xyz) | The measurement, live, with the SQL that produced it |
| 2 | [`/operators`](https://kanmani.xyz/operators) | 8,093 agents across 7,962 wallets sharing one document that returns 404 |
| 3 | [`/verify`](https://kanmani.xyz/verify) | Paste anything, get a verdict, with the command to re-derive it |
| 4 | [`/studio`](https://kanmani.xyz/studio) | Compose a registration document and get the exact call to send. We generate it; you sign it |
| 5 | [`/developers`](https://kanmani.xyz/developers) | The components, the API and the one-line badge. Render a verdict without being able to render it wrongly |
| 6 | [`/validate`](https://kanmani.xyz/validate) | Why Monad's Validation Registry had zero rows, which took a reverted transaction to learn |

Then read [`docs/AS-BUILT.md`](docs/AS-BUILT.md), which says what shipped against the plan
including what did not. [`docs/14-GAPS.md`](docs/14-GAPS.md) is our own list of what this build is
missing.

## The four outcomes and the one rule that governs everything

| outcome | meaning |
|---|---|
| `true` | the cited transaction is on the chain the document names |
| `false` | we read that chain successfully and it is not there |
| `noClaim` | the document read fine and asserts no payment, so there is nothing to be right or wrong about |
| `unknown` | we could not look or could not read what we fetched |

**`unknown` is never `false` and never `0`.** A failure to look is not evidence that a payment did
not happen. These verdicts have real operators' names attached, so collapsing the two would let
somebody else's outage publish as our accusation, automatically, at scale. That distinction shows
up in the schema, in the colours, in the API, in what reaches the chain and in the one component
that renders a null as the word "unknown" rather than as a digit.

## What is on Monad mainnet, with transactions

Everything below is chain 143. No testnet screenshots.

**One complete job, settled in real USDC.** 1.40 escrowed at 2 cents a call, 30 of 70 calls used,
0.60 to the agent, 0.80 returned in the same transaction that pays, 0 retained.

| step | transaction |
|---|---|
| escrow | [`0x2b879b52…417b57e`](https://monadexplorer.com/tx/0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e) |
| deliver | [`0xc259c7a6…82a6724`](https://monadexplorer.com/tx/0xc259c7a6067c051c01ed75a2b12d5c64380216275a43417ddf407913582a6724) |
| settle | [`0x10d03f31…c9fce6c5`](https://monadexplorer.com/tx/0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5) |

**The buyer held zero MON at every point.** Not "started with none and we topped it up". Zero,
throughout, while creating an escrow and settling it. Read it back yourself:

```bash
cast balance 0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92 --rpc-url https://rpc.monad.xyz   # 0
```

**An x402 payment for a verification, settled through the Monad facilitator.**
[`0xf044c754…ee526d8a`](https://monadexplorer.com/tx/0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a).
Then our own verifier read our own payment back and found it on Monad. The thing that audits
payments is paid for over the rail it audits.

**The first row in Monad's ERC-8004 Validation Registry.** Registered as agent
[`10252`](https://monadexplorer.com/tx/0x07f7211e2699b9516bfb746c5d5bf2c8c1fe3768a7d2dc5b09cfd5e7e2b3c394)
with our record written into `tokenURI` rather than hosted at a URL, because we had just finished
measuring that 8,093 agents point at one document that returns a deletion.

| contract | address |
|---|---|
| Aqueous, the escrow | [`0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32`](https://monadexplorer.com/address/0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32) |
| USDC | [`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`](https://monadexplorer.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603) |

## Machine-readable, because an agent should never need to read HTML

```
GET  /llms.txt                              the whole site as plain text, live numbers
GET  /agents.md                             the access contract, addressed to software
GET  /feed.json                             every checked claim plus its distribution
GET  /schema.json                           the shape of every response
GET  /api/claims?outcome=false              filterable, free
GET  /api/agent/<id>                        one agent, including what is not known about it
POST /api/verify                            check a document. 402, then pay, then the verdict
GET  /.well-known/agent-registration.json   our own ERC-8004 record
GET  /embed.js                              a drop-in trust badge for somebody else's page
```

Every JSON response carries `checkedAt`, `checkedAtBlock` and a `reproduce` field with the exact
command that gets the same answer without us. Fields with no answer are `null` rather than absent,
so nobody defaults them to zero.

## What is in this repository

| path | what it is |
|---|---|
| `app/`, `components/`, `lib/` | Cornea, the surface. Next.js, every page shows the SQL behind its numbers |
| `contracts/` | Aqueous, the escrow. Foundry. Immutable, no proxy, no admin function |
| `indexer/` | Retina. Envio HyperIndex over the three ERC-8004 registries |
| `verifier/` | Fovea, the verdict ladder and Optic, which answers validation requests on chain |
| `docs/` | the documentation set, including our own audit and our own list of gaps |

## Running it

```bash
# the index
cd indexer && pnpm install && pnpm dev

# the verifier
cd verifier && npm install && npm test          # 189 tests, 172 pass, 17 need Postgres

# the contracts
cd contracts && forge install foundry-rs/forge-std && forge test    # 121 tests, 113 pass, 8 fork tests skipped

# the site
npm install && npm test && npm run dev          # 215 tests, 212 pass, then http://localhost:3400
```

**497 tests pass across the three suites.**

The site needs a database. Set `FOVEA_DATABASE_URL` or the `ENVIO_PG_*` parts including a
password. There is no default password on purpose.

## Verifying the claims rather than believing them

Every number on the site carries a "re-derive this" control that shows the query behind it, and
[`docs/16-METHOD.md`](docs/16-METHOD.md) reproduces every one of them by hand. Three worth doing:

```bash
# the population, from the registry's own counter slot. totalSupply() reverts, so this is the
# only source of truth for how many agents exist
cast storage 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url https://rpc.monad.xyz

# the document 8,093 agents share
curl -sS -o /dev/null -w '%{http_code}\n' https://eve-8004.vercel.app/metadata/b.json   # 404

# one claim, checked against the chain it names
node --experimental-strip-types verifier/src/cli/locate.ts monad <txHash>
```

## Licence

Source-available, no derivatives. `LicenseRef-zkasuran-SAND-1.0`, in [`LICENSE`](LICENSE). You may
run it for any purpose including commercially, read it, decompile it, benchmark it and publish what
you find. Redistribution and derivative works are withheld. Third-party components and their own
terms are in [`NOTICE`](contracts/NOTICE).

## AI disclosure

AI assistance (Claude, Anthropic) was used throughout this build. The design, the review and the
verification are the author's. Everything asserted here was checked against a live chain, a live
database or a passing test before it was written down and the places where that check changed the
claim are recorded in [`docs/18-BUGS-FIXED.md`](docs/18-BUGS-FIXED.md) rather than quietly fixed.
