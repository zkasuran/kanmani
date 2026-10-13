import Link from "next/link";
import { Mono, PageHeader, Panel } from "@/components/ui.tsx";
import { ComplianceLookup, CviBadge, type ComplianceLookupData } from "@/components/compliance-lookup.tsx";
import {
  COMPLIANCE_CHAINS,
  DEPLOYER,
  FLOW_STEPS,
  MAINNET_GATE,
  OFFCHAIN_CODE_MAP,
  PASS_REFUSE_EVIDENCE,
  TESTNET_VERIFIED_WORKER,
  evidenceCviState,
  readCviStatus,
  txHref,
} from "@/lib/cleanverse-onchain.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Compliance",
  description: "Settlement gated on an on-chain verified identity, read live on both Monad chains.",
};

/** Read one wallet across both chains, same shape as the API, for the server-rendered rows. */
async function readWallet(worker: `0x${string}`): Promise<ComplianceLookupData> {
  const chains = await Promise.all(
    COMPLIANCE_CHAINS.map(async (c) => ({
      chainId: c.chainId,
      key: c.key,
      displayName: c.displayName,
      gate: c.gate,
      registered: c.registered,
      ...(await readCviStatus(worker, c)),
    })),
  );
  return { address: worker, chains };
}

function LiveRow({ label, chain }: { label: string; chain: ComplianceLookupData["chains"][number] }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-line)]/60 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-56 shrink-0 font-mono text-[12px] text-muted">{label}</span>
      <span className="w-40 shrink-0 font-mono text-[11.5px] text-faint">
        {chain.displayName} ({chain.chainId})
      </span>
      <span className="w-28 shrink-0">
        <CviBadge state={chain.state} />
      </span>
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted">{chain.reason}</span>
    </div>
  );
}
{/* PAGE_PLACEHOLDER */}

