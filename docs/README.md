# Docs

Every document that ships with Kanmani, grouped by what it answers. The code is the source of truth
and these explain it. Where a doc states a number, the number is reproducible by the command the doc
names.

## Ground truth and the thesis

| doc | what it covers |
|---|---|
| [01-GROUND-TRUTH](01-GROUND-TRUTH.md) | the live chain facts the build rests on, each read from an RPC not from a page |
| [02-THESIS](02-THESIS.md) | why hash integrity is not claim truth, the one idea the whole project turns on |
| [03-POPULATION](03-POPULATION.md) | what the registered agents on Monad actually are, measured |
| [AS-BUILT](AS-BUILT.md) | what shipped, component by component |
| [TRACTION](TRACTION.md) | every project contacted, what came back and the transaction for anything settled. Also at [kanmani.xyz/traction](https://kanmani.xyz/traction) |

## The verification ladder

| doc | what it covers |
|---|---|
| [04-VERIFICATION-LADDER](04-VERIFICATION-LADDER.md) | the rungs from declared to settled and what each one can and cannot say |
| [16-METHOD](16-METHOD.md) | how to reproduce every published number by hand |
| [25-PROOF](25-PROOF.md) | what each layer actually is, checked against public chain state |
| [14-GAPS](14-GAPS.md) | what the build does not do yet, stated plainly rather than hidden |

## Integration notes

| doc | what it covers |
|---|---|
| [19-NANSEN](19-NANSEN.md) | turning a registration wallet into its known entity and labels |
| [20-CLEANVERSE](20-CLEANVERSE.md) | identity coupled to settlement |
| [21-MERA-UX](21-MERA-UX.md) | one passkey, a scoped session and a gasless Monad transaction |
| [22-AURORA](22-AURORA.md) | funding a Monad job from any chain through Intents Connect |
| [23-ADDING-A-CHAIN](23-ADDING-A-CHAIN.md) | what it takes to index and verify a new chain |
| [26-CRE-SIMULATION](26-CRE-SIMULATION.md) | the Chainlink CRE slashing oracle, recorded simulation |
| [27-ATLAS-INDUCTION](27-ATLAS-INDUCTION.md) | what Qwen 3.8 Max does in the atlas induction loop |
| [28-X402-UPTO](28-X402-UPTO.md) | the x402 upto scheme on Monad, signing a maximum and settling less |
| [29-AGENT-PASSKEY](29-AGENT-PASSKEY.md) | a device passkey for an agent, verified by Monad's P256 precompile |
| [32-PRF-PRIMITIVES](32-PRF-PRIMITIVES.md) | the four keys derived from one passkey ceremony, HKDF-SHA256 and AES-256-GCM, audited against the source |
| [36-COMPLIANCE](36-COMPLIANCE.md) | the `/compliance` page and the on-chain CVI read behind it |
| [37-TESTNET](37-TESTNET.md) | the sponsored mint and the paid check settled in TestUSDC on Monad testnet |
| [38-PAY-RUNS](38-PAY-RUNS.md) | time to first transaction, recorded as runs each tied to a real settlement |
| [40-ALCHEMY](40-ALCHEMY.md) | the signed webhook that re-verifies a repaired document on its own |

## Developer surfaces

| doc | what it covers |
|---|---|
| [33-MCP](33-MCP.md) | Kanmani as an MCP server: the five tools, the transport and how to connect |
| [34-EVIDENCE-CHECK](34-EVIDENCE-CHECK.md) | the two free checks that run before anything reaches the chain |
| [35-MACHINE-SURFACES](35-MACHINE-SURFACES.md) | every GET surface served for software, including `/openapi.json` and `/skill.md` |
| [39-RECEIPTS](39-RECEIPTS.md) | the receipt endpoints, including why one of them verifies receipts that are not ours |

## The agents

| doc | what it covers |
|---|---|
| [30-AGENTS](30-AGENTS.md) | the twelve agents Kanmani runs as paid services, each with its slug, price ceiling and ERC-8004 id |
| [31-SELF-AUDIT](31-SELF-AUDIT.md) | every agent Kanmani operates, checked by Kanmani |

## Security review

| doc | what it covers |
|---|---|
| [17-CONTRACT-AUDIT](17-CONTRACT-AUDIT.md) | the running security review, every finding stated as an exploit and a proof |
| [18-BUGS-FIXED](18-BUGS-FIXED.md) | bugs found and fixed, with the exploit kept rather than summarised |
| [SECURITY-AUDIT](SECURITY-AUDIT.md) | the 2026-10-10 full-surface audit: what was fixed in the tree and what needs a redeploy |

## Reference

| doc | what it covers |
|---|---|
| [10-API](10-API.md) | the public API surface |
| [24-KIT-LICENCE](24-KIT-LICENCE.md) | the licence carve-out for the component layer |
| [41-BLOG](41-BLOG.md) | the five posts under `/blog` and which doc each one companions |
