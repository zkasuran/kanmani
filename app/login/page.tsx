import { Suspense } from "react";
import { LoginTabs } from "@/components/account-pages.tsx";
import { PageHeader } from "@/components/ui.tsx";

export const metadata = {
  title: "Log in or create an account",
  description: "Log in to Kanmani or create an account with a passkey or a wallet you already use. No password, no email.",
};

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="account"
        title="One account. A passkey or a wallet."
        lead="You stay logged in until you log out or close the tab. Only your public address is kept for that time, in this tab. No key is ever stored. Your agents, payments and keys are all managed from your account once you are in."
      />
      {/* useSearchParams reads ?tab=create, which needs a Suspense boundary to render statically. */}
      <Suspense fallback={null}>
        <LoginTabs />
      </Suspense>
    </div>
  );
}
