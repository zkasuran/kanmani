/**
 * `locate` against real chains, from the command line.
 *
 *   set -a && . ../.env.local && set +a
 *   node --experimental-strip-types src/cli/locate.ts <network> <txHash>
 *
 * Prints the verdict plus the coverage table, because a `false` only means anything next to the
 * list of chains it was tested against.
 */
import { CHAINS, coverageTable, resolveChain } from "../chains.ts";
import { locate } from "../ladder/locate.ts";
import { readerFor } from "../rpc.ts";

const [network, txHash] = process.argv.slice(2);

if (!network || !txHash) {
  console.error("usage: locate.ts <network> <txHash>");
  console.error(`covered: ${CHAINS.map((c) => c.key).join(", ")}`);
  process.exit(2);
}

const lookup = resolveChain(network);
console.log(`declared network : ${network}${lookup.known ? ` -> ${lookup.chain.displayName}` : ""}`);
console.log(`declared tx      : ${txHash}`);
console.log();

const outcome = await locate(network, txHash, (c) => readerFor(c));

if (outcome.found === true) {
  console.log(`VERDICT  found on ${outcome.chain.displayName}`);
  console.log(`  block          ${outcome.blockNumber}`);
  console.log(`  status         ${outcome.status}`);
  console.log(`  from           ${outcome.from}`);
  console.log(`  to             ${outcome.to}`);
  console.log(`  checkedAtBlock ${outcome.checkedAtBlock}`);
} else if (outcome.found === false) {
  console.log(`VERDICT  NOT found on ${outcome.chain.displayName}`);
  console.log(`  ${outcome.reason}`);
  console.log(`  checkedAtBlock ${outcome.checkedAtBlock}`);
} else {
  // Printed differently on purpose. Unknown is not a soft false, it is a different answer.
  console.log("VERDICT  unknown, we could not look");
  console.log(`  ${outcome.reason}`);
}

console.log();
console.log("coverage, which is what a NOT found is relative to:");
for (const row of coverageTable()) {
  console.log(`  ${row.configured ? "yes" : " no"}  ${row.chain} (${row.id})`);
}
