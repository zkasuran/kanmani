/**
 * Evidence that IS a transaction: a feedback whose URI is a block explorer link to one tx.
 *
 * Some agents publish feedback whose `feedbackUri` is `https://monadvision.com/tx/0x…` rather than a
 * JSON document. There is no document to fetch: explorers answer a script with a 403 or an HTML page,
 * so the fetch-then-hash ladder always stopped at `declared` with "could not be read". But the claim
 * is all in the URI, and the URI is itself what the feedback event committed on chain, so it cannot be
 * swapped afterwards. Reading it is not a guess about a document's shape: the explorer, the chain and
 * the transaction hash are the only things the link can mean.
 *
 * What this reads is deliberately narrow:
 *   - only mainnet explorers, each mapped to exactly one chain we cover;
 *   - only the `/tx/<32-byte hash>` path, with nothing after the hash but an optional slash, query or
 *     fragment;
 *   - no recipient. The link does not name who was paid, so the verdict can only be the tx-exists
 *     `true` (`settlementChecked: false`), never the strong settlement `true`. That is stated in the
 *     reason so a reader does not mistake one for the other.
 */
const EXPLORERS: Record<string, string> = {
  "monadvision.com": "monad",
  "www.monadvision.com": "monad",
  "monadexplorer.com": "monad",
  "www.monadexplorer.com": "monad",
  "monadscan.com": "monad",
  "www.monadscan.com": "monad",
  "etherscan.io": "ethereum",
  "basescan.org": "base",
  "arbiscan.io": "arbitrum",
  "optimistic.etherscan.io": "optimism",
  "polygonscan.com": "polygon",
  "bscscan.com": "bsc",
  "celoscan.io": "celo",
};

export const EXPLORER_TX_MAPPING = "explorer-tx-link.v1";

export type ExplorerTx = { network: string; txHash: string; host: string };

export function explorerTx(uri: string): ExplorerTx | null {
  let u: URL;
  try {
    u = new URL(uri.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const network = EXPLORERS[u.hostname.toLowerCase()];
  if (!network) return null;
  const m = u.pathname.match(/^\/tx\/(0x[0-9a-fA-F]{64})\/?$/);
  if (!m) return null;
  return { network, txHash: m[1]!.toLowerCase(), host: u.hostname.toLowerCase() };
}
