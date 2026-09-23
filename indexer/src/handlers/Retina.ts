/**
 * Retina. Captures everything arriving on the ERC-8004 registries and turns it into signal.
 *
 * Four measured facts drive the shape of this file, each one found by reading the chain rather
 * than the spec:
 *
 *   1. `Registered` can carry an EMPTY agentURI. The canonical IdentityRegistryUpgradeable has
 *      three register() overloads and the no-argument one emits `Registered(agentId, "", sender)`.
 *      An indexer that reads the URI only from this event holds nothing for those agents.
 *
 *   2. The registry is NOT enumerable. `totalSupply()` reverts, so the population lives in a
 *      storage slot. `onBlock` reads it and publishes it beside what the logs produced, so a
 *      gap reads as "the index is behind" rather than "these agents do not exist".
 *
 *   3. 8,093 of 10,252 agents (78.94%) share ONE tokenURI, a deleted Vercel deployment. Records
 *      are deduplicated by content so the cluster becomes a first-class number instead of 8,093
 *      copies of a dead string.
 *
 *   4. `feedbackURI` and `feedbackHash` exist ONLY as non-indexed fields of `NewFeedback`.
 *      `readFeedback()` does not return them and eth_getLogs caps at a 100-block span on free
 *      Monad RPC against a 104M-block head. Without this indexer the verifier is impossible.
 *
 * Two chains now, Monad 143 and BSC 56, with the same three registries at the same addresses and
 * unrelated populations. Everything in this file stays per-chain: entity IDs carry the chain and
 * chain 143 produces the same IDs it always did. The one place the chains meet is ./Chiasm.ts,
 * called from the `Registered` handler.
 */
import { indexer, createEffect, S } from "envio";
import { recordReferral } from "./Chiasm";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Storage slot holding the registration counter, since totalSupply() reverts. */
const COUNTER_SLOT =
  "0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00";

/**
 * Per-chain wiring for the population cross-check. The registries sit at the same three
 * addresses on both chains, verified on chain rather than taken from a deployment list, so the
 * only thing that actually differs here is which node to ask. See config.yaml for the reads.
 *
 * Keyed by the literal chain ids from config.yaml, so a chain added there without a line here is
 * a type error in the onBlock `where` below rather than a silent gap.
 *
 * Both URLs are overridable and both fall back to a public endpoint. Overridable is NOT because
 * a dedicated endpoint fixes the sweep failures. That was the theory and it is wrong: swapping
 * the public Monad endpoint for a dedicated one left the failure count unchanged, 3,705 against
 * 3,869, which is what proved the cause was sweep volume rather than the endpoint. The `_gte`
 * floor on PopulationCheck is the fix. This stays configurable because hardcoding one provider's
 * URL is its own problem.
 *
 * The Monad URL carries an API key, so it lives in .env.local and arrives through compose.
 * Falling back to the public endpoint is deliberate: a missing key should degrade, not break,
 * because this read is a cross-check rather than the indexing path. The BSC default is
 * bsc-dataseed.bnbchain.org, which answered the counter slot on 2026-09-23 without a key.
 */
const CHAINS = {
  143: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    rpc: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
  },
  56: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
  },
} as const;

/**
 * Entity IDs stay namespaced by chain because every entity here is per-chain and an agent id
 * means nothing without the chain it was minted on. Chain 143 produces the same strings it did
 * when Monad was the only chain, so no published Monad row moves.
 */
const agentKey = (chainId: number, agentId: bigint): string =>
  `${chainId}_${agentId}`;

const feedbackKey = (
  chainId: number,
  agentId: bigint,
  client: string,
  index: bigint,
): string => `${chainId}_${agentId}_${client}_${index}`;

/** Stable dedup key for a registration document. Not cryptographic, never used as evidence. */
function uriKey(uri: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < uri.length; i++) {
    const c = uri.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}_${uri.length}`;
}

/**
 * Classify how a registration document is delivered. `ipfs://` gets its own case because an
 * earlier pass bucketed it as "other" and undercounted agents that do declare something.
 */
function recordKind(uri: string): string {
  if (!uri) return "empty";
  if (uri.startsWith("data:") && uri.slice(0, 40).includes("base64")) return "data-base64";
  if (uri.startsWith("data:")) return "data-plain";
  if (uri.startsWith("http://") || uri.startsWith("https://")) return "http";
  if (uri.startsWith("ipfs://")) return "ipfs";
  if (uri.trimStart().startsWith("{")) return "inline-json";
  return "other";
}

