/**
 * When does a signing session re-prompt, and for what.
 *
 * Mera's session never prompts once open: `toViemAccount` signs with no ceremony until `end()`. So a
 * "re-prompt" is always the app choosing to run one more passkey ceremony, and the only question is
 * which refusal justifies it. This maps `assertCanPay`'s codes to that decision in one place, so the
 * rule "re-prompt only for out-of-scope actions" is one tested function rather than scattered `if`
 * branches across the UI.
 */
import type { SessionErrorCode } from "./session.ts";

export type Reprompt =
  /** In scope, in time, right payee. Zero prompts, the prompt-free path. */
  | "none"
  /** Expired or ended. One sign-in ceremony reopens the session. */
  | "renew"
  /** The amount is over the ceiling. One ceremony reopens a session the user agrees covers it. */
  | "raiseCap"
  /** The payee is outside scope. Re-pin and re-consent. */
  | "rePin";

export function repromptFor(code: SessionErrorCode | null): Reprompt {
  switch (code) {
    case null:
      return "none";
    case "SESSION_EXPIRED":
    case "SESSION_ENDED":
      return "renew";
    case "SCOPE_EXCEEDED":
      return "raiseCap";
    case "WRONG_SIGNER":
      return "rePin";
    default:
      return "none";
  }
}

/** One line a person can read for why the next action asks for the passkey again. */
export function repromptReason(r: Reprompt): string {
  switch (r) {
    case "none":
      return "In scope and in time, so this signs with no prompt.";
    case "renew":
      return "The session expired, so one sign-in reopens it.";
    case "raiseCap":
      return "This is over the session's ceiling, so a fresh consent opens one that covers it.";
    case "rePin":
      return "This pays an address outside the session's scope, so it re-pins and asks again.";
    default:
      return "In scope and in time, so this signs with no prompt.";
  }
}
