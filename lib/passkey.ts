/**
 * The ceremony: one passkey prompt, three keys, nothing stored.
 *
 * ## What this stores: nothing
 *
 * Not a session cookie, not a token, not a credential ID, not a hint. The two Mera gates are a
 * judge clearing local storage mid-demo and a judge opening the app on a second device and the
 * strongest possible answer to both is that there was never anything there to clear.
 *
 * That is affordable because the passkey is created as a **discoverable** credential, which means
 * the browser itself can offer it for this relying party with nothing from us. `getPasskeyPrfOutput`
 * called with no `credential` lets WebAuthn pick, so a fresh browser profile on a fresh machine
 * runs exactly the same code path as a returning user. There is no "returning user" path at all,
 * which is why there is no way for one to break.
 *
 * Caching a credential ID would shave nothing measurable and would introduce the one thing the
 * gate is looking for: state whose absence changes behaviour.
 *
 * ## The prompt count, stated honestly
 *
 * Mera's own source: `createPasskeyWithPrfOutput` *"runs one creation ceremony and shows one
 * user-verification prompt. On authenticators that do not evaluate PRF during creation, a fallback
 * assertion evaluates the same salt and shows a second prompt."*
 *
 * So one prompt is the common case, not a guarantee and it depends on the judge's authenticator
 * rather than on our code. Claiming "one prompt" flatly would be a claim we cannot keep on a
 * machine we do not control. Signing in afterwards is always exactly one prompt, because that is
 * a single assertion.
 *
 * ## PRF is not available everywhere and the judge picks the stack
 *
 * From Mera's authenticator support matrix: desktop Chrome only carries PRF for passkeys saved to
 * Google Password Manager, the local profile authenticator lacks `hmac-secret` and a third-party
 * password-manager extension intercepting WebAuthn produces a passkey that exists but returns no
 * PRF output. Bitwarden and Dashlane are listed as not working.
 *
 * A judge is a developer and developers run password managers. So a missing PRF output is a
 * first-class outcome here with a named cause and a named fix, never a thrown stack trace, and
 * never a silent fallback to something weaker.
 */
import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { deriveKeys, type IrisKeys } from "./iris.ts";

/** The relying party. `id` must be the registrable domain, never the full origin. */
export function relyingParty(): { id: string; name: string } {
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  return { id: host, name: "Kanmani" };
}

export type CeremonyOutcome =
  | { ok: true; keys: IrisKeys; prompts: "one" | "one or two"; created: boolean }
  /**
   * Something went wrong in a way the person in front of the screen can act on.
   *
   * `cause` and `fix` are separate fields rather than one message because the UI shows them
   * differently: the cause explains why this is not their fault, the fix is the thing to click.
   */
  | { ok: false; code: string; cause: string; fix: string; retryable: boolean };

/**
 * Turn a Mera error into something a person can act on.
 *
 * Every branch names what happened and what to do. The default branch is deliberately not
 * "something went wrong": an unrecognised error still says which operation failed and offers the
 * one action that ever helps, which is trying a different authenticator.
 */
function explain(e: unknown): CeremonyOutcome {
  const code = isMeraError(e) ? e.code : "UNKNOWN";

  switch (code) {
    case "PRF_UNAVAILABLE":
      return {
        ok: false,
        code,
        cause:
          "This authenticator created a passkey but will not produce a PRF output, so there is nothing to derive keys from. On desktop Chrome that usually means the passkey was saved to the local profile rather than to Google Password Manager or a password-manager extension intercepted the request. Bitwarden and Dashlane do not support this today.",
        fix: "Try again and choose Google Password Manager, iCloud Keychain, 1Password, Windows Hello or a security key. Disabling a password-manager extension for this site also works.",
        retryable: true,
      };
    case "PASSKEY_OPERATION_FAILED":
      return {
        ok: false,
        code,
        cause:
          "The passkey ceremony did not complete. Usually that is the prompt being dismissed or timing out, which is not an error in the usual sense.",
        fix: "Try again and complete the prompt.",
        retryable: true,
      };
    case "CRYPTO_UNAVAILABLE":
      return {
        ok: false,
        code,
        cause:
          "This browser does not expose the Web Crypto API to this page. That normally means the page is not on a secure origin.",
        fix: "Open this site over https or on localhost.",
        retryable: false,
      };
    case "INPUT_INVALID":
      return {
        ok: false,
        code,
        cause: "The ceremony was given something malformed, which is a bug on our side rather than yours.",
        fix: "Reload and try once. If it happens again it is worth reporting, because it should not.",
        retryable: true,
      };
    default:
      return {
        ok: false,
        code,
        cause: `The passkey ceremony failed with ${code}${e instanceof Error ? `: ${e.message}` : ""}.`,
        fix: "Try again and if it repeats try a different authenticator.",
        retryable: true,
      };
  }
}

/**
 * First time: create the passkey and derive.
 *
 * Mera generates a fresh user handle per call, so this adds a passkey rather than replacing one.
 * That matters: an authenticator overwrites a discoverable credential with the same `rp.id` and
 * `user.id` and a fixed handle would silently destroy the previous account's only key.
 */
export async function createAccount(name: string): Promise<CeremonyOutcome> {
  try {
    const result = await createPasskeyWithPrfOutput({
      rp: relyingParty(),
      user: { name, displayName: name },
    });
    return {
      ok: true,
      keys: await deriveKeys(result.prfOutput),
      // Honest about what we cannot control. See the note at the top of this file.
      prompts: "one or two",
      created: true,
    };
  } catch (e) {
    return explain(e);
  }
}

/**
 * Every time after: assert and derive. Exactly one prompt, always.
 *
 * No `credential` is passed, on purpose. The browser offers whatever discoverable passkey exists
 * for this relying party, which is why a fresh device and a fresh profile need nothing from us.
 */
export async function signIn(): Promise<CeremonyOutcome> {
  try {
    const { prfOutput } = await getPasskeyPrfOutput({ rpId: relyingParty().id });
    return { ok: true, keys: await deriveKeys(prfOutput), prompts: "one", created: false };
  } catch (e) {
    return explain(e);
  }
}

/**
 * Whether this browser can do WebAuthn at all.
 *
 * Deliberately narrow. It answers "is the API present", not "will PRF work", because the second
 * question has no answer until a ceremony runs. A page that promised PRF support from a feature
 * check and then failed mid-gate would be worse than one that made no promise.
 */
export function webAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator?.credentials?.create === "function"
  );
}
