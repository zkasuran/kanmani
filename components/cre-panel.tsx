/**
 * The CRE workflow, shown on /bond (flagship 8.2).
 *
 * The bond's terms are read straight from Sclera on Monad by a Chainlink CRE workflow, which then
 * reads the agent's measured claim-truth rate from the Kanmani API and signs a verdict. This panel
 * shows that, with the last recorded simulation log and the two external calls named exactly. It
 * reads a validated file (lib/cre-sim.ts), never a hard-coded string, so a fresh 8.1 capture flows
 * through without touching this component.
 */
import { Mono, Panel, Row } from "@/components/ui.tsx";
import { creSimulation } from "@/lib/cre-sim.ts";

const SCLERA = "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf";

export function CrePanel() {
  const sim = creSimulation();
  const m = sim.featured.measured;
  return (
    <Panel
      title="read by a CRE workflow"
      subtitle="A Chainlink CRE workflow reads the bond's terms from Sclera on Monad, then reads the agent's measured claim-truth rate from the Kanmani API and signs the verdict. Simulated with the CRE CLI, which is the deliverable Chainlink judges."
    >
      {/* the external call */}
      <dl className="mb-4">
        <Row label="chain read">
          <span className="text-[13px] text-muted">
            <Mono className="text-[12px]">bonds(uint256)</Mono> on Sclera{" "}
            <a
              href={`https://monadscan.com/address/${SCLERA}`}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[12px] text-[var(--color-brand)] hover:underline"
            >
              {SCLERA}
            </a>{" "}
            on Monad mainnet, block LATEST
          </span>
        </Row>
        <Row label="external api">
          <span className="text-[13px] text-muted">
            <Mono className="text-[12px]">GET /api/sla/&lt;agentId&gt;</Mono>, run by every node, aggregated by
            median.{" "}
            <a
              href={sim.featured.liveCheck}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[12px] text-[var(--color-brand)] hover:underline"
            >
              check agent {sim.featured.agentId} live
            </a>
          </span>
        </Row>
      </dl>

      {/* the last simulation log */}
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <Mono className="text-[11px] text-faint">
          {sim.command}
        </Mono>
        <Mono className="text-[11px] text-faint">
          CLI {sim.cliVersion} · SDK {sim.sdkVersion} · captured {sim.capturedAt.slice(0, 10)}
        </Mono>
      </div>
      <div className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
        <pre className="sql">{sim.featured.log.join("\n")}</pre>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
        That is <Mono className="text-[12px]">{m.trueCount}</Mono> true of{" "}
        <Mono className="text-[12px]">{m.sampleSize}</Mono> decided claims, a measured{" "}
        <Mono className="text-[12px]">{m.rateBps}</Mono> bps. The workflow refused a verdict because this
        agent has no bond, so there is nothing to slash, which is the measurement without the judgement.
      </p>

      {/* the chain-half companion */}
      <div className="mt-4 rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
        <pre className="sql">{sim.bondRead.log}</pre>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
        The same workflow reading a live bond&apos;s terms (agent {sim.bondRead.agentId}), so the chain half
        hits a real deployed bond even though the featured run above is observation mode.
      </p>

      {/* honesty */}
      <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        This is a successful CRE CLI simulation, which is the bounty deliverable. The chain read and the
        decision are real. No verdict was issued because no single agent has both a bond and a decided
        sample yet, the same honesty the panel beside this one states.{" "}
        <a
          href={sim.docsHref}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--color-brand)] hover:underline"
        >
          full recorded run →
        </a>
      </p>
    </Panel>
  );
}
