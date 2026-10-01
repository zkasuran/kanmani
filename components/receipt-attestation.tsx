"use client";

/**
 * Sign a verification receipt in the tab, then verify it through the public endpoint.
 *
 * This is the "non-account work" the Mera PRF bounty asks for, made pressable. The attestation key
 * (kanmani.optic.v1, ed25519, a did:key) signs a statement about a claim. It owns nothing and cannot
 * move money. Anyone can then check that statement at POST /api/receipt/verify with no key and no
 * payment, which is the part that matters: the identity's output is public evidence a stranger can
 * recompute, not a login.
 *
 * The page shows two checks side by side. The local one is fast. The endpoint one is the one that
 * proves a third party who does not run our code reaches the same answer. The copy-ready curl lets a
 * judge run that same check from their own shell.
 */
import { useState } from "react";
import { signReceipt, toHex, verifyReceipt, type IrisKeys, type Receipt } from "@/lib/iris.ts";

type Done = {
  receipt: Receipt;
  sig: string;
  did: string;
  localValid: boolean;
  endpointValid: boolean | null;
  signedBytesFormat: string | null;
  curl: string;
  endpointUrl: string;
  error: string | null;
};

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://kanmani.xyz";
}

export function ReceiptAttestation({ keys }: { keys: IrisKeys }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);

  async function attest() {
    setBusy(true);
    setCopied(false);
    const receipt: Receipt = {
      claimId: "143_10182_0x103040545AC5031A11E8C03dd11324C7333a13C7_2",
      outcome: "true",
      checkedAtBlock: "106462031",
      checkedAt: new Date().toISOString(),
      mapping: "execution-market.v1",
    };
    const sigBytes = signReceipt(receipt, keys.attestation.privateKey);
    const sig = toHex(sigBytes);
    const localValid = verifyReceipt(receipt, sigBytes, keys.attestation.publicKey);
    const did = keys.attestation.id;
    const endpointUrl = `${origin()}/api/receipt/verify`;
    const payload = { receipt, signature: sig, publicKey: did };
    const curl = `curl -sS ${endpointUrl} \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(payload)}'`;

    let endpointValid: boolean | null = null;
    let signedBytesFormat: string | null = null;
    let error: string | null = null;
    try {
      const res = await fetch("/api/receipt/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      const data = body?.data as { valid?: boolean; signedBytesFormat?: string } | undefined;
      endpointValid = typeof data?.valid === "boolean" ? data.valid : null;
      signedBytesFormat = data?.signedBytesFormat ?? null;
      if (endpointValid === null) error = `the endpoint answered HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message;
    }

    setDone({ receipt, sig, did, localValid, endpointValid, signedBytesFormat, curl, endpointUrl, error });
    setBusy(false);
  }

  function copyCurl() {
    if (!done) return;
    const text = done.curl;
    const mark = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(mark).catch(() => fallbackCopy(text, mark));
    } else {
      fallbackCopy(text, mark);
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-4">
      <button onClick={attest} disabled={busy} className="cta-ghost disabled:opacity-40">
        {busy ? "signing and verifying…" : "sign a receipt, then verify it through the public endpoint"}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        Signed in this tab with the attestation key, then checked by{" "}
        <span className="font-mono text-[var(--color-brand)]">POST /api/receipt/verify</span>, which
        holds no key and verifies any receipt, not only ours. The two checks below must agree.
      </p>

      {done ? (
        <div className="mt-3 space-y-3">
          <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <p className="font-mono text-[11px] text-faint">ed25519 signature, 64 bytes</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted">{done.sig}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-faint">attributable to {done.did}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Verdict label="checked in this tab" valid={done.localValid} />
            <Verdict label="checked by the public endpoint" valid={done.endpointValid} />
          </div>

          {done.signedBytesFormat ? (
            <p className="font-mono text-[11px] leading-relaxed text-faint">
              canonical bytes: {done.signedBytesFormat}
            </p>
          ) : null}
          {done.error ? (
            <p className="font-mono text-[12px] text-[var(--color-unknown)]">{done.error}</p>
          ) : null}

          <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-faint">run it yourself, no key needed</p>
              <button onClick={copyCurl} className="cta-ghost text-[11px]">
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{done.curl}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Verdict({ label, valid }: { label: string; valid: boolean | null }) {
  const color =
    valid === null ? "var(--color-unknown)" : valid ? "var(--color-true)" : "var(--color-false)";
  return (
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
      <p className="font-mono text-[11px] text-faint">{label}</p>
      <p className="mt-1 font-mono text-[13px]" style={{ color }}>
        {valid === null ? "no answer" : valid ? "valid" : "not valid"}
      </p>
    </div>
  );
}

function fallbackCopy(text: string, onDone: () => void) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    onDone();
  } catch {
    // Clipboard is best effort. A judge can still select the text by hand.
  }
}
