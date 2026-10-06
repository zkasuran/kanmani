#!/usr/bin/env node
/**
 * The unified account: log in and create account in the bar (the address once signed in), /login
 * with two tabs, one dashboard at /account.
 *
 *   node scripts/e2e/account-unified.e2e.mjs [url]     default https://kanmani.xyz
 *
 * Runs a real passkey ceremony in Chrome's virtual authenticator with PRF on, so every assertion is
 * about what the site did, not about a mock. It also checks the two things the change must not break:
 * the Mera stateless test (clear storage, log in again, same address) and a session written before
 * `kind` was removed still reading as logged in.
 */
import { launchPage, argUrl } from "./lib.mjs";
import { addPrfAuthenticator } from "./lib/passkey-authenticator.mjs";

const url = argUrl();
const { browser, page } = await launchPage();
await addPrfAuthenticator(page);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};
const header = () => page.locator("header");

// 1. Signed out: the bar shows log in and create account as direct links, with no dropdown.
await page.goto(`${url}/`, { waitUntil: "networkidle" });
const bar = header().locator("nav").first();
check("there is no create menu in the nav", (await bar.getByRole("link", { name: /^create$/ }).count()) === 0);
const navLogin = bar.getByRole("link", { name: "log in", exact: true });
const navCreate = bar.getByRole("link", { name: "create account", exact: true });
check("the bar shows log in and create account when signed out", (await navLogin.count()) === 1 && (await navCreate.count()) === 1);
check("log in links to /login", (await navLogin.getAttribute("href")) === "/login");
check("create account links to the create tab", (await navCreate.getAttribute("href")) === "/login?tab=create");
await navLogin.hover();
await page.waitForTimeout(700);
check("hovering the account links opens no dropdown", (await page.getByRole("menu").count()) === 0);

// 2. /login: two tabs, the create tab reachable and labelled.
await page.goto(`${url}/login`, { waitUntil: "networkidle" });
check("login tab selected by default", (await page.getByRole("tab", { name: "log in" }).getAttribute("aria-selected")) === "true");
await page.getByRole("tab", { name: "create account" }).click();
await page.waitForURL(/tab=create/);
check("create tab updates the URL", page.url().includes("tab=create"));
check("create tab offers a passkey and a wallet", (await page.getByRole("button", { name: /create with a passkey/i }).count()) === 1 && (await page.getByRole("button", { name: /create with a wallet/i }).count()) === 1);

// 3. Create with a passkey: lands on the dashboard, logged in, no kind anywhere.
await page.getByRole("button", { name: /create with a passkey/i }).click();
await page.waitForURL(/\/account/, { timeout: 30_000 });
await page.getByText("kanmani account · passkey").first().waitFor({ timeout: 20_000 });
check("create lands on /account, logged in", page.url().includes("/account"));
const stored = await page.evaluate(() => sessionStorage.getItem("kanmani.session.v1"));
const rec = stored ? JSON.parse(stored) : {};
check("stored session has no kind", stored !== null && !("kind" in rec), stored ?? "nothing stored");
const address = rec.address;
const navAddr = header().locator("nav").first().getByRole("link", { name: /0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/ });
check("signed in, the bar shows the short address linking to /account", (await navAddr.count()) === 1 && (await navAddr.getAttribute("href")) === "/account");
check("signed in, log in is gone from the bar", (await header().locator("nav").first().getByRole("link", { name: "log in", exact: true }).count()) === 0);

// 4. The dashboard has its sections, and the agents section knows who is signed in.
for (const id of ["payments", "agents", "keys"]) check(`section #${id} exists`, (await page.locator(`section#${id}`).count()) === 1);
const sender = (await page.getByTestId("studio-sender").first().textContent().catch(() => "")) ?? "";
check("agents section signs as the logged-in account", sender.toLowerCase() === address, sender);
check("the keys demo button is still there for the Mera flow", (await page.getByRole("button", { name: "create a passkey", exact: true }).count()) === 1);

// 5. Stateless: clear storage, reload, log in again with the same passkey, same address.
await page.evaluate(() => {
  sessionStorage.clear();
  localStorage.clear();
});
await page.goto(`${url}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /log in with a passkey/i }).click();
await page.waitForURL(/\/account/, { timeout: 30_000 });
const again = JSON.parse((await page.evaluate(() => sessionStorage.getItem("kanmani.session.v1"))) ?? "{}");
check("after clearing storage the same passkey logs into the same address", again.address === address, again.address);

// 6. A session written before kind was removed still reads as logged in.
await page.evaluate((a) => sessionStorage.setItem("kanmani.session.v1", JSON.stringify({ v: 1, address: a, method: "passkey", kind: "agent", since: Date.now() })), address);
await page.goto(`${url}/account`, { waitUntil: "networkidle" });
check("an old session with kind still reads as logged in", (await page.getByText("kanmani account · passkey").count()) > 0);

// 7. Old addresses land in the new places.
await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
check("/studio lands on /account#agents", page.url().endsWith("/account#agents"), page.url());
await page.goto(`${url}/create/agent`, { waitUntil: "networkidle" });
check("/create/agent lands on the create tab", page.url().endsWith("/login?tab=create"), page.url());

// 8. Log out from the dashboard.
await page.goto(`${url}/account`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "log out" }).first().click();
await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15_000 });
check("log out clears the session", (await page.evaluate(() => sessionStorage.getItem("kanmani.session.v1"))) === null);

check("no uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\naccount-unified: ${results.length - failed} of ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
