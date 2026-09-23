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
 * key your own passkey derives, in this browser, or by any wallet you already use if you would
 * rather take the calldata and send it yourself. Both paths are offered on equal footing because a
 * project that measures other people's registrations must not be able to manufacture one, and the
 * honest way to guarantee that is to have no means of doing it.
 *
 * Everything shown before the send is the exact bytes that will be sent. The calldata is on screen,
 * copyable, and decodes back to what the preview showed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mono } from "@/components/ui.tsx";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import { type IrisKeys } from "@/lib/iris.ts";
import {
  EMPTY_DRAFT,
  agentUri,
  byteLength,
  consequences,
  identityRegistryFor,
  problems,
  recordJson,
  registerCalldata,
  setAgentUriCalldata,
  type RegistrationDraft,
  type UriKind,
} from "@/lib/registration.ts";
import { registrable } from "@/lib/chains.ts";
import {
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

export function StudioFlow() {
  const [door, setDoor] = useState<Door>("create");
  const [draft, setDraft] = useState<RegistrationDraft>({
    ...EMPTY_DRAFT,
    skills: [{ id: "", endpoint: "", x402: false }],
  });
  const [kind, setKind] = useState<UriKind>("data");
  const [hostedAt, setHostedAt] = useState("");
  const [chainId, setChainId] = useState<number>(CHAIN_OPTIONS[0]?.id ?? 143);
  const [agentId, setAgentId] = useState("");
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authority, setAuthority] = useState<Authority | null>(null);
  const [receipt, setReceipt] = useState<{ receipt: ActionReceipt; signature: string } | null>(null);
  const [published, setPublished] = useState<"no" | "yes" | "already">("no");
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  // A stale "you own this" is the one piece of state that must never outlive its inputs, so it is
  // cleared whenever the id, the account or the door changes rather than refreshed in place.
  useEffect(() => {
    setAuthority(null);
    setReceipt(null);
    setPublished("no");
  }, [agentId, keys, door]);

  const json = useMemo(() => recordJson(draft), [draft]);
  const uri = useMemo(() => agentUri(draft, kind, hostedAt), [draft, kind, hostedAt]);
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

  /** One passkey prompt, then the account key exists in memory only. Nothing is stored. */
  const connect = useCallback(async (mode: "new" | "existing") => {
    setNote(null);
    if (!webAuthnAvailable()) {
      setNote({ kind: "error", text: "This browser has no WebAuthn. A passkey cannot be created here." });
      return;
    }
    setBusy("connect");
    try {
      const outcome: CeremonyOutcome = mode === "new" ? await createAccount("Kanmani studio") : await signIn();
      if (!outcome.ok) {
        setNote({ kind: "error", text: `${outcome.cause} ${outcome.fix}` });
        return;
      }
      setKeys(outcome.keys);
      setNote({
        kind: "info",
        text: "Signed in. The key lives in this tab only and reconstructs from the same passkey on any device.",
      });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message ?? "The passkey ceremony failed." });
    } finally {
      setBusy(null);
    }
  }, []);

  /** Ask the registry, via our own API, whether this passkey account actually holds the agent. */
  const verifyOwnership = useCallback(async () => {
    if (!keys || !/^\d+$/.test(agentId)) return;
    setBusy("authority");
    setNote(null);
    try {
      setAuthority(await checkAuthority(Number(agentId), keys.account.address));
    } finally {
      setBusy(null);
    }
  }, [keys, agentId]);

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
            Which chains, and what it takes to add one →
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
          <span className="mt-1 block text-[11.5px] leading-snug text-muted">
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
                : "8,640 agents on Monad point at a hosted document whose host answered and said it is not there. It is a valid choice and it is the failure mode we measured most."}
            </p>
          </div>
        </div>

        {/* -------------------------------------------------------------- consequences and bytes */}
        <div className="flex flex-col gap-3">
          <p className="eyebrow">what this document would mean</p>
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
          the owner, and nothing here can add to that. What a passkey adds is the three things the
          chain cannot do for you — tell you that you are not the owner{" "}
          <span className="text-[var(--color-text)]">before</span> you pay gas to find out, bind the
          transaction to the document you actually previewed, and give you an authority that
          reconstructs on another device instead of living in one browser profile.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {keys ? (
            <>
              <span className="chip chip--live">signed in</span>
              <code className="font-mono text-[12px] text-[var(--color-text)]">{keys.account.address}</code>
              <span className="font-mono text-[11px] text-faint">{keys.attestation.id.slice(0, 28)}…</span>
            </>
          ) : (
            <>
              <button type="button" disabled={busy === "connect"} onClick={() => connect("existing")} className="cta">
                {busy === "connect" ? "waiting for the prompt…" : "sign in with a passkey"}
              </button>
              <button type="button" disabled={busy === "connect"} onClick={() => connect("new")} className="cta-ghost">
                create a new passkey
              </button>
            </>
          )}
        </div>

        {/* ---- ownership, only meaningful when repointing something that exists ---- */}
        {keys && door === "manage" ? (
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
                <span className="unknown-value">unknown</span> — we could not find out ({authority.reason}).
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

        {keys ? (
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
            This address owns whatever it registers, and it needs MON for gas: a registration is the
            one action here that is not relayed, because the registry records{" "}
            <Mono>msg.sender</Mono> as the owner and a relayer would end up owning your agent. The key
            comes from the passkey rather than from anything stored here, so the same passkey on
            another device reaches the same agent.{" "}
            <Link href="/account" className="text-[var(--color-brand)] hover:underline">
              What the four keys are →
            </Link>
          </p>
        ) : (
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
            You can also skip the passkey entirely, take the calldata above and send it from any
            wallet. Nothing here is custodial either way: there is no key on our server that could
            sign for you. The passkey path exists because it can check ownership first and leave you a
            receipt.
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
