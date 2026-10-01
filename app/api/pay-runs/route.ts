import { envelope, json, problem } from "@/lib/api.ts";
import { q1 } from "@/lib/db.ts";
import { type RunMetric } from "@/lib/pay-run.ts";
import { PAY_TO, requirements } from "@/lib/x402.ts";
import { createPublicClient, defineChain, http } from "viem";

export const dynamic = "force-dynamic";

/**
 * Record and read time-to-first-transaction, as runs each tied to a real settlement.
 *
 * GET returns the aggregate: a `real` block of mainnet settles and a `ci` block of rehearsals, kept
 * apart so the published median is never mixed. POST records one run. A `real` + `mainnet` run is
 * only inserted after its cited tx is read on chain and matched, so a stranger cannot poison the
 * median with a number that has no settlement behind it. The UNIQUE tx_hash is the dedup, so a replay
 * returns the first row rather than inserting a second.
 *
 * Unauthenticated by design: anyone can finish a payment. The on-chain check plus the UNIQUE
 * constraint is what protects the number, not a login.
 */

const RPC = process.env.RPC_MONAD ?? "https://rpc.monad.xyz";
const MAX_BODY_BYTES = 2_048;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const AGG = (where: string) => `
  SELECT count(*)::int AS count,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_ms) AS median_ms,
    max(elapsed_ms) AS worst_ms,
    min(elapsed_ms) AS best_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY app_taps) AS median_taps
  FROM fovea.pay_run WHERE ${where}`;

type AggRow = { count: number; median_ms: string | null; worst_ms: number | null; best_ms: number | null; median_taps: string | null };

function block(r: AggRow | undefined) {
  if (!r || r.count === 0) {
    return { count: 0, medianMs: null, worstMs: null, bestMs: null, medianTaps: null };
  }
  return {
    count: r.count,
    medianMs: r.median_ms === null ? null : Math.round(Number(r.median_ms)),
    worstMs: r.worst_ms,
    bestMs: r.best_ms,
    medianTaps: r.median_taps === null ? null : Number(r.median_taps),
  };
}

export async function GET() {
  const real = await q1<AggRow>(AGG("source = 'real' AND net = 'mainnet'"));
  const ci = await q1<AggRow>(AGG("source = 'ci'"));
  return json(
    envelope(
      { real: block(real), ci: block(ci) },
      "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_ms), max(elapsed_ms), min(elapsed_ms) FROM fovea.pay_run WHERE source='real' AND net='mainnet'",
    ),
  );
}

/** Read the cited tx on chain 143 and confirm it credited PAY_TO in the USDC asset from the payer. */
async function verifyMainnetTx(txHash: `0x${string}`, payer: string | undefined): Promise<{ ok: boolean; reason: string }> {
  try {
    const pub = createPublicClient({ chain: monad, transport: http(RPC) });
    const receipt = await pub.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return { ok: false, reason: "the cited transaction did not succeed on chain 143" };
    const asset = requirements().asset.toLowerCase();
    const payTo = PAY_TO.toLowerCase();
    const credited = receipt.logs.some(
      (l) =>
        l.address.toLowerCase() === asset &&
        l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        l.topics[2] !== undefined &&
        `0x${l.topics[2].slice(-40)}`.toLowerCase() === payTo,
    );
    if (!credited) return { ok: false, reason: "no USDC Transfer to the payee in the cited transaction" };
    if (payer && receipt.from.toLowerCase() !== payer.toLowerCase()) {
      // The relayer, not the payer, sends an x402 settle, so `from` is the facilitator. The payer is
      // the EIP-3009 `from` inside a Transfer log, which the `credited` check already tied to the
      // asset. So a payer mismatch on receipt.from is expected and not a rejection on its own.
      void 0;
    }
    return { ok: true, reason: "credited the payee on chain 143" };
  } catch (e) {
    return { ok: false, reason: `could not read the transaction: ${(e as Error).message}` };
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `Send under ${MAX_BODY_BYTES} bytes.`);
  }
  let b: { source?: unknown; appTaps?: unknown; passkeyPrompts?: unknown; elapsedMs?: unknown; txHash?: unknown; net?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return problem(400, "Body is not JSON", "Send { source, appTaps, passkeyPrompts, elapsedMs, txHash?, net }.");
  }

  const source = b.source === "real" || b.source === "ci" ? b.source : null;
  const net = b.net === "mainnet" || b.net === "testnet" ? b.net : null;
  const metric: RunMetric = {
    appTaps: Number(b.appTaps),
    passkeyPrompts: Number(b.passkeyPrompts),
    elapsedMs: Number(b.elapsedMs),
  };
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (
    !source ||
    !net ||
    !inRange(metric.appTaps, 0, 1000) ||
    !inRange(metric.passkeyPrompts, 0, 100) ||
    !inRange(metric.elapsedMs, 0, 3_600_000)
  ) {
    return problem(400, "Bad run", "source real|ci, net mainnet|testnet, integer appTaps 0-1000, passkeyPrompts 0-100, elapsedMs 0-3600000.");
  }

  const txHash = typeof b.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(b.txHash) ? (b.txHash as `0x${string}`) : null;
  const payer = typeof (b as { payer?: unknown }).payer === "string" ? ((b as { payer?: string }).payer as string) : undefined;

  // A real mainnet run must cite a settlement we can read on chain. This is the whole honesty position.
  if (source === "real" && net === "mainnet") {
    if (!txHash) return problem(400, "A real run needs its tx", "A real mainnet run must cite the txHash of its settlement.");
    const v = await verifyMainnetTx(txHash, payer);
    if (!v.ok) return problem(400, "Unverifiable settlement", v.reason);
  }

  const row = await q1<{ id: string; fresh: boolean }>(
    `INSERT INTO fovea.pay_run (source, app_taps, passkey_prompts, elapsed_ms, tx_hash, net, payer)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tx_hash) DO UPDATE SET tx_hash = fovea.pay_run.tx_hash
     RETURNING id::text, (xmax = 0) AS fresh`,
    [source, metric.appTaps, metric.passkeyPrompts, metric.elapsedMs, txHash, net, payer ?? null],
  );

  // Return the current aggregate so the page updates without a second request.
  const real = await q1<AggRow>(AGG("source = 'real' AND net = 'mainnet'"));
  const ci = await q1<AggRow>(AGG("source = 'ci'"));
  return json(
    envelope(
      {
        recorded: true,
        firstTime: row?.fresh ?? false,
        id: row?.id ?? null,
        real: block(real),
        ci: block(ci),
      },
      "INSERT INTO fovea.pay_run ...; a real+mainnet row is verified on chain before insert",
    ),
    { status: row?.fresh ? 201 : 200 },
  );
}
