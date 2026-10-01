/**
 * The /fund flow state machine, pure so it is unit-tested under `node --test` with no browser.
 *
 * The seven UI states item 3.2 names map onto the real Aurora execution states. The mapping is the
 * whole point: the UI never shows a state Aurora did not report, and an unknown or missing state holds
 * rather than guessing `funded`. Showing "done" on a value you could not read is exactly the fail-open
 * this project exists to expose, so it does not happen to our own money flow.
 *
 * Aurora states (docs.intents.aurora.dev lifecycle tables, read 2026-10-01):
 *   active:   CREATED, DEPOSIT_PENDING, DEPOSIT_PROCESSING, OPERATION_PENDING, OPERATION_PROCESSING, SUCCESS
 *   terminal: EXPIRED, DEPOSIT_FAILED, OPERATION_FAILED
 *
 * The refund split matters and is asserted in the tests: EXPIRED and DEPOSIT_FAILED refund the deposit,
 * while OPERATION_FAILED (a short landing) leaves funds at the intermediary for client recovery. Copying
 * one case onto the other would tell a refunded user their money is stuck, or the reverse.
 */

export type FundUiState =
  | "form"
  | "quote"
  | "signing"
  | "awaiting-deposit"
  | "bridging"
  | "funded"
  | "short-landing"
  | "expired"
  | "error";

/** Fixed 4s between polls. Aurora says transitions are eventual, so a tighter poll buys nothing. */
export const POLL_DELAY_MS = 4000;
/** Hard ceiling on total polling, so a stuck execution never polls forever (hardening: ceilings). */
export const MAX_POLL_MS = 30 * 60_000;
export const MAX_POLL_ATTEMPTS = Math.ceil(MAX_POLL_MS / POLL_DELAY_MS);

export function nextPollDelay(): number {
  return POLL_DELAY_MS;
}

/**
 * Map an Aurora execution state to a UI state. Only called once a deposit address exists, so CREATED
 * means the signature is in and we are waiting on the deposit. Anything unrecognised holds at
 * `awaiting-deposit` (the caller shows the raw string as unknown) and never advances to `funded`.
 */
export function mapAuroraState(auroraState: string): FundUiState {
  switch (auroraState) {
    case "CREATED":
    case "DEPOSIT_PENDING":
      return "awaiting-deposit";
    case "DEPOSIT_PROCESSING":
    case "OPERATION_PENDING":
    case "OPERATION_PROCESSING":
      return "bridging";
    case "SUCCESS":
      return "funded";
    case "OPERATION_FAILED":
      return "short-landing";
    case "EXPIRED":
    case "DEPOSIT_FAILED":
      return "expired";
    default:
      return "awaiting-deposit";
  }
}

/** The three states the poll stops on. A still-active or unknown state keeps polling. */
export function isTerminal(s: FundUiState): boolean {
  return s === "funded" || s === "short-landing" || s === "expired";
}

/** Whether a terminal state refunds the deposit (EXPIRED/DEPOSIT_FAILED) rather than leaving it at the intermediary. */
export function isRefundState(s: FundUiState): boolean {
  return s === "expired";
}