/**
 * Read the population counter. All external I/O goes through an Effect: handlers run a parallel
 * preload pass and then a sequential pass, so a bare fetch would double-execute and serialise
 * the indexer.
 *
 * `cache: false` because the counter changes every time an agent registers and a cached value
 * would make the freshness number we publish a lie.
 *
 * `crossChain: false` states the default explicitly. Under `disable_default_cross_chain: true`
 * every effect is already chain-scoped, which is what makes `context.chain.id` readable in here.
 * Reading it on a cross-chain effect throws, so the option and the read belong together in one
 * place rather than one relying on the other's default.
 */
const readAgentCount = createEffect(
  {
    name: "readAgentCount",
    input: { blockNumber: S.bigint },
    // `S.nullable(S.bigint)` rather than `S.union([S.bigint, null])`. Same thing at runtime, but
    // the union spelling passes a bare `null` where every other element is a schema object, which
    // reads like a mistake even when it is not.
    output: S.nullable(S.bigint),
    // Required, not optional. The counter changes on every registration, so caching it would
    // make the freshness number we publish a lie.
    cache: false,
    rateLimit: false,
    crossChain: false,
  },
  async ({ input, context }) => {
    const chain = CHAINS[context.chain.id as keyof typeof CHAINS];
    if (!chain) {
      // A chain in config.yaml with no line in CHAINS. Publish unknown rather than guess a node.
      context.log.warn(
        `readAgentCount: no RPC configured for chain ${context.chain.id}, publishing unknown`,
      );
      return null;
    }
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getStorageAt",
      // "latest", NOT the block being indexed. That is the whole fix.
      //
      // rpc.monad.xyz is not an archive node. Asking it for state at block 53,010,000 returns
      // -32602 "Block requested not found. Request might be querying historical state that is
      // not available", so every sweep during a backfill failed, which is every sweep there is
      // until the index reaches head. Measured: 5,276 of 5,276 returned no result. The public
      // BSC endpoints are the same: eth_getCode at block 30,000,000 answers "missing trie node".
      //
      // Reading at head is also what the number is FOR. IndexState is one row per chain that
      // each sweep overwrites and /status compares "agents that exist now" against "rows we hold
      // now". Nobody reads a historical population, so nothing was gained by asking for one.
      params: [chain.identity, COUNTER_SLOT, "latest"],
    };
    try {
      const res = await fetch(chain.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // This index runs unattended for six weeks. A hung socket with no timeout stalls the
        // effect indefinitely. The sweep stalls with it. Fail closed on a slow RPC the same
        // way we fail closed on a broken one.
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json()) as { result?: string };
      if (!json.result) {
        context.log.warn(
          `readAgentCount: no result on chain ${context.chain.id} at block ` +
            `${input.blockNumber}, publishing unknown. ` +
            `rpc said: ${JSON.stringify(json).slice(0, 200)}`,
        );
        return null;
      }
      return BigInt(json.result);
    } catch (err) {
      // Fail closed. A missing count is published as unknown rather than as zero, which is the
      // whole data-quality position of this project.
      //
      // But SAY SO. A bare `catch { return null }` here hid a 100% failure rate, because a
      // silent null is indistinguishable from a chain that has nothing to report.
      context.log.warn(
        `readAgentCount failed on chain ${context.chain.id} at block ` +
          `${input.blockNumber}: ${String(err)}`,
      );
      return null;
    }
  },
);

/**
 * Registration. Only records a URI when the event actually carries one: an empty agentURI here
 * is normal, not an error.
 */
