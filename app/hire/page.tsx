import Link from "next/link";
import { Mono, PageHeader, Panel } from "@/components/ui.tsx";
import { AGENTS } from "@/lib/agents.ts";
import { EXTRAS } from "@/lib/agent-extras.ts";
import IDS from "@/lib/agent-ids.json" with { type: "json" };

export const metadata = {
  title: "Hire Kanmani's agents",
  description: "Twelve ERC-8004 agents on Monad that answer the questions a builder or buyer has before sending money: over HTTP, A2A or MCP, priced by usage or free.",
};

type Row = { slug: string; name: string; sells: string; why: string; priceAtomic: string; input: string };

const usd = (a: string) => (a === "0" ? "free" : `up to ${(Number(a) / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} USDC`);

export default function Hire() {
  const rows: Row[] = [
    ...Object.values(AGENTS).map((a) => ({ slug: a.slug, name: a.name, sells: a.sells, why: a.needsMonad, priceAtomic: a.priceAtomic, input: a.input })),
    ...EXTRAS.map((e) => ({ slug: e.slug, name: e.name, sells: e.sells, why: e.why, priceAtomic: e.priceAtomic, input: e.input })),
  ];
  const ids = IDS as Record<string, number>;
  const groups: [string, string[]][] = [
    ["before you hire an agent", ["sentinel", "ledger", "twin", "pulse", "bondsman", "assay"]],
    ["before you trust a payment", ["locator", "notary", "scribe"]],
    ["before you ship your own", ["registrar", "doctor", "linter"]],
  ];
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="hire · erc-8004 on monad · a2a, mcp, http"
        title="Twelve agents for the questions you have before money moves."
        lead={
          <>
            Each one does real work against live chain state and says how it got its answer. Paid ones use x402 upto: you sign a
            ceiling and pay only for what the call used. The build tools are free. All twelve are operated by Kanmani from one
            owner address, <Mono>0xDB6c…7777</Mono>, which is stated here so nobody mistakes them for independent agents.
          </>
        }
      />
      <Panel title="held to the standard we check others by">
        <div className="px-5 py-4 text-[12.5px] leading-relaxed text-muted">
          Every agent here carries an ERC-8004 registration-v1 document on chain as a data: URI, so it cannot go dead.
          Each document is its own, names its protocol (A2A, with a real agent card), points back to its agent id and
          states its trust model. <Link href="/self-audit.json" className="text-[var(--color-brand)] hover:underline">The self-audit</Link>{" "}
          runs our own Doctor, Linter and registration check against all of them: document on chain byte for byte, spec
          consequences met, no shared document, indexed correctly, A2A hireable, x402 settleable and each one doing its
          published example. <Mono>node scripts/self-audit.mjs</Mono> reruns it.
        </div>
      </Panel>
      {groups.map(([title, slugs]) => (
        <Panel key={title} title={title}>
          <div className="grid gap-3 px-5 py-4 lg:grid-cols-2">
            {slugs.map((slug) => {
              const r = rows.find((x) => x.slug === slug)!;
              const id = ids[slug];
              return (
                <article key={slug} className="rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4" data-testid={`hire-${slug}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-mono text-[14px] text-[var(--color-text)]">{r.name}</h3>
                    <span className="font-mono text-[11.5px] text-muted">{usd(r.priceAtomic)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text)]">{r.sells}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{r.why}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px]">
                    <a href={`/api/service/${slug}`} className="text-[var(--color-brand)] hover:underline" target="_blank" rel="noopener">
                      /api/service/{slug}
                    </a>
                    {id ? (
                      <Link href={`/agent/${id}`} className="text-muted hover:text-[var(--color-text)]">
                        ERC-8004 #{id}
                      </Link>
                    ) : (
                      <span className="text-faint">not yet registered</span>
                    )}
                    <a href={`/api/service/${slug}/agent-card.json`} className="text-muted hover:text-[var(--color-text)]" target="_blank" rel="noopener">A2A card</a>
                    <a href={`/api/service/${slug}/registration.json`} className="text-muted hover:text-[var(--color-text)]" target="_blank" rel="noopener">registration</a>
                    <span className="text-faint">input {r.input}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>
      ))}
      <Panel title="how to call them">
        <div className="grid gap-3 px-5 py-4 text-[12.5px] leading-relaxed text-muted lg:grid-cols-3">
          <p>
            <span className="text-[var(--color-text)]">HTTP:</span> <Mono>GET /api/service/&lt;slug&gt;</Mono> for the price and an example, then{" "}
            <Mono>POST</Mono> the input with a <Mono>PAYMENT-SIGNATURE</Mono> header. Free agents need no header.
          </p>
          <p>
            <span className="text-[var(--color-text)]">A2A:</span> <Mono>message/send</Mono> to the same URL with the input as a data part. Paid agents answer{" "}
            <Mono>input-required</Mono> with <Mono>x402.payment.required</Mono>; resend with <Mono>x402.payment.payload</Mono>.
          </p>
          <p>
            <span className="text-[var(--color-text)]">From code:</span> <Mono>node scripts/pay-agent.mjs &lt;slug&gt; &apos;&lt;json&gt;&apos;</Mono> or{" "}
            <Mono>scripts/pay-agent-a2a.mjs</Mono> in the repo. Every answer returns the meter its charge came from.
          </p>
        </div>
      </Panel>
    </div>
  );
}
