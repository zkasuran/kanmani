/**
 * The test total the site publishes, kept as three measured numbers rather than one typed figure.
 *
 * The hero said 503 for days after the real total became 511, because it was a single literal nobody
 * re-derived. Splitting it per suite means the arithmetic is checkable and `lib/counts.test.ts`
 * asserts the sum, so a stale part can no longer hide inside a plausible whole.
 *
 * Never edit these by hand. `npm run counts` runs the suites, writes the measured numbers here and
 * refreshes every doc marker, the README badge and the README art from them, so they change together.
 */
export const SUITES = {
  /** The app's own tests: `node --test` over `lib/**\/*.test.ts`. 15 skip without a database. */
  site: { pass: 535, total: 550 },
  /** The verifier: `node --test` over `verifier/src/**\/*.test.ts`. 27 skip without a database. */
  verifier: { pass: 216, total: 243 },
  /**
   * `forge test` in `contracts/`, default profile. 9 skip there: 6 fork tests that need an archive
   * node, 2 that need ffi and the AgentPasskey suite, which needs the P256 precompile and runs under
   * `FOUNDRY_PROFILE=p256` instead. `./verify.sh` runs all three tiers.
   */
  contracts: { pass: 172, total: 182 },
} as const;

export const TESTS_PASSING = SUITES.site.pass + SUITES.verifier.pass + SUITES.contracts.pass;

/** Skips are deliberate, mostly fork tests needing an archive node. Published so the gap is not a mystery. */
export const TESTS_SKIPPED =
  SUITES.site.total - SUITES.site.pass +
  (SUITES.verifier.total - SUITES.verifier.pass) +
  (SUITES.contracts.total - SUITES.contracts.pass);
