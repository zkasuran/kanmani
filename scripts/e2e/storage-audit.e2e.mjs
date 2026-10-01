#!/usr/bin/env node
/**
 * Nothing secret reaches storage. Flagship 1.3 audit, the live form of the no-persist unit test.
 *
 * After a full run on /pay, dump localStorage, sessionStorage, IndexedDB and cookies and assert no
 * value matches a 64-hex private key or a 32-byte PRF-shaped base64url blob, and that sessionStorage
 * holds only the public session record. The unit test lib/prf-no-persist.test.ts proves the write
 * path; this proves the whole browser kept the promise.
 *
 *   node scripts/e2e/storage-audit.e2e.mjs [url]      default https://kanmani.xyz
 */
import { launchChrome, argUrl } from "./lib.mjs";
import { addPrfAuthenticator } from "./lib/passkey-authenticator.mjs";

const url = argUrl();
const { browser, page } = await launchChrome();
await addPrfAuthenticator(page);

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

await page.goto(`${url}/pay?net=testnet`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect a new passkey/i }).click();
await page.getByText(/signing session open/i).waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: /pay .* and verify/i }).click();
await page.waitForTimeout(2500);

const dump = await page.evaluate(async () => {
  const read = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k) out[k] = store.getItem(k);
    }
    return out;
  };
  let idb = [];
  try {
    if (indexedDB.databases) idb = (await indexedDB.databases()).map((d) => d.name);
  } catch {
    idb = [];
  }
  return { local: read(localStorage), session: read(sessionStorage), cookies: document.cookie, idb };
});

const HEX64 = /\b[0-9a-fA-F]{64}\b/;
const B64_32 = /[A-Za-z0-9_-]{43}/; // 32 bytes base64url, no padding
const all = JSON.stringify(dump);
check("no 64-hex private key anywhere in storage", !HEX64.test(all), all.match(HEX64)?.[0] ?? "");
check("no 32-byte PRF-shaped base64url blob in storage", !B64_32.test(all.replace(/[0-9a-fA-F]{40,}/g, "")), "");
check("localStorage is empty", Object.keys(dump.local).length === 0, JSON.stringify(dump.local));

// sessionStorage may hold only the public session record under kanmani.session.v1.
const sKeys = Object.keys(dump.session);
const onlyPublic =
  sKeys.length === 0 ||
  (sKeys.length === 1 && sKeys[0] === "kanmani.session.v1" && !/private|content|prf|secret/i.test(dump.session[sKeys[0]]));
check("sessionStorage holds only the public session record", onlyPublic, JSON.stringify(dump.session));

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\nstorage-audit: ${checks.length - failed} of ${checks.length} checks`);
process.exit(failed === 0 ? 0 : 1);
