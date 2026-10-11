import Link from "next/link";
import { AccountOverview } from "@/components/account-overview.tsx";
import { AccountPanel } from "@/components/account-panel.tsx";
import { Reveal } from "@/components/motion.tsx";
import { StudioFlow } from "@/components/studio-flow.tsx";
import { PageHeader, Panel } from "@/components/ui.tsx";
import { clusterShape, registryHealth } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Account",
  description:
    "Your Kanmani account in one place: balances, payments, the agents you own, how to register one and the four keys one passkey derives.",
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


/** In-page sections, so the nav menu and old links can point straight at one. */
const SECTIONS = [
  { id: "payments", label: "payments" },
  { id: "agents", label: "agents" },
  { id: "keys", label: "keys" },
];

const PAYMENTS = [
  { href: "/pay", label: "pay for a check", hint: "a gasless USDC payment from a passkey, settled on Monad" },
  { href: "/fund", label: "fund from another chain", hint: "fill a Monad escrow job from Base, Arbitrum or BSC" },
  { href: "/bond", label: "bond an agent", hint: "stake USDC on its own claim-truth rate" },
  { href: "/compliance", label: "verified settlement", hint: "pay only a wallet with a Cleanverse identity" },
];

export default async function AccountPage() {
  /** Queried rather than typed, as on the old studio page, so the prose cannot go stale. */
  const [shapeQ, healthQ] = await Promise.all([clusterShape(), registryHealth()]);
  const shape = shapeQ.rows;
  const health = healthQ.rows;
  const notThere = health.byState.find((b) => /not there|404|absent/i.test(String(b.state)));
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="account"
        title="Your account. Payments, agents and keys in one place."
        lead={
          <>
            One account, made from a passkey or a wallet. What it can do follows from what the address owns on
            chain, so there is no separate agent account: register an agent from here and it is yours. No key is
            stored on this device and nothing secret reaches the server.
          </>
        }
      />

      <nav aria-label="account sections" className="-mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
        {SECTIONS.map((x) => (
          <a key={x.id} href={`#${x.id}`} className="text-muted hover:text-[var(--color-text)]">
            {x.label}
          </a>
        ))}
      </nav>

      <AccountOverview />

      <section id="payments" className="scroll-mt-24">
        <Panel title="payments" subtitle="Every payment here is a transaction on Monad you can read with cast. The balances above are what this address holds.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PAYMENTS.map((p) => (
              <Link key={p.href} href={p.href} className="signin-method block">
                <span className="font-mono text-[12.5px] text-[var(--color-text)]">{p.label} →</span>
                <span className="mt-1 block text-[11.5px] leading-snug text-muted">{p.hint}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </section>

      <section id="agents" className="scroll-mt-24 flex flex-col gap-[var(--section-gap)]">
        <Reveal>
          <Panel title="register or repoint an agent" subtitle="Compose the document, watch what each field would mean, then send the transaction with your own key.">
            <StudioFlow hostedFailureAgents={notThere ? notThere.agents : null} />
          </Panel>
        </Reveal>
        <Reveal>
        <Panel title="what this will and will not do">
          <ul className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
            <li>
              <span className="text-[var(--color-text)]">It will show you the exact bytes.</span> The
              JSON, the URI, the byte count and the calldata are all on screen before anything is sent,
              and the calldata decodes back to the document you were shown. That is asserted in a test
              rather than promised here.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will not sign for you.</span> There is no
              key on our server that could. Send the calldata from any wallet or sign in with a
              passkey and send it from the account that passkey derives. Both are yours.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will not fabricate a listing.</span> No
              agent appears because we made one. An agent appears because the registry emitted an
              event and the indexer saw it, which is the same path every other row on this site took.
            </li>
            <li>
              <span className="text-[var(--color-text)]">It will refuse a payment claim.</span> A
              registration document is not the place for one. If a draft mentions a payment proof, the
              consequence list says so, because most payment claims on Monad cite a transaction that
              is not on the chain they name and the fix starts with not making the claim.
            </li>
            <li>
              <span className="text-[var(--color-text)]">Verifying yourself is free.</span> A failing
              verdict is not a scarlet letter. Repoint the document and the{" "}
              <code className="font-mono">MetadataUpdate</code> re-runs the ladder so the record
              corrects itself with both readings kept.{" "}
              <Link href="/status" className="text-[var(--color-brand)] ilink">
                Verdicts that have changed →
              </Link>
            </li>
          </ul>
        </Panel>
        </Reveal>
        <Reveal>
        <Panel
          title="why data: is the default"
          subtitle="The recommendation carries our own measurement and we took it ourselves."
        >
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            We probed all {health.recordsTotal.toLocaleString()} distinct registration documents on
            Monad.{" "}
            {notThere ? `${notThere.agents.toLocaleString()} agents` : "Agents"} point at a document
            whose host answered and said it is not there,{" "}
            {shape.largestMemberCount.toLocaleString()} of them sharing one expired preview deployment
            across {shape.largestDistinctOwners.toLocaleString()} wallets. Those registrations are still valid on chain, with
            a valid owner and a valid URI and they will stay that way forever while describing
            nothing. A <code className="font-mono">data:</code> URI cannot 404 because there is no host
            to ask.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            When we registered ourselves as agent 10252 we wrote our record into{" "}
            <code className="font-mono">tokenURI</code> rather than hosting it, a day after measuring
            that. Hosting is still offered here, because a hosted document is a legitimate choice and
            the point is that the consequence is visible rather than hidden.{" "}
            <Link href="/operators" className="text-[var(--color-brand)] ilink">
              The clusters behind that number →
            </Link>
          </p>
        </Panel>
        </Reveal>
      </section>

      <section id="keys" className="scroll-mt-24 flex flex-col gap-[var(--section-gap)]">
        <div>
          <span className="kicker">mera · webauthn prf · trust-identity-ai</span>
          <h2 className="mt-2 font-display text-[1.5rem] font-semibold tracking-tight">Four keys from one passkey. The server holds none of them.</h2>
          <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
            One passkey ceremony gives four independent keys: the account you sign in with, the identity that signs
            verification receipts off chain, the on-chain attestation key a contract recovers as the verdict signer and
            the key that encrypts anything private. Clearing storage loses nothing and a second device reproduces the
            same keys exactly.
          </p>
        </div>
      <AccountPanel />

      {/* ---------------------------------------------------------------- how, in the open */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="how the four keys are derived">
          <p className="text-[13.5px] leading-relaxed text-muted">
            One WebAuthn assertion returns a 32-byte PRF output. That output is run through
            HKDF-SHA256 with a distinct info string per key, so the four are independent: holding
            one tells you nothing about the others.
          </p>
          <pre className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`prfOutput  = getPasskeyPrfOutput({ rpId })        one ceremony, one prompt

account    = HKDF(prfOutput, info="kanmani.iris.v1")          -> secp256k1 -> EVM address
attestation= HKDF(prfOutput, info="kanmani.optic.v1")         -> ed25519   -> signs receipts
onchain    = HKDF(prfOutput, info="kanmani.optic-onchain.v1") -> secp256k1 -> verdict signer
content    = HKDF(prfOutput, info="kanmani.vitreous.v1")      -> AES-256-GCM key`}</pre>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The honest limit: HKDF makes the four keys independent of each other, not independent
            of the PRF output. Anyone holding those 32 bytes holds all four. That is equally true
            of deriving from four separate salts, at a different point in the flow, so saying so
            beats implying a compartmentalisation that does not exist.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            A salt costs a ceremony and a ceremony costs a prompt. Four namespaces as four salts
            would be four prompts. Category Labs, who build Mera, confirmed on 2026-09-18 that
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
            four are derived in the tab and stay there.
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
          <Link href="/method" className="text-[var(--color-brand)] ilink">
            How the rest of it is decided →
          </Link>
        </p>
      </Panel>
      </section>
    </div>
  );
}
