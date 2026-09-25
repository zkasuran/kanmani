import Link from "next/link";
import { Mono, PageHeader, Panel } from "@/components/ui.tsx";
import { Reveal } from "@/components/motion.tsx";
import { CANONICAL_REGISTRIES, coverage, indexedChains, registrable } from "@/lib/chains.ts";
import { agentsByChain } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Chains",
  description:
    "Which chains Kanmani reads, which carry ERC-8004 registries and what it takes to add one. Coverage is published, because a negative means nothing without the list of places it was looked for.",
};

export default async function Chains() {
  /**
   * The BSC population was typed into this sentence and had drifted 797 short before anyone looked.
   * Asked for now, so the page cannot state a number the indexer disagrees with.
   */
  const counts = (await agentsByChain()).rows.counts;
  const rows = coverage();
  const hosting = registrable();
  const live = indexedChains();

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="monad is home · the rest is evidence"
        title="Built on Monad. Verified wherever the money landed."
        lead={
          <>
            Monad is the chain this is for: the population we measure, the escrow, the receipts, the
            registry we write to. Every other chain here exists to answer a question about a{" "}
            <span className="text-[var(--color-text)]">Monad</span> agent. Did the payment it cites
            actually land and did its standing start here or arrive from somewhere else. ERC-8004
            anticipates exactly that: an agent registered on one chain can still operate and transact
            on others.
          </>
        }
      />

      {/* ---------------------------------------------------------------- the table */}
      <Reveal>
        <Panel
          title="every chain in the registry"
          subtitle={
            <>
              {rows.length} chains declared, {hosting.length} carrying ERC-8004 registries,{" "}
              {live.length} present in the live index. A chain with no endpoint configured reads as
              uncovered and a claim naming it is <span className="unknown-value">unknown</span>,
              never false.
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                  <th className="pb-2">chain</th>
                  <th className="pb-2">id</th>
                  <th className="pb-2">readable</th>
                  <th className="pb-2">erc-8004</th>
                  <th className="pb-2">indexed</th>
                  <th className="pb-2">names a document may use</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ chain, configured, registries }) => (
                  <tr key={chain.id} className="border-b border-[var(--color-line)]/50 last:border-0">
                    <td className="py-2">
                      <a
                        href={chain.explorer}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-[13px] text-[var(--color-brand)] hover:underline"
                      >
                        {chain.displayName}
                      </a>
                    </td>
                    <td className="py-2 font-mono text-[12px] text-muted">{chain.id}</td>
                    <td className="py-2">
                      {configured ? (
                        <span className="chip chip--live">yes</span>
                      ) : (
                        <span className="unknown-value font-mono text-[11px]">no endpoint</span>
                      )}
                    </td>
                    <td className="py-2">
                      {registries ? (
                        <span className="chip chip--live">deployed</span>
                      ) : (
                        <span className="font-mono text-[11px] text-faint">none</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[11px]">
                      {chain.erc8004?.indexed ? (
                        <span className="text-[var(--color-true)]">live</span>
                      ) : registries ? (
                        <span className="text-muted">configured</span>
                      ) : (
                        <span className="text-faint">{/* voice-gate:allow empty-cell glyph */ "\u2014"}</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-faint">{chain.aliases.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">Readable</span> and{" "}
            <span className="text-[var(--color-text)]">erc-8004</span> are deliberately separate
            columns. A chain can be readable without hosting a single agent, which is what makes
            &quot;registered on Monad, paid on Base&quot; a checkable statement rather than a hope.
            Ethereum hosts no registry here and we still read receipts on it.
          </p>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- the addresses */}
      <Reveal>
        <Panel
          title="why a new chain needs no new addresses"
          subtitle="The registries are per-chain singletons and the mainnet deployments share one address set."
        >
          <dl className="space-y-1.5">
            {(
              [
                ["identity", CANONICAL_REGISTRIES.identity],
                ["reputation", CANONICAL_REGISTRIES.reputation],
                ["validation", CANONICAL_REGISTRIES.validation],
              ] as const
            ).map(([name, addr]) => (
              <div key={name} className="proof-row">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-faint">{name}</dt>
                <dd>
                  <Mono className="break-all text-[var(--color-text)]">{addr}</Mono>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            Established on chain rather than from a deployment list, because a wrong address indexes
            nothing and still looks like a working integration. On both 143 and 56:{" "}
            <Mono>eth_getCode</Mono> returns a 130-byte ERC-1967 proxy at all three,{" "}
            <Mono>getVersion()</Mono> is <Mono>2.0.0</Mono> and the reputation and validation
            registries each answer <Mono>getIdentityRegistry()</Mono> with the identity address above.
            That last check is the load-bearing one: the set is self-consistent on chain, so nothing
            here rests on a document.
          </p>
          <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <pre className="sql">{`# check it yourself, on any chain in the table
cast call 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 \\
  'getIdentityRegistry()(address)' --rpc-url <rpc>
# -> 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`}</pre>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
            A chain that deployed somewhere else overrides the set with its own. Monad testnet does
            exactly that, which is why the override exists rather than an assumption that the
            addresses are universal.
          </p>
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- adding one */}
      <Reveal>
        <Panel
          title="adding a chain"
          subtitle="One entry, one env var and a test that fails with whatever is still missing."
        >
          <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
            <pre className="sql">{`// shared/erc8004-chains.json
{
  "id": 130,
  "key": "unichain",
  "displayName": "Unichain",
  "aliases": ["unichain", "uni"],
  "rpcEnv": "RPC_UNICHAIN",
  "explorer": "https://uniscan.xyz",
  "erc8004": { "startBlock": 1234567, "indexed": false }
}

# then
export RPC_UNICHAIN=https://…
npm test                 # conformance + drift and it names what is missing`}</pre>
          </div>
          <ul className="mt-4 space-y-2 text-[13.5px] leading-relaxed text-muted">
            <li>
              <span className="text-[var(--color-text)]">The registry is the only source of truth.</span>{" "}
              Chains used to live in three places that nothing compared, so a chain could be added to
              the verifier, missed in the indexer and still look integrated. Drift tests now bind
              them.
            </li>
            <li>
              <span className="text-[var(--color-text)]">An alias collision is refused.</span> Two
              chains claiming <Mono>base</Mono> would make a document ambiguous, so the test fails
              rather than resolving by declaration order.
            </li>
            <li>
              <span className="text-[var(--color-text)]">
                <Mono>erc8004: null</Mono> is a first-class answer.
              </span>{" "}
              It means we read receipts there and no agent lives there. Handing back plausible
              addresses for a chain with no deployment is how a wrong integration comes to look like a
              working one, so that returns null instead.
            </li>
            <li>
              <span className="text-[var(--color-text)]">Widening coverage is a published change.</span>{" "}
              Adding a chain can turn a <span className="text-[var(--color-false)]">false</span> into
              a <span className="text-[var(--color-true)]">true</span>, which is a correction with a
              before and an after rather than a number that quietly improves.{" "}
              <Link href="/status" className="text-[var(--color-brand)] hover:underline">
                Verdicts that have changed →
              </Link>
            </li>
          </ul>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            The full runbook, including how to find a start block without scanning an empty chain, is
            in <Mono>docs/23-ADDING-A-CHAIN.md</Mono>.
          </p>
        </Panel>
      </Reveal>

      <Reveal>
        <Panel title="what is honest to say about this">
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            Not &quot;runs on any chain&quot;. {rows.length} chains are declared here and the list is
            on this page beside every claim that depends on it. A chain outside it is{" "}
            <span className="unknown-value">unknown</span>, which is a statement about our reach and
            never about an operator.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            <span className="text-[var(--color-text)]">
              And this is not a multi-chain explorer, deliberately.
            </span>{" "}
            {live.length > 1 ? (
              <>
                {live.length} chains are in the index, but only Monad is a population you can browse
                here. The {live.length - 1} other indexed chain
                {live.length - 1 === 1 ? " is" : "s are"} present to enrich a Monad row, not to be a
                second list: an operator whose document also appears elsewhere is marked on{" "}
                <Link href="/operators" className="text-[var(--color-brand)] hover:underline">
                  /operators
                </Link>
                , matched on the document&apos;s content hash. Browsing BNB Smart Chain&apos;s own
                {(counts[56] ?? 0).toLocaleString()} agents is not something this site does and
                8004scan already does it well.
              </>
            ) : (
              <>
                One chain is in the index today, so there is nothing to merge yet and this page says
                so rather than implying a network that is not there.
              </>
            )}
          </p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
            <Link href="/method" className="text-[var(--color-brand)] hover:underline">
              How coverage decides a verdict →
            </Link>
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}
