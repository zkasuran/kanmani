"use client";

/**
 * The account page, which is also the two Mera gates, live.
 *
 * Both gates are pass/fail tests a judge runs on their own machine:
 *
 *   UX:  "judges clear local storage or open the app on a fresh device mid-demo and
 *         identity/access must fully reconstruct from the passkey"
 *   PRF: "same passkey on a second device or fresh browser profile reproduces the same
 *         derived keys / decrypts the same state, live"
 *
 * So this page does not describe those properties, it hands the judge the buttons. The storage
 * readout is live and includes our own origin's cookies, so "we store nothing" is something they
 * read off the screen rather than something we assert in a paragraph.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui.tsx";
import { useSession } from "@/components/session.tsx";
import { createAccount, signIn, webAuthnAvailable, type CeremonyOutcome } from "@/lib/passkey.ts";
import { signReceipt, signVaultWrite, toHex, verifyReceipt, type IrisKeys, type Receipt } from "@/lib/iris.ts";
import { CONTEXT, open, parseSealed, seal, writeMessage, type Sealed } from "@/lib/vault.ts";

async function contentFingerprint(key: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", key as BufferSource);
  return `sha256 ${toHex(new Uint8Array(digest)).slice(0, 32)}… of the key, never the key`;
}

export function AccountPanel() {
  const session = useSession();
  const [outcome, setOutcome] = useState<CeremonyOutcome | null>(null);
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [storage, setStorage] = useState<{ local: number; session: number; cookies: number } | null>(null);
  const [receipt, setReceipt] = useState<{ sig: string; verified: boolean } | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  /**
   * SHA-256 of the content key, not the key.
   *
   * An earlier cut of this printed the first eight bytes of the key itself under a label saying
   * it was a fingerprint. Eight bytes is not a break and printing live key material on the page
   * that argues about not leaking secrets is exactly the wrong shape. A hash is one line and it
   * is actually true.
   */
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [note, setNote] = useState("Only this passkey can read this line.");
  const [vault, setVault] = useState<
    { phase: "idle" } | { phase: "working" } | { phase: "stored"; sealed: Sealed } | { phase: "read"; text: string } | { phase: "error"; why: string }
  >({ phase: "idle" });

  useEffect(() => {
    setAvailable(webAuthnAvailable());
    readStorage();
  }, []);

  function readStorage() {
    if (typeof window === "undefined") return;
    setStorage({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      cookies: document.cookie ? document.cookie.split(";").filter((c) => c.trim()).length : 0,
    });
  }

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setReceipt(null);
    const started = performance.now();
    const r = kind === "create" ? await createAccount("kanmani") : await signIn();
    // Measured rather than estimated, because taps and seconds is a scored criterion and an
    // unmeasured claim about it is worth nothing to a judge.
    setElapsed(Math.round(performance.now() - started));
    setOutcome(r);
    // The bar and this page show the same account. Adopting keeps the keys in memory, never storage.
    session.adopt(r);
    setBusy(null);
    readStorage();
    setFingerprint(r.ok ? await contentFingerprint(r.keys.content) : null);
  }

  function clearEverything() {
    window.localStorage.clear();
    window.sessionStorage.clear();
    for (const c of document.cookie.split(";")) {
      const name = c.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
    // Deliberately keeps the derived keys on screen. Clearing storage must not sign you out,
    // because nothing about your identity was in storage. Reloading re-derives from the passkey.
    readStorage();
  }

  async function signOne(keys: IrisKeys) {
    const r: Receipt = {
      claimId: "143_10182_0x103040545AC5031A11E8C03dd11324C7333a13C7_2",
      outcome: "true",
      checkedAtBlock: "106462031",
      checkedAt: new Date().toISOString(),
      mapping: "execution-market.v1",
    };
    const sig = signReceipt(r, keys.attestation.privateKey);
    setReceipt({ sig: toHex(sig), verified: verifyReceipt(r, sig, keys.attestation.publicKey) });
  }

  /** Seal the note under the content key, sign it with the account key, store the ciphertext. */
  async function store(keys: IrisKeys) {
    setVault({ phase: "working" });
    try {
      const sealed = await seal(keys.content, CONTEXT.agentMemory, note);
      const signature = signVaultWrite(writeMessage(keys.account.address, sealed), keys.account.privateKey);
      const r = await fetch("/api/vault", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: keys.account.address, sealed, signature }),
      });
      if (!r.ok) {
        const e = await r.json();
        setVault({ phase: "error", why: `${e.title ?? r.status}: ${e.detail ?? ""}` });
        return;
      }
      setVault({ phase: "stored", sealed });
    } catch (e) {
      setVault({ phase: "error", why: (e as Error).message });
    }
  }

  /**
   * Fetch the blob back and decrypt it.
   *
   * Deliberately fetches rather than reusing the object in memory. Reading what we just sealed
   * out of a local variable would prove nothing about the server actually holding it and the
   * gate is about a second device that has no local variable.
   */
  async function readBack(keys: IrisKeys) {
    setVault({ phase: "working" });
    try {
      const r = await fetch(
        `/api/vault?address=${keys.account.address}&context=${encodeURIComponent(CONTEXT.agentMemory)}`,
      );
      const body = await r.json();
      const blob = body?.data?.blobs?.[0]?.sealed;
      const parsed = parseSealed(blob);
      if (!parsed) {
        setVault({ phase: "error", why: "nothing stored for this address yet" });
        return;
      }
      const opened = await open(keys.content, parsed, CONTEXT.agentMemory);
      setVault(opened.ok ? { phase: "read", text: opened.text } : { phase: "error", why: opened.reason });
    } catch (e) {
      setVault({ phase: "error", why: (e as Error).message });
    }
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ the two buttons */}
      <Panel title="create or restore" subtitle="No seed phrase, no extension, no key on our server.">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => run("create")}
            disabled={busy !== null || available === false}
            className="cta disabled:opacity-40"
          >
            {busy === "create" ? "waiting for the prompt…" : "create a passkey"}
          </button>
          <button
            onClick={() => run("signin")}
            disabled={busy !== null || available === false}
            className="cta-ghost disabled:opacity-40"
          >
            {busy === "signin" ? "waiting for the prompt…" : "sign in with an existing one"}
          </button>
          {elapsed !== null ? (
            <span className="font-mono text-[12px] text-faint">
              {(elapsed / 1000).toFixed(2)}s, measured
            </span>
          ) : null}
        </div>

        {available === false ? (
          <p className="mt-3 rounded border border-[var(--color-unknown)]/40 bg-[var(--color-unknown-bg)] p-3 text-[13px] text-[var(--color-unknown)]">
            This browser does not expose WebAuthn to this page. Nothing here will work until it
            does and that is the browser rather than the site.
          </p>
        ) : null}

        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Creating is one prompt on most authenticators. On ones that do not evaluate PRF during
          creation it is two, because a second assertion has to run. That depends on your
          authenticator rather than on this site, so it is stated rather than promised. Signing in
          afterwards is always exactly one.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          This same passkey pays.{" "}
          <Link href="/pay" className="text-[var(--color-brand)] hover:underline">
            Open a scoped signing session and send a gasless Monad transaction →
          </Link>
        </p>
      </Panel>

      {/* ------------------------------------------------ failure, explained rather than thrown */}
      {outcome && !outcome.ok ? (
        <section className="rounded-lg border border-[var(--color-unknown)]/40 bg-[var(--color-unknown-bg)] p-4">
          <p className="font-mono text-[12px] text-[var(--color-unknown)]">{outcome.code}</p>
          <p className="mt-2 text-[14px] leading-relaxed">{outcome.cause}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">What to do:</span> {outcome.fix}
          </p>
          {outcome.retryable ? (
            <button
              onClick={() => run("create")}
              className="cta-ghost mt-3"
            >
              try again
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------ the four keys */}
      {outcome?.ok ? (
        <Panel
          title="four keys, one ceremony"
          subtitle="Derived with HKDF-SHA256 over a single PRF output, one namespace per key. Public halves shown. The private halves never leave this tab and are never sent anywhere."
        >
          <div className="space-y-3">
            <KeyRow
              ns="kanmani.iris.v1"
              what="account"
              why="Signs in and owns listings. An ordinary EVM address, usable on any chain."
              value={outcome.keys.account.address}
              accent
            />
            <KeyRow
              ns="kanmani.optic.v1"
              what="attestation"
              why="Signs verification receipts off chain as a did:key. Deliberately not a wallet: it can say what was checked and it cannot move money."
              value={outcome.keys.attestation.id}
            />
            <KeyRow
              ns="kanmani.optic-onchain.v1"
              what="onchain attestation"
              why="The verdict signer. secp256k1, whose EVM address a contract pins and recovers, so a Sclera slashing verdict is authorised by this key rather than by whoever relays it. Still not the account wallet."
              value={outcome.keys.onchainAttestation.address}
            />
            <KeyRow
              ns="kanmani.vitreous.v1"
              what="content"
              why="AES-256-GCM key for anything the server must not read. Shown as its SHA-256 rather than itself, because printing a live content key on screen would be the exact mistake this page is about."
              value={fingerprint ?? "computing fingerprint…"}
            />
          </div>

          <div className="mt-4 border-t border-[var(--color-line)] pt-4">
            <button
              onClick={() => signOne(outcome.keys)}
              className="cta-ghost"
            >
              sign a verification receipt with the attestation key
            </button>
            {receipt ? (
              <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
                <p className="font-mono text-[11px] text-faint">ed25519 signature, 64 bytes</p>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">{receipt.sig}</p>
                <p className="mt-2 font-mono text-[12px]">
                  verified against the public key:{" "}
                  <span className={receipt.verified ? "text-[var(--color-true)]" : "text-[var(--color-false)]"}>
                    {receipt.verified ? "yes" : "no"}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* ------------------------------------------------ storage the server cannot read */}
      {outcome?.ok ? (
        <Panel
          title="storage this server cannot read"
          subtitle="Encrypted here with the content key, stored as ciphertext, signed with the account key so nobody else can overwrite it. Open this page on a second device, sign in with the same passkey and read it back: the address will match and the text will decrypt."
        >
          <div className="space-y-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--color-brand)]"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => store(outcome.keys)}
                disabled={vault.phase === "working"}
                className="cta disabled:opacity-40"
              >
                encrypt and store
              </button>
              <button
                onClick={() => readBack(outcome.keys)}
                disabled={vault.phase === "working"}
                className="cta-ghost disabled:opacity-40"
              >
                fetch from the server and decrypt
              </button>
              <a
                href={`/api/vault?address=${outcome.keys.account.address}`}
                target="_blank"
                rel="noreferrer"
                className="cta-ghost"
              >
                see what the server actually holds →
              </a>
            </div>

            {vault.phase === "stored" ? (
              <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
                <p className="font-mono text-[11px] text-faint">
                  stored. this is everything the server has and your text is not in it
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">
                  {JSON.stringify(vault.sealed)}
                </p>
              </div>
            ) : null}
            {vault.phase === "read" ? (
              <div className="rounded border border-[var(--color-true)]/40 bg-[var(--color-true-bg)] p-3">
                <p className="font-mono text-[11px] text-[var(--color-true)]">
                  fetched from the server and decrypted in this tab
                </p>
                <p className="mt-1 font-mono text-[13px]">{vault.text}</p>
              </div>
            ) : null}
            {vault.phase === "error" ? (
              <div className="rounded border border-[var(--color-unknown)]/40 bg-[var(--color-unknown-bg)] p-3">
                <p className="font-mono text-[12px] text-[var(--color-unknown)]">{vault.why}</p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* ------------------------------------------------ the gate, made pressable */}
      <Panel
        title="what this site has stored about you"
        subtitle="Live readout of this origin, not a claim. While you are logged in, sessionStorage holds one entry: your public address and how you signed in, cleared when the tab closes. No key is ever in it, so clearing it loses nothing: the keys come back from the passkey."
      >
        <dl className="grid grid-cols-3 gap-3">
          <Count label="localStorage" n={storage?.local ?? null} />
          <Count label="sessionStorage" n={storage?.session ?? null} />
          <Count label="cookies" n={storage?.cookies ?? null} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={clearEverything} className="cta-ghost">
            clear all of it
          </button>
          <button onClick={() => window.location.reload()} className="cta-ghost">
            hard reload, then sign in again
          </button>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          The passkey is created as a discoverable credential, so the browser offers it with
          nothing from us. There is no cached credential ID and no returning-user path, which is
          why there is no returning-user path that can break. Sign in on a second device and the
          address above will be identical, because it is a deterministic function of the PRF
          output and nothing else.
        </p>
      </Panel>
    </div>
  );
}

function KeyRow({
  ns,
  what,
  why,
  value,
  accent,
}: {
  ns: string;
  what: string;
  why: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="border-b border-[var(--color-line)]/50 pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono text-[11px] uppercase tracking-wide text-faint">{what}</span>
        <span className="font-mono text-[11px] text-[var(--color-brand)]">{ns}</span>
      </div>
      <p
        className={`mt-1 break-all font-mono text-[13px] ${
          accent ? "text-[var(--color-text)]" : "text-muted"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{why}</p>
    </div>
  );
}

function Count({ label, n }: { label: string; n: number | null }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel-2)] px-4 py-3.5">
      <div className={`stat-value text-[1.9rem] ${n === 0 ? "text-[var(--color-true)]" : "text-[var(--color-text)]"}`}>
        {n === null ? <span className="unknown-value text-base">reading</span> : n}
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-faint">{label}</p>
    </div>
  );
}
