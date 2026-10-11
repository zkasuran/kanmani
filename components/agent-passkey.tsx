"use client";

/**
 * The agent's passkey, on its own page.
 *
 * Anyone sees whether a passkey is bound and since which block, read live from AgentPasskey. The
 * owner can bind one (two prompts: create the passkey, then sign the binding) or unbind. Anyone
 * holding the bound passkey can test it: the device signs a fresh challenge and the contract's `verify`
 * runs Monad's P256 precompile over it, as a free read. That test is the point of the page: the check
 * happens on chain, not in this browser.
 *
 * Nothing is stored. The passkey's private key never leaves the authenticator and the page keeps no
 * credential id; a later test lets the browser offer whichever passkey matches.
 */
import { useCallback, useEffect, useState } from "react";
import { keccak256, toHex } from "viem";
import { declined, useSend } from "@/components/use-send.ts";
import { relyingParty } from "@/lib/passkey.ts";
import { gasCheck } from "@/lib/gas.ts";
import {
  AGENT_PASSKEY_ABI,
  AGENT_PASSKEY_ADDRESS,
  bindCalldata,
  hexToBytes,
  p256FromSpki,
  toAssertion,
  unbindCalldata,
  userVerified,
  type P256Key,
} from "@/lib/agent-passkey.ts";

const OWNER_OF = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

type Binding = { bound: boolean; x: bigint; y: bigint; at: bigint } | null;

const short = (v: bigint) => `0x${v.toString(16).padStart(64, "0").slice(0, 10)}…`;
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

async function assertWith(challenge: `0x${string}`, allow?: ArrayBuffer) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(hexToBytes(challenge)),
      rpId: relyingParty().id,
      userVerification: "required",
      ...(allow ? { allowCredentials: [{ type: "public-key" as const, id: allow }] } : {}),
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey answered.");
  const r = cred.response as AuthenticatorAssertionResponse;
  const authenticatorData = new Uint8Array(r.authenticatorData);
  if (!userVerified(authenticatorData)) throw new Error("The authenticator did not verify you (no biometric or PIN), which the contract requires.");
  return toAssertion({ authenticatorData, clientDataJSON: new Uint8Array(r.clientDataJSON), signature: new Uint8Array(r.signature) });
}

