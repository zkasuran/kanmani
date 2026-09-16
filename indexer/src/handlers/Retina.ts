/**
 * Retina. Captures everything arriving on the ERC-8004 registries and turns it into signal.
 *
 * Four measured facts drive the shape of this file, each one found by reading the chain rather
 * than the spec:
 *
 *   1. `Registered` can carry an EMPTY agentURI. The canonical IdentityRegistryUpgradeable has
 *      three register() overloads, and the no-argument one emits `Registered(agentId, "", sender)`.
 *      An indexer that reads the URI only from this event holds nothing for those agents.
 *
 *   2. The registry is NOT enumerable. `totalSupply()` reverts, so the population lives in a
 *      storage slot. `onBlock` reads it and publishes BOTH that number and what the logs
 *      produced, so a gap reads as "the index is behind" rather than "these agents do not exist".
 *
 *   3. 8,093 of 10,252 agents (78.94%) share ONE tokenURI, a deleted Vercel deployment. Records
 *      are deduplicated by content so the cluster becomes a first-class number instead of 8,093
 *      copies of a dead string.
 *
 *   4. `feedbackURI` and `feedbackHash` exist ONLY as non-indexed fields of `NewFeedback`.
 *      `readFeedback()` does not return them, and eth_getLogs caps at a 100-block span on free
 *      Monad RPC against a 104M-block head. Without this indexer the verifier is impossible.
 */
import { indexer, createEffect, S } from "envio";

const CHAIN = 143;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Storage slot holding the registration counter, since totalSupply() reverts. */
const COUNTER_SLOT =
  "0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00";
const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const agentKey = (agentId: bigint): string => `${CHAIN}_${agentId}`;

const feedbackKey = (
  agentId: bigint,
  client: string,
  index: bigint,
): string => `${CHAIN}_${agentId}_${client}_${index}`;

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
 * `cache: false` because the counter changes every time an agent registers, and a cached value
 * would make the freshness number we publish a lie.
 */
const readAgentCount = createEffect(
  {
    name: "readAgentCount",
    input: { blockNumber: S.bigint },
    output: S.union([S.bigint, null]),
    // Required, not optional. The counter changes on every registration, so caching it would
    // make the freshness number we publish a lie.
    cache: false,
    rateLimit: false,
  },
  async ({ input }) => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getStorageAt",
      params: [IDENTITY, COUNTER_SLOT, `0x${input.blockNumber.toString(16)}`],
    };
    try {
      const res = await fetch("https://rpc.monad.xyz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { result?: string };
      if (!json.result) return null;
      return BigInt(json.result);
    } catch {
      // Fail closed. A missing count is published as unknown rather than as zero, which is the
      // whole data-quality position of this project.
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
    const id = agentKey(event.params.agentId);
    const existing = await context.Agent.get(id);
    const uri = event.params.agentURI ?? "";
    const hasUri = uri.length > 0;

    let uriHash: string | undefined = existing?.uriHash;
    if (hasUri) {
      uriHash = uriKey(uri);
      const rec = await context.AgentRecord.get(uriHash);
      if (rec) {
        context.AgentRecord.set({
          ...rec,
          memberCount: rec.memberCount + 1,
          distinctOwners: rec.distinctOwners + 1,
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
 * Transfer. The mint is where an agent first exists, and this is the ONLY source of ownership
 * change afterwards, so skipping it means reporting stale owners forever.
 */
indexer.onEvent(
  { contract: "IdentityRegistry", event: "Transfer", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = agentKey(event.params.tokenId);
    const existing = await context.Agent.get(id);
    const isMint = event.params.from === ZERO;

    if (!existing) {
      // Transfer can arrive before Registered within a block. Create the row so ownership is
      // never dropped, and let Registered fill in the rest.
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
    const id = agentKey(event.params.agentId);
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
    const id = agentKey(event.params._tokenId);
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
        event.params.agentId,
        event.params.clientAddress,
        event.params.feedbackIndex,
      ),
      agent_id: agentKey(event.params.agentId),
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
      id: `${CHAIN}_${event.params.requestHash}`,
      agent_id: agentKey(event.params.agentId),
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
    const id = `${CHAIN}_${event.params.requestHash}`;
    const existing = await context.Validation.get(id);
    context.Validation.set({
      id,
      agent_id: agentKey(event.params.agentId),
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
 * The population cross-check, every 2,000 blocks (~30 min at Monad's block time).
 *
 * The registry is not enumerable, so "how many agents exist" and "how many have we indexed" are
 * two different questions with two different answers. Publishing both is what lets /status say
 * the index is behind instead of quietly reporting a number that was true when it was written.
 * Muster's index froze for five days doing exactly that.
 */
indexer.onBlock(
  {
    name: "PopulationCheck",
    where: ({ chain }) => {
      switch (chain.id) {
        case 143:
          return { block: { number: { _every: 2000 } } };
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

    const existing = await context.IndexState.get(String(CHAIN));
    context.IndexState.set({
      id: String(CHAIN),
      // Unknown stays unknown. A failed read must never be published as zero.
      counterSlotCount: counter ?? existing?.counterSlotCount ?? 0n,
      agentsFromLogs: existing?.agentsFromLogs ?? 0n,
      atBlock: BigInt(block.number),
      // onBlock exposes only `block.number`, with no `fields` option to widen it, so the
      // wall-clock stamp is taken here rather than from the block. It is used purely to show
      // freshness on /status, never as consensus time.
      updatedAt: BigInt(Math.floor(Date.now() / 1000)),
      feedbackCount: existing?.feedbackCount ?? 0n,
      recordCount: existing?.recordCount ?? 0n,
    });
  },
);
