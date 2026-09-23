/**
 * Conformance and drift tests for the chain registry.
 *
 * These exist so **a half-added chain cannot pass**. Before this file, chains lived in three places
 * that nothing compared, which meant a chain could be added to the verifier, missed in the indexer,
 * and still look integrated. That is the same shape of defect this project exists to point at in
 * other people's data, one floor down, so it gets a test rather than a convention.
 *
 * The drift tests read the other two declarations as text on purpose. Importing the verifier's
 * module would couple the site's test run to the verifier's build, and parsing the YAML would add a
 * dependency to assert something a substring already proves: that the id and the addresses appear
 * where they must.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_REGISTRIES,
  CHAINS,
  byId,
  byKey,
  coverage,
  covered,
  indexedChains,
  registrable,
  registriesFor,
  resolveDeclared,
  txUrl,
} from "./chains.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/* ------------------------------------------------------------------ conformance */

test("every chain is complete, so a partly-filled entry cannot ship", () => {
  assert.ok(CHAINS.length > 0);
  for (const c of CHAINS) {
    assert.ok(Number.isInteger(c.id) && c.id > 0, `${c.key}: id must be a positive integer`);
    assert.match(c.key, /^[a-z0-9-]+$/, `${c.key}: key is used in URLs, so keep it a slug`);
    assert.ok(c.displayName.trim().length > 0, `${c.key}: needs a display name`);
    assert.ok(c.aliases.length > 0, `${c.key}: needs at least one alias, or no document can name it`);
    assert.match(c.rpcEnv, /^RPC_[A-Z0-9_]+$/, `${c.key}: rpcEnv should look like RPC_NAME`);
    assert.match(c.explorer, /^https:\/\/[^/]+$/, `${c.key}: explorer must be an https origin with no trailing slash`);
  }
});

test("chain ids and keys are unique", () => {
  assert.equal(new Set(CHAINS.map((c) => c.id)).size, CHAINS.length, "duplicate chain id");
  assert.equal(new Set(CHAINS.map((c) => c.key)).size, CHAINS.length, "duplicate chain key");
});

test("no alias is claimed by two chains, because that makes a document ambiguous", () => {
  const seen = new Map<string, string>();
  for (const c of CHAINS) {
    for (const a of c.aliases) {
      const prior = seen.get(a);
      assert.equal(prior, undefined, `alias "${a}" is claimed by both ${prior} and ${c.key}`);
      seen.set(a, c.key);
    }
  }
});

test("aliases are lowercase and trimmed, because resolution lowercases the input", () => {
  for (const c of CHAINS) {
    for (const a of c.aliases) {
      assert.equal(a, a.toLowerCase().trim(), `${c.key}: alias "${a}" must be lowercase and trimmed`);
    }
  }
});

test("a chain is reachable by its own key and every one of its aliases", () => {
  for (const c of CHAINS) {
    assert.equal(byKey(c.key)?.id, c.id);
    assert.equal(byId(c.id)?.key, c.key);
    for (const a of c.aliases) {
      assert.equal(resolveDeclared(a)?.id, c.id, `${c.key}: alias "${a}" did not resolve`);
      assert.equal(resolveDeclared(` ${a.toUpperCase()} `)?.id, c.id, `${c.key}: "${a}" must resolve case and space insensitively`);
    }
  }
});

test("an unrecognised network resolves to undefined rather than to a nearby guess", () => {
  for (const bad of ["", "   ", "solana", "monad testnet", "not a chain", 143, null, undefined, {}]) {
    assert.equal(resolveDeclared(bad as unknown), undefined, `${String(bad)} must not resolve`);
  }
});

/* ------------------------------------------------------------------ the registries */

test("the canonical registry addresses are well formed and distinct", () => {
  const { identity, reputation, validation } = CANONICAL_REGISTRIES;
  for (const [name, a] of Object.entries({ identity, reputation, validation })) {
    assert.match(a, ADDRESS, `${name} is not an address`);
  }
  assert.equal(new Set([identity, reputation, validation]).size, 3, "the three registries must differ");
});

test("a chain with no ERC-8004 deployment returns null rather than plausible addresses", () => {
  const without = CHAINS.filter((c) => c.erc8004 === null);
  assert.ok(without.length > 0, "this test is meaningless if every chain hosts the registries");
  for (const c of without) {
    assert.equal(registriesFor(c.id), null, `${c.key}: must not be handed addresses it does not have`);
  }
});

