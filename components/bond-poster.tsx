"use client";

/**
 * Post a bond on your own agent or release one that has matured, from a passkey or a wallet.
 *
 * Every rule the contract enforces is checked here first (lib/bond-post.ts) and every chain fact the
 * decision rests on is read live: who owns the agent, whether it was ever bonded, the USDC balance,
 * the current allowance and the MON for gas. The button stays off until all of them allow the send,
 * so the only thing left to fail is the chain itself.
 *
 * A passkey signs through a session scoped to exactly this spend and this contract, which expires in
 * two minutes. A wallet signs in the wallet after being moved to Monad. We never hold a key.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { erc20Abi } from "viem";
import { declined, useSend } from "@/components/use-send.ts";
import { formatNative, gasCheck, type GasCheck } from "@/lib/gas.ts";
import { IDENTITY_REGISTRY } from "@/lib/registration.ts";
import { displayAddress } from "@/lib/login.ts";
import {
  canPost,
  planBond,
  releaseCalldata,
  SCLERA_ADDRESS,
  suggestFloor,
  USDC_MONAD_ADDRESS,
  WINDOW_PRESETS,
  type BondDraft,
} from "@/lib/bond-post.ts";

const OWNER_OF = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const BONDS = [
  {
    type: "function",
    name: "bonds",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "address" }, { type: "uint64" }, { type: "uint8" }, { type: "address" }, { type: "uint64" },
      { type: "uint128" }, { type: "uint16" }, { type: "uint32" }, { type: "uint64" },
    ],
  },
] as const;
const STATES = ["none", "active", "slashed", "released"] as const;
/** postBond cannot be estimated before the approval exists, so its gas is this bound until then. */
const POST_GAS_BOUND = 300_000n;

type Chain = {
  owner: string | null;
  state: (typeof STATES)[number] | null;
  postedAt: bigint | null;
  windowBlocks: bigint | null;
  amount: bigint | null;
  head: bigint | null;
  usdc: bigint | null;
  allowance: bigint | null;
  gas: GasCheck | null;
};

