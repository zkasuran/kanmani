import { judge } from "../../../verifier/src/ladder/verdict.ts";
export async function GET() {
  return Response.json({ ok: typeof judge === "function" });
}
