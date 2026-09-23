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

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import { type IrisKeys } from "@/lib/iris.ts";
import {
  EMPTY_DRAFT,
  IDENTITY_REGISTRY,
  agentUri,
  byteLength,
  consequences,
  problems,
  recordJson,
  registerCalldata,
  setAgentUriCalldata,
  type RegistrationDraft,
  type UriKind,
} from "@/lib/registration.ts";

type Door = "create" | "manage";

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
  const [agentId, setAgentId] = useState("");
  const [keys, setKeys] = useState<IrisKeys | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);

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
              <p className="mt-1 font-mono text-[11px] text-faint">to {IDENTITY_REGISTRY} on chain 143</p>
              <pre className="sql mt-2 max-h-28 overflow-auto break-all">{calldata}</pre>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------------------------------------------------------------- sign it yourself */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
        <p className="eyebrow">sign it with your own key</p>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
          Two ways, offered on equal footing. Take the calldata above and send it from any wallet you
          already use, or sign in with a passkey and send it from the account that passkey derives.
          Either way the key is yours: nothing is stored here and we hold nothing that could sign on
          your behalf.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {keys ? (
            <>
              <span className="chip chip--live">signed in</span>
              <code className="font-mono text-[12px] text-[var(--color-text)]">{keys.account.address}</code>
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

        {keys ? (
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
            This address owns whatever it registers. It needs MON for gas, because a registration is
            the one action here that is not relayed: the registry records{" "}
            <code className="font-mono text-[var(--color-brand)]">msg.sender</code> as the owner, so a
            relayer would end up owning your agent.{" "}
            <Link href="/account" className="text-[var(--color-brand)] hover:underline">
              What the four keys are →
            </Link>
          </p>
        ) : null}

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
