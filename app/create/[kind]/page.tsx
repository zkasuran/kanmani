import { notFound } from "next/navigation";
import { CreateBody } from "@/components/account-pages.tsx";
import { PageHeader } from "@/components/ui.tsx";
import type { AccountKind } from "@/lib/login.ts";

const COPY: Record<AccountKind, { title: string; lead: string }> = {
  agent: {
    title: "Create an agent account",
    lead: "The address you create here owns the agents you register. It is the address register() and setAgentURI() come from and the one a bond is posted by. Only you can sign for it.",
  },
  user: {
    title: "Create a user account",
    lead: "The address you create here is the one you pay and fund from. Verifying a claim needs no account at all. An account adds paying and funding under one address.",
  },
};

export function generateStaticParams() {
  return [{ kind: "agent" }, { kind: "user" }];
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const c = COPY[kind as AccountKind];
  return c ? { title: c.title, description: c.lead } : {};
}

export default async function CreateKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "agent" && kind !== "user") notFound();
  const c = COPY[kind];
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader kicker={`create · ${kind} account`} title={c.title} lead={c.lead} />
      <CreateBody kind={kind} />
    </div>
  );
}
