"use client";

/**
 * Sign-in and account views, shared by the nav menu, /login and the /account dashboard.
 *
 * Two methods on equal footing, passkey and wallet, for both creating an account and logging in.
 * The account view reads only public state (`/api/account/<address>`), so it shows the same facts a
 * stranger could look up. What the login adds is the right to sign, which is why the passkey keys
 * are shown as present or needing one prompt rather than hidden.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, walletAvailable } from "@/components/session.tsx";
import { webAuthnAvailable } from "@/lib/passkey.ts";
import { displayAddress, shortAddress, type LoginMethod } from "@/lib/login.ts";

type AccountData = {
  address: string;
  balances: { mon: string | null; usdc: string | null };
  agentCount: number;
  agents: { agentId: number; name: string | null; rung: string; feedbackCount: number; bond: string | null }[];
};

/* ------------------------------------------------------------------ sign in */

export function SignIn({
  create,
  compact = false,
  onDone,
}: {
  create: boolean;
  compact?: boolean;
  onDone?: () => void;
}) {
  const s = useSession();
  // Feature checks run after mount so server and client render the same buttons first.
  const [avail, setAvail] = useState<{ passkey: boolean; wallet: boolean } | null>(null);
  useEffect(() => setAvail({ passkey: webAuthnAvailable(), wallet: walletAvailable() }), []);

  const go = async (m: LoginMethod) => {
    if (await s.start(m, { create })) onDone?.();
  };

  const methods: { m: LoginMethod; title: string; hint: string; missing: string }[] = [
    {
      m: "passkey",
      title: create ? "create with a passkey" : "log in with a passkey",
      hint: create
        ? "Face, fingerprint or device PIN. Your address is derived from it, on any device."
        : "The same passkey gives the same address on any device.",
      missing: "No WebAuthn in this browser.",
    },
    {
      m: "wallet",
      title: create ? "create with a wallet" : "log in with a wallet",
      hint: create
        ? "Use the address you already have. You sign one message, no transaction."
        : "Sign one message to prove the address is yours. It costs nothing.",
      missing: "No browser wallet found.",
    },
  ];

  return (
    <div className={compact ? "flex flex-col gap-1.5" : "grid gap-3 sm:grid-cols-2"}>
      {methods.map(({ m, title, hint, missing }) => {
        const off = avail !== null && !avail[m];
        const busy = s.busy === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => go(m)}
            disabled={s.busy !== null}
            aria-describedby={`signin-${m}-hint`}
            className={`signin-method text-left ${compact ? "signin-method--compact" : ""}`}
          >
            <span className="font-mono text-[12.5px] text-[var(--color-text)]">
              {busy ? (m === "passkey" ? "waiting for the passkey…" : "waiting for the wallet…") : title}
            </span>
            <span id={`signin-${m}-hint`} className="mt-1 block text-[11.5px] leading-snug text-muted">
              {off ? missing : hint}
            </span>
          </button>
        );
      })}
      {s.error ? (
        <p role="alert" className={`signin-error text-[12px] leading-relaxed ${compact ? "" : "sm:col-span-2"}`}>
          {s.error.cause} <span className="text-muted">{s.error.fix}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ account */

function useAccount(address: string | undefined) {
  const [data, setData] = useState<AccountData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!address) return;
    setFailed(false);
    try {
      const r = await fetch(`/api/account/${address}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(((await r.json()) as { data: AccountData }).data);
    } catch {
      setFailed(true);
    }
  }, [address]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  return { data, failed, reload: load };
}

/** A balance. `unknown` when it could not be read. Never a zero standing in for "did not look". */
function Balance({ value, unit }: { value: string | null | undefined; unit: string }) {
  if (value === undefined) return <span className="text-faint">…</span>;
  if (value === null) return <span className="unknown-value">unknown</span>;
  // Cut, never rounded, to four places: rounding up would show more than the wallet holds. The
  // exact figure is on hover.
  const [whole, frac = ""] = value.split(".");
  const cut = frac.slice(0, 4).replace(/0+$/, "");
  const shown = cut ? `${whole}.${cut}` : whole;
  return (
    <span className="text-[var(--color-text)]" title={`${value} ${unit}`}>
      {shown !== value && frac.length > 4 ? "≈" : ""}
      {shown} <span className="text-faint">{unit}</span>
    </span>
  );
}

export function AccountSummary({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const s = useSession();
  const router = useRouter();
  const { data, failed } = useAccount(s.session?.address);
  const [copied, setCopied] = useState(false);
  if (!s.session) return null;
  const { address, method, since } = s.session;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(displayAddress(address));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard refused: the full address is still selectable below */
    }
  };
  const logout = () => {
    s.logout();
    onNavigate?.();
    router.push("/");
  };

  const agentsShown = compact ? (data?.agents ?? []).slice(0, 3) : (data?.agents ?? []);

  return (
    <div className="account-view flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="kicker">kanmani account · {method}</span>
          <button
            type="button"
            onClick={copy}
            title="copy the full address"
            className="mt-1 block max-w-full truncate font-mono text-[13px] text-[var(--color-text)] hover:text-[var(--color-brand)]"
          >
            {compact ? shortAddress(address) : displayAddress(address)}
            <span className="ml-2 text-[11px] text-faint">{copied ? "copied" : "copy"}</span>
          </button>
          {!compact ? (
            <span className="mt-0.5 block text-[11.5px] text-faint">
              logged in since {new Date(since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ends when you log out or close this tab
            </span>
          ) : null}
        </div>
        <a
          href={`https://monadscan.com/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-mono text-[11px] text-muted hover:text-[var(--color-text)]"
        >
          explorer ↗
        </a>
      </div>

      <dl className="account-balances grid grid-cols-2 gap-2 font-mono text-[12px]">
        <div>
          <dt className="text-faint">MON</dt>
          <dd><Balance value={failed ? null : data?.balances.mon} unit="MON" /></dd>
        </div>
        <div>
          <dt className="text-faint">USDC</dt>
          <dd><Balance value={failed ? null : data?.balances.usdc} unit="USDC" /></dd>
        </div>
      </dl>

      {method === "passkey" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          {s.keys ? (
            <>signing keys: in this tab&apos;s memory only.</>
          ) : (
            <>
              signing keys: not in memory since the reload.{" "}
              <button type="button" onClick={() => s.unlock()} disabled={s.busy !== null} className="text-[var(--color-brand)] hover:underline">
                {s.busy === "unlock" ? "waiting for the passkey…" : "unlock with one prompt"}
              </button>
            </>
          )}
        </p>
      ) : null}
      {s.error && !compact ? <p role="alert" className="signin-error text-[12px]">{s.error.cause} <span className="text-muted">{s.error.fix}</span></p> : null}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="kicker">your agents</span>
          <span className="font-mono text-[11px] text-faint">
            {failed ? <span className="unknown-value">unknown</span> : data ? data.agentCount : "…"}
          </span>
        </div>
        {data && data.agentCount === 0 ? (
          <p className="mt-1.5 text-[12px] leading-snug text-muted">
            This address owns no registered agent on Monad.{" "}
            <Link href="/account#agents" onClick={onNavigate} className="text-[var(--color-brand)] hover:underline">register one</Link>
          </p>
        ) : null}
        {agentsShown.length ? (
          <ul className="mt-1.5 flex flex-col">
            {agentsShown.map((a) => (
              <li key={a.agentId} className="account-agent flex items-center justify-between gap-3 border-b border-[var(--color-line)]/60 py-1.5 last:border-0">
                <Link href={`/agent/${a.agentId}`} onClick={onNavigate} className="min-w-0 truncate font-mono text-[12px] text-[var(--color-text)] hover:text-[var(--color-brand)]">
                  #{a.agentId} {a.name ?? <span className="text-faint">unnamed</span>}
                </Link>
                <span className="flex shrink-0 gap-2 font-mono text-[11px] text-faint">
                  <span>{a.rung}</span>
                  {a.bond ? (
                    <Link href={`/bond?agent=${a.agentId}#post`} onClick={onNavigate} className="text-[var(--color-true)] hover:underline">bond {a.bond}</Link>
                  ) : (
                    <Link href={`/bond?agent=${a.agentId}#post`} onClick={onNavigate} className="text-[var(--color-brand)] hover:underline">bond it</Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {compact && data && data.agentCount > agentsShown.length ? (
          <Link href="/account#agents" onClick={onNavigate} className="mt-1 block font-mono text-[11px] text-muted hover:text-[var(--color-text)]">
            all {data.agentCount} →
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-line)] pt-3 font-mono text-[12px]">
        {!compact ? null : (
          <Link href="/account" onClick={onNavigate} className="text-[var(--color-text)] hover:text-[var(--color-brand)]">dashboard</Link>
        )}
        <Link href="/account#agents" onClick={onNavigate} className="text-muted hover:text-[var(--color-text)]">agents</Link>
        <Link href="/account#payments" onClick={onNavigate} className="text-muted hover:text-[var(--color-text)]">payments</Link>
        {method === "passkey" ? (
          <Link href="/account#keys" onClick={onNavigate} className="text-muted hover:text-[var(--color-text)]">keys</Link>
        ) : null}
        <button type="button" onClick={logout} className="ml-auto text-muted hover:text-[var(--color-false)]">log out</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ nav pieces */

/** The nav label: `account` until signed in, then the short address with a live dot once logged in. */
export function AccountLabel() {
  const s = useSession();
  // Until storage is read the label keeps its width with a neutral placeholder, so a logged-in reader
  // never sees "account" flash before their address.
  if (!s.ready) return <span className="account-label account-label--pending">account</span>;
  if (!s.session) return <span className="account-label">account</span>;
  return (
    <span className="account-label account-label--in" title={`${displayAddress(s.session.address)} · ${s.session.method}`}>
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-true)]" aria-hidden="true" />
      <span className="sr-only">logged in as </span>
      {shortAddress(s.session.address)}
    </span>
  );
}

/**
 * What the account entry opens. Signed out: the two ways in, each a link to its own tab on /login,
 * so creating and logging in happen on one dedicated page rather than inside a hover panel. Signed
 * in: the account itself, with the dashboard one click away.
 */
export function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const s = useSession();
  if (!s.ready) return <p className="text-[12px] text-faint">…</p>;
  if (s.session) return <AccountSummary compact onNavigate={onNavigate} />;
  return (
    <div className="flex flex-col gap-1.5">
      <Link href="/login" onClick={onNavigate} className="signin-method signin-method--compact block text-left">
        <span className="font-mono text-[12.5px] text-[var(--color-text)]">log in →</span>
        <span className="mt-1 block text-[11.5px] leading-snug text-muted">with the passkey or wallet you used before</span>
      </Link>
      <Link href="/login?tab=create" onClick={onNavigate} className="signin-method signin-method--compact block text-left">
        <span className="font-mono text-[12.5px] text-[var(--color-text)]">create account →</span>
        <span className="mt-1 block text-[11.5px] leading-snug text-muted">a passkey or a wallet you already use. No password, no email</span>
      </Link>
    </div>
  );
}

/**
 * The account entry in the desktop bar, with no dropdown. Signed out it is one button, `account`, to
 * /login, where the log in and create account tabs both live. Signed in it is the short address,
 * linking to /account, where everything for the account lives.
 */
export function AccountNav({ active }: { active: boolean }) {
  const s = useSession();
  const base = "nav-link inline-block rounded px-2.5 py-1.5 font-mono text-[12px] transition-colors";
  if (!s.ready) return <span className={`${base} text-faint`} aria-hidden="true">account</span>;
  if (s.session) {
    return (
      <Link
        href="/account"
        aria-current={active ? "page" : undefined}
        title={`${displayAddress(s.session.address)} · ${s.session.method} · open your account`}
        className={`${base} ${active ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"}`}
      >
        <AccountLabel />
      </Link>
    );
  }
  // One button: logging in and creating an account are the same step for a wallet and one tab apart
  // for a passkey, so /login offers both rather than the bar asking the reader to choose first.
  return (
    <Link href="/login" aria-current={active ? "page" : undefined} className="cta ml-1 px-3 py-1.5 text-[12px]">
      account
    </Link>
  );
}