test("a chain with a deployment gets addresses and a sane start block", () => {
  const withDeployment = registrable();
  assert.ok(withDeployment.length > 0);
  for (const c of withDeployment) {
    const r = registriesFor(c.id);
    assert.ok(r, `${c.key}: registrable chains must resolve registries`);
    assert.match(r!.identity, ADDRESS);
    assert.ok(Number.isInteger(c.erc8004!.startBlock) && c.erc8004!.startBlock >= 0, `${c.key}: bad start block`);
  }
});

test("indexed is a subset of registrable, because you cannot index a chain with no registry", () => {
  const registrableIds = new Set(registrable().map((c) => c.id));
  for (const c of indexedChains()) {
    assert.ok(registrableIds.has(c.id), `${c.key}: indexed but not registrable`);
  }
});

test("Monad is registrable and indexed, since every number on this site is measured there", () => {
  const monad = byId(143);
  assert.ok(monad, "chain 143 must be in the registry");
  assert.ok(monad!.erc8004, "Monad must carry an ERC-8004 deployment");
  assert.equal(monad!.erc8004!.indexed, true);
});

/* ------------------------------------------------------------------ coverage */

test("coverage reflects the environment, because a declared chain with no endpoint is uncovered", () => {
  const monad = byId(143)!;
  assert.equal(covered(143, {}), false, "no endpoint means uncovered, which makes a claim unknown");
  assert.equal(covered(143, { [monad.rpcEnv]: "https://rpc.monad.xyz" }), true);
  assert.equal(covered(999999, { ANYTHING: "x" }), false, "an unknown chain is never covered");
});

test("the coverage table lists every chain, so a reader sees what was not looked at", () => {
  const rows = coverage({});
  assert.equal(rows.length, CHAINS.length);
  assert.ok(rows.every((r) => r.configured === false));
});

test("a transaction link is built per chain, and unknown chains get null rather than a broken URL", () => {
  assert.equal(txUrl(143, "0xabc"), "https://monadexplorer.com/tx/0xabc");
  assert.equal(txUrl(999999, "0xabc"), null);
});

/* ------------------------------------------------------------------ drift */

/**
 * Anchored matchers, because a substring search is wrong here in a way that passes.
 *
 * `- id: 1` occurs inside `- id: 143`. A plain `includes` therefore reports Ethereum as present in a
 * file that only mentions Monad, which is a green test asserting the opposite of the truth. Both
 * patterns below anchor to the end of the line. This is the bug the tests were written to catch,
 * found in the tests themselves on the first run.
 */
const yamlChainId = (id: number) => new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, "m");
const tsChainId = (id: number) => new RegExp(`^\\s*id:\\s*${id}\\s*,\\s*$`, "m");

test("the verifier's chain list has not drifted from the registry", () => {
  const src = readFileSync(new URL("../verifier/src/chains.ts", import.meta.url), "utf8");
  for (const c of CHAINS) {
    assert.match(src, tsChainId(c.id), `verifier/src/chains.ts is missing chain ${c.id} (${c.key})`);
    assert.ok(src.includes(`rpcEnv: "${c.rpcEnv}"`), `verifier/src/chains.ts is missing ${c.rpcEnv}`);
    for (const a of c.aliases) {
      assert.ok(src.includes(`"${a}"`), `verifier/src/chains.ts is missing alias "${a}" for ${c.key}`);
    }
  }
});

test("the indexer config declares every registrable chain, at the right addresses", () => {
  const yaml = readFileSync(new URL("../indexer/config.yaml", import.meta.url), "utf8");
  for (const c of registrable()) {
    assert.match(yaml, yamlChainId(c.id), `indexer/config.yaml is missing chain ${c.id} (${c.key})`);
    const r = registriesFor(c.id)!;
    for (const [name, addr] of Object.entries(r)) {
      assert.ok(yaml.includes(addr), `indexer/config.yaml is missing the ${name} registry ${addr} for ${c.key}`);
    }
  }
});

test("the indexer does not index a chain the registry says has no deployment", () => {
  const yaml = readFileSync(new URL("../indexer/config.yaml", import.meta.url), "utf8");
  for (const c of CHAINS.filter((x) => x.erc8004 === null)) {
    assert.doesNotMatch(
      yaml,
      yamlChainId(c.id),
      `indexer/config.yaml indexes ${c.key} (${c.id}) but the registry says it hosts no ERC-8004 deployment`,
    );
  }
});
