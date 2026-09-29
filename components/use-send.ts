"use client";

/**
 * Send one transaction from whoever is logged in and wait for it to be mined.
 *
 * Shared by every owner action (bond, passkey binding) so the rules cannot drift between them:
 *   wallet   moved to Monad first; must still be the account that logged in; the wallet signs.
 *   passkey  keys unlocked with one prompt if a reload dropped them; signed in a session scoped to
 *            `maxAmountAtomic` and to one contract for two minutes, then zeroed.
 * A reverted receipt is an error, never a success.
 */
import { useCallback, useMemo } from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { ensureWalletChain, useSession, walletProvider } from "@/components/session.tsx";
import { viemChain } from "@/lib/chains.ts";
import { openSession } from "@/lib/session.ts";

export function useSend() {
  const s = useSession();
  const chain = useMemo(() => viemChain(143)!, []);
  const pub = useMemo(() => createPublicClient({ chain, transport: http() }), [chain]);
  const sender = useMemo(() => (s.session ? { kind: s.session.method, address: s.session.address } : null), [s.session]);

  const send = useCallback(
    async (o: { to: `0x${string}`; data: `0x${string}`; spendAtomic: bigint; label: string }): Promise<`0x${string}`> => {
      if (!sender) throw new Error("Log in first.");
      let hash: `0x${string}`;
      if (sender.kind === "wallet") {
        const w = walletProvider();
        if (!w) throw new Error("No browser wallet on this page.");
        await ensureWalletChain(w, chain);
        const [from] = ((await w.request({ method: "eth_requestAccounts" })) as string[]).map((a) => a.toLowerCase());
        if (from !== sender.address.toLowerCase()) throw new Error(`The wallet is on ${from}, not the account you logged in with.`);
        hash = await createWalletClient({ account: sender.address, chain, transport: custom(w) }).sendTransaction({ to: o.to, data: o.data, account: sender.address, chain });
      } else {
        const keys = s.keys ?? (await s.unlock());
        if (!keys) throw new Error("The passkey was not unlocked.");
        const session = openSession({
          privateKey: keys.account.privateKey,
          scope: { label: o.label, maxAmountAtomic: o.spendAtomic, payTo: o.to, resourceHost: window.location.host },
          ttlMs: 120_000,
        });
        try {
          session.assertCanPay(o.spendAtomic, o.to);
          hash = await createWalletClient({ account: session.account, chain, transport: http() }).sendTransaction({ to: o.to, data: o.data, account: session.account, chain });
        } finally {
          session.end();
        }
      }
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("The transaction was mined and reverted. Nothing changed.");
      return hash;
    },
    [sender, s, chain, pub],
  );

  return { sender, send, pub, chain, session: s };
}

/** viem wraps a wallet's 4001 inside its own errors, so look through the cause chain. */
export function declined(e: unknown): boolean {
  for (let x = e as { code?: number; name?: string; cause?: unknown } | undefined, i = 0; x && i < 6; x = x.cause as typeof x, i++) {
    if (x.code === 4001 || x.name === "UserRejectedRequestError" || x.name === "NotAllowedError") return true;
  }
  return false;
}
