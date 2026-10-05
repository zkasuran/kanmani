import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { Code, Facts, H2, Note, Prose, Shot } from "@/components/blog.tsx";

export const metadata = {
  title: "One passkey, four keys, nothing stored",
  description:
    "One WebAuthn PRF ceremony through Mera derives four unrelated keys with HKDF: an account, an identity that signs receipts, an on-chain attestor and a content key. They reconstruct on any device and nothing secret is kept on disk or on our server.",
};

export default function MeraPrf() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · mera prf · updated 2026-10-04"
        title="One passkey, four keys, nothing stored"
        lead="A passkey can do more than sign you in. Its PRF output is deterministic key material, so one ceremony seeds a whole family of unrelated keys. They come back on any device that holds the passkey. Nothing secret is kept anywhere."
      />

      <Prose>
        <H2>The lever</H2>
        <p>
          WebAuthn&apos;s PRF extension returns the same 32 bytes every time for the same passkey, relying party
          and salt. Mera turns that into keys. The property we build on, confirmed with the Mera team: because the
          output is deterministic, the keys are recoverable on any device holding the same passkey, with no
          separate enrolment and nothing cached in the browser.
        </p>
        <p>
          We run one PRF ceremony, then expand that one output with HKDF-SHA256 under a fixed salt and a
          different <Code>info</Code> string per key. The info string is the namespace. The four keys share a root
          and are cryptographically unrelated to each other.
        </p>
      </Prose>

      <Facts
        caption="The four namespaces, from lib/iris.ts. Only the first is a wallet."
        rows={[
          { k: "kanmani.iris.v1", v: "secp256k1 account", src: "the address that pays and owns" },
          { k: "kanmani.optic.v1", v: "ed25519, published as a did:key", src: "signs verification receipts. Holds no funds and is not a wallet" },
          { k: "kanmani.optic-onchain.v1", v: "secp256k1 attestor", src: "an address a contract can pin and recover with ecrecover. the deployed Sclera contract pins one fixed attestor, so this key is ready for a contract that pins it" },
          { k: "kanmani.vitreous.v1", v: "AES-256-GCM content key", src: "encrypts the one thing we do store, as ciphertext only" },
        ]}
      />

      <Prose>
        <H2>Non-account work</H2>
        <p>
          The most interesting key is the one that is furthest from a wallet. The attestation identity signs
          verification receipts in the browser. Anyone can check a receipt against our public endpoint, so its
          output is public evidence, produced by an identity that cannot move money. Signing keys are derived,
          content is encrypted with an AEAD. The two are never confused.
        </p>

        <H2>Nothing stored. The page proves it</H2>
        <p>
          There is no cookie, no token, no cached credential id and no derived key on disk. The passkey is
          discoverable, so the browser offers it with nothing from us, which means there is no returning-user
          record to leak or to break. The account page reads its own storage live, rather than claiming it:
        </p>
      </Prose>

      <Shot
        post="mera-prf"
        name="keys"
        width={1153}
        height={346}
        href="/account"
        alt="What this site has stored about you: 1 localStorage entry, 0 sessionStorage, 0 cookies, with buttons to clear all of it and sign in again"
        caption={
          <>
            The live readout on the <Link href="/account">account page</Link>, signed out. The one localStorage
            entry is the light or dark theme. Clear all of it, hard reload, sign in with the passkey and the same
            address comes back.
          </>
        }
      />

      <Prose>
        <p>
          A test fails the build if any derived secret ever reaches localStorage, sessionStorage, IndexedDB or the
          server (<Code>lib/prf-no-persist.test.ts</Code>). In a real browser, our end-to-end suite clears every
          kind of storage and signs in again with the same passkey. It ran ten times with a fresh passkey each
          time and reconstructed the same account on all ten. A second suite audits storage after sign-in and
          finds no 64-hex key and no PRF-shaped blob.
        </p>
        <p>
          The one thing a server holds is a vault entry encrypted under the content key, with its context bound as
          additional authenticated data. Untrusted storage holds ciphertext and nothing that could decrypt it.
        </p>
      </Prose>

      <Note label="the derivation is pinned">
        Two implementations have to agree on the keys. Otherwise a second device would derive a different account. A
        test vector fixes it: PRF bytes 1 through 32 always give the account{" "}
        <Code>0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B</Code>. Change the salt, the info string or the order and
        that test fails.
      </Note>

      <Prose>
        <H2>The same passkey pays</H2>
        <p>
          The account key also opens a Mera signing session on <Link href="/pay">the pay page</Link>. The session
          is scoped to x402 verification payments, a fixed recipient and a ceiling. Within that scope it signs
          with no further prompt. The facilitator relays the payment and pays the gas. A live run on Monad
          testnet took 2 taps plus 1 passkey confirmation and 4.7 seconds from load to a settled payment.
        </p>
        <p>
          Try the cross-device test yourself: create a passkey on the{" "}
          <Link href="/account">account page</Link>, note the four fingerprints, then sign in on a second device
          holding the same synced passkey. The fingerprints are identical and the vault entry decrypts.
        </p>
      </Prose>
    </div>
  );
}
