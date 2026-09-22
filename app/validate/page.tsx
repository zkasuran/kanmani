import Link from "next/link";
import { Mono, Num, Panel } from "@/components/ui.tsx";
import { q1 } from "@/lib/db.ts";
import { CHAIN_ID } from "@/lib/db.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Ask for a validation",
  description:
    "Monad's ERC-8004 Validation Registry is owner-initiated. Here is how to ask Kanmani for an on-chain check of your own agent.",
};

const VALIDATOR = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const REGISTRY = "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58";
const TAG = "kanmani.payment-claim.v1";

export default async function Validate() {
  // Our own row, read live from the index rather than stated. The count is the whole "before and
  // after" and it would be embarrassing to assert it from a constant.
  const counts = await q1<{ validations: string; feedbacks: string }>(
    `SELECT (SELECT count(*) FROM "Validation" WHERE "chainId" = $1) AS validations,
            (SELECT count(*) FROM "Feedback"   WHERE "chainId" = $1) AS feedbacks`,
    [CHAIN_ID],
  );
  const validations = Number(counts?.validations ?? 0);
  const feedbacks = Number(counts?.feedbacks ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-faint">
          erc-8004 validation registry · monad mainnet
        </p>
        <h1 className="mt-3 text-[clamp(1.5rem,3.2vw,2.2rem)] font-semibold leading-[1.2] tracking-tight">
          <Num value={feedbacks} /> feedbacks on this chain.{" "}
          <span className="text-[var(--color-brand)]">
            <Num value={validations} /> validation{validations === 1 ? "" : "s"}.
          </span>
        </h1>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-muted">
          Anyone can leave feedback about any agent. Almost nobody has ever asked for one to be
          independently checked. That is not apathy, it is how the contract works and the
          difference is worth understanding before you read the gap as a community failing.
        </p>
      </div>

      <Panel title="why the registry is empty, which took a failed transaction to learn">
        <p className="max-w-3xl text-[14px] leading-relaxed">
          We tried to write our verdicts into this registry directly. Every call reverted with{" "}
          <Mono className="text-[var(--color-false)]">Not authorized</Mono>. Simulating{" "}
          <Mono>validationRequest</Mono> from three different addresses settled why:
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2">caller</th>
              <th className="pb-2">result</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-line)]/50">
              <td className="py-2 text-[13px]">us, an arbitrary validator</td>
              <td className="py-2 font-mono text-[12px] text-[var(--color-false)]">revert, Not authorized</td>
            </tr>
            <tr className="border-b border-[var(--color-line)]/50">
              <td className="py-2 text-[13px]">the agent&apos;s own declared wallet</td>
              <td className="py-2 font-mono text-[12px] text-[var(--color-false)]">revert, Not authorized</td>
            </tr>
            <tr>
              <td className="py-2 text-[13px]">the agent&apos;s NFT owner</td>
              <td className="py-2 font-mono text-[12px] text-[var(--color-true)]">passes</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
          <span className="text-[var(--color-text)]">
            Only an agent&apos;s owner can open a validation and they name the validator when they
            do.
          </span>{" "}
          A validator cannot publish an opinion about somebody else&apos;s agent, however true that
          opinion is. So the permissionless half of ERC-8004 fills up and the half that requires
          consent stays empty. Monad&apos;s own ERC-8004 guide does not mention this, because it
          still lists the Validation Registry as coming soon while it has been live and answering
          calls the whole time.
        </p>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
          We think that design is right. A verdict about your agent, written on chain, permanently,
          by a stranger you never engaged, is not a thing anyone should be able to do to you.
        </p>
      </Panel>

      <Panel title="so ask and we answer" subtitle="Two calls from your own wallet, no signup, no key.">
        <ol className="space-y-4 text-[14px] leading-relaxed">
          <li>
            <p className="font-mono text-[11px] uppercase tracking-wide text-faint">
              1. open a request naming us
            </p>
            <p className="mt-1 text-muted">
              From the wallet that owns your agent NFT. That ownership is the whole authorisation.
            </p>
            <pre className="mt-2 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`cast send ${REGISTRY} \\
  "validationRequest(address,uint256,string,bytes32)" \\
  ${VALIDATOR} \\
  <yourAgentId> \\
  "https://example.com/why-you-are-asking" \\
  $(cast keccak "your-own-reference") \\
  --rpc-url https://rpc.monad.xyz --private-key $YOUR_KEY`}</pre>
          </li>
          <li>
            <p className="font-mono text-[11px] uppercase tracking-wide text-faint">2. we answer</p>
            <p className="mt-1 text-muted">
              Our responder watches for requests naming{" "}
              <Mono className="text-[var(--color-brand)]">{VALIDATOR}</Mono> and writes a{" "}
              <Mono>validationResponse</Mono> carrying the verdict, a link to the claim page it came
              from and the hash of the receipt.
            </p>
          </li>
          <li>
            <p className="font-mono text-[11px] uppercase tracking-wide text-faint">3. read it back</p>
            <pre className="mt-2 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`cast call ${REGISTRY} \\
  "getSummary(uint256,address[],string)(uint64,uint8)" \\
  <yourAgentId> "[${VALIDATOR}]" "${TAG}" \\
  --rpc-url https://rpc.monad.xyz`}</pre>
          </li>
        </ol>
      </Panel>

      <Panel title="what our response means, exactly">
        <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
          The contract takes a <Mono>uint8</Mono> and <Mono>getSummary</Mono> averages it. That is a
          score and our verdicts are not a score. Four outcomes do not sit on a scale. So we only
          write the ones we actually decided:
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2">verdict</th>
              <th className="pb-2">written?</th>
              <th className="pb-2">response</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["true", "yes", "100", "the cited transaction is on the chain the document names"],
              ["false", "yes", "0", "we read that chain and it is not there"],
              ["unknown", "no", "nothing", "we could not look, so we have nothing to say"],
              ["noClaim", "no", "nothing", "the document asserts no payment, so there was nothing to check"],
            ].map(([v, w, r, why]) => (
              <tr key={v} className="border-b border-[var(--color-line)]/50 last:border-0">
                <td className="py-2 font-mono text-[13px]">{v}</td>
                <td
                  className={`py-2 font-mono text-[12px] ${
                    w === "yes" ? "text-[var(--color-true)]" : "text-[var(--color-unknown)]"
                  }`}
                >
                  {w}
                </td>
                <td className="py-2 font-mono text-[12px] text-muted">{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
          The absence of a row is the signal that we did not check, rather than a zero standing in
          for it. That is what makes the average mean something exact: it is the share of your
          checked payment claims that resolved, not an opinion about your agent.
        </p>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
          <span className="text-[var(--color-text)]">We will refuse to answer</span> if we hold no
          decided verdict about your agent and the refusal is silent on chain rather than a zero.
          Writing a number for an agent we could not check would be permanent and wrong.{" "}
          <Link href="/method" className="text-[var(--color-brand)] hover:underline">
            How each verdict is decided →
          </Link>
        </p>
      </Panel>

      <Panel title="our own row">
        <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
          We registered as agent{" "}
          <a
            href="https://monadexplorer.com/tx/0x07f7211e2699b9516bfb746c5d5bf2c8c1fe3768a7d2dc5b09cfd5e7e2b3c394"
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[var(--color-brand)] hover:underline"
          >
            10252
          </a>{" "}
          with our record written into <Mono>tokenURI</Mono> rather than hosted at a URL, because we
          had just finished measuring that 8,093 agents on this chain point at one document that
          returns a deletion. Registering at a URL after publishing that number would be advice we
          do not take.
        </p>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">
          Then we asked ourselves for a validation and answered it, which is the only agent we are
          allowed to do that for. Said plainly because it would be easy to blur: vouching for
          ourselves proves nothing about us. It proves the registry works and that this pipeline
          reaches the chain.
        </p>
        <pre className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 sql">{`cast call ${REGISTRY} \\
  "getSummary(uint256,address[],string)(uint64,uint8)" \\
  10252 "[${VALIDATOR}]" "${TAG}" \\
  --rpc-url https://rpc.monad.xyz`}</pre>
      </Panel>
    </div>
  );
}
