/**
 * Aurora's own refusal reaches the caller, and nothing else does.
 *
 * Every Aurora error used to collapse into "http 400", so the page could only say the quote failed.
 * The most common refusal is an amount under the bridge minimum ("Amount is too low for bridge, try at
 * least 303099"), which the caller can fix in one step if told. Only a 4xx is carried, because a 5xx is
 * Aurora's trouble and not advice. The text is cut to printable ASCII and capped, so control
 * characters and direction overrides cannot reach a caller. It is rendered as escaped text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteFunding, IntentsError, type FetchLike } from "./intents.ts";

const params = {
  wallet: "0x1111111111111111111111111111111111111111",
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  amount: "120000",
  agent: "0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32" as `0x${string}`,
};
const answer = (status: number, body: unknown): FetchLike => async () => ({ ok: status < 300, status, json: async () => body });

async function caught(f: FetchLike): Promise<IntentsError> {
  try {
    await quoteFunding(params, { apiKey: "k", fetchImpl: f });
  } catch (e) {
    assert.ok(e instanceof IntentsError, `expected IntentsError, got ${String(e)}`);
    return e;
  }
  assert.fail("quoteFunding did not throw");
}

test("a 400 with a bridge minimum carries the reason and the minimum", async () => {
  const e = await caught(answer(400, { error: "Amount is too low for bridge, try at least 303099" }));
  assert.equal(e.upstream?.status, 400);
  assert.equal(e.upstream?.message, "Amount is too low for bridge, try at least 303099");
  assert.equal(e.upstream?.minAmount, "303099");
});

test("a 4xx reason without a minimum is carried with minAmount null", async () => {
  const e = await caught(answer(400, { error: "missing required fields" }));
  assert.equal(e.upstream?.message, "missing required fields");
  assert.equal(e.upstream?.minAmount, null);
});

test("a 5xx carries nothing, so its text never reaches a caller", async () => {
  const e = await caught(answer(502, { error: "internal: db at 10.0.0.4 refused" }));
  assert.equal(e.upstream, undefined);
});

test("a 4xx with no readable reason carries nothing", async () => {
  assert.equal((await caught(answer(400, null))).upstream, undefined);
  assert.equal((await caught(answer(400, { error: 42 }))).upstream, undefined);
  const notJson: FetchLike = async () => ({ ok: false, status: 400, json: async () => { throw new Error("not json"); } });
  assert.equal((await caught(notJson)).upstream, undefined);
});

test("control and bidi characters are stripped and the reason is capped", async () => {
  const e = await caught(answer(400, { error: `<script>alert(1)</script>\u0000\u202e${"x".repeat(500)}` }));
  assert.ok(e.upstream);
  assert.equal(/[\u0000-\u001f\u202e]/.test(e.upstream.message), false);
  assert.ok(e.upstream.message.length <= 200);
});
