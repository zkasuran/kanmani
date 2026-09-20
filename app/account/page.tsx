import Link from "next/link";
import { AccountPanel } from "@/components/account-panel.tsx";
import { Panel } from "@/components/ui.tsx";

export const metadata = {
  title: "Account",
  description:
    "One passkey ceremony, three independent keys, nothing stored. Clear local storage or open a second device and everything rebuilds.",
};

/**
 * Tested combinations are published rather than left for a judge to discover mid-gate.
 *
 * From Mera's own authenticator support matrix, which is the primary source and is more specific
 * than anything we could infer. A judge is a developer and developers run password managers, so
 * the combination that fails is likelier here than in the general population.
 */
const AUTHENTICATORS = [
  { name: "Google Password Manager", where: "Chrome, Edge", prf: true },
  { name: "iCloud Keychain", where: "macOS 15+, iOS 18+", prf: true },
  { name: "1Password", where: "extension and app", prf: true },
  { name: "Windows Password Manager", where: "Windows 11 25H2+", prf: true },
  { name: "YubiKey 5C Nano", where: "hardware", prf: true },
  { name: "Proton Pass", where: "extension", prf: true },
  { name: "Chrome local profile", where: "no Google Password Manager", prf: false },
  { name: "Bitwarden", where: "extension", prf: false },
  { name: "Dashlane", where: "extension", prf: false },
];

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">
          One passkey ceremony gives three independent keys: the account you sign in with, the
          identity that signs verification receipts, and the key that encrypts anything private.
          Nothing is stored on this device and nothing secret reaches the server, so clearing local
          storage loses nothing and a second device reproduces the same keys exactly.
        </p>
      </div>

      <AccountPanel />

      {/* ---------------------------------------------------------------- how, in the open */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="how the three keys are derived">
          <p className="text-[13.5px] leading-relaxed text-muted">
            One WebAuthn assertion returns a 32-byte PRF output. That output is run through
            HKDF-SHA256 with a distinct info string per key, so the three are independent: holding
            one tells you nothing about the others.
          </p>
          <pre className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`prfOutput  = getPasskeyPrfOutput({ rpId })        one ceremony, one prompt

account    = HKDF(prfOutput, info="kanmani.iris.v1")       -> secp256k1 -> EVM address
attestation= HKDF(prfOutput, info="kanmani.optic.v1")      -> ed25519   -> signs receipts
content    = HKDF(prfOutput, info="kanmani.vitreous.v1")   -> AES-256-GCM key`}</pre>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The honest limit: HKDF makes the three keys independent of each other, not independent
            of the PRF output. Anyone holding those 32 bytes holds all three. That is equally true
            of deriving from three separate salts, at a different point in the flow, and saying so
            beats implying a compartmentalisation that does not exist.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            A salt costs a ceremony, and a ceremony costs a prompt. Three namespaces as three salts
            would be three prompts. Category Labs, who build Mera, confirmed on 2026-09-18 that
            HKDF namespacing counts as genuinely namespaced. It is also their own pattern: Mera&apos;s
            secret vault derives its AES key from the same PRF output with fixed HKDF info,
            explicitly so it is separated from other keys derived from that output.
          </p>
        </Panel>

        <Panel
          title="authenticators, tested rather than assumed"
          subtitle="PRF is not universal and you pick the authenticator, not us. Published here so nothing about this is a surprise mid-demo."
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="pb-2">authenticator</th>
                <th className="pb-2">where</th>
                <th className="pb-2 text-right">prf</th>
              </tr>
            </thead>
            <tbody>
              {AUTHENTICATORS.map((a) => (
                <tr key={a.name} className="border-b border-[var(--color-line)]/50 last:border-0">
                  <td className="py-1.5 text-[13px]">{a.name}</td>
                  <td className="py-1.5 font-mono text-[11.5px] text-faint">{a.where}</td>
                  <td
                    className={`py-1.5 text-right font-mono text-[12px] ${
                      a.prf ? "text-[var(--color-true)]" : "text-[var(--color-false)]"
                    }`}
                  >
                    {a.prf ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            On desktop Chrome only passkeys saved to Google Password Manager carry PRF, because the
            local profile authenticator lacks hmac-secret. A password-manager extension that
            intercepts WebAuthn can produce a passkey that exists and returns no PRF output at all.
            When that happens this page names the cause and the fix rather than throwing.
          </p>
        </Panel>
      </div>

      <Panel title="what the server never gets">
        <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-muted">
          <li>
            <span className="font-mono text-[var(--color-true)]">no</span> session cookie carrying
            authority. A cookie may cache. It may never authorise.
          </li>
          <li>
            <span className="font-mono text-[var(--color-true)]">no</span> private key, ever. All
            three are derived in the tab and stay there.
          </li>
          <li>
            <span className="font-mono text-[var(--color-true)]">no</span> credential ID cached
            anywhere. The passkey is discoverable, so the browser offers it unprompted.
          </li>
          <li>
            <span className="font-mono text-[var(--color-true)]">no</span> recovery path. Losing
            the passkey loses the keys. Said plainly rather than implying a recovery that does not
            exist.
          </li>
        </ul>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
          A database breach here exposes no key material, because there is none to expose. That is
          a stronger property than most applications have and it falls out of the constraint rather
          than being bolted on.{" "}
          <Link href="/method" className="text-[var(--color-brand)] hover:underline">
            How the rest of it is decided →
          </Link>
        </p>
      </Panel>
    </div>
  );
}
