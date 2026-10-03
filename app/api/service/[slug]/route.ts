import { json, problem, SITE } from "@/lib/api.ts";
import { readBodyJson } from "@/lib/body.ts";
import { AGENTS, assay, type AgentSlug, MONAD_BLOCK_MS, sentinel } from "@/lib/agents.ts";
import { chargeFor } from "@/lib/metering.ts";
import { EXTRAS, extraBySlug, extraCharge, isInputError } from "@/lib/agent-extras.ts";
import type { Meter } from "@/lib/upto.ts";
import { inputFromParts, objectFromParts, type A2APart } from "@/lib/a2a.ts";
import { AgentRefError, resolveAgentRef } from "@/lib/agent-ref.ts";
import { CHAIN_ID, q1 } from "@/lib/db.ts";
import { settlementRequirements, type UptoPayload, type UptoRequirements } from "@/lib/upto.ts";
import {
  challenge,
  confirmPaymentNonce,
  paymentFrom,
  paymentResponseHeader,
  releasePaymentNonce,
  requirements,
  reservePaymentNonce,
  settlePayment,
  uptoFacilitatorAddress,
  uptoServiceRequirements,
  verifyPayment,
  type PaymentRequirements,
} from "@/lib/x402.ts";

export const dynamic = "force-dynamic";

/**
 * The endpoint both shipped agents answer on.
 *
 * One route rather than two, because the agents differ in what they compute and not in how they are
 * paid, reached or described. Duplicating the payment handshake per agent is how two copies drift
 * until one of them takes money without doing work.
 *
 * ## Work first, settle second
 *
 * The answer is computed before the payment is settled, matching `/api/verify`. If the computation
 * throws, nothing has been taken. The reverse order is more convenient and occasionally charges for
 * a failure, which on a site about honest receipts would be indefensible.
 *
 * ## Paid by usage, capped by a signature
 *
 * `upto` is offered first. The buyer signs a Permit2 maximum equal to the listed price. We verify at
 * that maximum, run the work, compute the charge from the meter in lib/metering and settle only that.
 * The rest never leaves the buyer. `exact` is still accepted for clients without Permit2 and pays the
 * listed price as before. Every answer states which scheme was used, the ceiling, the charge and the
 * meter, so the charge can be recomputed rather than trusted.
 *
 * ## Free preview
 *
 * GET returns the agent's card, its price and the reason it needs Monad, unpaid. A caller cannot
 * consent to a price without seeing what it buys.
 */

/**
 * Every agent this route serves, core (Sentinel, Assay) and extra, as one shape so the payment path
 * exists once. `work` runs the agent and returns its answer with the meter the charge comes from.
 */
type Target = {
  slug: string;
  name: string;
  sells: string;
  why: string;
  input: string;
  example: Record<string, unknown>;
  priceAtomic: string;
  work: (input: Record<string, unknown>, ceiling: bigint) => Promise<{ answer: unknown; meter: Meter; charge: bigint }>;
  /** Checks run before any payment is asked for, so a caller never pays to be told no. */
  precheck?: (input: Record<string, unknown>) => Promise<void>;
};

const agentIndexed = async (agentId: number) =>
  Boolean(await q1(`SELECT 1 FROM "Agent" WHERE "chainId" = $1 AND "agentId" = $2 LIMIT 1`, [CHAIN_ID, String(agentId)]));

