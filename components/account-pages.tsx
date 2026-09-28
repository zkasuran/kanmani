"use client";

/**
 * The bodies of /create/<kind> and /login. Client-side because what they show depends on the
 * session, which only exists in the browser.
 */
import Link from "next/link";
import { AccountSummary, SignIn } from "@/components/account.tsx";
import { useSession } from "@/components/session.tsx";
import { Panel } from "@/components/ui.tsx";
import type { AccountKind } from "@/lib/login.ts";

const NEXT: Record<AccountKind, { href: string; label: string; hint: string }[]> = {
  agent: [
    { href: "/studio", label: "register your agent", hint: "register an agent or repoint one you own" },
    { href: "/bond", label: "bond its record", hint: "stake on your own claim-truth rate" },
    { href: "/verify", label: "check a claim", hint: "see what your own evidence documents prove" },
  ],
  user: [
    { href: "/verify", label: "verify a claim", hint: "paste anything, get a verdict" },
    { href: "/pay", label: "pay for a job", hint: "settle a job in USDC on Monad" },
    { href: "/fund", label: "fund from another chain", hint: "pay from another chain" },
  ],
};

function NextSteps({ kind }: { kind: AccountKind }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {NEXT[kind].map((n) => (
        <Link key={n.href} href={n.href} className="signin-method block">
          <span className="font-mono text-[12.5px] text-[var(--color-text)]">{n.label} →</span>
          <span className="mt-1 block text-[11.5px] leading-snug text-muted">{n.hint}</span>
        </Link>
      ))}
    </div>
  );
}

export function CreateBody({ kind }: { kind: AccountKind }) {
  const s = useSession();
  if (!s.ready) return <Panel title="…"><p className="px-5 py-4 text-sm text-faint">reading this tab&apos;s session…</p></Panel>;

  if (s.session) {
    return (
      <div className="flex flex-col gap-5">
        <Panel title={s.session.kind === kind ? "you are logged in" : `logged in with a ${s.session.kind} account`}>
          <div className="px-5 py-4">
            <AccountSummary />
          </div>
        </Panel>
        <Panel title="what to do next">
          <div className="px-5 py-4">
            <NextSteps kind={kind} />
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <Panel
      title={`create ${kind === "agent" ? "an agent" : "a user"} account`}
      subtitle="Pick one. Whichever you use here is how you log in later."
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <SignIn create kind={kind} />
        <p className="text-[12px] leading-relaxed text-muted">
          Already have one?{" "}
          <Link href="/login" className="text-[var(--color-brand)] hover:underline">log in</Link>. Want the other kind?{" "}
          <Link href={kind === "agent" ? "/create/user" : "/create/agent"} className="text-[var(--color-brand)] hover:underline">
            create {kind === "agent" ? "a user" : "an agent"} account
          </Link>
          .
        </p>
      </div>
    </Panel>
  );
}

export function LoginBody() {
  const s = useSession();
  if (!s.ready) return <Panel title="…"><p className="px-5 py-4 text-sm text-faint">reading this tab&apos;s session…</p></Panel>;

  if (!s.session) {
    return (
      <Panel title="log in" subtitle="Use the passkey or the wallet you created the account with.">
        <div className="flex flex-col gap-4 px-5 py-4">
          <SignIn create={false} />
          <p className="text-[12px] leading-relaxed text-muted">
            No account yet? Create an{" "}
            <Link href="/create/agent" className="text-[var(--color-brand)] hover:underline">agent account</Link> or a{" "}
            <Link href="/create/user" className="text-[var(--color-brand)] hover:underline">user account</Link>.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="your account" subtitle="Read from public chain state. The login adds the right to sign, nothing else.">
        <div className="px-5 py-4">
          <AccountSummary />
        </div>
      </Panel>
      <Panel title="what to do next">
        <div className="px-5 py-4">
          <NextSteps kind={s.session.kind} />
        </div>
      </Panel>
    </div>
  );
}