indexer.onEvent(
  { contract: "IdentityRegistry", event: "Registered", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = agentKey(event.chainId, event.params.agentId);
    const existing = await context.Agent.get(id);
    const uri = event.params.agentURI ?? "";
    const hasUri = uri.length > 0;

    let uriHash: string | undefined = existing?.uriHash;
    if (hasUri) {
      uriHash = uriKey(uri);

      // Has this wallet already registered an agent against this record? That question is the
      // only thing separating distinctOwners from memberCount. An earlier version incremented
      // both on every registration, which made them provably equal and published 8,093 where
      // the real wallet count is 7,962. See docs/18-BUGS-FIXED.md.
      //
      // The key relies on Envio normalising addresses the same way every time, which it does
      // because both sides come out of the same decoder.
      const ownerRowId = `${uriHash}_${event.params.owner}`;
      const seenOwner = await context.AgentRecordOwner.get(ownerRowId);
      context.AgentRecordOwner.set({
        id: ownerRowId,
        record_id: uriHash,
        owner: event.params.owner,
        agentCount: (seenOwner?.agentCount ?? 0) + 1,
        firstSeenBlock: seenOwner?.firstSeenBlock ?? BigInt(event.block.number),
      });

      const rec = await context.AgentRecord.get(uriHash);
      if (rec) {
        context.AgentRecord.set({
          ...rec,
          memberCount: rec.memberCount + 1,
          // Only a wallet not already on this record moves this one.
          distinctOwners: seenOwner ? rec.distinctOwners : rec.distinctOwners + 1,
        });
      } else {
        context.AgentRecord.set({
          id: uriHash,
          uri,
          memberCount: 1,
          distinctOwners: 1,
          kind: recordKind(uri),
          fetchedAt: undefined,
          httpStatus: undefined,
          byteLength: undefined,
          resolves: undefined,
          parsedName: undefined,
          firstSeenBlock: BigInt(event.block.number),
        });
      }

      // Chiasm. The same key this handler just wrote per chain, merged across chains. Everything
      // above stays per-chain; this is the only shared write in the file. See ./Chiasm.ts.
      await recordReferral(context, {
        uriHash,
        uri,
        chainId: event.chainId,
        agentId: event.params.agentId,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
      });
    }

    context.Agent.set({
      id,
      agentId: event.params.agentId,
      owner: event.params.owner,
      agentWallet: existing?.agentWallet,
      tokenUri: hasUri ? uri : existing?.tokenUri,
      uriHash,
      name: existing?.name,
      endpoints: existing?.endpoints ?? [],
      declaresX402: existing?.declaresX402 ?? false,
      registeredAtBlock: BigInt(event.block.number),
      registeredAt: BigInt(event.block.timestamp),
      lastSeenBlock: BigInt(event.block.number),
      // Declaring a URI is a claim, not evidence. Nothing has been checked yet.
      rung: "declared",
      transferCount: existing?.transferCount ?? 0,
      metadataUpdateCount: existing?.metadataUpdateCount ?? 0,
    });
  },
);

/**
 * Transfer. The mint is where an agent first exists and this is the ONLY source of ownership
 * change afterwards, so skipping it means reporting stale owners forever.
 */
indexer.onEvent(
  { contract: "IdentityRegistry", event: "Transfer", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = agentKey(event.chainId, event.params.tokenId);
    const existing = await context.Agent.get(id);
    const isMint = event.params.from === ZERO;

    if (!existing) {
      // Transfer can arrive before Registered within a block. Create the row so ownership is
      // never dropped and let Registered fill in the rest.
      context.Agent.set({
        id,
        agentId: event.params.tokenId,
        owner: event.params.to,
        agentWallet: undefined,
        tokenUri: undefined,
        uriHash: undefined,
        name: undefined,
        endpoints: [],
        declaresX402: false,
        registeredAtBlock: BigInt(event.block.number),
        registeredAt: BigInt(event.block.timestamp),
        lastSeenBlock: BigInt(event.block.number),
        rung: "declared",
        transferCount: isMint ? 0 : 1,
        metadataUpdateCount: 0,
      });
      return;
    }

    context.Agent.set({
      ...existing,
      owner: event.params.to,
      lastSeenBlock: BigInt(event.block.number),
      transferCount: isMint ? existing.transferCount : existing.transferCount + 1,
    });
  },
);

/**
 * Metadata. The reserved key "agentWallet" is written on every registration, so this fires at
 * least once per agent and is where the agent's transacting address comes from.
 */
indexer.onEvent(
  { contract: "IdentityRegistry", event: "MetadataSet" },
  async ({ event, context }) => {
    const id = agentKey(event.chainId, event.params.agentId);
    const existing = await context.Agent.get(id);
    if (!existing) return;

    let agentWallet = existing.agentWallet;
    if (event.params.metadataKey === "agentWallet") {
      // abi.encodePacked(address) is 20 raw bytes, so the hex value is the address itself.
      const raw = event.params.metadataValue;
      if (typeof raw === "string" && raw.length >= 42) {
        agentWallet = `0x${raw.slice(-40)}`;
      }
    }

    context.Agent.set({
      ...existing,
      agentWallet,
      lastSeenBlock: BigInt(event.block.number),
    });
  },
);

