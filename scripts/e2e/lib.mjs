/**
 * Shared helpers for the e2e suites.
 *
 * Every suite is a standalone Node script that takes the target URL as argv[2], prints one line
 * per check and exits non-zero on any failure. These helpers keep that contract uniform so the
 * runner (run.mjs) can treat every suite the same way and a single suite still runs on its own.
 *
 * No key, no env file, no POST to a third party. The suites GET public pages only, the same posture
 * scripts/prove.sh keeps.
 */
import { chromium } from "playwright";

/** The URL under test. argv[2] wins, then a default so a bare run still works. */
export function argUrl() {
  return (process.argv[2] ?? "https://kanmani.xyz").replace(/\/$/, "");
}

/**
 * Launch system Chrome, not a bundled browser. `executablePath` points at the installed Chrome, so
 * `npx playwright install` is not needed on a box that already has one. The CHROME env override is
 * kept from the original suites so a machine with Chrome elsewhere still works.
 */
export async function launchChrome() {
  const executablePath = process.env.CHROME ?? "/usr/bin/google-chrome";
  return chromium.launch({ executablePath, args: ["--no-sandbox"] });
}

/**
 * A browser with one context and one page already open, for suites that drive a single tab.
 * `launchChrome` returns the bare browser; five suites were written against this shape and
 * destructured `{ browser, context, page }` out of a value that had none of them, so every one died
 * on its first line before reaching the site.
 */
export async function launchPage() {
  const browser = await launchChrome();
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * A suite opts out of the current URL by exiting 2 with a stated reason, which the runner counts as
 * SKIP rather than a failure. Used where a check needs something the given URL does not expose (a
 * local build, a virtual authenticator that will not seed against a remote origin).
 */
export function skip(reason) {
  console.log(`SKIP ${reason}`);
  process.exit(2);
}

/**
 * A tiny check/report harness. `ok`/`bad` print one line each, `check` records a boolean, and
 * `done` prints the suite's tally and exits non-zero when anything failed. Kept deliberately small:
 * the value is a uniform exit code, not a framework.
 */
export function checks(name) {
  let pass = 0;
  let fail = 0;
  const api = {
    ok(msg) {
      console.log(`  ok    ${msg}`);
      pass += 1;
    },
    bad(msg) {
      console.log(`  BUG   ${msg}`);
      fail += 1;
    },
    note(msg) {
      console.log(`        ${msg}`);
    },
    check(cond, msg) {
      if (cond) api.ok(msg);
      else api.bad(msg);
      return Boolean(cond);
    },
    get failed() {
      return fail;
    },
    done() {
      console.log(`\n  ${name}: ${pass} ok, ${fail} failed`);
      return fail;
    },
    exit() {
      process.exit(api.done() ? 1 : 0);
    },
  };
  return api;
}

/**
 * Collect every console error and uncaught page error a page throws, plus any CSP violation it
 * reports. A strict CSP is generated at build time (next.config.ts), so a suite that injects its own
 * script would trip script-src: these listeners read through Playwright's own events rather than
 * injecting anything, which is why health.mjs never calls page.evaluate with inline script.
 */
export function collectPageErrors(page) {
  const errors = [];
  /**
   * Refusals the page asked for and handles. /fund quotes every source chain on load and Aurora
   * refuses some of them (422, its reason shown in the row) or the server has no key (503). The
   * browser still logs each as "Failed to load resource", which is not a page fault. Each such
   * response cancels exactly one of those console lines, so an unrelated failed load still counts.
   */
  let handled = 0;
  page.on("response", (res) => {
    if (/\/api\/fund\/quote$/.test(new URL(res.url()).pathname) && (res.status() === 422 || res.status() === 503)) handled++;
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (handled > 0 && /^Failed to load resource: the server responded with a status of (422|503)/.test(t)) {
      handled--;
      return;
    }
    errors.push(`console: ${t}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Install a virtual WebAuthn authenticator on the page's context, via raw CDP.
 *
 * Chromium only, which the whole suite already is. A ctap2 internal authenticator with resident keys
 * and user verification is what the passkey flow (lib/passkey.ts) expects. `hasPrf` is deliberately
 * NOT set here: flagship 0.1 only guarantees the create/get path runs headless. Whether a virtual
 * authenticator yields a usable PRF output is unconfirmed from Chrome's own spec and belongs to
 * flagship 1.4 and 2.1, which deepen these suites with the PRF-derived assertions.
 */
export async function installVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

/** Whether WebAuthn is present in the page, the same narrow check lib/passkey.ts:webAuthnAvailable uses. */
export async function webAuthnAvailable(page) {
  return page.evaluate(
    () =>
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator?.credentials?.create === "function",
  );
}

/**
 * Create one P-256 resident credential against the page's own origin, proving the virtual
 * authenticator seeds. Returns true on success, or an error string the caller turns into a SKIP.
 */
export async function createCredential(page) {
  return page.evaluate(async () => {
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: new Uint8Array(32),
          rp: { name: "kanmani-e2e", id: location.hostname },
          user: { id: new Uint8Array(16), name: "e2e@kanmani", displayName: "e2e" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          timeout: 10000,
        },
      });
      return Boolean(cred && cred.id);
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
}

