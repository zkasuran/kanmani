# Retina: the Kanmani indexer

Retina follows the ERC-8004 agent identity and reputation registries on Monad and BSC and turns
their logs into the rows the rest of Kanmani reads. It is built on Envio HyperIndex (`envio` 3.10.0)
with HyperSync as the data source for both chains.

It is in the project because the one pointer Kanmani exists to check is reachable no other way.
`feedbackURI` and `feedbackHash` are non-indexed fields of the `NewFeedback` event. `readFeedback()`
does not return them either (`config.yaml:76-81`, `schema.graphql:94-95`). The only path to the
evidence pointer is the log itself. On a 104M-block head where `eth_getLogs` caps at a 100-block
span, a stranger cannot cheaply backfill those logs, so an indexer is required rather than a
convenience.

## What it indexes

Three registries, on both chains, at the same addresses (`config.yaml:49-140`):

| Contract | Address | Events |
| --- | --- | --- |
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `Transfer`, `Registered`, `MetadataSet`, `MetadataUpdate`, `URIUpdated` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `NewFeedback`, `FeedbackRevoked`, `ResponseAppended` |
| ValidationRegistry | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `ValidationRequest`, `ValidationResponse` |

Two measured facts shaped that list, both read off the chain (`config.yaml:16-31`):

- The Identity Registry is not enumerable. `totalSupply()` reverts, so population is read from a
  storage slot by the `onBlock` worker rather than counted from events.
- The deployment emits four events per registration, one more than the ERC-8004 draft lists. The
  extra one is the ERC-4906 `MetadataUpdate`. Indexing only the draft's three would lose every
  transfer plus every metadata refresh.

## The schema

The entities live in `schema.graphql`. The shape is deliberate, not incidental.

- `AgentRecord` is deduplicated by the content hash of the registration document
  (`schema.graphql:55-78`). That is why the 78.94% of Monad agents that share one dead URL collapse to
  a single row rather than 8,093 near-identical ones.
- `Feedback` is the load-bearing entity (`schema.graphql:94-119`). It carries the evidence pointer no
  contract read returns.
- `IndexState` keeps a nullable `counterSlotCount` on purpose (`schema.graphql:212-223`). A failed
  slot read publishes unknown, never zero, because unknown is not a measurement.
- `ChiasmRecord` plus `ChiasmPresence` are the two `@crossChain` entities
  (`schema.graphql:151-210`). They merge a document referenced from more than one chain onto one row,
  keyed on the same content hash `AgentRecord` uses.

Two naming traps the schema records, both worth keeping:

- The entity is `AgentRecord`, not `Record`, so it does not shadow TypeScript's built-in `Record`
  (`schema.graphql:46-54`).
- No per-chain entity may declare its own `chainId` field. Envio appends that column itself under
  `disable_default_cross_chain: true`, so a hand-declared one is rejected (`schema.graphql:14-18`).

## The handlers

- `src/handlers/Retina.ts` registers the per-chain event handlers plus the `PopulationCheck`
  `onBlock` worker (`Retina.ts:742`). The worker reads the registry counter slot through an Envio
  Effect (`readAgentCount`, `createEffect`, `Retina.ts:123`) rather than from a handler, so the RPC
  read is cached and deduplicated across the preload pass.
- `src/handlers/Chiasm.ts` writes the cross-chain merge rows. The foreign key it writes from
  `ChiasmPresence` to `ChiasmRecord` is `record_id` (`Chiasm.ts:73`).

Two mechanics a reader needs. Handlers self-register by importing `indexer` from `envio`, so there
is no per-contract `handler:` key in HyperIndex v3 (`config.yaml:9-12`). Envio runs handlers twice,
once in a parallel preload pass then once sequentially, so every write is idempotent by construction
(`Chiasm.ts:30-33`).

## HyperSync

HyperSync is the sync source for both chains, so no RPC endpoint is configured for the sync path
(`config.yaml:31-38`). Monad keeps `start_block: 0` because HyperSync fast-forwards to the first
block carrying registry data, which is the only practical way to find the deployment block when the
public RPC keeps a limited state window. BSC pins `start_block: 79027268`, the proxy deployment
block, so the scan skips 79M empty blocks (`config.yaml:127-131`).

The one place an RPC is used is the counter-slot read in the Effect. It fails closed to unknown
rather than guessing (`Retina.ts:111-190`). That read is configurable through `MONAD_RPC_URL` and
`BSC_RPC_URL`, falling back to the public endpoints, because a missing key should degrade the
cross-check rather than break indexing (`Retina.ts:53-66`).

## Run it self-hosted

The app reads Postgres directly, so Hasura stays off. The commands below match the box deploy.

```bash
# a Postgres for Envio to write to, plus the HyperSync token for higher rate limits
export ENVIO_PG_HOST=127.0.0.1 ENVIO_PG_PORT=5432 ENVIO_PG_USER=... ENVIO_PG_PASSWORD=... ENVIO_PG_DATABASE=...
export ENVIO_API_TOKEN=...        # Envio HyperSync token
export ENVIO_HASURA=false         # the app queries Postgres, not Hasura
export TUI_OFF=true               # no interactive terminal UI on a server

pnpm install
pnpm codegen                      # generates the typed handlers and the schema tables

# local, with a Docker Postgres Envio brings up itself
pnpm dev

# or native against an external Postgres, the way the box runs it
node node_modules/envio/bin.mjs start
```

If `public` already holds Envio's checkpoint tables, `start` resumes from them in seconds rather than
re-indexing. A change to `config.yaml` or `schema.graphql` forces a full resync from the start block.
Running two indexers against one Postgres needs a per-project `ENVIO_PG_SCHEMA` plus
`ENVIO_INDEXER_PORT`, see the local-parallel notes in the Envio skills.

## Querying it

The app reads Postgres directly (`ENVIO_HASURA=false`), so a reader confirms freshness with the same
two numbers `/status` shows:

```sql
-- how far each chain has processed, from Envio's own view
SELECT chain_id, block_height, latest_processed_block, num_events_processed
FROM public.chain_metadata ORDER BY chain_id;

-- how many agents Retina holds, per chain
SELECT "chainId", count(*) FROM "Agent" GROUP BY "chainId" ORDER BY "chainId";
```

An exact per-event-name count needs Envio's `raw_events` table, which is off by default to save a
write on every log. Turning it on is one line in `config.yaml` (`rawEvents: true`) plus a resync from
the start block. Until then `/status` shows rows-written-per-handler, labelled as such, rather than a
raw log count.

## Licence

SAND-1.0 (`LicenseRef-zkasuran-SAND-1.0`), the default outbound licence for a competition entry.

