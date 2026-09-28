"use client";

/**
 * Who is logged in, shared by every page for the life of the tab.
 *
 * The rules live in lib/login.ts: public facts in `sessionStorage` until logout or the tab closes,
 * keys in memory only. This file is the React side of those rules plus the two ways in:
 *
 *   passkey  one WebAuthn prompt; the account address is derived from the passkey (lib/passkey)
 *   wallet   any injected EIP-1193 wallet; the wallet signs a plain message, verified here
 *
 * Creating an account and logging in run the same code with one flag, because for both methods an
 * account is an address someone can prove they control. There is no password and no server record.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPublicClient, http } from "viem";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import { type IrisKeys } from "@/lib/iris.ts";
import { viemChain } from "@/lib/chains.ts";
import {
  parseSession,
  sessionRecord,
  walletLoginMessage,
  SESSION_KEY,
  type AccountKind,
  type LoginMethod,
  type StoredSession,
} from "@/lib/login.ts";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...a: unknown[]) => void): void;
  removeListener?(event: string, fn: (...a: unknown[]) => void): void;
};

function injected(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) as Eip1193 | null;
}

/** Whether a browser wallet is present. Asked, never assumed, like `webAuthnAvailable`. */
export function walletAvailable(): boolean {
  return injected() !== null;
}

export type SessionState = {
  /** False until storage has been read, so the bar never flashes "login" at a logged-in reader. */
  ready: boolean;
  session: StoredSession | null;
  /** Passkey keys for this page load. Null for wallet sessions and after a reload until `unlock`. */
  keys: IrisKeys | null;
  busy: LoginMethod | "unlock" | null;
  error: { cause: string; fix: string } | null;
  start(method: LoginMethod, opts: { create: boolean; kind?: AccountKind }): Promise<boolean>;
  /** Rebuild passkey keys after a reload. Refuses a different passkey than the one logged in. */
  unlock(): Promise<IrisKeys | null>;
  /** For pages that run their own passkey ceremony, so the bar and the page never disagree. */
  adopt(outcome: CeremonyOutcome, kind?: AccountKind): void;
  logout(): void;
  clearError(): void;
};

const Ctx = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

function write(s: StoredSession | null) {
  try {
    if (s) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be disabled. The session then lasts for this page only, which is still correct.
  }
}

