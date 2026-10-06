"use client";

/**
 * The body of /login: one page, two tabs, the same two ways in on each.
 *
 * There is one kind of account. An address you prove you control with a passkey or a wallet is the
 * account. What it can do follows from what it owns on chain. So "create" and "log in" differ only
 * in whether a passkey is made or an existing one is used. For a wallet they are the same signature.
 * After either succeeds the reader lands on /account, the one place the account is managed.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountSummary, SignIn } from "@/components/account.tsx";
import { useSession } from "@/components/session.tsx";
import { Panel } from "@/components/ui.tsx";

type Tab = "login" | "create";

const TABS: { id: Tab; label: string; title: string; subtitle: string }[] = [
  { id: "login", label: "log in", title: "log in", subtitle: "Use the passkey or the wallet you created the account with." },
  {
    id: "create",
    label: "create account",
    title: "create an account",
    subtitle: "Pick one. Whichever you use here is how you log in later. There is no password and no email.",
  },
];

export function LoginTabs() {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "create" ? "create" : "login";
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ login: null, create: null });

  // Clear a sign-in error left over from the other tab, so a message never sits under the wrong form.
  const { clearError } = s;
  useEffect(() => clearError(), [tab, clearError]);

  if (!s.ready) {
    return (
      <Panel title="…">
        <p className="px-5 py-4 text-sm text-faint">reading this tab&apos;s session…</p>
      </Panel>
    );
  }

  if (s.session) {
    return (
      <Panel title="you are logged in" subtitle="Everything for this account is on one page.">
        <div className="flex flex-col gap-4 px-5 py-4">
          <AccountSummary />
          <Link href="/account" className="cta self-start">
            open your account →
          </Link>
        </div>
      </Panel>
    );
  }

  const select = (t: Tab) => router.replace(t === "create" ? "/login?tab=create" : "/login", { scroll: false });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next: Tab = tab === "login" ? "create" : "login";
    select(next);
    tabRefs.current[next]?.focus();
  };
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="log in or create an account" className="login-tabs flex gap-1" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            className={`rounded px-3 py-1.5 font-mono text-[12.5px] transition-colors ${
              tab === t.id
                ? "bg-[var(--color-panel)] text-[var(--color-text)] shadow-[inset_0_-2px_0_var(--color-brand)]"
                : "text-muted hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <Panel title={active.title} subtitle={active.subtitle}>
          <div className="flex flex-col gap-4 px-5 py-4">
            <SignIn key={tab} create={tab === "create"} onDone={() => router.push("/account")} />
            <p className="text-[12px] leading-relaxed text-muted">
              {tab === "login" ? (
                <>
                  No account yet?{" "}
                  <button type="button" onClick={() => select("create")} className="text-[var(--color-brand)] hover:underline">
                    create one
                  </button>
                  .
                </>
              ) : (
                <>
                  Already have one?{" "}
                  <button type="button" onClick={() => select("login")} className="text-[var(--color-brand)] hover:underline">
                    log in
                  </button>
                  . Registering an agent comes after, from your account.
                </>
              )}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
