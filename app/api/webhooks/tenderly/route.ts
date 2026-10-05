import { handleTenderlyWebhook } from "@/lib/tenderly.ts";
import { describeWebhook } from "@/lib/rehydrate.ts";

export const dynamic = "force-dynamic";

/** Tenderly alerts on the Identity Registry. Signature first, then the shared re-verification path. */
export async function POST(req: Request) {
  return handleTenderlyWebhook(req);
}

/** Tenderly checks reachability with a GET when the webhook is added. Any answer passes. */
export async function GET() {
  return describeWebhook();
}