/**
 * ERC-4906, which the ERC-8004 draft does not list. The Monad deployment emits it, confirmed by
 * matching topic0 0xf8e1a15a against `cast keccak "MetadataUpdate(uint256)"`. It is the signal
 * that an off-chain document changed, so a cached copy is stale.
 */
indexer.onEvent(
  { contract: "IdentityRegistry", event: "MetadataUpdate" },
  async ({ event, context }) => {
    const id = agentKey(event.chainId, event.params._tokenId);
    const existing = await context.Agent.get(id);
    if (!existing) return;
    context.Agent.set({
      ...existing,
      metadataUpdateCount: existing.metadataUpdateCount + 1,
      lastSeenBlock: BigInt(event.block.number),
    });
  },
);

/**
 * Feedback. The single most important handler in Retina: this event is the only path to the
 * evidence pointer for all 9,188 Monad feedbacks.
 */
indexer.onEvent(
  {
    contract: "ReputationRegistry",
    event: "NewFeedback",
    fields: { block: ["timestamp"], transaction: ["hash"] },
  },
  async ({ event, context }) => {
    context.Feedback.set({
      id: feedbackKey(
        event.chainId,
        event.params.agentId,
        event.params.clientAddress,
        event.params.feedbackIndex,
      ),
      agent_id: agentKey(event.chainId, event.params.agentId),
      clientAddress: event.params.clientAddress,
      feedbackIndex: event.params.feedbackIndex,
      value: event.params.value,
      // Envio decodes uint8 as bigint and the schema field is Int!, so this conversion is
      // required. It only surfaces at tsc time against the generated types, never at codegen.
      valueDecimals: Number(event.params.valueDecimals),
      tag1: event.params.tag1,
      tag2: event.params.tag2,
      endpoint: event.params.endpoint,
      feedbackUri: event.params.feedbackURI,
      feedbackHash: event.params.feedbackHash,
      revoked: false,
      revokedAtBlock: undefined,
      responseUri: undefined,
      responseHash: undefined,
      responder: undefined,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
    });
  },
);

/**
 * Revocation. A verdict about revoked feedback is a verdict about something that no longer
 * stands, so missing this would make the verifier confidently wrong.
 */
indexer.onEvent(
  { contract: "ReputationRegistry", event: "FeedbackRevoked" },
  async ({ event, context }) => {
    const id = feedbackKey(
      event.chainId,
      event.params.agentId,
      event.params.clientAddress,
      event.params.feedbackIndex,
    );
    const existing = await context.Feedback.get(id);
    if (!existing) return;
    context.Feedback.set({
      ...existing,
      revoked: true,
      revokedAtBlock: BigInt(event.block.number),
    });
  },
);

/**
 * The operator's on-chain right of reply, rendered beside our verdict. This is what keeps
 * publishing verdicts about other people's work fair rather than one-sided.
 */
indexer.onEvent(
  { contract: "ReputationRegistry", event: "ResponseAppended" },
  async ({ event, context }) => {
    const id = feedbackKey(
      event.chainId,
      event.params.agentId,
      event.params.clientAddress,
      event.params.feedbackIndex,
    );
    const existing = await context.Feedback.get(id);
    if (!existing) return;
    context.Feedback.set({
      ...existing,
      responseUri: event.params.responseURI,
      responseHash: event.params.responseHash,
      responder: event.params.responder,
    });
  },
);

/**
 * Validation Registry. Empty on Monad when sampled 2026-09-13, so these index zero rows today.
 * That is the point: indexing from day one proves the before and after once Optic starts
 * writing, instead of us asserting we were first.
 */
indexer.onEvent(
  { contract: "ValidationRegistry", event: "ValidationRequest" },
  async ({ event, context }) => {
    context.Validation.set({
      id: `${event.chainId}_${event.params.requestHash}`,
      agent_id: agentKey(event.chainId, event.params.agentId),
      validatorAddress: event.params.validatorAddress,
      requestHash: event.params.requestHash,
      requestUri: event.params.requestURI,
      response: undefined,
      responseUri: undefined,
      responseHash: undefined,
      tag: undefined,
      requestedAtBlock: BigInt(event.block.number),
      respondedAtBlock: undefined,
    });
  },
);

