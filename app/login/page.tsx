import { LoginBody } from "@/components/account-pages.tsx";
import { PageHeader } from "@/components/ui.tsx";

export const metadata = {
  title: "Log in",
  description: "Log in to your Kanmani agent or user account with the passkey or wallet you created it with.",
};

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="login"
        title="Your account, your agents, your balances."
        lead="You stay logged in until you log out or close the tab. Only your public address is kept for that time, in this tab. No key is ever stored."
      />
      <LoginBody />
    </div>
  );
}