export function AgentPasskeyPanel({ agentId }: { agentId: number }) {
  const { sender, send, pub } = useSend();
  const [binding, setBinding] = useState<Binding>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | "create" | "sign" | "send" | "test" | "unbind">(null);
  const [note, setNote] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const id = BigInt(agentId);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [k, o] = await Promise.all([
          pub.readContract({ address: AGENT_PASSKEY_ADDRESS, abi: AGENT_PASSKEY_ABI, functionName: "keyOf", args: [id] }),
          pub.readContract({ address: REGISTRY, abi: OWNER_OF, functionName: "ownerOf", args: [id] }).catch(() => null),
        ]);
        if (!live) return;
        setBinding({ bound: k[0], x: k[1], y: k[2], at: k[3] });
        setOwner(o ? String(o) : null);
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [pub, id, tick]);

  const isOwner = !!sender && !!owner && owner.toLowerCase() === sender.address.toLowerCase();

  const bind = useCallback(async () => {
    if (!sender) return;
    setNote(null);
    try {
      // Gas first: a bind is ~250k gas. Learning you had no MON after two passkey prompts is the
      // worst place to learn it.
      const [have, price] = await Promise.all([pub.getBalance({ address: sender.address }), pub.getGasPrice()]);
      const g = gasCheck(have, 300_000n, price);
      if (g.state === "short") throw new Error(`This account needs MON for gas first (about ${Number(g.shortWei) / 1e18} more).`);

      setBusy("create");
      const created = (await navigator.credentials.create({
        publicKey: {
          rp: { id: relyingParty().id, name: "Kanmani agent passkey" },
          user: { id: buf(crypto.getRandomValues(new Uint8Array(16))), name: `agent #${agentId}`, displayName: `Kanmani agent #${agentId}` },
          challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
          // ES256 only: that is P-256, the curve Monad's precompile verifies.
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          attestation: "none",
          timeout: 120_000,
        },
      })) as PublicKeyCredential | null;
      if (!created) throw new Error("No passkey was created.");
      const spki = (created.response as AuthenticatorAttestationResponse).getPublicKey?.();
      if (!spki) throw new Error("This browser does not expose the new passkey's public key.");
      const key: P256Key = p256FromSpki(new Uint8Array(spki));

      setBusy("sign");
      const challenge = await pub.readContract({ address: AGENT_PASSKEY_ADDRESS, abi: AGENT_PASSKEY_ABI, functionName: "bindChallenge", args: [id, key.x, key.y, sender.address] });
      const a = await assertWith(challenge, created.rawId);

      // Checked on chain before paying for it: the same precompile, as a free read.
      const pre = await pub.readContract({ address: AGENT_PASSKEY_ADDRESS, abi: AGENT_PASSKEY_ABI, functionName: "verifyWith", args: [challenge, key.x, key.y, a] });
      if (!pre) throw new Error("Monad's P256 precompile rejected this signature, so nothing was sent.");

      setBusy("send");
      const hash = await send({ to: AGENT_PASSKEY_ADDRESS, data: bindCalldata(id, key, a), spendAtomic: 0n, label: `Bind a passkey to agent #${agentId}. Moves no token.` });
      setNote({ kind: "ok", text: `Bound. The passkey ${short(key.x)} now speaks for agent #${agentId}. ${hash}` });
      setTick((n) => n + 1);
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Cancelled. Nothing was sent." : ((e as Error).message ?? "Binding failed.").slice(0, 300) });
    } finally {
      setBusy(null);
    }
  }, [sender, pub, id, agentId, send]);

  const test = useCallback(async () => {
    setNote(null);
    setBusy("test");
    try {
      // A fresh challenge each time. Not a transaction: `verify` is a view, so this costs nothing.
      const challenge = keccak256(toHex(`kanmani passkey test agent ${agentId} ${Date.now()} ${Math.random()}`));
      const a = await assertWith(challenge);
      const ok = await pub.readContract({ address: AGENT_PASSKEY_ADDRESS, abi: AGENT_PASSKEY_ABI, functionName: "verify", args: [id, challenge, a] });
      setNote(
        ok
          ? { kind: "ok", text: `Verified on Monad. AgentPasskey.verify ran the P256 precompile over your device's signature and it matches the passkey bound to agent #${agentId}.` }
          : { kind: "error", text: "That passkey signed, but it is not the one bound to this agent. Monad's precompile said no." },
      );
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Cancelled." : ((e as Error).message ?? "The test failed.").slice(0, 300) });
    } finally {
      setBusy(null);
    }
  }, [pub, id, agentId]);

  const unbind = useCallback(async () => {
    setNote(null);
    setBusy("unbind");
    try {
      await send({ to: AGENT_PASSKEY_ADDRESS, data: unbindCalldata(id), spendAtomic: 0n, label: `Unbind the passkey from agent #${agentId}. Moves no token.` });
      setNote({ kind: "info", text: "Unbound. The agent has no passkey until you bind one again." });
      setTick((n) => n + 1);
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Declined. Nothing was sent." : ((e as Error).message ?? "Unbinding failed.").slice(0, 300) });
    } finally {
      setBusy(null);
    }
  }, [send, id, agentId]);

  const label = busy === "create" ? "creating the passkey…" : busy === "sign" ? "sign the binding with it…" : busy === "send" ? "sending…" : binding?.bound ? "replace it with a new passkey →" : "bind a passkey →";

  return (
    <div className="flex flex-col gap-3 px-5 py-4" data-testid="agent-passkey">
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[12.5px]">
        <span>
          {binding === null ? (
            failed ? <span className="unknown-value">unknown</span> : <span className="text-faint">reading…</span>
          ) : binding.bound ? (
            <>
              <span className="text-[var(--color-true)]">bound</span> · key <span className="text-[var(--color-text)]">{short(binding.x)}</span> · since block {binding.at.toLocaleString()}
            </>
          ) : (
            <span className="text-muted">no passkey bound</span>
          )}
        </span>
        <a className="text-[11px] text-muted hover:text-[var(--color-text)]" href={`https://monadscan.com/address/${AGENT_PASSKEY_ADDRESS}`} target="_blank" rel="noopener noreferrer">
          AgentPasskey ↗
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {binding?.bound ? (
          <button type="button" className="cta-ghost" onClick={test} disabled={busy !== null} data-testid="passkey-test">
            {busy === "test" ? "waiting for your passkey…" : "test it on chain with your passkey"}
          </button>
        ) : null}
        {isOwner ? (
          <>
            <button type="button" className="cta" onClick={bind} disabled={busy !== null} data-testid="passkey-bind">{label}</button>
            {binding?.bound ? (
              <button type="button" className="font-mono text-[12px] text-muted hover:text-[var(--color-false)]" onClick={unbind} disabled={busy !== null} data-testid="passkey-unbind">
                {busy === "unbind" ? "unbinding…" : "unbind"}
              </button>
            ) : null}
          </>
        ) : !binding?.bound && sender ? (
          <span className="text-[12px] text-faint">Only the agent&apos;s owner can bind a passkey.</span>
        ) : null}
      </div>

      {note ? (
        <p role="status" data-testid="passkey-note" className={`break-all text-[12.5px] leading-relaxed ${note.kind === "error" ? "text-[var(--color-false)]" : note.kind === "ok" ? "text-[var(--color-true)]" : "text-muted"}`}>
          {note.text}
        </p>
      ) : null}

      <p className="text-[11.5px] leading-relaxed text-faint">
        A passkey&apos;s private key cannot leave the device. Every use needs you there, verified by
        biometric or PIN. Bound to an agent, it is a second authority a stolen server key does not carry:
        any contract can call <code className="font-mono">AgentPasskey.verify</code> and Monad&apos;s P256
        precompile checks the device signed. It proves a device approved, not who holds it. It stops
        counting if the agent changes owner. Unbinding needs only the owner, so a lost phone never locks
        the agent.
      </p>
    </div>
  );
}
