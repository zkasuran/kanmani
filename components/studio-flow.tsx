"use client";

/**
 * The studio: compose a registration document, then put it on chain with your own key.
 *
 * Two doors, which is the shape the plan specified.
 *
 *   Door A, manage. You already own an agent. Point at it, see what we have already measured about
 *   it, then repoint its document with `setAgentURI`. The registry enforces ownership, so this can
 *   only ever work on an agent you actually hold.
 *
 *   Door B, create. Compose a document, watch each field's consequence appear, then send
 *   `register(agentURI)`.
 *
 * **We never sign for you and we never hold a key.** The transaction is signed either by the account
 * key your own passkey derives, in this browser or by any wallet you already use if you would
 * rather take the calldata and send it yourself. Both paths are offered on equal footing because a
 * project that measures other people's registrations must not be able to manufacture one and the
 * honest way to guarantee that is to have no means of doing it.
 *
 * Everything shown before the send is the exact bytes that will be sent. The calldata is on screen,
 * copyable and decodes back to what the preview showed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mono } from "@/components/ui.tsx";
import { ensureWalletChain, useSession, walletProvider } from "@/components/session.tsx";
import { formatNative, gasCheck, type GasCheck } from "@/lib/gas.ts";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import { type IrisKeys } from "@/lib/iris.ts";
import {
  EMPTY_DRAFT,
  IDENTITY_ABI,
  adopt,
  decodeDataUri,
  recordJsonPreserving,
  byteLength,
  consequences,
  identityRegistryFor,
  problems,
  registerCalldata,
  setAgentUriCalldata,
  type RegistrationDraft,
  type UriKind,
} from "@/lib/registration.ts";
import { registrable, viemChain } from "@/lib/chains.ts";
import { createWalletClient, createPublicClient, custom, encodeFunctionData, http } from "viem";
import { openSession } from "@/lib/session.ts";
import {
  agentScope,
  checkAuthority,
  signAction,
  verifyAction,
  type ActionReceipt,
  type Authority,
} from "@/lib/authority.ts";

type Door = "create" | "manage";

const CHAIN_OPTIONS = registrable();

const FIELD =
  "mt-1 w-full rounded border border-[var(--color-line-bright)] bg-[var(--color-ink)] px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]";
const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint";

/**
 * `hostedFailureAgents` is measured, not typed. This copy used to state a figure inline, which meant a
 * client component was asserting a population it had no way to re-check. The server page queries it and
 * passes it down, so the sentence cannot outlive the measurement.
 */
