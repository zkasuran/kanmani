/**
 * The `settled` rung against a real chain, from the command line.
 *
 *   set -a && . ../.env.local && set +a
 *   node --experimental-strip-types src/cli/settled.ts <network> <txHash> <recipient> [asset] [amount]
 *
 * Prints what the transaction actually did, not only the answer, because "none of them to this
 * agent" is only meaningful next to the transfers it did make.
 *
 * The reader here is the only place in this rung that knows a provider exists. `settledCheck` is
 * written against the three reads it needs, so its decision logic is testable with no network.
 */
import { createPublicClient, http as viemHttp } from "viem";
import { CHAINS, coverageTable, resolveChain, type Chain } from "../chains.ts";
import {
  settledCheck,
  type NativeTransfer,
  type SettlementReader,
  type SettlementReceipt,
} from "../ladder/settled.ts";

const cache = new Map<number, SettlementReader | null>();

/**
 * A reader per chain. Null when that chain has no endpoint configured.
 *
 * **Null rather than a client pointed at a default.** A silent fallback would make an unconfigured
 * chain look checked, which is the difference between "no payment reached this agent" and "we did
 * not look".
 */
export function settlementReaderFor(chain: Chain, env: NodeJS.ProcessEnv = process.env): SettlementReader | null {
  if (cache.has(chain.id)) return cache.get(chain.id)!;

  const url = env[chain.rpcEnv];
  if (!url) {
    cache.set(chain.id, null);
    return null;
  }

  const client = createPublicClient({ transport: viemHttp(url, { timeout: 10_000, retryCount: 1 }) });

  const reader: SettlementReader = {
    async getBlockNumber() {
      return await client.getBlockNumber();
    },
    async getReceipt(hash) {
      // viem throws TransactionReceiptNotFoundError for a hash the chain does not have. That is an
      // absence rather than a failure, so it becomes null here and every OTHER error is rethrown
      // for `settledCheck` to record as unknown. The match is on the error name rather than on a
      // message substring a provider is free to reword.
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          blockNumber: r.blockNumber,
          status: r.status,
          from: r.from,
          to: r.to,
          logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
        } satisfies SettlementReceipt;
      } catch (e) {
        if (((e as { name?: string })?.name ?? "") === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },
    async getNativeTransfer(hash) {
      try {
        const t = await client.getTransaction({ hash });
        return { to: t.to, value: t.value } satisfies NativeTransfer;
      } catch (e) {
        if (((e as { name?: string })?.name ?? "") === "TransactionNotFoundError") return null;
        throw e;
      }
    },
  };

  cache.set(chain.id, reader);
  return reader;
}

/** Test seam: readers are cached per chain id, so a test changing env needs this. */
export function resetSettlementReaderCache(): void {
  cache.clear();
}

async function main(): Promise<number> {
  const [network, txHash, recipient, asset, amount] = process.argv.slice(2);

  if (!network || !txHash || !recipient) {
    console.error("usage: settled.ts <network> <txHash> <recipient> [asset|native] [atomicAmount]");
    console.error(`covered: ${CHAINS.map((c) => c.key).join(", ")}`);
    return 2;
  }

  const lookup = resolveChain(network);
  console.log(`declared network : ${network}${lookup.known ? ` -> ${lookup.chain.displayName}` : ""}`);
  console.log(`declared tx      : ${txHash}`);
  console.log(`recipient        : ${recipient}`);
  console.log(`claimed asset    : ${asset ?? "not stated, both rails will be read"}`);
  console.log(`claimed amount   : ${amount ?? "not stated"}`);
  console.log();

  const r = await settledCheck(
    { txHash, network, recipient, asset, amount },
    (c) => settlementReaderFor(c),
  );

  if (r.settled === true) {
    console.log(`VERDICT  settled on ${r.chain.displayName}`);
    console.log(`  block          ${r.blockNumber}`);
    console.log(`  confirmations  ${r.confirmations}`);
    console.log(`  received       ${r.transfer.value} atomic units of ${r.transfer.asset}`);
    console.log(`  from           ${r.transfer.from}`);
    // Printed even when true, because an unchecked amount is a gap a reader has to see.
    console.log(`  amount checked ${r.amountCompared ? "yes" : "NO, see the reason"}`);
    console.log(`  checkedAtBlock ${r.checkedAtBlock}`);
    console.log(`  ${r.reason}`);
    return 0;
  }
  if (r.settled === false) {
    console.log(`VERDICT  NOT settled on ${r.chain.displayName}`);
    console.log(`  ${r.reason}`);
    if (r.transfers.length > 0) {
      console.log(`  what it did move, so the answer can be checked:`);
      for (const t of r.transfers) {
        console.log(`    ${t.value} of ${t.asset}  ${t.from} -> ${t.to}`);
      }
    }
    console.log(`  checkedAtBlock ${r.checkedAtBlock}`);
    return 1;
  }

  // Printed differently on purpose. Unknown is not a soft false, it is a different answer.
  console.log("VERDICT  unknown, we could not look");
  console.log(`  ${r.reason}`);
  console.log();
  console.log("coverage, which is what a NOT settled is relative to:");
  for (const row of coverageTable()) {
    console.log(`  ${row.configured ? "yes" : " no"}  ${row.chain} (${row.id})`);
  }
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