function spec(slug: string): Target | undefined {
  const core = (AGENTS as Record<string, (typeof AGENTS)[AgentSlug]>)[slug];
  if (core) {
    return {
      slug: core.slug,
      name: core.name,
      sells: core.sells,
      why: core.needsMonad,
      input: core.input,
      example: JSON.parse(core.input),
      priceAtomic: core.priceAtomic,
      async precheck(input) {
        await resolveAgentRef(input, core.input, agentIndexed);
      },
      async work(input, ceiling) {
        // Resolved again here, so work can never run on an agent the precheck would have refused.
        const { agentId } = await resolveAgentRef(input, core.input, agentIndexed);
        const answer =
          core.slug === "sentinel"
            ? await sentinel(agentId, Number.isFinite(Number(input.maxAgeBlocks)) ? Number(input.maxAgeBlocks) : 64)
            : await assay(agentId);
        const m = chargeFor(core.slug, answer, ceiling);
        return { answer, meter: m.meter, charge: m.chargeAtomic };
      },
    };
  }
  const e = extraBySlug(slug);
  if (!e) return undefined;
  return {
    slug: e.slug,
    name: e.name,
    sells: e.sells,
    why: e.why,
    input: e.input,
    example: e.example,
    priceAtomic: e.priceAtomic,
    async work(input, ceiling) {
      const r = await e.run(input, ceiling);
      return { answer: r.answer, meter: r.meter, charge: extraCharge(e, r.meter) };
    },
  };
}

const KNOWN = () => [...Object.keys(AGENTS), ...EXTRAS.map((e) => e.slug)].join(", ");
const isInput = (e: unknown) => isInputError(e) || (e as { input?: boolean })?.input === true;

