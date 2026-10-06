"use client";

/** The top of /account: the account when signed in, the two ways in when not. */
import Link from "next/link";
import { AccountSummary } from "@/components/account.tsx";
import { useSession } from "@/components/session.tsx";
import { Panel } from "@/components/ui.tsx";

export function AccountOverview() {
  const s = useSession();
  if (!s.ready) {
    return (
      <Panel title="your account">
        <p className="text-sm text-faint">reading this tab&apos;s session…</p>
      </Panel>
    );
  }
  if (!s.session) {
    return (
      <Panel title="you are not logged in" subtitle="One account, made from a passkey or a wallet you already use.">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/login" className="cta">
            log in →
          </Link>
          <Link href="/login?tab=create" className="cta-ghost">
            create account →
          </Link>
        </div>
        <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          The keys section below works without an account: one passkey prompt derives all four keys in this
          tab and signs you in with the first of them.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="your account" subtitle="Read from public chain state. The login adds the right to sign, nothing else.">
      <AccountSummary />
    </Panel>
  );
}
