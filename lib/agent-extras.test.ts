/**
 * The agent extras, tested on the seam that decides 400 against 500.
 *
 * `agent-extras.ts` throws `InputError` on anything the caller got wrong, and the service route
 * catches it and maps it to a 400 (`app/api/service/[slug]/route.ts`). Everything else becomes a
 * 500 with a fixed message. That mapping is the whole fail-closed story for this family of
 * endpoints, and nothing asserted it: a refactor that let an `InputError` escape as a 500 would
 * have turned a caller mistake into "the agent did not complete", and a refactor that widened
 * `isInputError` would have reflected an internal error message back to a stranger as a 400.
 *
 * No database is needed for any of this. Every extra validates its input BEFORE it reads the index,
 * so a bad input is refused on a path that never opens a connection. The one test that does need
 * the index says so and skips.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRAS, extraBySlug, extraCharge, isInputError } from "./agent-extras.ts";

const hasDb = Boolean(process.env.ENVIO_PG_PASSWORD || process.env.FOVEA_DATABASE_URL);
const needsDb = hasDb ? false : "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

/* ------------------------------------------------- the throw the route turns into a 400 */

test("a bad agentId throws InputError, so the route answers 400 and not 500", async () => {
  const ledger = extraBySlug("ledger");
  assert.ok(ledger, "the ledger extra must exist");

  // Each of these is a caller mistake, not a server fault. None may reach the index.
  const badInputs: Record<string, unknown>[] = [
    {},
    { agentId: 0 },
    { agentId: -1 },
    { agentId: 1.5 },
    { agentId: "not a number" },
    { agentId: null },
    { agentId: NaN },
    { agentId: Infinity },
    { agentId: [] },
    { agentId: {} },
  ];
  for (const input of badInputs) {
    await assert.rejects(
      () => ledger!.run(input, 0n),
      (e: unknown) => {
        assert.equal(isInputError(e), true, `${JSON.stringify(input)} must be an InputError, got ${String(e)}`);
        return true;
      },
      `${JSON.stringify(input)} must be refused`,
    );
  }
});

test("isInputError is false for a plain Error, so an internal fault stays a 500", () => {
  // The dangerous direction. If this ever returned true, the route would hand a stranger the
  // message from an internal failure as if it were advice about their input.
  assert.equal(isInputError(new Error("connection refused: 127.0.0.1:5434")), false);
  assert.equal(isInputError(new TypeError("x is not a function")), false);
  assert.equal(isInputError(new RangeError("out of range")), false);
  assert.equal(isInputError("a string"), false);
  assert.equal(isInputError(null), false);
  assert.equal(isInputError(undefined), false);
  assert.equal(isInputError({ message: "pretending" }), false);
});

/* ------------------------------------------------------------------ the catalogue shape */

test("every extra carries the fields the route reads before it runs anything", () => {
  assert.ok(EXTRAS.length > 0);
  const slugs = new Set<string>();
  for (const e of EXTRAS) {
    assert.equal(typeof e.slug, "string", "slug");
    assert.ok(e.slug.length > 0, `${e.slug}: slug is empty`);
    assert.equal(slugs.has(e.slug), false, `${e.slug}: duplicate slug, extraBySlug would shadow one`);
    slugs.add(e.slug);

    // The price is quoted to a buyer before any work happens, so it has to be an atomic integer
    // string. A float here would be signed into a payment requirement.
    assert.match(e.priceAtomic, /^[0-9]+$/, `${e.slug}: priceAtomic must be atomic digits`);
    assert.equal(typeof e.input, "string", `${e.slug}: input`);
    assert.ok(e.input.length > 0, `${e.slug}: input description is empty`);
    assert.equal(typeof e.example, "object", `${e.slug}: example`);
    assert.notEqual(e.example, null, `${e.slug}: example is null`);
    assert.ok(Array.isArray(e.tags), `${e.slug}: tags`);
    assert.equal(typeof e.run, "function", `${e.slug}: run`);
  }
});

test("extraBySlug returns undefined for an unknown slug rather than throwing", () => {
  assert.equal(extraBySlug("no-such-agent"), undefined);
  assert.equal(extraBySlug(""), undefined);
  assert.equal(extraBySlug("__proto__"), undefined);
  assert.ok(extraBySlug("ledger"));
});

/* ------------------------------------------------------------------ the charge */

test("a free extra charges nothing whatever its meter says", () => {
  const free = EXTRAS.find((e) => e.priceAtomic === "0");
  if (!free) return; // nothing to assert if every extra is priced
  const charged = extraCharge(free, { unit: "claim read", used: 9_999, pricePerUnitAtomic: "100", baseAtomic: "1000" });
  assert.equal(charged, 0n, "a zero price is zero no matter how much was used");
});

test("a priced extra never charges above its own ceiling", () => {
  const priced = EXTRAS.find((e) => e.priceAtomic !== "0");
  if (!priced) return;
  const ceiling = BigInt(priced.priceAtomic);
  // Usage far past anything real. The charge is min(ceiling, base + used * perUnit), so the
  // ceiling is what a buyer signed and what they must not be billed past.
  const charged = extraCharge(priced, {
    unit: "claim read",
    used: 1_000_000,
    pricePerUnitAtomic: "1000000",
    baseAtomic: "1000000",
  });
  assert.ok(charged <= ceiling, `charged ${charged} above the ceiling ${ceiling}`);
});

/* ------------------------------------------------------------------ the probe fan-out */

test(
  "the liveness probe fan-out reads a bounded body and reports a refusal rather than throwing",
  { skip: needsDb },
  async () => {
    // Needs the index to find an agent's endpoints. The transport underneath is bounded at 16 KiB
    // and its own cap, truncation flag and timeout are asserted in verifier/src/net/probe.test.ts.
    const pulse = extraBySlug("pulse");
    assert.ok(pulse);
    const r = await pulse!.run({ agentId: 10256 }, 0n);
    const answer = r.answer as { endpoints: { answered: boolean; reason?: string }[] };
    assert.ok(Array.isArray(answer.endpoints));
    for (const p of answer.endpoints) {
      // Either it answered or it says why. Never a throw out of the fan-out.
      if (!p.answered) assert.equal(typeof p.reason, "string");
    }
  },
);