/** What this agent accepts right now. Upto only when the facilitator's address could be read. */
async function offers(priceAtomic: string): Promise<{ upto: UptoRequirements | null; exact: PaymentRequirements; accepts: (UptoRequirements | PaymentRequirements)[] }> {
  const fac = await uptoFacilitatorAddress();
  const upto = fac ? uptoServiceRequirements(priceAtomic, fac) : null;
  const exact = { ...requirements(), amount: priceAtomic };
  return { upto, exact, accepts: upto ? [upto, exact] : [exact] };
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = spec(slug);
  if (!s) return problem(404, "No such agent", `Known agents: ${KNOWN()}.`);
  const resource = `${SITE}/api/service/${s.slug}`;
  if (s.priceAtomic === "0") {
    return json({ agent: s.name, sells: s.sells, why: s.why, card: `${resource}/agent-card.json`, registration: `${resource}/registration.json`, input: s.input, example: s.example, price: { free: true }, call: `POST ${resource} with the input as JSON. A2A message/send works too.` });
  }
  const o = await offers(s.priceAtomic);
  // The body IS the x402 v2 challenge (x402Version, error, resource, accepts at the top level), so a
  // standard client reads it without knowing us. The description rides beside it. It used to nest the
  // challenge under howToPay, which our own Linter agent caught: a spec client found no accepts.
  return json(
    {
      ...challenge(resource, "PAYMENT-SIGNATURE header required. This body is the price and the reason.", o.accepts),
      agent: s.name,
      sells: s.sells,
      why: s.why,
      card: `${resource}/agent-card.json`,
      registration: `${resource}/registration.json`,
      blockMs: MONAD_BLOCK_MS,
      input: s.input,
      example: s.example,
      price: {
        ceilingAtomic: s.priceAtomic,
        asset: requirements().asset,
        network: requirements().network,
        schemes: o.accepts.map((a) => a.scheme),
        meter: "upto charges min(ceiling, base + units used); every answer returns the meter it was charged from. exact always charges the ceiling.",
      },
    },
    { status: 402 },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = spec(slug);
  if (!s) return problem(404, "No such agent", `Known agents: ${KNOWN()}.`);
  let body: Record<string, unknown>;
  // Bounded before anything parses it. This route is reachable with no payment and no auth (a free
  // agent runs its work straight away), so the body ceiling is the first thing the request meets.
  const read = await readBodyJson(req);
  if (!read.ok) {
    return problem(read.status, read.title, read.status === 413 ? read.detail : `Send ${s.input}`);
  }
  body = (read.value ?? {}) as Record<string, unknown>;
  // A2A JSON-RPC (message/send) lands here too: brokers and readiness probes speak it. The
  // registration record declares this endpoint as a2a. Same work, same payment rules underneath.
  if (body && body.jsonrpc === "2.0") return a2a(s, body, req.headers);
  return serve(s, body, req.headers);
}

type Spec = Target;

/** The priced call itself. Shared by plain JSON and A2A, so the payment rules exist once. */
async function serve(s: Spec, body: Record<string, unknown>, headers: Headers): Promise<Response> {
  const resource = `${SITE}/api/service/${s.slug}`;

  // Free agents: no payment step at all, only the work.
  if (s.priceAtomic === "0") {
    try {
      const r = await s.work(body, 0n);
      return json({ agent: s.name, chainId: 143, payment: null, meter: r.meter, answer: r.answer });
    } catch (e) {
      if (isInput(e)) return problem(400, "Input not accepted", (e as Error).message, { expected: s.input, example: s.example });
      console.error(`[/api/service/${s.slug}] failed:`, (e as Error).message);
      return problem(500, "The agent did not complete", (e as Error).message.slice(0, 200), { retryable: true });
    }
  }

  if (s.precheck) {
    try {
      await s.precheck(body);
    } catch (e) {
      if (e instanceof AgentRefError) {
        return problem(e.notMeasured ? 422 : 400, e.notMeasured ? "Not measured here" : "Input not accepted", e.message, { expected: s.input, example: s.example, charged: false });
      }
      throw e;
    }
  }

  const o = await offers(s.priceAtomic);
  const ask = (reason: string) => json(challenge(resource, reason, o.accepts), { status: 402 });
  const payment = paymentFrom(headers, o.upto ? ["upto", "exact"] : ["exact"]);
  if (!payment.ok) return ask(payment.reason);
  const isUpto = payment.payload.accepted.scheme === "upto";
  // The requirements WE set, never the ones the client echoes. Verify-time amount is the ceiling.
  const asked: UptoRequirements | PaymentRequirements = isUpto ? o.upto! : o.exact;

  const verified = await verifyPayment(payment.payload, asked);
  if (!verified.valid) {
    // Whose fault it is decides the status code. A facilitator outage answered as 402 would make the
    // caller re-sign, which burns a nonce for a failure that was never theirs.
    if (verified.ours) {
      return problem(503, "We could not check your payment", verified.reason, {
        retryable: true,
        note: "Your payment was not rejected. Nothing was charged and your authorization is untouched.",
      });
    }
    return ask(verified.reason);
  }

  // Reserve the authorization before any priced work, so one signature cannot drive many parallel
  // computations for a single eventual settle.
  const reservation = reservePaymentNonce(payment.payload);
  if (!reservation.ok) return ask(reservation.reason);

  // Work before money. If this throws, the verified authorization is deliberately not settled.
  const ceiling = BigInt(s.priceAtomic);
  let answer: unknown;
  let metered: { meter: Meter; chargeAtomic: bigint };
  try {
    const r = await s.work(body, ceiling);
    answer = r.answer;
    metered = { meter: r.meter, chargeAtomic: r.charge };
  } catch (e) {
    releasePaymentNonce(reservation.key);
    if (isInput(e)) return problem(400, "Input not accepted", (e as Error).message, { expected: s.input, example: s.example, charged: false });
    console.error(`[/api/service/${s.slug}] agent failed:`, (e as Error).message);
    return problem(500, "The agent did not complete", "The agent could not produce a result. Nothing was charged.", {
      charged: false,
      retryable: true,
      note: "Your payment was verified and deliberately not settled, because we did not deliver.",
    });
  }
  const chargeAtomic = isUpto ? metered.chargeAtomic : ceiling;

  let settleReqs: UptoRequirements | PaymentRequirements = asked;
  if (isUpto) {
    const g = settlementRequirements(o.upto!, payment.payload.payload as UptoPayload, chargeAtomic);
    if (!g.ok) {
      releasePaymentNonce(reservation.key);
      return problem(402, "Payment cannot be settled for this charge", g.reason, { charged: false, retryable: true });
    }
    settleReqs = g.requirements;
  }

  // Nothing owed: no transaction at all. The signature is marked spent here so it cannot be replayed
  // for another call. It lapses on chain at its deadline without ever moving funds.
  if (isUpto && chargeAtomic === 0n) {
    confirmPaymentNonce(reservation.key);
    return json({
      agent: s.name,
      chainId: 143,
      blockMs: MONAD_BLOCK_MS,
      payment: {
        scheme: "upto",
        settled: true,
        transaction: null,
        ceilingAtomic: s.priceAtomic,
        chargedAtomic: "0",
        meter: metered.meter,
        payer: verified.payer || null,
        note: "Charged nothing, so nothing was sent on chain. Your signed maximum was never used.",
      },
      answer,
    });
  }

  const settled = await settlePayment(payment.payload, settleReqs);

  // Delivery is gated on settlement. A verified-but-unsettled payment does not get the paid answer,
  // or the settle step is optional. The authorization is untouched, so a genuine payer retries.
  if (!settled.settled) {
    releasePaymentNonce(reservation.key);
    return problem(402, "Payment did not settle", settled.reason ?? "settlement did not confirm", {
      charged: false,
      retryable: true,
      note: "The payment verified but settlement did not confirm, so nothing was delivered and nothing was charged. Your authorization is untouched.",
    });
  }

  confirmPaymentNonce(reservation.key);

  return json(
    {
      agent: s.name,
      chainId: 143,
      blockMs: MONAD_BLOCK_MS,
      payment: {
        scheme: isUpto ? "upto" : "exact",
        settled: settled.settled,
        transaction: settled.transaction,
        reason: settled.reason,
        ceilingAtomic: s.priceAtomic,
        chargedAtomic: settled.amount ?? chargeAtomic.toString(),
        // The meter the charge came from. For exact it is shown too, beside the fixed charge, so a
        // buyer can see what upto would have cost.
        meter: metered.meter,
        payer: settled.payer ?? (verified.payer || null),
        note: isUpto
          ? "Signed a maximum, charged the metered amount. The rest never left your wallet. Recompute the charge from the meter."
          : "Paid the listed price with exact. upto would have charged the metered amount shown.",
      },
      answer,
    },
    { headers: settled.transaction ? { "x-payment-response": paymentResponseHeader(settled) } : {} },
  );
}

/* ------------------------------------------------------------------ A2A */

const X402_EXT = "https://github.com/google-a2a/a2a-x402/v0.1";

async function a2a(s: Spec, body: Record<string, unknown>, _headers: Headers): Promise<Response> {
  const id = (body.id as string | number | null | undefined) ?? null;
  const reply = (result: unknown) => json({ jsonrpc: "2.0", id, result }, { headers: { "x-a2a-extensions": X402_EXT } });
  const fail = (code: number, message: string) => json({ jsonrpc: "2.0", id, error: { code, message } });
  const method = String(body.method ?? "");

  if (method === "tasks/get" || method === "tasks/cancel" || method === "tasks/resubscribe") {
    // Stateless: every task completes or asks for input within its own request, so none is kept.
    return fail(-32001, "Task not found: this agent keeps no tasks between requests. Send message/send again.");
  }
  if (method !== "message/send" && method !== "tasks/send") {
    return fail(-32601, `Method not found: ${method || "(none)"}. This agent answers message/send.`);
  }

  const params = (body.params ?? {}) as { message?: { parts?: A2APart[]; taskId?: string; contextId?: string; metadata?: Record<string, unknown> } };
  const msg = params.message ?? {};
  const taskId = msg.taskId || crypto.randomUUID();
  const contextId = msg.contextId || crypto.randomUUID();
  const core = s.slug === "sentinel" || s.slug === "assay";
  const input: Record<string, unknown> = core ? { ...objectFromParts(msg.parts), ...inputFromParts(msg.parts) } : objectFromParts(msg.parts);
  const o = s.priceAtomic === "0" ? { accepts: [] } : await offers(s.priceAtomic);
  const task = (state: string, text: string, metadata: Record<string, unknown>, artifacts?: unknown[]) =>
    reply({
      kind: "task",
      id: taskId,
      contextId,
      status: { state, timestamp: new Date().toISOString(), message: { kind: "message", role: "agent", messageId: crypto.randomUUID(), taskId, contextId, parts: [{ kind: "text", text }], metadata } },
      ...(artifacts ? { artifacts } : {}),
    });
  const free = s.priceAtomic === "0";
  const required = free ? {} : { "x402.payment.status": "payment-required", "x402.payment.required": { x402Version: 2, accepts: o.accepts } };
  const hasInput = Object.keys(input).some((k) => input[k] !== undefined && input[k] !== null);

  if (!hasInput) {
    return task("input-required", `${s.name}: ${s.sells} Send ${s.input} as a data part${free ? "" : ", then pay with x402"}.`, { ...required, example: s.example });
  }

  if (free) {
    const r = await serve(s, input, new Headers());
    const out = (await r.json().catch(() => ({}))) as { answer?: unknown; meter?: unknown; detail?: string };
    return r.status === 200
      ? task("completed", `${s.name} answered.`, {}, [{ artifactId: crypto.randomUUID(), name: s.slug, parts: [{ kind: "data", data: { answer: out.answer, meter: out.meter } }] }])
      : task(r.status === 400 ? "input-required" : "failed", `${s.name}: ${out.detail ?? `HTTP ${r.status}`}`, { example: s.example });
  }

  if (s.precheck) {
    try {
      await s.precheck(input);
    } catch (e) {
      if (e instanceof AgentRefError) {
        // Refused before payment is requested. "rejected" tells a broker not to pay or retry.
        return task(e.notMeasured ? "rejected" : "input-required", `${s.name}: ${e.message}`, { example: s.example, charged: false });
      }
      throw e;
    }
  }

  const payload = msg.metadata?.["x402.payment.payload"];
  if (!payload) {
    return task("input-required", `Payment is required for ${s.name}. Sign one of the accepted x402 options and resend with x402.payment.payload and this taskId.`, required);
  }

  // Hand the signed payload to the same path a PAYMENT-SIGNATURE header takes.
  const h = new Headers({ "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") });
  const r = await serve(s, input, h);
  const out = (await r.json().catch(() => ({}))) as { payment?: { transaction?: string | null; payer?: string | null; settled?: boolean }; answer?: unknown; detail?: string; error?: string };
  if (r.status === 200) {
    const receipt = { success: true, transaction: out.payment?.transaction ?? "", network: "eip155:143", payer: out.payment?.payer ?? undefined };
    return task(
      "completed",
      `${s.name} answered.`,
      { "x402.payment.status": "payment-completed", "x402.payment.receipts": [receipt] },
      [{ artifactId: crypto.randomUUID(), name: s.slug, parts: [{ kind: "data", data: { answer: out.answer, payment: out.payment } }] }],
    );
  }
  if (r.status === 402) {
    return task("input-required", `Payment was not accepted: ${out.detail ?? out.error ?? "see x402.payment.error"}. Nothing was charged.`, {
      ...required,
      "x402.payment.status": "payment-failed",
      "x402.payment.error": out.detail ?? out.error ?? "payment not accepted",
      "x402.payment.receipts": [{ success: false, errorReason: out.detail ?? "payment not accepted", network: "eip155:143", transaction: "" }],
    });
  }
  return task("failed", `The agent did not complete (HTTP ${r.status}). Nothing was charged.`, { "x402.payment.status": "payment-failed", "x402.payment.error": out.detail ?? `HTTP ${r.status}` });
}
