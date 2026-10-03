import Link from "next/link";
import { Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { bondsFor, usdc } from "@/lib/bonds.ts";
import { BondPoster } from "@/components/bond-poster.tsx";
import { CrePanel } from "@/components/cre-panel.tsx";

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
const ATTESTOR = "0x358c591aD7D60aC36bC223472B41518A7FA7b44A";
const FIRST_BOND = "0x72970dc0428412d04c043877be6b8c979b245797cf275bcae683394026697e7c";
const FIRST_RELEASE = "0x06082587d73900d91f6dcd16408170dd322f316e9dc0acea27ae2a7d1fb41b92";

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

export default async function Bond({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  const initialAgent = agent && /^\d+$/.test(agent) ? agent : null;
  /**
   * Every bond we have posted, read live from the contract on each load.
   *
   * This page used to be prose about one bond, which meant a second bond existed on chain and the page
   * describing bonds did not know. The ids are ours and enumerated deliberately: Sclera has no
   * "list all bonds" view and inventing one from events would report a matured window as still active.
   */
  const OURS = [10252, 10256, 10257];
  const bonds = await bondsFor(OURS);
  const live = OURS.map((id) => ({ id, b: bonds.get(id) })).filter((x) => x.b);
  const staked = live.reduce((n, x) => n + Number(x.b!.amountAtomic), 0);
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="sclera · monad mainnet · immutable"
        title="Trust stops being a badge. It becomes a price."
        lead={
          <>
            An agent locks USDC against a floor on its own future claim-truth rate. Stay above the floor
            and the stake comes back. Fall below it and a signed verdict takes it. There is no admin
            function and no override anywhere in that path.
          </>
        }
      />

      {/* ---------------------------------------------------------------- post one */}
      <Reveal>
        <Panel
          id="post"
          title="bond your own agent"
          subtitle="From the passkey or wallet that owns it. Every rule the contract enforces is checked here first, from live chain state, so the button only turns on for a send that can succeed."
        >
          <BondPoster initialAgent={initialAgent} />
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- it is live */}
      <Reveal>
        <Panel
          title={`every bond we have posted · ${live.length}`}
          subtitle="Read from Sclera on every load. State is the contract's, not an index's, because a window matures when a block number passes and emits nothing."
        >
          <div className="space-y-px">
            {live.map(({ id, b }) => (
              <Link
                key={id}
                href={`/agent/${id}`}
                className="block rounded border border-transparent px-2 py-2.5 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Mono className="w-16 shrink-0 text-[13px]">#{id}</Mono>
                  <span className="font-mono text-[13px] text-[var(--color-text)]">{b!.state}</span>
                  <Mono className="text-[13px]">{usdc(b!.amountAtomic)} USDC</Mono>
                  <span className="text-[11.5px] text-muted">
                    floor {(b!.minTruthRateBps / 100).toFixed(0)}% over {b!.minSampleSize} claims
                  </span>
                  {b!.state === "active" && b!.matured === true ? (
                    <span className="text-[11.5px] text-muted">window closed, releasable</span>
                  ) : null}
                  {b!.state === "released" ? (
                    <span className="text-[11.5px] text-muted">returned in full</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            {usdc(String(staked))} USDC is at stake across these right now. A released bond reads zero
            because the money went back, which is why the state is shown beside the amount rather than
            the amount alone.
          </p>
        </Panel>

        <Panel title="one complete bond, on mainnet" subtitle="Posted, held for its full window, released. Not a testnet screenshot and not a plan.">
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
            <Row label="bond posted">
              <Tx hash={FIRST_BOND}>0.02 USDC staked on agent 10252, block 107460188</Tx>
            </Row>
            <Row label="bond released">
              <Tx hash={FIRST_RELEASE}>returned in full after the window, block 107719555</Tx>
            </Row>
            <Row label="floor committed to">
              <Mono>8000 bps</Mono> <span className="text-muted">80% of decided claims must resolve true</span>
            </Row>
            <Row label="window">
              <Mono>216,000 blocks</Mono> <span className="text-muted">about a day at 400ms</span>
            </Row>
            <Row label="minimum sample">
              <Mono>5</Mono> <span className="text-muted">below this nothing can slash</span>
            </Row>
          </dl>

          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            Verified by where the money went rather than by an event we emitted. While the bond was open the
            contract held 20,000 units and the agent was down by exactly that; on release both reversed.
            The bond now reads state <Mono>3</Mono>, <Mono>Released</Mono>, with its amount zeroed and a
            second release reverts <Mono>WrongState()</Mono>.
          </p>
          <div className="mt-2 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <pre className="sql">{`# the contract holds nothing now, because it gave it back
cast call ${USDC} 'balanceOf(address)(uint256)' \\
  ${SCLERA} --rpc-url https://rpc.monad.xyz    # 0

# and the bond is settled rather than open
cast call ${SCLERA} 'bonds(uint256)' 10252 --rpc-url https://rpc.monad.xyz
# state 3 == Released, amount 0`}</pre>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">What the release does not prove:</span> the window ran
            with no verdict submitted, so this demonstrates the timelock, the state machine and the return
            path. It does not show that a measurement fed the outcome. <Mono>release</Mono> is callable by anyone on
            purpose, because the money can only go to the agent that posted it, which keeps a bond from being
            stranded by an operator who has lost access to the gas token.
          </p>
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

      {/* ---------------------------------------------------------------- the workflow that decides */}
      <Reveal>
        <CrePanel />
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
             and this contract holds bonds.
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
            <span className="text-[var(--color-text)]">No bond has been slashed and we declined to fake
            one.</span> Two things block it independently. The attestor key is derived from a passkey, so
            nothing in the repository can author a slashing verdict at all. That is the key separation
            working rather than a gap. And agent 10252&apos;s real claim-truth sample is empty, because our
            own record asserts no payment claims, so an honest verdict carries a sample of zero and the
            contract refuses it before computing a rate. Manufacturing a slash would mean signing numbers
            that are not a measurement or publishing false payment claims about our own agent. Both are the
            thing this project exists to detect, so the absence stays and the slashing path rests on the
            contract test suite and fork tests against real mainnet state.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            The review that preceded this deployment found a real one and is published with the exploit
            rather than summarised: <Mono>postBond</Mono> originally never checked who owned the agent,
            so anyone could bond anyone and a stranger could have created an unslashable bond that made
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
