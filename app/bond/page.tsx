import Link from "next/link";
import { Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Bond",
  description:
    "An agent stakes USDC against a floor on its own claim-truth rate. Live on Monad mainnet, immutable, slashed by a signed verdict with no admin override.",
};

/** Deployed 2026-09-24. Immutable, no proxy, no admin function. */
const SCLERA = "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ATTESTOR = "0x358c591aD7D60aC36bC223472B41518A7FA7b44A";
const FIRST_BOND = "0x72970dc0428412d04c043877be6b8c979b245797cf275bcae683394026697e7c";

function Tx({ hash, children }: { hash: string; children: React.ReactNode }) {
  return (
    <a
      href={`https://monadexplorer.com/tx/${hash}`}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-[13px] text-[var(--color-brand)] hover:underline"
    >
      {children}
    </a>
  );
}

export default function Bond() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="sclera · monad mainnet · immutable"
        title="Trust stops being a badge. It becomes a price."
        lead={
          <>
            An agent locks USDC against a floor on its own future claim-truth rate. Stay above the floor
            and the stake comes back. Fall below it, and a signed verdict takes it. There is no admin
            function and no override anywhere in that path.
          </>
        }
      />

      {/* ---------------------------------------------------------------- it is live */}
      <Reveal>
        <Panel title="live on mainnet, with money in it" subtitle="Not a testnet screenshot and not a plan.">
          <dl className="space-y-1">
            <Row label="contract">
              <a
                href={`https://monadexplorer.com/address/${SCLERA}`}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all font-mono text-[13px] text-[var(--color-brand)] hover:underline"
              >
                {SCLERA}
              </a>
            </Row>
            <Row label="first bond">
              <Tx hash={FIRST_BOND}>0.02 USDC staked on agent 10252, block 107460188</Tx>
            </Row>
            <Row label="floor committed to">
              <Mono>8000 bps</Mono> <span className="text-muted">— 80% of decided claims must resolve true</span>
            </Row>
            <Row label="window">
              <Mono>216,000 blocks</Mono> <span className="text-muted">— about a day at 400ms</span>
            </Row>
            <Row label="minimum sample">
              <Mono>5</Mono> <span className="text-muted">— below this nothing can slash</span>
            </Row>
          </dl>

          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            Check the stake by where the money is rather than by an event we emitted:
          </p>
          <div className="mt-2 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <pre className="sql">{`# the contract is holding it
cast call ${USDC} 'balanceOf(address)(uint256)' \\
  ${SCLERA} --rpc-url https://rpc.monad.xyz    # 20000

# and when it can be released
cast call ${SCLERA} 'maturesAt(uint256)(uint64)' 10252 \\
  --rpc-url https://rpc.monad.xyz    # 107676188`}</pre>
          </div>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- how it works */}
      <Reveal as="section" className="band">
        <div className="max-w-2xl">
          <span className="kicker">how a bond is decided</span>
          <h2 className="mt-4 fluid-3 font-semibold leading-tight tracking-tight">
            The thing that slashes it is a measurement, not an opinion.
          </h2>
        </div>
        <div className="rail mt-8">
          <div className="rail__step">
            <div className="layer__name">Post</div>
            <p className="layer__body">
              The agent picks its own floor, window and minimum sample, then locks the tokens. Only the
              agent can: the contract reads <Mono>ownerOf</Mono> from the ERC-8004 registry and refuses
              anyone else.
            </p>
          </div>
          <div className="rail__step">
            <div className="layer__name">Measure</div>
            <p className="layer__body">
              Claim-truth rate over a block range, served at{" "}
              <Mono>/api/sla/&lt;agentId&gt;</Mono>. A pure function of the id and the range, so
              independent nodes computing it agree.
            </p>
          </div>
          <div className="rail__step">
            <div className="layer__name">Sign</div>
            <p className="layer__body">
              A verdict is signed by an attestor key derived from a passkey. The contract recovers it and
              compares against one address fixed at deploy.
            </p>
          </div>
          <div className="rail__step">
            <div className="layer__name">Settle</div>
            <p className="layer__body">
              Above the floor, the stake returns when the window matures and anyone may trigger it. Below
              it, the bond is forfeit in the same transaction that decides.
            </p>
          </div>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- the security work */}
      <Reveal>
        <Panel
          title="why the forwarder is not trusted"
          subtitle="The one design decision that keeps this from being a fund-loss bug."
        >
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            A Chainlink CRE report reaches a consumer through a forwarder. We read the deployed
            forwarder&apos;s source before trusting it: <Mono>typeAndVersion()</Mono> returns{" "}
            <Mono>MockKeystoneForwarder 1.0.0</Mono> and its <Mono>report</Mono> function is
            permissionless by design.{" "}
            <span className="text-[var(--color-text)]">
              A contract gating on <Mono>msg.sender == forwarder</Mono> would be gating on nothing
            </span>
            , and this contract holds bonds.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            So authorisation travels with the verdict instead. The attestor signs it, the contract
            recovers the signer and requires it equals{" "}
            <Mono className="break-all">{ATTESTOR}</Mono>, fixed at deploy with no setter. The forwarder
            is a pipe. Anyone may push a report through it and exactly one signature makes it act.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            That attestor is a passkey-derived key that <span className="text-[var(--color-text)]">owns nothing</span>{" "}
            and can only sign verdicts.{" "}
            <Link href="/account" className="text-[var(--color-brand)] hover:underline">
              How the four keys separate →
            </Link>
          </p>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- honesty */}
      <Reveal>
        <Panel title="what this does not prove yet">
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">No bond has been slashed.</span> Our own agent
            record asserts no payment claims, so its sample sits below the minimum and nothing can fall
            below the floor. The slashing path is covered by the contract test suite and by fork tests
            against real mainnet state — not by a live slash of our own money, and those are different
            strengths of evidence.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            The review that preceded this deployment found a real one and is published with the exploit
            rather than summarised: <Mono>postBond</Mono> originally never checked who owned the agent,
            so anyone could bond anyone, and a stranger could have created an unslashable bond that made
            an agent read as staked. A badge that costs one atomic unit to fake is the thing this project
            exists to attack, so the fix is enforced by the registry and mutation-tested.{" "}
            <Link href="/method" className="text-[var(--color-brand)] hover:underline">
              How a verdict is decided →
            </Link>
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}
