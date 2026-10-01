import { test } from "node:test";
import assert from "node:assert/strict";
import { repromptFor, repromptReason, type Reprompt } from "./session-reprompt.ts";

test("in scope and in time never re-prompts", () => {
  assert.equal(repromptFor(null), "none");
});

test("an expired or ended session renews with one sign-in", () => {
  assert.equal(repromptFor("SESSION_EXPIRED"), "renew");
  assert.equal(repromptFor("SESSION_ENDED"), "renew");
});

test("over the cap raises the cap, a wrong payee re-pins", () => {
  assert.equal(repromptFor("SCOPE_EXCEEDED"), "raiseCap");
  assert.equal(repromptFor("WRONG_SIGNER"), "rePin");
});

test("every decision has a human reason", () => {
  for (const r of ["none", "renew", "raiseCap", "rePin"] as Reprompt[]) {
    assert.equal(typeof repromptReason(r), "string");
    assert.ok(repromptReason(r).length > 0);
  }
});
