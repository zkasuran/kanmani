/**
 * The build guide, written once and served in every format a tool reads.
 *
 *   /skill.md          agentskills.io SKILL.md: Claude Code, Codex, Hermes, Goose, OpenCode and any
 *                      runtime that loads skills. Frontmatter plus body.
 *   /build/AGENTS.md   drop-in for a repo root. Codex, Cursor, Windsurf, Copilot, Gemini CLI, Aider,
 *                      Zed, Jules and friends read AGENTS.md.
 *   /llms.txt          the build section is appended, for anything that only reads llms.txt.
 *
 * One source so they cannot disagree. Every command here was run against the live API before it was
 * written down. The reference test in lib/build-guide.test.ts keeps the endpoints it names real.
 */
import { IDENTITY_REGISTRY } from "./registration.ts";

export const SKILL_NAME = "kanmani-erc8004-agent";
export const SKILL_DESCRIPTION =
  "Create, register and verify an ERC-8004 agent on Monad with Kanmani: build a registration document that cannot go dead, get the exact register() transaction, check its gas and test evidence documents against the real verifier before publishing. Use when building, registering, repointing or debugging an ERC-8004 agent or its reputation evidence.";

export function buildGuide(site: string): string {
  return `# Build an ERC-8004 agent on Monad with Kanmani

Kanmani checks whether what ERC-8004 agents claim actually happened on chain. These steps get a new
agent registered so its record holds up when it is checked. Everything below is free and needs no key.

You never give Kanmani a key. It returns the exact transaction and you sign it with the agent's own.

## Rules that are not optional

1. **The agent's own key sends the registration.** The registry makes \`msg.sender\` the owner, so a
   relayer, a service or Kanmani sending it would own your agent. Use a dedicated key holding only a
   little MON: \`data.gas.need\` in step 1 says how much, measured at the moment you ask.
2. **Never paste a private key into a chat, a prompt, a file in the repo or a log.** Read it from an
   environment variable (\`AGENT_PRIVATE_KEY\`) or a keystore. Add the env file to \`.gitignore\`.
3. **Put the document on chain** (\`kind: "data"\`, the default). 8,640 Monad agents point at hosted
   documents that now return a deletion. A \`data:\` URI cannot go dead.
4. **Evidence must name the network the payment settled on.** Most Monad claims that fail name
   \`monad\` for a payment made on another chain (live counts at /claims). Check every evidence document before publishing.
5. **\`unknown\` is not \`false\`.** It means undecided. Do not treat it as a failure.

## Step 1: check the registration and get the transaction

\`\`\`bash
curl -s -X POST ${site}/api/registration/check \\
  -H 'content-type: application/json' \\
  -d '{
    "draft": {
      "name": "Scout",
      "description": "Finds agents worth hiring on Monad",
      "url": "https://example.com",
      "skills": [{ "id": "scout", "endpoint": "https://example.com/api/scout", "x402": false }],
      "refuses": ["custody of funds"]
    },
    "sender": "0xYOUR_AGENT_ADDRESS"
  }'
\`\`\`

\`sender\` is optional. The calldata does not depend on it; it only adds the gas check.

- \`data.ready\` is about the document only. If false, fix everything in \`data.problems\` and check again.
- \`data.canSend\` is \`ready\` plus gas: \`true\` means send, \`false\` means fund \`sender\` with \`data.gas.short\`
  first, \`null\` means no sender was given or gas could not be read (the chain will decide).

When it is ready:

- \`data.transaction\` is \`{ chainId: 143, to: "${IDENTITY_REGISTRY}", function, data, value: "0" }\`
- \`data.gas\` says whether \`sender\` can pay. If \`state\` is \`"short"\`, fund it with \`data.gas.short\` first.
- \`data.consequences\` says what each field implies (can take a payment, has a callable endpoint, ...).
- \`data.send.cast\` is a ready command.

To repoint an agent you already own, add \`"agentId": "<id>"\` next to \`draft\`. The transaction becomes \`setAgentURI\`.

Every field of the request body:

| field | where | required | meaning |
|---|---|---|---|
| \`draft.name\` | inside \`draft\` | yes | what the agent is called |
| \`draft.description\` | inside \`draft\` | no | one sentence a buyer can read |
| \`draft.url\` | inside \`draft\` | no | the operator's site |
| \`draft.skills[]\` | inside \`draft\` | no | \`{ id, endpoint, x402 }\`, up to 32 |
| \`draft.refuses[]\` | inside \`draft\` | no | what it will not do |
| \`kind\` | next to \`draft\` | no | \`"data"\` (default, on chain) or \`"https"\` (you host it) |
| \`hostedAt\` | next to \`draft\` | with \`https\` | the absolute https URL of your hosted document |
| \`agentId\` | next to \`draft\` | no | a decimal string, only to repoint an agent you own |
| \`sender\` | next to \`draft\` | no | the address that will send, for the gas check |
| \`chainId\` | next to \`draft\` | no | 143, the only chain with a registry here |

The registry at \`${IDENTITY_REGISTRY}\` is a proxy (its own code is small by design). Check it on
https://monadexplorer.com/address/${IDENTITY_REGISTRY} before sending if you want to verify it yourself.

## Step 2: sign and send it with the agent's own key

Foundry:

\`\`\`bash
cast send ${IDENTITY_REGISTRY} <data.transaction.data> \\
  --rpc-url https://rpc.monad.xyz --private-key "$AGENT_PRIVATE_KEY"
\`\`\`

viem (TypeScript):

\`\`\`ts
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const monad = defineChain({ id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } });
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);
const r = await fetch("${site}/api/registration/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft, sender: account.address }) }).then((x) => x.json());
if (!r.data.ready) throw new Error(r.data.problems.join("; "));
const hash = await createWalletClient({ account, chain: monad, transport: http() }).sendTransaction({ to: r.data.transaction.to, data: r.data.transaction.data });
const receipt = await createPublicClient({ chain: monad, transport: http() }).waitForTransactionReceipt({ hash });
const agentId = BigInt(receipt.logs.find((l) => l.address.toLowerCase() === r.data.transaction.to.toLowerCase() && l.topics.length === 4)!.topics[3]!);
\`\`\`

web3.py (Python):

\`\`\`python
import os, requests
from web3 import Web3
w3 = Web3(Web3.HTTPProvider("https://rpc.monad.xyz"))
acct = w3.eth.account.from_key(os.environ["AGENT_PRIVATE_KEY"])
r = requests.post("${site}/api/registration/check", json={"draft": draft, "sender": acct.address}).json()["data"]
assert r["ready"], r["problems"]
tx = {"to": r["transaction"]["to"], "data": r["transaction"]["data"], "chainId": 143,
      "nonce": w3.eth.get_transaction_count(acct.address), "gas": w3.eth.estimate_gas({"from": acct.address, "to": r["transaction"]["to"], "data": r["transaction"]["data"]}),
      "maxFeePerGas": w3.eth.gas_price * 2, "maxPriorityFeePerGas": w3.eth.max_priority_fee}
h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
receipt = w3.eth.wait_for_transaction_receipt(h)
agent_id = int(next(l for l in receipt.logs if l.address.lower() == r["transaction"]["to"].lower() and len(l.topics) == 4).topics[3].hex(), 16)
\`\`\`

No code at all: ${site}/account#agents does the same in a browser, from a passkey or a wallet.

## Step 3: confirm it

\`\`\`bash
curl -s ${site}/api/agent/<agentId>          # what Kanmani measures about it (indexed within about a minute)
curl -s ${site}/api/account/<address>        # every agent that address owns, with balances
\`\`\`

## Step 4: check evidence before you publish it

When your agent does paid work, the feedback it receives (or gives) carries an evidence document. Check
it first. Send the document itself; this endpoint never fetches URLs.

\`\`\`bash
curl -s -X POST ${site}/api/evidence/check -H 'content-type: application/json' -d '{
  "document": {
    "network": "monad",
    "proof_of_payment": { "network": "monad", "payment_tx": "0x<64 hex settlement tx>" },
    "rating": { "score": 90, "target_address": "0x<who was paid>" }
  }
}'
\`\`\`

\`data.outcome\` is what the published document will get. It is a **string**: compare it with
\`=== "true"\`, never test it for truthiness, because \`"false"\` and \`"unknown"\` are truthy strings too.

| outcome | meaning | what to do |
|---|---|---|
| \`true\` | the payment is on the named chain and reached the named recipient | publish |
| \`false\` | not on the named chain | read \`data.foundOnChain\` and \`data.advice\`; usually fix \`network\` |
| \`noClaim\` | the document asserts no payment | fine for a plain rating; add the payment if it was paid work |
| \`unknown\` | could not decide (often an unrecognised shape) | use the shape above |

\`data.rung\` is how far down the check got (declared, resolvable, intact, parsed, true), \`data.mapping\` names
the document shape it was read as and \`data.foundOnChain\` is \`null\` unless a \`false\` was found on another
chain. The \`intact\` rung compares the bytes with the hash committed on chain, so it is only decided after
publishing: ${site}/method explains every rung.

The shape above is one the verifier reads today. \`network\` is the chain the payment settled on,
\`payment_tx\` the settlement transaction (not an approval or bridge leg), \`target_address\` who was paid.

## Step 5 (optional): take payments over x402

Declare \`"x402": true\` on a skill whose endpoint answers HTTP 402. Monad's facilitator
(https://x402-facilitator.molandak.org) supports \`exact\` and \`upto\` on chain 143. Kanmani's own agents
are working examples: \`GET ${site}/api/service/sentinel\` returns their 402 challenge.

## Every other way in

- MCP server (streamable HTTP, no auth): \`${site}/mcp\`. Tools: check_registration, check_evidence,
  get_agent, get_account, list_claims.
- OpenAPI 3.1: \`${site}/openapi.json\`, for agent frameworks, GPT Actions, n8n, Zapier, Make, Dify.
- A2A agent card: \`${site}/.well-known/agent-card.json\`.
- Everything else: \`${site}/llms.txt\`, \`${site}/agents.md\`, \`${site}/developers#build\`.
`;
}

/**
 * agentskills.io SKILL.md: YAML frontmatter with name and description, then the guide.
 *
 * The description is written as a JSON string, which is valid YAML. Unquoted, its ": " made strict
 * YAML parsers reject the whole file, so a skill loader would have silently skipped it.
 */
export function skillMd(site: string): string {
  return `---
name: ${SKILL_NAME}
description: ${JSON.stringify(SKILL_DESCRIPTION)}
license: MIT
metadata:
  homepage: ${site}
  version: "1"
---

${buildGuide(site)}`;
}

/** A drop-in AGENTS.md for the root of a repo that builds an ERC-8004 agent. */
export function agentsMdDropIn(site: string): string {
  return `# AGENTS.md

This repository builds an ERC-8004 agent registered on Monad (chain 143). Follow the steps below when
creating, registering or changing the agent. Follow them too when producing reputation evidence.

Source of truth for these instructions: ${site}/skill.md (fetch it for the latest version).

${buildGuide(site).replace(/^# .*\n/, "")}`;
}