indexer.onEvent(
  { contract: "ValidationRegistry", event: "ValidationResponse" },
  async ({ event, context }) => {
    const id = `${event.chainId}_${event.params.requestHash}`;
    const existing = await context.Validation.get(id);
    context.Validation.set({
      id,
      agent_id: agentKey(event.chainId, event.params.agentId),
      validatorAddress: event.params.validatorAddress,
      requestHash: event.params.requestHash,
      requestUri: existing?.requestUri,
      requestedAtBlock: existing?.requestedAtBlock ?? BigInt(event.block.number),
      response: Number(event.params.response),
      responseUri: event.params.responseURI,
      responseHash: event.params.responseHash,
      tag: event.params.tag,
      respondedAtBlock: BigInt(event.block.number),
    });
  },
);

/**
 * The population cross-check, every 10,000 blocks on each chain.
 *
 * The registry is not enumerable, so "how many agents exist" and "how many have we indexed" are
 * two different questions with two different answers. Publishing both is what lets /status say
 * the index is behind instead of quietly reporting a number that was true when it was written.
 * Muster's index froze for five days doing exactly that.
 *
 * Only the first number is written here. The second is a row count, so Hasura answers it exactly
 * and for free with `Agent_aggregate { aggregate { count } }`. An earlier version stored it on
 * IndexState and never incremented it, which pinned it at 0 and made the gap always maximal.
 * See docs/18-BUGS-FIXED.md.
 *
 * IndexState is per-chain, one row keyed by chain id, so BSC gets the same honest freshness gap
 * Monad does and Monad's row is untouched by its arrival.
 */
indexer.onBlock(
  {
    name: "PopulationCheck",
    where: ({ chain }) => {
      switch (chain.id) {
        case 143:
          return {
            block: {
              // Every 10,000 blocks and only from a RECENT block.
              //
              // IndexState is one row keyed by chain, so every sweep overwrites the last and
              // only the most recent value is ever read. With `start_block: 0` and a stride of
              // 2,000 this fired about 52,875 times per full resync, almost all of them at
              // blocks where the registry did not exist yet, each one an uncached call to a
              // public RPC, to write a row that gets overwritten.
              //
              // The floor is NOT the registry deployment block, which was the first attempt at
              // this. That left 5,276 sweeps and 3,705 of them still failed. Pointing those at a
              // dedicated RPC instead of the public one changed nothing measurable, 3,869, which
              // is how we learned the cause is the volume rather than the endpoint. Only the
              // newest value survives, so a recent floor is the actual fix.
              //
              // It never needs bumping. The chain only moves forward, so any floor below head
              // keeps sweeping forever. See docs/18-BUGS-FIXED.md.
              //
              // The stride trades freshness for that: about 2.5 hours at Monad's block time,
              // against the multi-day freeze this check exists to catch.
              number: { _every: 10000, _gte: 105000000 },
            },
          };
        case 56:
          return {
            block: {
              // Same shape, same reasoning, BSC's own floor. Head was 123,484,348 on 2026-09-23,
              // so 123,000,000 sits below it and keeps sweeping forever without replaying the
              // 44M blocks between the deployment at 79,027,268 and now. 10,000 BSC blocks is
              // about 2 hours.
              number: { _every: 10000, _gte: 123000000 },
            },
          };
        default: {
          // Exhaustiveness check: adding a chain to config.yaml without handling it here is a
          // type error rather than a silent gap.
          const _exhaustive: never = chain.id;
          return false;
        }
      }
    },
  },
  async ({ block, context }) => {
    const counter = await context.effect(readAgentCount, {
      blockNumber: BigInt(block.number),
    });

    // One row per chain. `context.chain.id` rather than a constant, because this handler now runs
    // on both chains and a hardcoded id would have BSC overwriting Monad's freshness row.
    const chainId = String(context.chain.id);
    const existing = await context.IndexState.get(chainId);
    context.IndexState.set({
      id: chainId,
      // Unknown stays unknown. The comment here said that before the field could express it:
      // the schema had `BigInt!`, so this line's `?? 0n` fallback published exactly the zero it
      // forbids. The field is nullable now. See docs/18-BUGS-FIXED.md.
      counterSlotCount: counter ?? existing?.counterSlotCount,
      atBlock: BigInt(block.number),
      // onBlock exposes only `block.number`, with no `fields` option to widen it, so the
      // wall-clock stamp is taken here rather than from the block. It is used purely to show
      // freshness on /status, never as consensus time.
      updatedAt: BigInt(Math.floor(Date.now() / 1000)),
    });
  },
);