/** Whether this address owns any agent, so a login lands on the right kind of account. */
async function ownsAgents(address: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/account/${address}`, { cache: "no-store" });
    if (!r.ok) return false;
    const j = (await r.json()) as { data?: { agentCount?: number } };
    return (j.data?.agentCount ?? 0) > 0;
  } catch {
    return false;
  }
}

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  const [busy, setBusy] = useState<SessionState["busy"]>(null);
  const [error, setError] = useState<SessionState["error"]>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const set = useCallback((s: StoredSession | null, k: IrisKeys | null = null) => {
    write(s);
    setSession(s);
    setKeys(k);
  }, []);

  const logout = useCallback(() => {
    set(null);
    setError(null);
  }, [set]);

  // Restore. A wallet session is kept only if the wallet still exposes that address to this site:
  // a wallet that was locked, disconnected or switched means nobody here controls it any more.
  useEffect(() => {
    let live = true;
    const s = parseSession(window.sessionStorage.getItem(SESSION_KEY));
    (async () => {
      if (s?.method === "wallet") {
        const w = injected();
        const accounts = w ? ((await w.request({ method: "eth_accounts" }).catch(() => [])) as string[]) : [];
        if (!accounts.map((a) => a.toLowerCase()).includes(s.address)) {
          if (live) set(null);
          if (live) setReady(true);
          return;
        }
      }
      if (live) {
        setSession(s);
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [set]);

  // Follow the wallet. Switching account in the wallet logs this one out rather than silently
  // carrying the old address, which the new account never proved control of.
  useEffect(() => {
    const w = injected();
    if (!w?.on || session?.method !== "wallet") return;
    const onAccounts = (...a: unknown[]) => {
      const list = ((a[0] as string[]) ?? []).map((x) => x.toLowerCase());
      if (!list.includes(sessionRef.current?.address ?? "")) logout();
    };
    w.on("accountsChanged", onAccounts);
    return () => w.removeListener?.("accountsChanged", onAccounts);
  }, [session?.method, logout]);

  const start = useCallback<SessionState["start"]>(
    async (method, { create, kind }) => {
      setError(null);
      setBusy(method);
      try {
        if (method === "passkey") {
          if (!webAuthnAvailable()) {
            setError({ cause: "This browser has no WebAuthn, so a passkey cannot be used here.", fix: "Use a browser wallet instead or open the site in a current browser." });
            return false;
          }
          const outcome = create ? await createAccount(kind === "agent" ? "Kanmani agent account" : "Kanmani") : await signIn();
          if (!outcome.ok) {
            setError({ cause: outcome.cause, fix: outcome.fix });
            return false;
          }
          const address = outcome.keys.account.address;
          const k = kind ?? ((await ownsAgents(address)) ? "agent" : "user");
          set(sessionRecord(address, "passkey", k, Date.now()), outcome.keys);
          return true;
        }

        const w = injected();
        if (!w) {
          setError({ cause: "No browser wallet was found on this page.", fix: "Install or unlock a wallet such as MetaMask or Rabby then try again. A passkey works too." });
          return false;
        }
        const accounts = (await w.request({ method: "eth_requestAccounts" })) as string[];
        const address = accounts?.[0];
        if (!address) {
          setError({ cause: "The wallet did not share an address.", fix: "Approve the connection in the wallet and try again." });
          return false;
        }
        const message = walletLoginMessage({
          host: window.location.host,
          address,
          kind: kind ?? "user",
          created: create,
          nonce: nonce(),
          issuedAt: new Date().toISOString(),
        });
        const signature = (await w.request({ method: "personal_sign", params: [message, address] })) as `0x${string}`;
        // Checked against the chain, not only by ecrecover, so a smart-contract wallet (ERC-1271)
        // logs in as well as a plain key does.
        const chain = viemChain(143);
        const ok = chain
          ? await createPublicClient({ chain, transport: http() })
              .verifyMessage({ address: address as `0x${string}`, message, signature })
              .catch(() => false)
          : false;
        if (!ok) {
          setError({ cause: "The signature did not verify for that address.", fix: "Try again from the same account. If it repeats the wallet may not support message signing." });
          return false;
        }
        const k = kind ?? ((await ownsAgents(address)) ? "agent" : "user");
        set(sessionRecord(address, "wallet", k, Date.now()));
        return true;
      } catch (e) {
        const code = (e as { code?: number }).code;
        setError(
          code === 4001
            ? { cause: "The request was declined in the wallet.", fix: "Nothing was signed. Try again when ready." }
            : { cause: (e as Error).message || "Signing in failed.", fix: "Try again. If it repeats try the other method." },
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [set],
  );

  const unlock = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.method !== "passkey") return null;
    setBusy("unlock");
    setError(null);
    try {
      const outcome = await signIn();
      if (!outcome.ok) {
        setError({ cause: outcome.cause, fix: outcome.fix });
        return null;
      }
      if (outcome.keys.account.address.toLowerCase() !== s.address) {
        setError({
          cause: "That passkey belongs to a different account than the one logged in.",
          fix: "Choose the passkey for this account or log out and log in with the other one.",
        });
        return null;
      }
      setKeys(outcome.keys);
      return outcome.keys;
    } finally {
      setBusy(null);
    }
  }, []);

  const adopt = useCallback<SessionState["adopt"]>(
    (outcome, kind) => {
      if (!outcome.ok) return;
      const address = outcome.keys.account.address;
      const prev = sessionRef.current;
      const k = kind ?? (prev && prev.address === address.toLowerCase() ? prev.kind : "user");
      set(sessionRecord(address, "passkey", k, prev?.address === address.toLowerCase() ? prev.since : Date.now()), outcome.keys);
    },
    [set],
  );

  const value = useMemo<SessionState>(
    () => ({ ready, session, keys, busy, error, start, unlock, adopt, logout, clearError: () => setError(null) }),
    [ready, session, keys, busy, error, start, unlock, adopt, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
