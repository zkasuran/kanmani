import Link from "next/link";
import { Addr, Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";
import {
  buildFundingSteps,
  AQUEOUS_MONAD,
  MONAD_USDC_ASSET_ID,
  type Terms,
  type BuiltStep,
} from "@/lib/intents.ts";
import { USDC_MONAD } from "@/lib/x402.ts";

export const metadata = {
  title: "Fund from any chain",
  description:
    "Fund a Monad escrow job with an asset you hold on another chain. Aurora Intents Connect bridges it to an account you own on Monad and funds the job on arrival. No manual bridge, no wallet switch, no Monad USDC first.",
};

// Source chains Aurora Intents Connect lists as supported, read from the live docs on 2026-09-23.
// The buyer picks one of these. The destination is always Monad.
const SOURCE_CHAINS = [
  "Ethereum",
  "Base",
  "Arbitrum",
  "Optimism",
  "Polygon",
  "Avalanche",
  "BNB Smart Chain",
  "Solana",
  "NEAR",
  "Aurora",
  "Gnosis",
  "Scroll",
  "TON",
  "Tron",
];

type Props = { searchParams: Promise<{ from?: string; amount?: string; agent?: string }> };

// A worst-case delivered amount is base units of USDC (6 decimals). Keep the demo honest and small.
const DEFAULT_AMOUNT = "87125";

function toBaseUnits(input: string | undefined): bigint {
  if (!input || !/^\d+$/.test(input)) return BigInt(DEFAULT_AMOUNT);
  const v = BigInt(input);
  return v > 0n && v < 1n << 127n ? v : BigInt(DEFAULT_AMOUNT);
}

function usdc(base: bigint): string {
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export default async function Fund({ searchParams }: Props) {
  const sp = await searchParams;
  const from = SOURCE_CHAINS.includes(sp.from ?? "") ? sp.from! : "Base";
  const amount = toBaseUnits(sp.amount);
  const agent = /^0x[0-9a-fA-F]{40}$/.test(sp.agent ?? "")
    ? (sp.agent as `0x${string}`)
    : ("0x1111111111111111111111111111111111111111" as `0x${string}`);

  // The exact batch that funds the job. Terms.amount is the guaranteed delivered amount, so the
  // escrow receives precisely what it expects. This is the same builder the client library ships,
  // rendered here so the two-step plan is visible.
  const terms: Terms = {
    agent,
    token: USDC_MONAD as `0x${string}`,
    amount,
    pricePerUnit: 0n,
    deadline: 4102444800n,
    termsHash: ("0x" + "00".repeat(32)) as `0x${string}`,
    salt: ("0x" + "11".repeat(32)) as `0x${string}`,
  };
  const { steps } = buildFundingSteps({ amount, terms });

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="aurora intents connect · cross-chain · fund a monad job"
        title="Fund a Monad job with money you hold on another chain."
        lead={
          <>
            Hire an agent with money you already hold somewhere else. You pick the chain and the asset.
            Aurora Intents Connect bridges it to an account on Monad that only you control, then funds the
            escrow job the moment the funds land. You never switch wallets, you never touch a bridge by
            hand and you never have to get Monad USDC first.
          </>
        }
      />
      {/* body continues below */}
      <FundBody from={from} amount={amount} steps={steps} terms={terms} />
    </div>
  );
}

function FundBody({
  from,
  amount,
  steps,
  terms,
}: {
  from: string;
  amount: bigint;
  steps: BuiltStep[];
  terms: Terms;
}) {
  const stepLabel = ["Bridge", "createJob"];
  return (
    <div className="space-y-5">
      <form action="/fund" className="elevated grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-5 sm:grid-cols-3">
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">pay from</span>
          <select
            name="from"
            defaultValue={from}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-brand)]"
          >
            {SOURCE_CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">job amount, USDC base units</span>
          <input
            name="amount"
            defaultValue={amount.toString()}
            inputMode="numeric"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none placeholder:text-faint focus:border-[var(--color-brand)]"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="cta w-full justify-center"
          >
            show the plan
          </button>
        </div>
      </form>

      <Panel
        title="the plan"
        subtitle={`pay ${usdc(amount)} USDC of value from ${from}, land a funded job on Monad`}
      >
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          Two things happen and you sign once. Intents Connect bridges your asset to the intermediary,
          then runs the destination steps below from that account. The cross-chain part is real work.
          It is just not your work.
        </p>
        <ol className="space-y-3">
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-faint">step 1 · {stepLabel[0]}</div>
            <p className="mt-1 text-[13px]">
              Intents Connect moves your source asset to your intermediary on Monad as USDC. The
              guaranteed delivery is the amount the next step is built against.
            </p>
          </li>
          {steps.map((s, i) => (
            <li key={i} className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
              <div className="font-mono text-[11px] uppercase tracking-wide text-faint">
                step {i + 2} · {i === 0 ? "approve" : stepLabel[1]}
              </div>
              <div className="mt-1 space-y-1 text-[13px]">
                <Row label="to">
                  <Addr value={s.to} />
                </Row>
                <Row label="call">
                  <Mono className="text-muted">{s.functionSignature}</Mono>
                </Row>
                <Row label="selector">
                  <Mono className="text-muted">{s.selector}</Mono>
                </Row>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] text-faint">
          The service adds its own gas-fee transfer to this batch. We do not add it and we do not pay
          it from the job amount. The escrow is <Addr value={AQUEOUS_MONAD} /> and the token is USDC at{" "}
          <Addr value={USDC_MONAD} />.
        </p>
      </Panel>

      <Panel title="what lands where and why a revert is safe">
        <div className="space-y-3 text-[13px] leading-relaxed">
          <p>
            The bridged funds land in an <strong>intermediary account you own</strong>, controlled by
            your source wallet through a Chain Signature. That account is the caller for both steps, so
            it is the job&apos;s buyer of record. That is correct, because it is yours.
          </p>
          <p>
            Aqueous pulls <strong>exactly</strong> the amount in the job terms and reverts on anything
            short. So the terms amount is set to the guaranteed delivery, never the pre-fee figure. If a
            quote moves and the delivery comes in below that, the plan refuses before you sign rather
            than sending a batch the escrow would reject.
          </p>
          <p>
            If the createJob call reverts anyway, <strong>the funds are not lost</strong>. They stay in
            your intermediary. Recovery is a separate withdrawal you authorize with Intents Connect
            covering the gas. A short landing is a recoverable state, not a burned deposit.
          </p>
          <Row label="destination asset">
            <Mono className="text-muted">{MONAD_USDC_ASSET_ID}</Mono>
          </Row>
          <Row label="job amount">
            <Mono className="text-muted">
              {usdc(terms.amount)} USDC ({terms.amount.toString()} base units)
            </Mono>
          </Row>
        </div>
      </Panel>

      <Panel title="honest note">
        <p className="text-[13px] leading-relaxed text-muted">
          This page builds the exact two-step batch and shows the shortfall guard. The live quote, the
          worst-case delivery number and the signing payload come from Aurora&apos;s create endpoint,
          which needs an Intents Connect API key wired server side, so those numbers are not fetched on
          this public page. The final funded deposit spends real money across a real bridge and is run
          from the operator&apos;s wallet, not from here. See{" "}
          <Link href="/method" className="text-[var(--color-brand)] hover:underline">
            the method
          </Link>{" "}
          for how each figure is checked.
        </p>
      </Panel>
    </div>
  );
}
