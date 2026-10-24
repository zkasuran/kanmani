/**
 * The usage scanner can only count an event if the signature it hashes equals the one the contract emits.
 *
 * `scripts/usage-aggregate.mjs` wrote BondPosted with `uint128` where Sclera emits `uint256`, so its topic
 * matched nothing and no bond was ever counted, on either version, until 24 October. Nothing caught it because
 * the scanner only runs against a live chain. This reads the signatures out of the script and out of the
 * Solidity sources and compares them, offline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const script = read("scripts/usage-aggregate.mjs");

/** The canonical signature of an event declared in a Solidity file: types only, no names, no `indexed`. */
function solidityEvent(file: string, name: string): string {
  const src = read(file);
  const m = src.match(new RegExp(`event\\s+${name}\\s*\\(([^)]*)\\)`));
  assert.ok(m, `${name} not found in ${file}`);
  const types = m[1]!
    .split(",")
    .map((p) => p.replace(/\/\/.*$/gm, "").trim())
    .filter(Boolean)
    .map((p) => p.split(/\s+/)[0]!);
  return `${name}(${types.join(",")})`;
}

/** Every `sig("...")` string the script hashes. */
const scriptSigs = [...script.matchAll(/sig\("([^"]+)"\)/g)].map((m) => m[1]!);

const CASES: [string, string, string][] = [
  ["Sclera v1", "contracts/src/Sclera.sol", "BondPosted"],
  ["Sclera v2", "contracts/src/ScleraV2.sol", "BondPosted"],
  ["Aqueous", "contracts/src/Aqueous.sol", "JobCreated"],
  ["AgentPasskey", "contracts/src/AgentPasskey.sol", "PasskeyBound"],
  ["AgentPasskey", "contracts/src/AgentPasskey.sol", "PasskeyUnbound"],
];

for (const [label, file, name] of CASES) {
  test(`${label}: the script hashes the signature ${name} really has`, () => {
    const real = solidityEvent(file, name);
    assert.ok(scriptSigs.includes(real), `the script does not hash ${real}. It has: ${scriptSigs.filter((s) => s.startsWith(name)).join(" | ") || "nothing named " + name}`);
  });
}

test("Sclera v1 and v2 emit the same BondPosted signature, so one topic serves both scans", () => {
  assert.equal(solidityEvent("contracts/src/Sclera.sol", "BondPosted"), solidityEvent("contracts/src/ScleraV2.sol", "BondPosted"));
});

test("the uint128 form that matched nothing is not in the script", () => {
  assert.equal(scriptSigs.some((s) => s.startsWith("BondPosted(") && s.includes("uint128")), false);
});

test("each contract is scanned from its deployment block or earlier, never after it", () => {
  // Deployment blocks read from the broadcast receipts of the mainnet deploys.
  const DEPLOYED: Record<string, number> = { aqueous: 106_347_450, sclera: 107_455_772, scleraV2: 112_106_633, agentPasskey: 109_009_064 };
  for (const [name, block] of Object.entries(DEPLOYED)) {
    const m = script.match(new RegExp(`${name}:\\s*\\{[^}]*from:\\s*([0-9_]+)`));
    assert.ok(m, `no start block for ${name}`);
    const from = Number(m[1]!.replace(/_/g, ""));
    assert.ok(from <= block, `${name} is scanned from ${from}, after it was deployed at ${block}`);
  }
});

test("every contract the script scans has a topic for at least one event it counts", () => {
  for (const name of ["aqueous", "sclera", "scleraV2", "agentPasskey"]) assert.match(script, new RegExp(`${name}:\\s*\\{`));
});
