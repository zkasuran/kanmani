import { test } from "node:test";
import assert from "node:assert/strict";
import { ADEXTO_FACTORIES_143, listMonadMarkets, resolveMarkets } from "./adexto.ts";

const LOOP = "0x6AF1B9A42213e87B7f3b8a7Ac93447aEA7f615B2" as const;
const PARCEL = "0xC0B02176D37C1a64A6B493335115dB5D6D645E1F" as const;
const UNBOUND = "0x1111111111111111111111111111111111111111" as const;
const CURVE = "0x55B9F98C78cf42186FB3827e0658E0d12C5A9189" as const;

test("list_markets keeps only Monad markets with real addresses, from an SSE answer", async () => {
  const payload = JSON.stringify([
    { chainId: 143, token: LOOP, curve: CURVE },
    { chainId: 42161, token: PARCEL, curve: CURVE },
    { chainId: 143, token: "not an address", curve: CURVE },
  ]);
  const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: payload }] } })}\n`;
  const fake = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await listMonadMarkets(fake), [{ token: LOOP, curve: CURVE }]);
});

test("a market counts only where a factory binds it, checking both factory generations", async () => {
  const reader = {
    agentIdOf: async (f: string, t: string) =>
      t === LOOP && f === ADEXTO_FACTORIES_143[0] ? 10276n : t === PARCEL && f === ADEXTO_FACTORIES_143[1] ? 10251n : 0n,
    symbol: async (t: string) => (t === LOOP ? "LOOP" : t === PARCEL ? "PARCEL" : "X"),
    name: async (t: string) => (t === LOOP ? "Loop" : null),
  };
  const out = await resolveMarkets(
    [{ token: LOOP, curve: CURVE }, { token: PARCEL, curve: CURVE }, { token: UNBOUND, curve: CURVE }],
    reader,
  );
  assert.deepEqual(out.map((m) => [m.agentId, m.symbol, m.name]), [[10276, "LOOP", "Loop"], [10251, "PARCEL", "PARCEL"]]);
  assert.equal(out[0]!.url, "https://adexto.xyz/token/loop?chain=143");
});

test("an unreadable chain binds nothing rather than guessing", async () => {
  const reader = { agentIdOf: async () => null, symbol: async () => "LOOP", name: async () => "Loop" };
  assert.deepEqual(await resolveMarkets([{ token: LOOP, curve: CURVE }], reader), []);
});
