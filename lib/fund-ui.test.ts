import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapAuroraState,
  isTerminal,
  isRefundState,
  nextPollDelay,
  POLL_DELAY_MS,
  MAX_POLL_MS,
  MAX_POLL_ATTEMPTS,
  type FundUiState,
} from "./fund-ui.ts";

/**
 * The state machine, pinned against every Aurora lifecycle value. The load-bearing checks: an unknown
 * state never becomes `funded`, and the EXPIRED-vs-OPERATION_FAILED refund split cannot regress.
 */

test("every active Aurora state maps to the right UI state", () => {
  assert.equal(mapAuroraState("CREATED"), "awaiting-deposit");
  assert.equal(mapAuroraState("DEPOSIT_PENDING"), "awaiting-deposit");
  assert.equal(mapAuroraState("DEPOSIT_PROCESSING"), "bridging");
  assert.equal(mapAuroraState("OPERATION_PENDING"), "bridging");
  assert.equal(mapAuroraState("OPERATION_PROCESSING"), "bridging");
  assert.equal(mapAuroraState("SUCCESS"), "funded");
});

test("the terminal states map to their UI states, keeping the refund split", () => {
  assert.equal(mapAuroraState("OPERATION_FAILED"), "short-landing");
  assert.equal(mapAuroraState("EXPIRED"), "expired");
  assert.equal(mapAuroraState("DEPOSIT_FAILED"), "expired");
});

test("an unknown or empty state holds at awaiting-deposit and never guesses funded", () => {
  assert.equal(mapAuroraState("PROCESSING"), "awaiting-deposit");
  assert.equal(mapAuroraState("COMPLETED"), "awaiting-deposit");
  assert.equal(mapAuroraState(""), "awaiting-deposit");
  assert.equal(mapAuroraState("garbage"), "awaiting-deposit");
});

test("isTerminal is true for exactly the three ending states", () => {
  const terminal: FundUiState[] = ["funded", "short-landing", "expired"];
  const active: FundUiState[] = ["form", "quote", "signing", "awaiting-deposit", "bridging", "error"];
  for (const s of terminal) assert.equal(isTerminal(s), true, s);
  for (const s of active) assert.equal(isTerminal(s), false, s);
});

test("isRefundState is true only for the refund case, so copy cannot cross the two failures", () => {
  assert.equal(isRefundState("expired"), true);
  assert.equal(isRefundState("short-landing"), false);
  assert.equal(isRefundState("funded"), false);
});

test("the poll is bounded by a fixed delay and a hard attempt ceiling", () => {
  assert.equal(nextPollDelay(), POLL_DELAY_MS);
  assert.equal(POLL_DELAY_MS, 4000);
  assert.equal(MAX_POLL_MS, 1_800_000);
  assert.equal(MAX_POLL_ATTEMPTS, 450);
});
