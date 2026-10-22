/**
 * Which of an agent's feedbacks count toward what its page and API say about its claims.
 *
 * A feedback its own author has revoked is withdrawn. It stays on chain, so it stays in the count of what
 * is on chain. It also stays listed with a revoked flag. It is not a claim the agent made good or failed,
 * so it is counted as neither true, false nor unknown. Found when Defigent revoked two feedbacks that its
 * own encoder had malformed (blocks 115612538 and 115612541). They were still being shown as "could not
 * check" on agent 10411.
 *
 * This is the display rule only. The sample a bond is measured on (CLAIM_TRUTH_WINDOW_SQL, `/api/sla`) is a
 * separate question and is deliberately not changed here: letting a reviewer remove a claim after the fact
 * would let them move a bonded agent's rate in either direction, so that needs agreeing in the open first.
 */
export function partitionRevoked<T extends { revoked: boolean }>(rows: readonly T[]): { live: T[]; revoked: T[] } {
  const live: T[] = [];
  const revoked: T[] = [];
  for (const r of rows) (r.revoked ? revoked : live).push(r);
  return { live, revoked };
}