export default async function CompliancePage() {
  const [workerData, deployerData] = await Promise.all([
    readWallet(TESTNET_VERIFIED_WORKER),
    readWallet(DEPLOYER),
  ]);
  const workerTestnet = workerData.chains.find((c) => c.chainId === 10143)!;
  const deployerTestnet = deployerData.chains.find((c) => c.chainId === 10143)!;
  const deployerMainnet = deployerData.chains.find((c) => c.chainId === 143)!;

  const seq = FLOW_STEPS.filter((s) => !("branch" in s));
  const branches = FLOW_STEPS.filter((s) => "branch" in s) as (typeof FLOW_STEPS[number] & { branch: string })[];
  const passSettle = PASS_REFUSE_EVIDENCE.find((r) => r.kind === "pass" && r.step.includes("settle"))!;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="cleanverse · identity-gated settlement"
        title="Money cannot reach a wallet that is not cleared"
        lead="Settlement is gated on a Cleanverse Verified Identity read on chain, not on a flag the escrow could drop. This page reads cviStatus live on both Monad chains, draws the flow and shows the pass and the refuse as real transactions."
      />

      {/* 1. live status, read on load */}
      <Panel title="live CVI status, read on load" subtitle="A server-side eth_call to each gate's cviStatus on every request. Nothing here is hardcoded, the page renders whatever the chain returns.">
        <div>
          <LiveRow label="testnet worker (tier 20 CVI)" chain={workerTestnet} />
          <LiveRow label="our deployer, no CVI" chain={deployerTestnet} />
          <LiveRow label="our deployer, no CVI" chain={deployerMainnet} />
        </div>
        <p className="mt-3 font-mono text-[11px] text-faint">
          reproduce: curl -s https://kanmani.xyz/api/compliance/{TESTNET_VERIFIED_WORKER}
        </p>
      </Panel>

      {/* 2. the any-wallet lookup, pre-filled with a real read */}
      <Panel title="check any wallet" subtitle="The on-chain read for any address, on both chains. Pre-filled with the verified testnet worker so the happy path runs with one click.">
        <ComplianceLookup initial={workerData} />
      </Panel>
{/* FLOW_PLACEHOLDER */}

      {/* 3. the flow, drawn */}
      <Panel title="how settlement is gated" subtitle="Identity verification is structurally coupled to asset movement: the only payout path reads the CVI first, then the CVA re-checks it on its own transfer.">
        <ol className="flex flex-col gap-2" aria-label="settlement flow">
          {seq.map((s, i) => (
            <li key={s.key} className="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel-2)]/40 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[11px] text-faint">{i + 1}</span>
                <span className="font-mono text-[12.5px] text-[var(--color-text)]">{s.title}</span>
                {"fn" in s && s.fn ? <Mono className="text-[var(--color-brand)]">{s.fn}()</Mono> : null}
              </div>
              <p className="mt-1 pl-5 text-[12px] leading-snug text-muted">{s.detail}</p>
            </li>
          ))}
        </ol>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {branches.map((s) => {
            const tone =
              s.branch === "verified"
                ? "border-[var(--color-true)]/40"
                : s.branch === "unverified"
                  ? "border-[var(--color-false)]/40"
                  : "border-[var(--color-unknown)]/40";
            return (
              <div key={s.key} className={`rounded-[var(--radius)] border ${tone} bg-[var(--color-panel)] px-3 py-2.5`}>
                <div className="mb-1"><CviBadge state={s.branch as "verified" | "unverified" | "unknown"} /></div>
                <p className="font-mono text-[11.5px] text-[var(--color-text)]">{s.title}</p>
                <p className="mt-1 text-[11.5px] leading-snug text-muted">{s.detail}</p>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* 4. pass and refuse, on chain */}
      <Panel title="the pass and the refuse, on chain" subtitle="The end-to-end testnet run. A verified worker is paid, an unverified wallet is refused and no money moves. The escrowed asset is labelled on every row.">
        <div className="overflow-x-auto">
          <table className="table-cards w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-[var(--color-line)] font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="py-2 pr-3">step</th>
                <th className="py-2 pr-3">asset</th>
                <th className="py-2 pr-3">outcome</th>
                <th className="py-2 pr-3">tx</th>
              </tr>
            </thead>
            <tbody>
              {PASS_REFUSE_EVIDENCE.map((r) => {
                const href = txHref(r.chainId, r.txHash);
                const short = `${r.txHash.slice(0, 10)}…${r.txHash.slice(-8)}`;
                return (
                  <tr key={r.txHash} className="border-b border-[var(--color-line)]/60 last:border-0">
                    <td className="py-2 pr-3 align-top" data-label="step">
                      {r.kind === "setup" ? (
                        <span className="font-mono text-[12px] text-muted">{r.step}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <CviBadge state={evidenceCviState(r.kind)} />
                          <span className="font-mono text-[12px] text-[var(--color-text)]">{r.step}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top font-mono text-[11.5px] text-muted" data-label="asset">{r.asset}</td>
                    <td className="py-2 pr-3 align-top text-muted" data-label="outcome">
                      {r.outcome}
                      {r.revert ? <span className="ml-1 font-mono text-[11px] text-[var(--color-false)]">{r.revert}</span> : null}
                    </td>
                    <td className="py-2 pr-3 align-top" data-label="tx">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-[var(--color-brand)] ilink">
                          {short}
                        </a>
                      ) : (
                        <Mono className="text-muted">{short}</Mono>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          The on-chain gate decides first, so a refusal reverts before any balance leaves escrow. The
          off-chain Verify-CVI API is documentation only here (it needs an api-id and an IP allowlist),
          and its code map is: {OFFCHAIN_CODE_MAP.map((m) => `${m.code} ${m.meaning} (${m.state})`).join(", ")}.
        </p>
      </Panel>
{/* USECASE_PLACEHOLDER */}

      {/* 5. use case and mainnet status */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="the use case: verified settlement" subtitle="The bounty asks for identity structurally coupled to asset movement, not an optional layer.">
          <p className="text-[13px] leading-relaxed text-muted">
            An autonomous agent cannot be paid for work until its wallet carries a verified identity. A
            buyer hiring an agent has the same know-your-counterparty duty a bank has. The agent&rsquo;s
            wallet is the counterparty. Gating the payout on a CVI, inside a CVA, is that duty enforced
            by the settlement rail rather than by a policy document. Because the payout asset re-checks
            compliance at the source, a Travel Rule report can be pulled for the settlement itself.
          </p>
          <p className="mt-4 mb-1 font-mono text-[11px] uppercase tracking-wide text-faint">
            Travel Rule export, built from the pass settle
          </p>
          <pre className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 font-mono text-[11px] leading-relaxed text-muted">
{`originator   (buyer)      ${DEPLOYER}
beneficiary  (worker)     ${TESTNET_VERIFIED_WORKER}
asset                     ${passSettle.asset} on Monad testnet (chain 10143)
amount                    1,000,000 units
settlement tx             ${passSettle.txHash}
identity gate             CVI tier 20, issued 0x6ae7f07b…f148aef057`}
          </pre>
          <p className="mt-2 text-[11.5px] leading-snug text-faint">
            The on-chain leg is what this report is built from. The identity data stays with Cleanverse
            under the CVI, so Kanmani holds no PII. When plan 6.3 reruns the settle in aUSDC, the asset
            line reads aUSDC and the rest is unchanged.
          </p>
        </Panel>

        <Panel title="mainnet status, stated plainly" subtitle="No mock, no implied-live. What runs today and what waits on Cleanverse.">
          <p className="text-[13px] leading-relaxed text-muted">
            The mainnet gate is deployed at <Mono className="text-[var(--color-text)]">{MAINNET_GATE}</Mono>{" "}
            but it is not yet registered as a compliance pool, so the mainnet validator reverts
            PoolNotRegistered for it. Every mainnet <Mono>cviStatus</Mono> reads unknown and every settle
            fails closed by design, which is why the deployer row above shows unknown on mainnet and not
            cleared on testnet.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The live end-to-end flow runs on Monad testnet with a CVA today. Registration is an off-chain
            step that needs Cleanverse production credentials. When they land, the mainnet column turns
            real with no page change, because the page reads the chain live rather than a stored answer.
          </p>
          <p className="mt-3 text-[12px] text-faint">
            See <Link href="/claims" className="text-[var(--color-brand)] ilink">claims</Link> and{" "}
            <Link href="/verify" className="text-[var(--color-brand)] ilink">verify</Link> for the rest of the ladder.
          </p>
        </Panel>
      </div>


    </div>
  );
}

