import { PayFlow } from "./pay-flow.tsx";
import { Eyebrow, Panel } from "@/components/ui.tsx";

export const metadata = {
  title: "Pay",
  description:
    "Mera as the whole account layer. One passkey prompt, a scoped signing session, then a real gasless Monad transaction with no seed phrase, no extension and no server-held key.",
};

/**
 * The Mera-powered UX gate, live.
 *
 * The bounty asks for an app where the user never notices there is a blockchain underneath: one
 * passkey ceremony, prompt-free signing through a scoped Mera session, a real Monad transaction,
 * and a stateless account that rebuilds from the passkey alone. This page walks a stranger through
 * all of it, so the properties are exercised rather than described.
 */
export default function PayPage() {
  return (
    <div className="space-y-12">
      <section className="field rise -mx-5 -mt-10 overflow-hidden border-b border-[var(--color-line)] px-5 pb-10 pt-12 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border sm:px-8">
        <div className="grid-faint pointer-events-none absolute inset-0" />
        <div className="relative">
          <Eyebrow>mera · x402 · consumer-payments</Eyebrow>
          <h1 className="mt-4 max-w-3xl text-[clamp(1.6rem,3.4vw,2.35rem)] font-semibold leading-[1.14] tracking-tight">
            Pay for a verification without ever touching a wallet.
          </h1>
          <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-muted">
            Mera is the whole account layer here. You connect a passkey once, a scoped signing session
            opens on the key it derives, then a single tap signs a payment the facilitator relays and
            pays the gas for. No seed phrase, no wallet extension, no MON in your pocket and no key on
            our server. The session signs with no further prompt until its scope expires. The
            countdown shows exactly when the next action asks again.
          </p>
        </div>
      </section>

      <PayFlow />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="what the session is scoped to">
          <p className="text-[13.5px] leading-relaxed text-muted">
            A prompt-free session is a key held in memory, so it is held on a short leash. The
            session names one thing it may sign, x402 verification payments, up to a ceiling you
            agree to when you open it. A payment above the ceiling is refused before the key signs. A
            session past its deadline is zeroed on the next action. That action re-runs the one
            prompt rather than signing on a session you have walked away from.
          </p>
          <pre className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`connect    -> one WebAuthn prompt -> account key (see /account)
openSession-> createSecp256k1SigningSession + toViemAccount
scope      -> x402 verification payments, up to 0.05 USDC
expiry     -> 5 minutes, checked on use, key zeroed on expiry
sign       -> EIP-3009 transferWithAuthorization, no prompt`}</pre>
        </Panel>

        <Panel
          title="time to first transaction"
          subtitle="Taps and seconds from a cold landing to a confirmed Monad transaction."
        >
          <ol className="space-y-2 text-[13.5px] leading-relaxed text-muted">
            <li>
              <span className="font-mono text-[var(--color-brand)]">1.</span> Open this page. Connect
              a passkey. One prompt.
            </li>
            <li>
              <span className="font-mono text-[var(--color-brand)]">2.</span> The session opens on the
              same tap. Nothing else to approve.
            </li>
            <li>
              <span className="font-mono text-[var(--color-brand)]">3.</span> Fund the shown account
              with a little USDC, then pay. The transaction settles on Monad.
            </li>
          </ol>
          <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
            The one thing a stranger cannot skip is holding the USDC the payment moves. Gas is not on
            them, because the facilitator pays it, so the only funding is the payment itself.
          </p>
        </Panel>
      </div>
    </div>
  );
}
