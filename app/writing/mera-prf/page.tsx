import Link from "next/link";
import { Mono, PageHeader, Panel, Prize, Row } from "@/components/ui.tsx";
import { postBySlug } from "@/lib/writing.ts";

/**
 * The Mera PRF piece. The namespaces and the derivation are facts from lib/iris.ts and lib/vault.ts.
 * The determinism and cross-device recovery are confirmed by Category Labs (Kai Jun Eer, 2026-09-21,
 * organizer-reviewed). The live demo is on the account page.
 */

export const metadata = {
  title: "One passkey, four keys, nothing stored",
  description:
    "Mera's PRF output is deterministic key material. One passkey ceremony derives four unrelated keys through HKDF, each in its own namespace, reconstructible on any device with nothing persisted to disk or a server.",
};

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--color-text)]">{children}</p>;
}

export default function MeraPrf() {
  const post = postBySlug("mera-prf")!;
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="writing · mera prf · 2026-10-01"
        title="One passkey, four keys, nothing stored"
        lead="A passkey can do more than sign in. Its PRF output is deterministic key material, so one ceremony seeds a family of unrelated keys that reconstruct anywhere, with nothing kept on a disk or a server."
      >
        <Prize post={post} />
      </PageHeader>

      <Panel title="the primitive: deterministic key material from a passkey">
        <div className="space-y-3">
          <P>
            WebAuthn PRF returns the same bytes every time for the same passkey, relying party and salt. That is
            the whole lever. Change the salt and you get an independent output, so one passkey is a root for as
            many unrelated keys as you have salts. Category Labs, who build Mera, confirmed the part that makes
            this safe to lean on: because the output is deterministic, the keys are recoverable on any device
            holding the same passkey, with no separate enrolment and no keys cached in the browser.
          </P>
        </div>
      </Panel>

      <Panel title="four namespaces from one ceremony">
        <div className="space-y-3">
          <P>
            We run one PRF ceremony, then split it with HKDF-SHA256 under a fixed salt, with a different{" "}
            <Mono>info</Mono> string per key. The info string is the namespace, so the four keys are
            cryptographically unrelated even though they share one root.
          </P>
          <div className="space-y-1 text-[13px]">
            <Row label="account">
              <Mono className="text-muted">kanmani.iris.v1 · secp256k1, the address that pays and owns</Mono>
            </Row>
            <Row label="attestation">
              <Mono className="text-muted">kanmani.optic.v1 · ed25519, a did:key that is not a wallet</Mono>
            </Row>
            <Row label="on-chain attestation">
              <Mono className="text-muted">kanmani.optic-onchain.v1 · secp256k1, recoverable by ecrecover</Mono>
            </Row>
            <Row label="content">
              <Mono className="text-muted">kanmani.vitreous.v1 · AES-256-GCM, encrypts stored data</Mono>
            </Row>
          </div>
          <P>
            Signing keys are derived and content uses an AEAD. The two are never confused. The derivation is
            pinned by a test vector so two implementations agree: PRF bytes 1 through 32 give the account address{" "}
            <Mono>0x92c2…454B</Mono> every time.
          </P>
        </div>
      </Panel>

      <Panel title="nothing is stored, which is the whole point">
        <div className="space-y-3">
          <P>
            No cookie, no token, no cached credential id, no derived private key on disk. The passkey is
            discoverable, so the browser offers it unprompted and there is no returning-user record to leak or to
            break. A test fails if any derived secret ever reaches local storage, session storage, IndexedDB or
            the server. The one thing we do keep on a server is a vault blob encrypted under the content key, with
            the context bound as additional authenticated data, so untrusted storage holds ciphertext and nothing
            that could decrypt it.
          </P>
        </div>
      </Panel>

      <Panel title="the novelty: a receipt signed by an identity that is not a wallet">
        <div className="space-y-3">
          <P>
            The attestation key signs verification receipts. Anyone can check one against the public endpoint, so
            its output is public evidence produced by an identity that holds no funds and is not an account. That
            is the furthest thing from a passkey wallet, which is exactly what the bounty rewards: a PRF namespace
            doing non-account work.
          </P>
          <P>
            The{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/account">account page</Link>{" "}
            shows the four key fingerprints, signs a receipt in the browser and verifies it against the public
            endpoint. It also holds a compare box so a second device can prove it reconstructs the same keys and
            decrypts the same blob.
          </P>
        </div>
      </Panel>
    </div>
  );
}
