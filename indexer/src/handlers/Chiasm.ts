/**
 * Chiasm. Where the two nerves cross.
 *
 * Retina indexes one chain's registries into per-chain rows. Chiasm is the one place those rows
 * are allowed to meet. It meets them on the only key that means the same thing on both chains:
 * the content key of the registration document.
 *
 * The domain fact underneath it. An ERC-8004 agent points at a registration document and the
 * registry stores only the pointer. Nothing ties a document to a chain, so the same document can
 * be referenced from Monad and from BSC by operators who have never heard of each other. On
 * Monad that is already the largest single fact in the index: 8,093 of 10,253 agents share one
 * dead deployment. A per-chain table can count that cluster. It cannot tell you whether BSC
 * points at the same document, which is the question a buyer checking an agent's history
 * actually has.
 *
 * Three things make this work under `disable_default_cross_chain: true`. All three are the
 * installed version's own mechanisms rather than a workaround:
 *
 *   1. `@crossChain` on both entities. Envio resolves a cross-chain entity against one shared
 *      in-memory table (InMemoryStore.entityScope returns "crossChain" regardless of which
 *      chain's event is running), so a row is shared instead of duplicated per chain. It is also
 *      the only way to declare a `chainId` field at all, since envio appends that column itself
 *      to per-chain entities and rejects a field of the same name.
 *
 *   2. The chainId in the ID of the per-chain slice, `<uriHash>_<chainId>`. Only the chain named
 *      in an ID ever writes that row, so the per-chain counters cannot race.
 *
 *   3. `getOrCreate` for the merged row, which is the row both chains write. The sequential pass
 *      walks every item in one batch in checkpoint order across all chains, one await at a time,
 *      and reads resolve against that shared in-memory table. So when BSC and Monad both land on
 *      the same document inside one batch, the second handler reads what the first wrote instead
 *      of overwriting it. Writes during the parallel preload pass are a no-op, so the increments
 *      below run exactly once per event.
 *
 * What this deliberately does not do. It does not touch any per-chain entity, so adding a chain
 * cannot move a published Monad number. Agent, AgentRecord, Feedback, Verdict, Validation and
 * IndexState all stay keyed by chain exactly as before.
 */
import type { EvmOnEventContext } from "envio";

/** One agent registration, already reduced to the fields the merge needs. */
export type Referral = {
  /** AgentRecord.id, the content key of the document. The join key, shared by both chains. */
  uriHash: string;
  /** The document itself, carried so a key collision is visible rather than silent. */
  uri: string;
  chainId: number;
  agentId: bigint;
  blockNumber: bigint;
  /** Block timestamp. Ordering across chains is by timestamp, so this is what first and last mean. */
  timestamp: bigint;
};

/**
 * Record one chain's reference to one document.
 *
 * Called from the `Registered` handler, after Retina has computed the same `uriHash` it writes to
 * AgentRecord. Sharing that key is what keeps the two layers consistent: a merged row can never
 * disagree with the per-chain rows it summarises, because there is only one key.
 */
export async function recordReferral(
  context: EvmOnEventContext,
  ref: Referral,
): Promise<void> {
  const { uriHash, uri, chainId, agentId, blockNumber, timestamp } = ref;

  // The per-chain slice, written first. Its ID carries the chain, so this row belongs to one
  // chain even though the table is shared. No contention, no ordering assumption needed.
  const presenceId = `${uriHash}_${chainId}`;
  const presence = await context.ChiasmPresence.get(presenceId);
  context.ChiasmPresence.set({
    id: presenceId,
    record_id: uriHash,
    chainId,
    agentCount: (presence?.agentCount ?? 0) + 1,
    firstAgentId: presence?.firstAgentId ?? agentId,
    firstSeenBlock: presence?.firstSeenBlock ?? blockNumber,
    lastSeenBlock: blockNumber,
    firstSeenAt: presence?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
  });

  // The merged row, the one both chains write. `getOrCreate` seeds it if this is the first
  // reference from any chain, then returns whatever is actually there, which may be a row the
  // other chain wrote earlier in this same batch.
  const record = await context.ChiasmRecord.getOrCreate({
    id: uriHash,
    uri,
    chainCount: 0,
    chainIds: [],
    agentCount: 0,
    firstSeenChainId: chainId,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    uriConflict: false,
  });

  // Set union, sorted. Two chains arriving in either order leave the same row, which is what
  // makes a resync reproduce the published numbers.
  const chainIds = record.chainIds.includes(chainId)
    ? record.chainIds
    : [...record.chainIds, chainId].sort((a, b) => a - b);

  context.ChiasmRecord.set({
    ...record,
    chainIds,
    chainCount: chainIds.length,
    agentCount: record.agentCount + 1,
    // Max rather than assignment. Ordered multichain mode already delivers events in timestamp
    // order, so this is belt and braces, but it keeps the field true if the mode ever changes.
    lastSeenAt: timestamp > record.lastSeenAt ? timestamp : record.lastSeenAt,
    // AgentRecord.id is a 64-bit content key, not a cryptographic digest. Two different
    // documents landing on one key would read as a cross-chain hit when it is a collision. The
    // stored URI is the only witness, so compare it every time and latch the answer. A
    // cross-chain claim off this table is only worth making while this is false.
    uriConflict: record.uriConflict || record.uri !== uri,
  });
}
