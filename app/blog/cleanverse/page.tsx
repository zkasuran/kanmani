import Link from "next/link";
import { Mono, PageHeader, Panel, Row } from "@/components/ui.tsx";

/**
 * The Cleanverse piece. Every on-chain fact here was read with eth_call on 2026-10-01 against Monad
 * mainnet (chain 143) and testnet (10143). No state-changing transaction, no funds moved. The live
 * lookup is on the compliance page, which reads cviStatus on load.
 */

export const metadata = {
  title: "A dollar that checks both sides before it moves",
  description:
    "Access USDC is a compliance asset on Monad that gates every transfer on an on-chain identity. We read its exact rule off the chain: tier 5 or higher, both sender and recipient. Otherwise the transfer reverts.",
};

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--color-text)]">{children}</p>;
}

const AUSD = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
const POLICY = "0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd";

export default function Cleanverse() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · cleanverse · 2026-10-01"
        title="A dollar that checks both sides before it moves"
        lead="Cleanverse gates asset movement behind an on-chain identity. Before wiring a real compliance asset into our escrow we read, off the chain, exactly what it would do. The answer decided the whole integration."
      />

      <Panel title="what Access USDC enforces, read not guessed">
        <div className="space-y-3">
          <P>
            Access USDC (<Mono>aUSDC</Mono>) is a Cleanverse Verified Asset on Monad. It is an ordinary ERC20 to
            look at, with one difference that matters: every transfer runs through a policy before it moves. We
            read the wiring with <Mono>eth_call</Mono>, no transaction sent.
          </P>
          <div className="space-y-1 text-[13px]">
            <Row label="token">
              <Mono className="text-muted">{AUSD}</Mono>
            </Row>
            <Row label="name / decimals">
              <Mono className="text-muted">Access USDC · 6</Mono>
            </Row>
            <Row label="policy()">
              <Mono className="text-muted">{POLICY}</Mono>
            </Row>
            <Row label="getRulesV2">
              <Mono className="text-muted">one rule: minTier 5, no group, no country</Mono>
            </Row>
          </div>
          <P>
            So a wallet can hold or move the token only if it carries a Cleanverse identity of tier 5 or higher.
            The policy address is the same on mainnet and testnet, so the rule is one fact, not two.
          </P>
        </div>
      </Panel>

      <Panel title="the check runs on both sides, before the balance">
        <div className="space-y-3">
          <P>
            A naive compliance token checks the sender. This one checks both ends of every transfer and it
            fires before the balance check. That second detail is useful: an <Mono>eth_call</Mono> reveals
            compliance status with no funds in the account, because the compliance revert happens first.
          </P>
          <P>
            Calling <Mono>canTransfer(aUSDC, from, to, 1)</Mono> for our own addresses on mainnet, the buyer{" "}
            <Mono>0xDB6c…7777</Mono> reverts <Mono>0xa6725971</Mono> and the revert data names the buyer itself.
            The escrow gate reverts and names the gate. A compliant holder returns true. The one address that
            passes today is a worker we issued a tier-20 identity to on testnet.
          </P>
        </div>
      </Panel>

      <Panel title="trace the escrow and four addresses have to pass">
        <div className="space-y-3">
          <P>
            Our escrow moves the token buyer to gate to the escrow contract on the way in, then escrow to gate to
            worker on the way out. Each hop is checked on both ends. Walk it through and the set of addresses that
            must each hold a tier-5 identity is the buyer, the gate, the escrow contract and the worker.
          </P>
          <P>
            Three of the four fail today, so a real settlement would revert on the first hop and nothing would
            move. That is the correct behaviour for a compliance asset. It is also the thing a demo that only ran
            a mock token never has to confront.
          </P>
        </div>
      </Panel>

      <Panel title="what this means for the build">
        <div className="space-y-3">
          <P>
            Nothing in our code has to change. Access USDC and our two contracts are all immutable. The
            token&apos;s rule is not ours to edit. The only lever is Cleanverse issuing a tier-5 identity to each
            of the four addresses, which their own guide documents a contract can hold. So the path is: get the
            four identities issued, fund the testnet asset, then run the pass and the refuse with the real
            compliance asset in place of the mock.
          </P>
          <P>
            The{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/compliance">compliance page</Link>{" "}
            reads an address&apos;s identity status live on both chains when it loads, so this is shown rather than
            asserted. Its mainnet column turns real the moment the identities exist, with no deploy.
          </P>
        </div>
      </Panel>
    </div>
  );
}
