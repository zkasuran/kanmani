import { envelope, json, problem } from "@/lib/api.ts";
import { evidenceCheck, isFailure } from "@/lib/build-server.ts";

export const dynamic = "force-dynamic";

/**
 * Free. Run an evidence document through the real judge before publishing it.
 *
 * The builder sends the document itself. It is judged by the same code as every published verdict,
 * so the answer here is the answer the document will get once it is on chain. A `false` is also
 * searched for on the other chains, so a mislabelled network comes back as one field to fix rather
 * than as a bare failure. Nothing is stored and no URL is ever fetched.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "Body is not JSON", 'Send {"document": { ...your evidence document... }}.');
  }
  let r;
  try {
    r = await evidenceCheck(body);
  } catch (e) {
    return problem(503, "The check did not complete", (e as Error).message.slice(0, 200), { retryable: true });
  }
  if (isFailure(r)) return problem(r.status, "No document to check", r.error);
  const { checkedAtBlock, ...data } = r;
  return json(envelope(data, "POST the same body again; the judge is deterministic for a given chain state.", checkedAtBlock));
}

export async function GET() {
  return json({ method: "POST", free: true, body: { document: "your evidence document, as JSON or a data: URI. URLs are not fetched." }, returns: "outcome, rung, reason, foundOnChain, advice", docs: "https://kanmani.xyz/skill.md" });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
