import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleTenderlyWebhook, parseTenderly, verifyTenderlySignature } from "./tenderly.ts";
import { IDENTITY_REGISTRY, METADATA_UPDATE_TOPIC, type ClaimTarget, type DeliveryRow, type Deps } from "./rehydrate.ts";

const SECRET = "tenderly-test-secret";
const DATE = "Mon, 05 Oct 2026 23:30:00 GMT";

function deps(): { deps: Deps; ledger: Map<string, DeliveryRow>; checked: string[] } {
  const ledger = new Map<string, DeliveryRow>();
  const checked: string[] = [];
  const claims: ClaimTarget[] = [
    { id: "143_10182_0xabc_1", feedbackUri: "https://x.example/doc.json", feedbackHash: "0x" + "11".repeat(32), outcome: "false" },
  ];
  const d: Deps = {
    now: () => new Date("2026-10-05T23:30:00Z"),
    signingKey: null,
    ensureSchema: async () => {},
    claimDelivery: async (input) => {
      const prior = ledger.get(input.key);
      if (prior && prior.status !== "failed") return { claimed: false, prior };
      ledger.set(input.key, { deliveryKey: input.key, keyedOn: input.keyedOn, webhookId: input.webhookId, eventType: input.eventType, status: "running", agentIds: [], claimsChecked: 0, verdictsAppended: 0, changed: 0, note: "accepted", receivedAt: input.receivedAt, finishedAt: null });
      return { claimed: true };
    },
    finishDelivery: async (key, f) => {
      const row = ledger.get(key);
      if (row) ledger.set(key, { ...row, ...f });
    },
    recentDeliveries: async () => [...ledger.values()],
    agentExists: async () => true,
    claimsForAgent: async () => claims,
    runLadder: async (uri) => {
      checked.push(uri);
      throw new Error("offline in tests");
    },
    appendVerdict: async () => 1,
  } as Deps;
  return { deps: d, ledger, checked };
}

const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");

function body(logs: unknown[], id = "evt-1") {
  return JSON.stringify({ id, event_type: "ALERT", alert_id: "alert-1", transaction: { hash: "0x" + "ab".repeat(32), logs } });
}
const sign = (raw: string, date = DATE, secret = SECRET) => createHmac("sha256", secret).update(raw).update(date).digest("hex");
const post = (raw: string, headers: Record<string, string>) =>
  new Request("https://kanmani.xyz/api/webhooks/tenderly", { method: "POST", body: raw, headers: { "content-type": "application/json", ...headers } });

const registryLog = { address: IDENTITY_REGISTRY, topics: [METADATA_UPDATE_TOPIC], data: word(10182) };

test("tenderly: no secret wired means every delivery is refused, never accepted unchecked", async () => {
  const r = await handleTenderlyWebhook(post(body([registryLog]), {}), deps().deps, null);
  assert.equal(r.status, 503);
});

test("tenderly: an unsigned or wrongly signed delivery is refused before anything is read", async () => {
  const raw = body([registryLog]);
  const h = deps();
  assert.equal((await handleTenderlyWebhook(post(raw, { date: DATE }), h.deps, SECRET)).status, 401);
  assert.equal((await handleTenderlyWebhook(post(raw, { date: DATE, "x-tenderly-signature": sign(raw, DATE, "wrong") }), h.deps, SECRET)).status, 401);
  // The Date header is inside the digest, so changing it breaks the signature.
  assert.equal((await handleTenderlyWebhook(post(raw, { date: "Tue, 06 Oct 2026 00:00:00 GMT", "x-tenderly-signature": sign(raw) }), h.deps, SECRET)).status, 401);
  assert.equal(h.ledger.size, 0);
});

test("tenderly: a signed registry event re-checks that agent's claims through the shared path", async () => {
  const raw = body([registryLog]);
  const h = deps();
  const r = await handleTenderlyWebhook(post(raw, { date: DATE, "x-tenderly-signature": sign(raw) }), h.deps, SECRET);
  assert.ok([200, 500].includes(r.status), `status ${r.status}`);
  assert.deepEqual(h.checked, ["https://x.example/doc.json"]);
  assert.ok(h.ledger.has("tenderly:evt-1"));
  assert.equal(h.ledger.get("tenderly:evt-1")!.keyedOn, "tenderly-id");
});

test("tenderly: a log from another contract is recorded as ignored", async () => {
  const raw = body([{ ...registryLog, address: "0x" + "99".repeat(20) }], "evt-2");
  const h = deps();
  const r = await handleTenderlyWebhook(post(raw, { date: DATE, "x-tenderly-signature": sign(raw) }), h.deps, SECRET);
  assert.equal(r.status, 200);
  assert.equal(h.ledger.get("tenderly:evt-2")!.status, "ignored");
  assert.equal(h.checked.length, 0);
});

test("tenderly: the same delivery id twice is a replay, nothing re-checked", async () => {
  const raw = body([{ ...registryLog, address: "0x" + "99".repeat(20) }], "evt-3");
  const h = deps();
  await handleTenderlyWebhook(post(raw, { date: DATE, "x-tenderly-signature": sign(raw) }), h.deps, SECRET);
  const r = await handleTenderlyWebhook(post(raw, { date: DATE, "x-tenderly-signature": sign(raw) }), h.deps, SECRET);
  const j = (await r.json()) as { data?: { status?: string }; status?: string };
  assert.equal(j.data?.status ?? j.status, "replayed");
});

test("tenderly: parse refuses a body with no id and reads logs flat or under raw", () => {
  assert.equal(parseTenderly({ event_type: "ALERT", transaction: {} }).ok, false);
  const p = parseTenderly({ id: "x", event_type: "TEST", transaction: { hash: "0x1", logs: [{ raw: registryLog }, registryLog, { junk: true }] } });
  assert.ok(p.ok && p.delivery.logs.length === 2);
});

test("tenderly: a malformed signature header is refused without throwing", () => {
  assert.equal(verifyTenderlySignature("{}", DATE, "not-hex", SECRET), false);
});