function usdcText(atomic: bigint): string {
  const w = atomic / 1_000_000n;
  const f = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

export function BondPoster({ initialAgent }: { initialAgent: string | null }) {
  // Chain, client and sender come from useSend, stable across renders, so the chain-read effect below
  // runs every 8s rather than on every render.
  const { sender, send, pub, session: s } = useSend();

  const [agents, setAgents] = useState<{ agentId: number; name: string | null }[] | null>(null);
  const [draft, setDraft] = useState<BondDraft>({ agentId: initialAgent ?? "", amountUsdc: "0.01", minTruthRatePct: "", windowBlocks: String(WINDOW_PRESETS[1].blocks), minSampleSize: "5" });
  const [facts, setFacts] = useState<Chain | null>(null);
  const [sla, setSla] = useState<{ rateBps: number | null; sampleSize: number } | null>(null);
  const [busy, setBusy] = useState<null | "approve" | "post" | "release">(null);
  const [done, setDone] = useState<{ step: string; hash: string }[]>([]);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  // The owner's agents, to pick from.
  useEffect(() => {
    if (!sender) return;
    let live = true;
    fetch(`/api/account/${sender.address}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: { agents?: { agentId: number; name: string | null }[] } }) => {
        if (!live) return;
        const list = j.data?.agents ?? [];
        setAgents(list);
        setDraft((d) => (d.agentId ? d : list[0] ? { ...d, agentId: String(list[0].agentId) } : d));
      })
      .catch(() => live && setAgents([]));
    return () => {
      live = false;
    };
  }, [sender]);

  const plan = useMemo(() => planBond(draft), [draft]);
  const agentId = /^\d+$/.test(draft.agentId) && draft.agentId !== "0" ? BigInt(draft.agentId) : null;

  // Measured rate, for the suggested floor. Free endpoint, same data Assay prices from.
  useEffect(() => {
    setSla(null);
    if (agentId === null) return;
    let live = true;
    fetch(`/api/sla/${agentId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: { rateBps: number | null; sampleSize: number } }) => live && j.data && setSla({ rateBps: j.data.rateBps, sampleSize: j.data.sampleSize }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId]);
  const suggestion = sla ? suggestFloor(sla.rateBps, sla.sampleSize) : null;

  // Everything the send depends on, read from chain. Re-read every 8s and after each step.
  useEffect(() => {
    if (!sender || agentId === null) {
      setFacts(null);
      return;
    }
    // Facts belong to one agent. Keeping the last agent's while the new one loads would show a ready
    // send for the wrong agent, so they are cleared first and the button waits.
    setFacts(null);
    let live = true;
    const read = async () => {
      const [owner, b, head, bal, allow, mon, price] = await Promise.all([
        pub.readContract({ address: IDENTITY_REGISTRY, abi: OWNER_OF, functionName: "ownerOf", args: [agentId] }).catch(() => null),
        pub.readContract({ address: SCLERA_ADDRESS, abi: BONDS, functionName: "bonds", args: [agentId] }).catch(() => null),
        pub.getBlockNumber().catch(() => null),
        pub.readContract({ address: USDC_MONAD_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [sender.address] }).catch(() => null),
        pub.readContract({ address: USDC_MONAD_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [sender.address, SCLERA_ADDRESS] }).catch(() => null),
        pub.getBalance({ address: sender.address }).catch(() => null),
        pub.getGasPrice().catch(() => null),
      ]);
      const state = b ? (STATES[Number(b[2])] ?? null) : null;
      const needApprove = plan.ok && allow !== null && allow < plan.plan.amountAtomic;
      let units: bigint | null = null;
      if (state === "active") {
        units = await pub.estimateGas({ account: sender.address, to: SCLERA_ADDRESS, data: releaseCalldata(agentId) }).catch(() => null);
      } else if (plan.ok) {
        const approveUnits = needApprove
          ? await pub.estimateGas({ account: sender.address, to: plan.plan.approve.to, data: plan.plan.approve.data }).catch(() => null)
          : 0n;
        const postUnits = needApprove
          ? POST_GAS_BOUND
          : await pub.estimateGas({ account: sender.address, to: plan.plan.post.to, data: plan.plan.post.data }).catch(() => POST_GAS_BOUND);
        units = approveUnits === null ? null : approveUnits + postUnits;
      }
      if (!live) return;
      setFacts({
        owner: owner ? String(owner) : null,
        state,
        postedAt: b ? b[1] : null,
        windowBlocks: b ? b[4] : null,
        amount: b ? b[5] : null,
        head,
        usdc: bal,
        allowance: allow,
        gas: units === null ? null : gasCheck(mon, units, price),
      });
    };
    void read();
    const t = window.setInterval(() => void read(), 8000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [sender, agentId, pub, plan, tick]);

  const eligibility = facts && sender ? canPost({ sender: sender.address, owner: facts.owner, state: facts.state }) : null;
  const matured = facts?.state === "active" && facts.head !== null && facts.postedAt !== null && facts.windowBlocks !== null ? facts.head >= facts.postedAt + facts.windowBlocks : null;
  const needApprove = plan.ok && facts?.allowance !== null && facts?.allowance !== undefined && facts.allowance < plan.plan.amountAtomic;
  const usdcShort = plan.ok && facts?.usdc !== null && facts?.usdc !== undefined && facts.usdc < plan.plan.amountAtomic;

  const sendTx = (to: `0x${string}`, data: `0x${string}`, spend: bigint) => send({ to, data, spendAtomic: spend, label: "Bond one agent on Sclera." });

  const post = async () => {
    if (!plan.ok) return;
    setNote(null);
    try {
      if (needApprove) {
        setBusy("approve");
        const h = await sendTx(plan.plan.approve.to, plan.plan.approve.data, plan.plan.amountAtomic);
        setDone((d) => [...d, { step: `approved exactly ${usdcText(plan.plan.amountAtomic)} USDC`, hash: h }]);
      }
      setBusy("post");
      const h = await sendTx(plan.plan.post.to, plan.plan.post.data, plan.plan.amountAtomic);
      setDone((d) => [...d, { step: `bond posted: ${usdcText(plan.plan.amountAtomic)} USDC for ${plan.plan.windowHuman}`, hash: h }]);
      setNote({ kind: "info", text: "Bonded. The agent's page shows it once the contract state is read, which is immediate." });
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Declined. Nothing was sent." : ((e as Error).message ?? "The send failed.").slice(0, 300) });
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  };

  const release = async () => {
    if (agentId === null) return;
    setNote(null);
    setBusy("release");
    try {
      const h = await sendTx(SCLERA_ADDRESS, releaseCalldata(agentId), 0n);
      setDone((d) => [...d, { step: `bond released: ${facts?.amount !== null && facts?.amount !== undefined ? usdcText(facts.amount) : "the"} USDC returned to the poster`, hash: h }]);
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Declined. Nothing was sent." : ((e as Error).message ?? "The send failed.").slice(0, 300) });
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  };

  if (!s.ready) return <p className="px-5 py-4 text-sm text-faint">reading this tab&apos;s session…</p>;
  if (!sender) {
    return (
      <div className="px-5 py-4 text-[13px] leading-relaxed text-muted">
        Log in with the passkey or wallet that owns the agent. Only the owner can bond it.{" "}
        <Link href="/login" className="text-[var(--color-brand)] hover:underline">log in →</Link>
      </div>
    );
  }

  const field = "w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--color-text)]";
  const label = "font-mono text-[11px] uppercase tracking-wide text-faint";
  const blocked = facts === null || !plan.ok || !eligibility?.ok || usdcShort || facts?.gas?.state === "short" || busy !== null;

  return (
    <div className="bond-poster flex flex-col gap-4 px-5 py-4" data-testid="bond-poster">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="chip chip--live">{sender.kind}</span>
        <code className="font-mono text-[12px] text-[var(--color-text)]">{displayAddress(sender.address)}</code>
        {sender.kind === "passkey" && !s.keys ? <span className="text-faint">· one passkey prompt when you send</span> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 lg:col-span-1">
          <span className={label}>agent</span>
          {/* Always a free field, so ?agent= and ids not in the list still work; owned agents are quick picks. */}
          <input className={field} inputMode="numeric" value={draft.agentId} onChange={(e) => setDraft({ ...draft, agentId: e.target.value.trim() })} placeholder="agent id" data-testid="bond-agent" />
          {agents && agents.length ? (
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              {agents.map((a) => (
                <button key={a.agentId} type="button" onClick={() => setDraft({ ...draft, agentId: String(a.agentId) })} className={`font-mono text-[11px] ${String(a.agentId) === draft.agentId ? "text-[var(--color-text)]" : "text-muted hover:text-[var(--color-text)]"}`}>
                  #{a.agentId}
                </button>
              ))}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>amount, USDC</span>
          <input className={field} inputMode="decimal" value={draft.amountUsdc} onChange={(e) => setDraft({ ...draft, amountUsdc: e.target.value })} data-testid="bond-amount" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>floor, % claim truth</span>
          <input className={field} inputMode="decimal" value={draft.minTruthRatePct} onChange={(e) => setDraft({ ...draft, minTruthRatePct: e.target.value })} placeholder={suggestion?.floorPct ?? "e.g. 80"} data-testid="bond-floor" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>window</span>
          <select className={field} value={draft.windowBlocks} onChange={(e) => setDraft({ ...draft, windowBlocks: e.target.value })}>
            {WINDOW_PRESETS.map((p) => (
              <option key={p.label} value={String(p.blocks)}>{p.label} ({p.blocks.toLocaleString()} blocks)</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>minimum sample</span>
          <input className={field} inputMode="numeric" value={draft.minSampleSize} onChange={(e) => setDraft({ ...draft, minSampleSize: e.target.value })} />
        </label>
      </div>

      {suggestion ? (
        <p className="text-[12px] leading-relaxed text-muted" data-testid="bond-suggestion">
          {suggestion.floorPct ? (
            <>
              Suggested floor <button type="button" className="font-mono text-[var(--color-brand)] hover:underline" onClick={() => setDraft({ ...draft, minTruthRatePct: suggestion.floorPct! })}>{suggestion.floorPct}%</button>. {suggestion.why}
            </>
          ) : (
            suggestion.why
          )}{" "}
          <span className="text-faint">Same rule Kanmani&rsquo;s Assay sells; a suggestion, not a requirement.</span>
        </p>
      ) : null}

      {/* What the chain says, before anything is signed. */}
      <dl className="grid gap-x-6 gap-y-1.5 font-mono text-[12px] sm:grid-cols-2" data-testid="bond-facts">
        <Fact k="owner" v={facts === null ? null : facts.owner === null ? "unknown" : facts.owner.toLowerCase() === sender.address.toLowerCase() ? "you" : facts.owner} bad={!!facts?.owner && facts.owner.toLowerCase() !== sender.address.toLowerCase()} />
        <Fact k="bond on this agent" v={facts === null ? null : facts.state ?? "unknown"} bad={facts?.state !== undefined && facts?.state !== null && facts.state !== "none"} />
        <Fact k="your USDC" v={facts === null ? null : facts.usdc === null ? "unknown" : `${usdcText(facts.usdc)} USDC`} bad={usdcShort} />
        <Fact k="approval for Sclera" v={facts === null ? null : facts.allowance === null ? "unknown" : needApprove ? `${usdcText(facts.allowance)} USDC, one approval first` : "enough"} />
        <Fact
          k="gas"
          v={facts === null ? null : facts.gas === null ? "unknown" : facts.gas.state === "unknown" ? "unknown" : `${formatNative(facts.gas.haveWei)} MON held · about ${formatNative(facts.gas.needWei)} needed`}
          bad={facts?.gas?.state === "short"}
        />
      </dl>

      {!plan.ok ? (
        <ul className="list-disc pl-5 text-[12px] text-[var(--color-false)]" data-testid="bond-errors">
          {plan.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}
      {eligibility && !eligibility.ok ? <p className={`text-[12.5px] ${eligibility.unknown ? "text-muted" : "text-[var(--color-false)]"}`} data-testid="bond-ineligible">{eligibility.reason}</p> : null}
      {usdcShort && plan.ok ? <p className="text-[12.5px] text-[var(--color-false)]">You hold less USDC on Monad than this bond. Bring some at <Link href="/fund" className="underline">/fund</Link> or lower the amount.</p> : null}
      {facts?.gas?.state === "short" ? <p className="text-[12.5px] text-[var(--color-false)]">This account needs about {formatNative(facts.gas.shortWei)} more MON for gas. Send it to {sender.address}.</p> : null}

      {facts?.state === "active" && facts.owner?.toLowerCase() === sender.address.toLowerCase() ? (
        <div className="rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-[12.5px]">
          This agent&apos;s bond is active: {facts.amount !== null ? `${usdcText(facts.amount)} USDC` : "an amount"} held.{" "}
          {matured === true ? (
            <>
              Its window has passed, so it can be released back to whoever posted it.{" "}
              <button type="button" className="cta-ghost ml-1" disabled={busy !== null || facts.gas?.state === "short"} onClick={release} data-testid="bond-release">
                {busy === "release" ? "releasing…" : "release it →"}
              </button>
              <span className="mt-1 block text-[11.5px] text-faint">Releasing ends it for good: Sclera allows one bond per agent, so this agent cannot be bonded again.</span>
            </>
          ) : matured === false && facts.postedAt !== null && facts.windowBlocks !== null && facts.head !== null ? (
            <>It matures in {(facts.postedAt + facts.windowBlocks - facts.head).toLocaleString()} blocks.</>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="cta" disabled={blocked} onClick={post} data-testid="bond-send">
            {busy === "approve" ? "approving the exact amount…" : busy === "post" ? "posting the bond…" : needApprove ? "approve, then post the bond →" : "post the bond →"}
          </button>
          {plan.ok ? (
            <span className="text-[11.5px] text-muted">
              {usdcText(plan.plan.amountAtomic)} USDC held for {plan.plan.windowHuman}, slashable below {(plan.plan.minTruthRateBps / 100).toFixed(2)}% over at least {plan.plan.minSampleSize} claims.
            </span>
          ) : null}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-faint">
        Before you sign: the USDC leaves your wallet for the whole window and comes back only by release, only if no verdict slashed it. Sclera allows one bond per agent, ever. The approval is for exactly this amount, never unlimited.
      </p>

      {done.length ? (
        <ul className="flex flex-col gap-1 text-[12px]" data-testid="bond-done">
          {done.map((d) => (
            <li key={d.hash}>
              <span className="text-[var(--color-true)]">✓</span> {d.step} ·{" "}
              <a className="font-mono text-[var(--color-brand)] hover:underline" href={`https://monadexplorer.com/tx/${d.hash}`} target="_blank" rel="noopener noreferrer">{d.hash.slice(0, 10)}…{d.hash.slice(-6)}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <p role="status" className={`text-[12.5px] ${note.kind === "error" ? "text-[var(--color-false)]" : "text-muted"}`}>{note.text}</p> : null}
    </div>
  );
}

function Fact({ k, v, bad }: { k: string; v: string | null; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--color-line)]/60 py-1">
      <dt className="text-faint">{k}</dt>
      <dd className={v === null ? "text-faint" : v === "unknown" ? "unknown-value" : bad ? "text-[var(--color-false)]" : "text-[var(--color-text)]"}>{v ?? "…"}</dd>
    </div>
  );
}
