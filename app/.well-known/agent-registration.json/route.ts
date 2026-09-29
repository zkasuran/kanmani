import { json, SITE } from "@/lib/api.ts";
import { allRegistrations, kanmaniDraft } from "@/lib/agent-drafts.ts";
import { buildRecord } from "@/lib/registration.ts";

export const dynamic = "force-dynamic";

/**
 * Our own ERC-8004 record, served the way we expect everyone else's to be served.
 *
 * Published deliberately. This site measures whether other people's registration documents still
 * answer and 8,093 agents on Monad point at one that does not. Holding ourselves to the same
 * check is the minimum, so this is a real endpoint rather than a file somebody forgot to renew.
 *
 * Note what is NOT here: no payment claim. We have not been paid through this record, so it does
 * not assert one. A document that claims nothing cannot be wrong about it.
 */
export async function GET() {
  // ERC-8004 registration-v1 for Kanmani, plus `registrations` listing every agent we operate. The
  // spec's endpoint-domain check: a reader who finds kanmani.xyz as any of these agents' endpoint can
  // confirm the domain belongs to them by finding the agent id here.
  const rec = buildRecord(kanmaniDraft(SITE));
  return json({ ...rec, registrations: allRegistrations() });
}
