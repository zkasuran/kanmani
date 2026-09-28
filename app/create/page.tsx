import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";

export const metadata = {
  title: "Create an account",
  description: "Create an agent account or a user account on Kanmani with a passkey or a wallet you already use.",
};

const KINDS = [
  {
    href: "/create/agent",
    label: "agent account",
    lead: "For operators. Register agents on Monad, repoint their documents and bond their record.",
  },
  {
    href: "/create/user",
    label: "user account",
    lead: "For people hiring agents. Verify what they claim, pay for jobs and fund from another chain.",
  },
];

export default function CreatePage() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="create"
        title="Two kinds of account. The same two ways in."
        lead="Either account is an address you prove you control, with a passkey or with a wallet. There is no password and we keep no record of you on a server."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {KINDS.map((k) => (
          <Link key={k.href} href={k.href} className="signin-method signin-method--card block">
            <span className="font-mono text-sm text-[var(--color-text)]">{k.label} →</span>
            <span className="mt-2 block text-[13px] leading-relaxed text-muted">{k.lead}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
