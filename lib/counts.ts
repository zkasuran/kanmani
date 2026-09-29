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
  /** `npm test` in the repo root. */
  site: { pass: 277, total: 280 },
  /** `npm test` in `verifier/`. */
  verifier: { pass: 181, total: 198 },
  /** `forge test` in `contracts/`. */
  contracts: { pass: 119, total: 127 },
} as const;

export const TESTS_PASSING = SUITES.site.pass + SUITES.verifier.pass + SUITES.contracts.pass;

/** Skips are deliberate, mostly fork tests needing an archive node. Published so the gap is not a mystery. */
export const TESTS_SKIPPED =
  SUITES.site.total - SUITES.site.pass +
  (SUITES.verifier.total - SUITES.verifier.pass) +
  (SUITES.contracts.total - SUITES.contracts.pass);
