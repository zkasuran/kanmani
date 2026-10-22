import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionRevoked } from "./claim-views.ts";

const row = (id: string, revoked: boolean) => ({ id, revoked });

test("revoked feedback is separated from live feedback and nothing is lost", () => {
  const rows = [row("a", false), row("b", true), row("c", false), row("d", true)];
  const { live, revoked } = partitionRevoked(rows);
  assert.deepEqual(live.map((r) => r.id), ["a", "c"]);
  assert.deepEqual(revoked.map((r) => r.id), ["b", "d"]);
  assert.equal(live.length + revoked.length, rows.length);
});

test("order is kept inside each group", () => {
  const { live } = partitionRevoked([row("z", false), row("y", true), row("x", false)]);
  assert.deepEqual(live.map((r) => r.id), ["z", "x"]);
});

test("an agent with nothing revoked is returned whole, so its output cannot change", () => {
  const rows = [row("a", false), row("b", false)];
  const { live, revoked } = partitionRevoked(rows);
  assert.deepEqual(live, rows);
  assert.deepEqual(revoked, []);
});

test("empty in, empty out", () => {
  assert.deepEqual(partitionRevoked([]), { live: [], revoked: [] });
});
