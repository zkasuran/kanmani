/**
 * The test total the site publishes, kept as three measured numbers rather than one typed figure.
 *
 * The hero said 503 for days after the real total became 511, because it was a single literal nobody
 * re-derived. Splitting it per suite means the arithmetic is checkable and `lib/counts.test.ts`
 * asserts the sum, so a stale part can no longer hide inside a plausible whole.
 *
 * These still need re-running by hand when suites change. The command for each is here so the next
 * person does not have to guess where the number came from, which is the actual reason it went stale.
 */
export const SUITES = {
  /** The app's own tests: `node --test` over `lib/**\/*.test.ts`. 15 skip without a database. */
  site: { pass: 470, total: 485 },
  /** The verifier: `node --test` over `verifier/src/**\/*.test.ts`. 27 skip without a database. */
  verifier: { pass: 214, total: 241 },
  /**
   * `forge test` in `contracts/`, default profile. 9 skip there: 6 fork tests that need an archive
   * node, 2 that need ffi and the AgentPasskey suite, which needs the P256 precompile and runs under
   * `FOUNDRY_PROFILE=p256` instead. `./verify.sh` runs all three tiers.
   */
  contracts: { pass: 124, total: 133 },
} as const;

export const TESTS_PASSING = SUITES.site.pass + SUITES.verifier.pass + SUITES.contracts.pass;

/** Skips are deliberate, mostly fork tests needing an archive node. Published so the gap is not a mystery. */
export const TESTS_SKIPPED =
  SUITES.site.total - SUITES.site.pass +
  (SUITES.verifier.total - SUITES.verifier.pass) +
  (SUITES.contracts.total - SUITES.contracts.pass);