export function StudioFlow({ hostedFailureAgents }: { hostedFailureAgents: number | null }) {
  const [door, setDoor] = useState<Door>("create");
  const [draft, setDraft] = useState<RegistrationDraft>({
    ...EMPTY_DRAFT,
    skills: [{ id: "", endpoint: "", x402: false }],
  });
  const [kind, setKind] = useState<UriKind>("data");
  const [hostedAt, setHostedAt] = useState("");
  const [chainId, setChainId] = useState<number>(CHAIN_OPTIONS[0]?.id ?? 143);
  const [agentId, setAgentId] = useState("");
  const session = useSession();
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  // Already logged in with a passkey on this page load: use those keys rather than asking again.
  useEffect(() => {
    if (!keys && session.keys) setKeys(session.keys);
  }, [keys, session.keys]);

  /**
   * Who sends. A passkey account signs here with its derived key. A wallet session signs in the
   * wallet itself, which is why a wallet login can register with one click and no copied calldata.
   * The passkey wins when both exist, because it was chosen on this page.
   */
  const sender = useMemo<{ kind: "passkey" | "wallet"; address: `0x${string}` } | null>(() => {
    if (keys) return { kind: "passkey", address: keys.account.address };
    if (session.session?.method === "wallet") return { kind: "wallet", address: session.session.address };
    return null;
  }, [keys, session.session]);

  /** Can the sender afford this transaction? Read before the send, never learned from a failure. */
  const [gas, setGas] = useState<GasCheck | null>(null);
  const [gasTick, setGasTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [authority, setAuthority] = useState<Authority | null>(null);
  const [receipt, setReceipt] = useState<{ receipt: ActionReceipt; signature: string; binding: string } | null>(null);
  const [published, setPublished] = useState<"no" | "yes" | "already">("no");
  const [sent, setSent] = useState<{ hash: string; agentId?: string } | null>(null);
  /** Fields the existing document carried that this form does not model. Written back unchanged. */
  const [carried, setCarried] = useState<Record<string, unknown>>({});
  const [adopted, setAdopted] = useState<{ uri: string; onChain: boolean } | null>(null);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  // A stale "you own this" is the one piece of state that must never outlive its inputs, so it is
  // cleared whenever the id, the account or the door changes rather than refreshed in place.
  useEffect(() => {
    setAuthority(null);
    setReceipt(null);
    setPublished("no");
    setSent(null);
    setCarried({});
    setAdopted(null);
  }, [agentId, keys, door, sender?.address]);

  const json = useMemo(() => recordJsonPreserving(draft, carried), [draft, carried]);
  // When a document was adopted, the URI must be built over the preserved record rather than only the
  // edited fields or sending would silently strip whatever this form does not show.
  const uri = useMemo(
    () => (kind === "data" ? `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}` : hostedAt.trim()),
    [kind, json, hostedAt],
  );
  const cons = useMemo(() => consequences(draft, kind, hostedAt), [draft, kind, hostedAt]);
  const probs = useMemo(() => problems(draft, kind, hostedAt), [draft, kind, hostedAt]);

  const calldata = useMemo(() => {
    try {
      if (door === "create") return uri ? registerCalldata(uri) : "";
      if (!/^\d+$/.test(agentId) || !uri) return "";
      return setAgentUriCalldata(BigInt(agentId), uri);
    } catch {
      return "";
    }
  }, [door, uri, agentId]);

  useEffect(() => {
    setGas(null);
    if (!sender || !calldata) return;
    const chain = viemChain(chainId);
    const registry = identityRegistryFor(chainId);
    if (!chain || !registry) return;
    let live = true;
    const pub = createPublicClient({ chain, transport: http() });
    (async () => {
      const [have, units, price] = await Promise.all([
        pub.getBalance({ address: sender.address }).catch(() => null),
        pub.estimateGas({ account: sender.address, to: registry, data: calldata as `0x${string}` }).catch(() => null),
        pub.getGasPrice().catch(() => null),
      ]);
      if (live) setGas(gasCheck(have, units, price, units === null ? "the registry would not estimate this call" : "could not read the chain"));
    })();
    // Re-read every 8 seconds while it is short, so funding the address shows up without a reload.
    const t = window.setTimeout(() => live && setGasTick((n) => n + 1), 8000);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [sender, calldata, chainId, gasTick]);

  /** Top up a passkey account from the browser wallet: one transfer of exactly the shortfall. */
  const topUp = useCallback(async () => {
    const w = walletProvider();
    const chain = viemChain(chainId);
    if (!w || !chain || !keys || gas?.state !== "short") return;
    setBusy("topup");
    setNote(null);
    try {
      await ensureWalletChain(w, chain);
      const [from] = (await w.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      const wallet = createWalletClient({ account: from, chain, transport: custom(w) });
      const hash = await wallet.sendTransaction({ to: keys.account.address, value: gas.shortWei, account: from, chain });
      await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash });
      setNote({ kind: "info", text: `Sent ${formatNative(gas.shortWei)} ${chain.nativeCurrency.symbol} to your passkey account.` });
      setGasTick((n) => n + 1);
    } catch (e) {
      setNote({ kind: "error", text: declined(e) ? "Declined in the wallet. Nothing was sent." : ((e as Error).message ?? "The top-up failed.").slice(0, 300) });
    } finally {
      setBusy(null);
    }
  }, [chainId, keys, gas]);

  /** One passkey prompt, then the account key exists in memory only. Nothing is stored. */
  const connect = useCallback(async (mode: "new" | "existing") => {
    setNote(null);
    if (!webAuthnAvailable()) {
      setNote({ kind: "error", text: "This browser has no WebAuthn. A passkey cannot be created here." });
      return;
    }
    setBusy("connect");
    try {
      const outcome: CeremonyOutcome = mode === "new" ? await createAccount("Kanmani") : await signIn();
      if (!outcome.ok) {
        setNote({ kind: "error", text: `${outcome.cause} ${outcome.fix}` });
        return;
      }
      setKeys(outcome.keys);
      session.adopt(outcome);
      setNote({
        kind: "info",
        text: "Signed in. The key lives in this tab only and reconstructs from the same passkey on any device.",
      });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message ?? "The passkey ceremony failed." });
    } finally {
      setBusy(null);
    }
  }, [session]);

  /**
   * Door A: load the operator's own record and diagnose it, rather than showing an empty form.
   *
   * Retyping a document you already published is the friction that makes a one-field fix feel like a
   * project and it is the reason the plan specified "their own data, already measured" as the first
   * screen. The consequence list then does the diagnosis, so the operator sees what is wrong with the
   * record they have rather than being told in prose.
   *
   * A `data:` document decodes locally with no network at all. A hosted one has to be fetched and the
   * host may refuse a browser, in which case we say so and offer the paste, instead of pretending the
   * document is unreadable.
   */
  const loadMine = useCallback(async () => {
    if (!/^\d+$/.test(agentId)) return;
    setBusy("load");
    setNote(null);
    try {
      const res = await fetch(`/api/agent/${agentId}`, { headers: { accept: "application/json" } });
      if (!res.ok) {
        setNote({ kind: "error", text: `No agent #${agentId} in the index (HTTP ${res.status}).` });
        return;
      }
      const body = (await res.json()) as { data?: { registration?: { uri?: string } | null } };
      const u = body.data?.registration?.uri ?? "";
      if (!u) {
        setNote({ kind: "info", text: "That agent declares no document at all, so there is nothing to load. 80 agents on Monad are in that state." });
        return;
      }

      let text: string | null = decodeDataUri(u);
      const onChain = text !== null;
      if (!onChain) {
        try {
          // Through our own server, not straight from the agent's host: the CSP allows this page to
          // talk only to this origin and the chain RPCs. The server fetches through the SSRF guard.
          const r = await fetch(`/api/agent/${agentId}/document`, { cache: "no-store" });
          text = r.ok ? await r.text() : null;
          if (!r.ok) {
            setNote({ kind: "error", text: `The document answered HTTP ${r.status}, so there is nothing to adopt. That is the finding, not a problem with this page.` });
            return;
          }
        } catch {
          setNote({ kind: "error", text: "Your host refused a browser fetch, which is a CORS setting rather than a fault. Paste the JSON into the fields below and the diagnosis still works." });
          setAdopted({ uri: u, onChain: false });
          return;
        }
      }

      const a = text ? adopt(text, onChain) : null;
      if (!a) {
        setNote({ kind: "error", text: "The document fetched but did not parse as a registration object." });
        return;
      }
      setDraft(a.draft);
      setCarried(a.carried);
      setAdopted({ uri: u, onChain });
      // Default the hosting choice to what they already use, so nothing changes unless they choose to.
      setKind(onChain ? "data" : "https");
      if (!onChain) setHostedAt(u);
      setNote({ kind: "info", text: "Loaded. Every field below is yours; the consequence list says what this record currently does." });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message ?? "Could not load." });
    } finally {
      setBusy(null);
    }
  }, [agentId]);

  /** Ask the registry, via our own API, whether the sending account actually holds the agent. */
  const verifyOwnership = useCallback(async () => {
    if (!sender || !/^\d+$/.test(agentId)) return;
    setBusy("authority");
    setNote(null);
    try {
      setAuthority(await checkAuthority(Number(agentId), sender.address));
    } finally {
      setBusy(null);
    }
  }, [sender, agentId]);

  /**
   * Sign a statement of intent before the transaction is sent.
   *
   * Signed with the attestation key, which cannot move money, so the receipt proves who authorised
   * this change to this document without granting anything. It commits to the URI by hash, which is
   * what makes it a defence against a page that previews one document and sends another.
   */
  const signIntent = useCallback(() => {
    if (!keys || !uri) return;
    setNote(null);
    try {
      setReceipt(
        signAction(
          {
            action: door === "create" ? "register" : "setAgentURI",
            chainId,
            agentId: door === "create" ? null : Number(agentId),
            agentURI: uri,
          },
          keys,
        ),
      );
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message ?? "Could not sign." });
    }
  }, [keys, uri, door, chainId, agentId]);

  /**
   * Publish the receipt so it is an audit trail rather than a personal artifact.
   *
   * Optional on purpose. A receipt is already complete and verifiable in the holder's hands; sending
   * it only makes it visible to somebody else. So this is a button, not a step.
   */
  const publish = useCallback(async () => {
    if (!receipt) return;
    setBusy("publish");
    setNote(null);
    try {
      const res = await fetch("/api/receipt/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(receipt),
      });
      const body = (await res.json().catch(() => null)) as { data?: { firstTime?: boolean }; detail?: string } | null;
      if (!res.ok) {
        setNote({ kind: "error", text: body?.detail ?? `The receipt was refused (HTTP ${res.status}).` });
        return;
      }
      setPublished(body?.data?.firstTime ? "yes" : "already");
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message ?? "The request failed." });
    } finally {
      setBusy(null);
    }
  }, [receipt]);

  /**
   * Send the transaction from the passkey-derived account.
   *
   * A registration is the one action here that cannot be relayed: the registry records `msg.sender` as
   * the owner, so a relayer would end up owning the agent. That is why this account needs MON for gas
   * and why the gasless path used everywhere else does not apply.
   *
   * The session is scoped to authority rather than to a spend (`maxAmountAtomic` is 0n) so a session
   * opened to pay for a verification cannot silently also register an agent. It is ended in a `finally`
   * so the key is zeroed whether the send succeeded or threw.
   */
  const send = useCallback(async () => {
    if (!keys || !calldata || !uri) return;
    const chain = viemChain(chainId);
    const registry = identityRegistryFor(chainId);
    if (!chain || !registry) {
      setNote({ kind: "error", text: "This chain has no browser endpoint configured, so it cannot be written to here." });
      return;
    }
    setBusy("send");
    setNote(null);
    noteBuild({ draft, kind, hostedAt, agentId: door === "manage" ? agentId : undefined });
    let session: ReturnType<typeof openSession> | null = null;
    try {
      session = openSession({
        privateKey: keys.account.privateKey,
        scope: agentScope(door === "create" ? "register" : "setAgentURI", window.location.host),
        ttlMs: 120_000,
      });
      // Run the session gate before the key signs, the same as the payment path does. It moves no
      // token, so the amount is zero, but the check still enforces the expiry and the scope rather
      // than handing a raw signer to viem with nothing in front of it.
      session.assertCanPay(0n);
      const wallet = createWalletClient({ account: session.account, chain, transport: http() });
      const pub = createPublicClient({ chain, transport: http() });

      const hash =
        door === "create"
          ? await wallet.writeContract({ address: registry, abi: IDENTITY_ABI, functionName: "register", args: [uri] })
          : await wallet.writeContract({
              address: registry,
              abi: IDENTITY_ABI,
              functionName: "setAgentURI",
              args: [BigInt(agentId), uri],
            });

      setSent({ hash });
      const rec = await pub.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") {
        setNote({ kind: "error", text: "The transaction was mined and reverted. Nothing changed on chain." });
        return;
      }
      // The registry is an ERC-721, so a mint emits Transfer with the token id as the fourth topic.
      // Read rather than assumed: a registration has no return value a transaction can carry.
      const mint = rec.logs.find(
        (l) => l.address.toLowerCase() === registry.toLowerCase() && l.topics.length === 4,
      );
      setSent({ hash, agentId: mint?.topics[3] ? String(BigInt(mint.topics[3])) : undefined });
    } catch (e) {
      const m = (e as Error).message ?? "The send failed.";
      setNote({
        kind: "error",
        text: /insufficient funds/i.test(m)
          ? "That account has no MON for gas. A registration cannot be relayed, because the registry records msg.sender as the owner."
          : m.slice(0, 400),
      });
    } finally {
      session?.end();
      setBusy(null);
    }
  }, [keys, calldata, uri, chainId, door, agentId, draft, kind, hostedAt]);

  /**
   * Send from the logged-in browser wallet. The wallet shows the call and signs it; we never see a
   * key. The wallet is moved to the target chain first. The sending account must still be the
   * one that logged in, so a wallet switched mid-page cannot register under an unexpected owner.
   */
  const sendFromWallet = useCallback(async () => {
    const w = walletProvider();
    const chain = viemChain(chainId);
    const registry = identityRegistryFor(chainId);
    if (!w || !sender || sender.kind !== "wallet" || !chain || !registry || !uri) {
      setNote({ kind: "error", text: "No browser wallet is available on this page." });
      return;
    }
    setBusy("send");
    setNote(null);
    noteBuild({ draft, kind, hostedAt, agentId: door === "manage" ? agentId : undefined });
    try {
      await ensureWalletChain(w, chain);
      const [from] = ((await w.request({ method: "eth_requestAccounts" })) as string[]).map((a) => a.toLowerCase());
      if (from !== sender.address.toLowerCase()) {
        setNote({ kind: "error", text: `The wallet is now on ${from}, not the account you logged in with. Switch back or log in again.` });
        return;
      }
      const wallet = createWalletClient({ account: sender.address, chain, transport: custom(w) });
      const data =
        door === "create"
          ? encodeFunctionData({ abi: IDENTITY_ABI, functionName: "register", args: [uri] })
          : encodeFunctionData({ abi: IDENTITY_ABI, functionName: "setAgentURI", args: [BigInt(agentId), uri] });
      // The exact bytes previewed above, so what the wallet shows is what this page showed.
      if (data !== calldata) throw new Error("The transaction differs from the preview. Nothing was sent.");
      const hash = await wallet.sendTransaction({ to: registry, data, account: sender.address, chain });
      setSent({ hash });
      const rec = await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash });
      if (rec.status !== "success") {
        setNote({ kind: "error", text: "The transaction was mined and reverted. Nothing changed on chain." });
        return;
      }
      const mint = rec.logs.find((l) => l.address.toLowerCase() === registry.toLowerCase() && l.topics.length === 4);
      setSent({ hash, agentId: mint?.topics[3] ? String(BigInt(mint.topics[3])) : undefined });
    } catch (e) {
      const m = (e as Error).message ?? "The send failed.";
      setNote({
        kind: "error",
        text: declined(e) ? "Declined in the wallet. Nothing was sent." : /insufficient funds/i.test(m) ? `That wallet has no ${chain.nativeCurrency.symbol} for gas.` : m.slice(0, 400),
      });
    } finally {
      setBusy(null);
    }
  }, [sender, chainId, uri, door, agentId, calldata, draft, kind, hostedAt]);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ kind: "info", text: `${what} copied.` });
    } catch {
      setNote({ kind: "error", text: "This browser refused clipboard access. Select the text and copy it." });
    }
  }, []);

  const setSkill = (i: number, patch: Partial<RegistrationDraft["skills"][number]>) =>
    setDraft((d) => ({ ...d, skills: d.skills.map((s, j) => (i === j ? { ...s, ...patch } : s)) }));

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- the two doors */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDoor("create")}
          className={door === "create" ? "cta" : "cta-ghost"}
        >
          register a new agent
        </button>
        <button
          type="button"
          onClick={() => setDoor("manage")}
          className={door === "manage" ? "cta" : "cta-ghost"}
        >
          repoint an agent you own
        </button>
      </div>

      {/* ---------------------------------------------------------------- which chain */}
      <div className="rounded border border-[var(--color-line)] p-3">
        <span className={LABEL}>which chain this agent is registered on</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {CHAIN_OPTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChainId(c.id)}
              className={chainId === c.id ? "cta" : "cta-ghost"}
            >
              {c.displayName} · {c.id}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          Only chains where the ERC-8004 registries are actually deployed are offered, read from the
          chain registry rather than hardcoded.{" "}
          <Link href="/chains" className="text-[var(--color-brand)] hover:underline">
            Which chains and what it takes to add one →
          </Link>{" "}
          Your identity lives here; the work can settle on any chain we can read.
        </p>
      </div>

      {door === "manage" ? (
        <label className="block max-w-xs">
          <span className={LABEL}>the agent id you own</span>
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder="10252"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value.replace(/[^\d]/g, ""))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={loadMine}
              disabled={!/^\d+$/.test(agentId) || busy === "load"}
              className="cta"
            >
              {busy === "load" ? "loading your record…" : "load my record →"}
            </button>
            {adopted ? (
              <span className={`chip ${adopted.onChain ? "chip--live" : "chip--built"}`}>
                {adopted.onChain ? "loaded from chain" : "loaded from your host"}
              </span>
            ) : null}
          </div>
          {adopted && Object.keys(carried).length > 0 ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              {Object.keys(carried).length} field
              {Object.keys(carried).length === 1 ? "" : "s"} this form does not edit (
              <Mono className="text-[11px]">{Object.keys(carried).slice(0, 4).join(", ")}</Mono>
              {Object.keys(carried).length > 4 ? "…" : ""}) are carried through unchanged. Dropping a
              field because we have no input for it would be a worse edit than the one you came to make.
            </p>
          ) : null}
          <span className="mt-2 block text-[11.5px] leading-snug text-muted">
            `setAgentURI` reverts for anyone who is not the owner, so this can only work on an agent
            you hold. Read what we already measured about it on{" "}
            {agentId ? (
              <Link href={`/agent/${agentId}`} className="text-[var(--color-brand)] hover:underline">
                /agent/{agentId}
              </Link>
            ) : (
              <span className="text-faint">/agent/&lt;id&gt;</span>
            )}
            .
          </span>
        </label>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* -------------------------------------------------------------- compose */}
        <div className="flex flex-col gap-3">
          <p className="eyebrow">the document</p>

          <label className="block">
            <span className={LABEL}>name</span>
            <input className={FIELD} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="what this agent is called" />
          </label>

          <label className="block">
            <span className={LABEL}>description</span>
            <textarea
              className={`${FIELD} min-h-[4.5rem] resize-y`}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="what it does, in one sentence a buyer can read"
            />
          </label>

          <label className="block">
            <span className={LABEL}>url</span>
            <input className={FIELD} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://your-site" />
          </label>

          <div className="rounded border border-[var(--color-line)] p-3">
            <span className={LABEL}>skills</span>
            {draft.skills.map((s, i) => (
              <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
                <input className={FIELD} value={s.id} onChange={(e) => setSkill(i, { id: e.target.value })} placeholder="skill id" />
                <input className={FIELD} value={s.endpoint} onChange={(e) => setSkill(i, { endpoint: e.target.value })} placeholder="https://… endpoint" />
                <label className="flex items-center gap-1.5 pb-1.5 font-mono text-[11px] text-muted">
                  <input type="checkbox" checked={s.x402} onChange={(e) => setSkill(i, { x402: e.target.checked })} />
                  x402
                </label>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDraft({ ...draft, skills: [...draft.skills, { id: "", endpoint: "", x402: false }] })}
              className="mt-2 font-mono text-[11px] text-[var(--color-brand)] hover:underline"
            >
              + another skill
            </button>
          </div>

          <div className="rounded border border-[var(--color-line)] p-3">
            <span className={LABEL}>where the record lives</span>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setKind("data")} className={kind === "data" ? "cta" : "cta-ghost"}>
                data: on chain
              </button>
              <button type="button" onClick={() => setKind("https")} className={kind === "https" ? "cta" : "cta-ghost"}>
                hosted at a URL
              </button>
            </div>
            {kind === "https" ? (
              <input className={FIELD} value={hostedAt} onChange={(e) => setHostedAt(e.target.value)} placeholder="https://your-site/agent.json" />
            ) : null}
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              {kind === "data"
                ? "Costs more gas once, then cannot rot. We took this option for our own record after measuring what happens to hosted ones."
                : `${hostedFailureAgents === null ? "Agents" : `${hostedFailureAgents.toLocaleString()} agents`} on Monad point at a hosted document whose host answered and said it is not there. It is a valid choice and it is the failure mode we measured most.`}
            </p>
          </div>
        </div>

        {/* -------------------------------------------------------------- consequences and bytes */}
        <div className="flex flex-col gap-3">
          <p className="eyebrow">
            {adopted ? "what your record currently does" : "what this document would mean"}
          </p>
          <ul className="space-y-1.5">
            {cons.map((c) => (
              <li key={c.label} className="flex gap-2 text-[12.5px] leading-snug">
                <span
                  aria-hidden
                  className={`mt-[0.3rem] h-2 w-2 shrink-0 rounded-sm ${c.met ? "bg-[var(--color-brand)]" : "bg-[var(--color-line-bright)]"}`}
                />
                <span>
                  <span className={c.met ? "text-[var(--color-text)]" : "text-muted"}>{c.label}</span>
                  <span className="block text-[11.5px] leading-snug text-faint">{c.why}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>the bytes that go on chain</span>
              <span className="font-mono text-[11px] text-faint">{byteLength(uri).toLocaleString()} bytes</span>
            </div>
            <pre className="sql mt-2 max-h-48 overflow-auto">{json || "{}"}</pre>
          </div>

          {probs.length ? (
            <ul className="rounded border border-[var(--color-line-bright)] bg-[var(--color-panel-2)] p-3 text-[12px] text-muted">
              {probs.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          ) : null}

          {calldata ? (
            <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className={LABEL}>{door === "create" ? "register(agentURI)" : "setAgentURI(agentId, newURI)"}</span>
                <button type="button" onClick={() => copy(calldata, "Calldata")} className="font-mono text-[11px] text-[var(--color-brand)] hover:underline">
                  copy
                </button>
              </div>
              <p className="mt-1 font-mono text-[11px] text-faint">
                to {identityRegistryFor(chainId) ?? "no registry on this chain"} on chain {chainId}
              </p>
              <pre className="sql mt-2 max-h-28 overflow-auto break-all">{calldata}</pre>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------------------------------------------------------------- authority */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
        <p className="eyebrow">authority</p>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
          The registry decides who may write: <Mono>setAgentURI</Mono> reverts for anyone who is not
          the owner and nothing here can add to that. What a passkey adds is the three things the
          chain cannot do for you. It tells you that you are not the owner{" "}
          <span className="text-[var(--color-text)]">before</span> you pay gas to find out, bind the
          transaction to the document you actually previewed and give you an authority that
          reconstructs on another device instead of living in one browser profile.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {sender ? (
            <>
              <span className="chip chip--live">{sender.kind === "wallet" ? "wallet" : "passkey"}</span>
              <code className="font-mono text-[12px] text-[var(--color-text)]" data-testid="studio-sender">{sender.address}</code>
              {keys ? <span className="font-mono text-[11px] text-faint">{keys.attestation.id.slice(0, 28)}…</span> : null}
              {sender.kind === "wallet" ? (
                <button type="button" disabled={busy === "connect"} onClick={() => connect("existing")} className="font-mono text-[11px] text-muted hover:text-[var(--color-text)]">
                  use a passkey instead
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" disabled={busy === "connect"} onClick={() => connect("existing")} className="cta">
                {busy === "connect" ? "waiting for the prompt…" : "sign in with a passkey"}
              </button>
              <button type="button" disabled={busy === "connect"} onClick={() => connect("new")} className="cta-ghost">
                create a new passkey
              </button>
              <Link href="/login" className="font-mono text-[12px] text-muted hover:text-[var(--color-text)]">
                or log in with a wallet →
              </Link>
            </>
          )}
        </div>

        {/* ---- ownership, only meaningful when repointing something that exists ---- */}
        {sender && door === "manage" ? (
          <div className="mt-4 border-t border-[var(--color-line)] pt-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={verifyOwnership}
                disabled={!/^\d+$/.test(agentId) || busy === "authority"}
                className="cta-ghost"
              >
                {busy === "authority" ? "asking the registry…" : "check that you own this agent →"}
              </button>
              {authority?.kind === "owner" ? <span className="chip chip--live">you own #{authority.agentId}</span> : null}
            </div>

            {authority?.kind === "notOwner" ? (
              <p className="mt-3 rounded border border-[var(--color-line-bright)] bg-[var(--color-panel-2)] p-3 text-[12.5px] leading-relaxed text-muted">
                <span className="text-[var(--color-false)]">This agent is held by another account.</span>{" "}
                The registry owner is <Mono className="break-all">{authority.owner}</Mono> and you are
                signed in as <Mono className="break-all">{authority.connected}</Mono>. Sending{" "}
                <Mono>setAgentURI</Mono> would revert and cost gas. Usually this means a different
                passkey, not a problem with the agent.
              </p>
            ) : null}

            {authority?.kind === "noSuchAgent" ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                No agent <Mono>#{authority.agentId}</Mono> is in the index. If you meant to create one,
                use <span className="text-[var(--color-text)]">register a new agent</span> above.
              </p>
            ) : null}

            {authority?.kind === "unknown" ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                <span className="unknown-value">unknown</span> because we could not find out ({authority.reason}).
                That is our failure to look, not a statement about your ownership, so nothing here is
                blocked on it. The registry will still refuse a write you are not entitled to make.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---- intent, bound to the document by hash ---- */}
        {keys && uri && probs.length === 0 ? (
          <div className="mt-4 border-t border-[var(--color-line)] pt-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" onClick={signIntent} className="cta-ghost">
                sign what you are about to send →
              </button>
              {receipt ? (
                <span className="chip chip--live">
                  {verifyAction(receipt.receipt, receipt.signature) ? "receipt verifies" : "receipt invalid"}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-[11.5px] leading-relaxed text-muted">
              Signed by the attestation key, which is ed25519 and cannot move money, so the receipt
              proves who authorised this change without granting anything. It commits to the document
              by hash, so a page that previewed one document and sent another would not match it.
              Publishing is optional: the receipt is already complete and verifiable in your hands,
              and sending it only makes it visible on the agent&apos;s own page.
            </p>
            {receipt ? (
              <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={LABEL}>action receipt</span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => copy(JSON.stringify({ ...receipt.receipt, signature: receipt.signature }, null, 2), "Receipt")}
                      className="font-mono text-[11px] text-[var(--color-brand)] hover:underline"
                    >
                      copy
                    </button>
                    <button
                      type="button"
                      onClick={publish}
                      disabled={busy === "publish" || published !== "no"}
                      className="font-mono text-[11px] text-[var(--color-brand)] hover:underline disabled:opacity-50 disabled:hover:no-underline"
                    >
                      {busy === "publish"
                        ? "publishing…"
                        : published === "yes"
                          ? "published"
                          : published === "already"
                            ? "already published"
                            : "publish"}
                    </button>
                  </span>
                </div>
                <pre className="sql mt-2 max-h-40 overflow-auto">
                  {JSON.stringify({ ...receipt.receipt, signature: receipt.signature }, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- send it, from the passkey account or the logged-in wallet ---- */}
        {sender && calldata && probs.length === 0 ? (
          <div className="mt-4 border-t border-[var(--color-line)] pt-4">
            <GasPanel
              gas={gas}
              sender={sender}
              symbol={viemChain(chainId)?.nativeCurrency.symbol ?? "MON"}
              chainId={chainId}
              canTopUp={sender.kind === "passkey" && walletProvider() !== null}
              busy={busy === "topup"}
              onTopUp={topUp}
              onCopy={() => copy(sender.address, "Address")}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={sender.kind === "wallet" ? sendFromWallet : send}
                disabled={busy === "send" || Boolean(sent?.agentId) || gas?.state === "short"}
                className="cta"
                data-testid="studio-send"
              >
                {busy === "send"
                  ? "signing and sending…"
                  : sent?.agentId
                    ? "sent"
                    : door === "create"
                      ? sender.kind === "wallet"
                        ? "register it from your wallet →"
                        : "register it from this account →"
                      : sender.kind === "wallet"
                        ? "repoint it from your wallet →"
                        : "repoint it from this account →"}
              </button>
              {door === "manage" && authority?.kind !== "owner" ? (
                <span className="font-mono text-[11px] text-muted">
                  check ownership first or the registry will reject it
                </span>
              ) : null}
            </div>

            {sent ? (
              <div className="mt-3 rounded border border-[var(--brand-line)] bg-[var(--color-panel)] p-3 text-[12.5px]">
                <a
                  href={`https://monadscan.com/tx/${sent.hash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[var(--color-brand)] hover:underline"
                >
                  {sent.hash.slice(0, 12)}…{sent.hash.slice(-10)}
                </a>
                {sent.agentId ? (
                  <span className="ml-2 text-muted">
                    registered as agent <Mono className="text-[var(--color-text)]">#{sent.agentId}</Mono>. It appears
                    on this site once the indexer sees it.
                  </span>
                ) : (
                  <span className="ml-2 text-muted">sent, waiting for the receipt…</span>
                )}
              </div>
            ) : null}

            <p className="mt-2 max-w-3xl text-[11.5px] leading-relaxed text-muted">
              {sender.kind === "wallet"
                ? "Your wallet shows the call and signs it. This page checks the bytes match the preview above before handing them over and never sees a key."
                : "Signed by a session scoped to this one action and nothing else. It may not move a token and the key is zeroed the moment the send finishes. We never hold it."}
            </p>
          </div>
        ) : null}

        {sender ? (
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
            This address owns whatever it registers and it needs MON for gas: a registration is the
            one action here that is not relayed, because the registry records{" "}
            <Mono>msg.sender</Mono> as the owner and a relayer would end up owning your agent.{" "}
            {sender.kind === "passkey"
              ? "The key comes from the passkey rather than from anything stored here, so the same passkey on another device reaches the same agent. "
              : "It is your wallet's own address, so the agent is held wherever that wallet is. "}
            <Link href="/account" className="text-[var(--color-brand)] hover:underline">
              What the four keys are →
            </Link>
          </p>
        ) : (
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
            Or skip the passkey entirely: take the calldata above and send it from any wallet. Nothing
            here is custodial either way, because there is no key on our server that could sign for you.
            Signing in adds three things a copied calldata cannot. It checks you own the agent before
            you pay gas, it leaves a receipt bound to the document and it can send the transaction
            itself from the account your passkey derives.
          </p>
        )}

        {note ? (
          <p className={`mt-3 text-[12.5px] ${note.kind === "error" ? "text-[var(--color-false)]" : "text-muted"}`}>
            {note.text}
          </p>
        ) : null}
      </div>

      <p className="text-[12px] leading-relaxed text-faint">
        After the transaction lands, the indexer sees it and the record is measured like every other:
        a{" "}
        <code className="font-mono">MetadataUpdate</code> re-runs the ladder for that agent, so a
        repointed document updates its own verdict with both timestamps kept.{" "}
        <Link href="/method" className="text-[var(--color-brand)] hover:underline">
          How each rung is decided →
        </Link>
      </p>
    </div>
  );
}


/** Tell the server which URI is about to be registered, so it can be counted as built here. Fire and forget. */
function noteBuild(body: unknown) {
  void fetch("/api/registration/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}

/** viem wraps a wallet's 4001 inside its own error types, so look through the cause chain. */
function declined(e: unknown): boolean {
  for (let x = e as { code?: number; name?: string; cause?: unknown } | undefined, i = 0; x && i < 6; x = x.cause as typeof x, i++) {
    if (x.code === 4001 || x.name === "UserRejectedRequestError") return true;
  }
  return false;
}

/**
 * The sender, its balance and what the send needs, shown before the send button is live.
 *
 * Three ways to cover a shortfall, in the order a newcomer is likeliest to have them: top up from a
 * browser wallet in one click (passkey accounts only), copy the address to send from an exchange or
 * another wallet or open it on the explorer to watch it arrive. The check re-reads every few
 * seconds, so funding shows up without a reload.
 */
function GasPanel({
  gas,
  sender,
  symbol,
  chainId,
  canTopUp,
  busy,
  onTopUp,
  onCopy,
}: {
  gas: GasCheck | null;
  sender: { kind: "passkey" | "wallet"; address: string };
  symbol: string;
  chainId: number;
  canTopUp: boolean;
  busy: boolean;
  onTopUp: () => void;
  onCopy: () => void;
}) {
  const explorer = chainId === 143 ? `https://monadscan.com/address/${sender.address}` : chainId === 56 ? `https://bscscan.com/address/${sender.address}` : null;
  return (
    <div className="gas-panel" data-testid="gas-panel" data-state={gas?.state ?? "reading"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={LABEL}>gas for this send</span>
        <span className="font-mono text-[12px]">
          {gas === null ? (
            <span className="text-faint">reading…</span>
          ) : gas.state === "unknown" ? (
            <span className="unknown-value">unknown</span>
          ) : (
            <>
              <span className={gas.state === "enough" ? "text-[var(--color-true)]" : "text-[var(--color-false)]"}>
                {formatNative(gas.haveWei)} {symbol}
              </span>
              <span className="text-faint"> held · about {formatNative(gas.needWei)} needed</span>
            </>
          )}
        </span>
      </div>
      {gas?.state === "unknown" ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
          Could not check ({gas.reason}). You can still send; the chain decides.
        </p>
      ) : null}
      {gas?.state === "short" ? (
        <div className="mt-2">
          <p className="text-[12px] leading-relaxed text-[var(--color-text)]">
            This {sender.kind === "passkey" ? "passkey account" : "wallet"} needs about {formatNative(gas.shortWei)} more {symbol}{" "}
            before it can send.{" "}
            <span className="text-muted">
              {sender.kind === "passkey" ? "A new passkey account starts empty. " : ""}Nobody else can pay this gas for you: whoever sends the registration becomes the owner.
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {canTopUp ? (
              <button type="button" onClick={onTopUp} disabled={busy} className="cta-ghost" data-testid="gas-topup">
                {busy ? "waiting for the wallet…" : `send ${formatNative(gas.shortWei)} ${symbol} from my wallet`}
              </button>
            ) : null}
            <button type="button" onClick={onCopy} className="cta-ghost">
              copy address to fund it
            </button>
            {explorer ? (
              <a href={explorer} target="_blank" rel="noopener noreferrer" className="font-mono text-[11.5px] text-muted hover:text-[var(--color-text)]">
                watch it on the explorer ↗
              </a>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">Checks again every few seconds. The send button turns on once it arrives.</p>
        </div>
      ) : null}
    </div>
  );
}
