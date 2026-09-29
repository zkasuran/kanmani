import { envelope, json, problem } from "@/lib/api.ts";
import { isFailure, registrationCheck } from "@/lib/build-server.ts";

export const dynamic = "force-dynamic";

/**
 * Free. Check an ERC-8004 registration draft and get the exact transaction to send.
 *
 * The same checks the studio runs, for anything that is not a browser: a coding agent, a framework
 * tool, a no-code flow, a shell script. Returns the problems, what each field implies, the document
 * and URI as they will be committed and the calldata for register() or setAgentURI(). With `sender`
 * it also says whether that address can pay the gas, before anyone spends it.
 *
 * Nothing is signed, stored or sent. The builder signs with their own key.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "Body is not JSON", 'Send {"draft": {"name": "...", "description": "...", "skills": [...]}}.');
  }
  const r = await registrationCheck(body);
  if (isFailure(r)) return problem(r.status, "The draft could not be read", r.error, { errors: r.errors });

  return json(
    envelope(
      r,
      `curl -s -X POST https://kanmani.xyz/api/registration/check -H 'content-type: application/json' -d '<this body>'`,
    ),
    { status: 200 },
  );
}

export async function GET() {
  return json({
    method: "POST",
    free: true,
    body: {
      draft: { name: "required", description: "one sentence a buyer can read", url: "your site", skills: [{ id: "skill-id", endpoint: "https://...", x402: false }], refuses: ["what it will not do"] },
      kind: '"data" (default, on chain, cannot go dead) or "https"',
      hostedAt: "only for kind https",
      chainId: 143,
      agentId: "only when repointing an agent you own",
      sender: "optional: the address that will send, to check it can pay gas",
    },
    returns: "ready, problems, consequences, document, agentURI, transaction {to, data}, send {cast, viem}, gas, next",
    docs: "https://kanmani.xyz/skill.md",
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
