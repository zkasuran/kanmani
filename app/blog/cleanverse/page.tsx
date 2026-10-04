import Link from "next/link";
import { PageHeader } from "@/components/ui.tsx";
import { Cmd, Code, Facts, H2, Note, Prose, Shot } from "@/components/blog.tsx";

export const metadata = {
  title: "Money that cannot reach a wallet that is not cleared",
  description:
    "Our escrow settles only to a wallet holding a Cleanverse Verified Identity, read on chain at the moment of payment. On Monad testnet a verified worker was paid and an unverified one was refused, both as real transactions.",
};

const TX = "https://testnet.monadexplorer.com/tx/";

export default function Cleanverse() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        kicker="blog · cleanverse · updated 2026-10-04"
        title="Money that cannot reach a wallet that is not cleared"
        lead="Most compliance checks are a flag the application could skip. Ours sits in the settlement path itself: the escrow reads the worker's Cleanverse identity on chain at the moment it pays. If the identity is not there, it reverts."
      />

      <Prose>
        <H2>Identity coupled to the money, not beside it</H2>
        <p>
          An agent marketplace pays workers for jobs. The compliance question is simple: is the wallet about to
          receive this money cleared to receive it? An off-chain check answers it once, somewhere else. The payment then trusts that answer. We put the check where the money moves. Our gate contract asks the
          Cleanverse validator for the recipient&apos;s identity status inside <Code>settle</Code>. If the
          answer is not an active, verified identity, the transaction reverts and the escrow keeps the funds.
        </p>
      </Prose>

      <Shot
        post="cleanverse"
        name="status"
        width={1153}
        height={318}
        href="/compliance"
        alt="Live CVI status: testnet worker verified, our deployer not cleared on testnet, our deployer not checkable on mainnet"
        caption={
          <>
            The <Link href="/compliance">compliance page</Link> reads each gate&apos;s <Code>cviStatus</Code> on
            every request. Nothing here is typed in. The three states are different answers and the page keeps
            them apart.
          </>
        }
      />

      <Prose>
        <H2>The pass and the refuse, as real transactions</H2>
        <p>
          We registered our gate as a compliance pool with the Cleanverse validator on Monad testnet, set its
          rule and had a tier-20 identity issued to a test worker. No personal data was sent: the identity field
          is optional. Then we ran the same job twice.
        </p>
      </Prose>

      <Facts
        caption="Each step is a transaction on Monad testnet (chain 10143). Open any of them."
        rows={[
          {
            k: "register the gate",
            v: <a href={`${TX}0x1fde7e517ca70b15a8894f7f778c68747e8dcd29a91017e170c936b9f2d64cce`}>0x1fde7e51…64cce</a>,
            src: "is_register returns true",
          },
          {
            k: "issue a CVI",
            v: <a href={`${TX}0x6ae7f07b5da99abb8d93ef430ff3fea175b7e76507406bb98f9149f148aef057`}>0x6ae7f07b…aef057</a>,
            src: "worker 0xaA51…0936, tier 20, active",
          },
          {
            k: "pass: settle to the verified worker",
            v: <a href={`${TX}0xea913ac399f270daec96bd6e1b374263a50803d84a4606a509dbc7176395174f`}>0xea913ac3…95174f</a>,
            src: "status 1, worker balance 0 then 1,000,000 tUSDC units",
          },
          {
            k: "refuse: settle to a wallet with no CVI",
            v: <a href={`${TX}0xd381c3e12f5535f05f066ff4ceabcf048075b593fd393f565c39a7017a0539d0`}>0xd381c3e1…0539d0</a>,
            src: "status 0, reverted CviNotVerified(), the escrow still holds the job",
          },
        ]}
      />

      <Prose>
        <H2>The compliance asset on mainnet</H2>
        <p>
          Cleanverse also issues Verified Assets. Access USDC is the one on Monad mainnet: an ERC-20 whose every
          transfer goes through a policy contract first. Before wiring it into the escrow we read, off the chain,
          exactly what that policy does. Asking it whether our house wallet may send one unit answers with a
          revert, before any balance check:
        </p>
      </Prose>

      <Cmd
        cmd={`cast call 0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd 'canTransfer(address,address,address,uint256)(bool)' \\
  0xaC0893567D43C3E7e6e35a72803df05416C1f20D 0xDB6c6340342e71A63cD11Ebac2185204b7777777 \\
  0xaA514cD6573f95DdD0df78ec1Fdcb8dA05E70936 1 --rpc-url https://rpc.monad.xyz`}
        out={`Error: server returned an error response: error code 3: execution reverted, data: "0xa6725971000000000000000000000000db6c6340342e71a63cd11ebac2185204b7777777"`}
        note="The revert data names the sender that is not cleared. The policy checks both ends of every transfer and requires a tier-5 identity on each."
      />

      <Prose>
        <p>
          That rule applies to every hop. An escrow holding aUSDC moves it from the buyer to the gate to the
          escrow contract on the way in, then back out to the worker. Each of those four addresses needs its own
          tier-5 identity. A contract can hold one. Until all four are issued, a mainnet settlement in aUSDC
          reverts on the first hop and nothing moves. That is the asset working as designed.
        </p>
      </Prose>

      <Note label="where mainnet stands">
        On mainnet the gate is not yet registered as a compliance pool, so the page reads every wallet there as{" "}
        <span className="unknown-value">not checkable</span> and every settle fails closed. No code changes are
        needed when it is registered: the contracts are immutable and the page reads the chain on load, so the
        mainnet column turns real on its own. The whole testnet flow above is what will run there.
      </Note>
    </div>
  );
}
