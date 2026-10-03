# CRE slashing oracle: recorded simulation

**Run it yourself:**

```bash
cd cre/kanmani-oracle
cre login                                   # browser flow, one time
cre workflow simulate slashing -T staging-settings --non-interactive --trigger-index 0
```

CLI simulation is the deliverable rather than a stand-in for one. Darb at Chainlink Labs confirmed it
directly when asked: no testnet DON is available to hackathon participants and CLI simulation is what
they look for when judging. That answer is why this is a simulation and not a deployment.

The live product shows this run at https://kanmani.xyz/bond, in a CRE panel that reads
`shared/cre-simulation.json`, the machine-readable twin of this file. The panel features the 10182
measurement and the 10256 bond read side by side.

The simulation runs the read, the decision and the report encoding for real. It does not settle:
`cre workflow simulate` uses a MockForwarder that records a report and never calls `onReport`. The
on-chain write stays gated behind a broadcast flag the judged configs leave off, so no bond is ever
touched.

## What the workflow proves

The bounty asks for a blockchain integrated with an external API. Both halves are real here.

* **The chain half.** It reads the bond terms straight from Sclera on Monad mainnet at
  `0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf`. The log line below shows real values: floor 8000bps,
  a 216,000 block window, minSample 5, nonce 1. Those are the terms of a bond actually posted, not a
  fixture.
* **The external half.** It then asks the Kanmani API for that agent's measured claim-truth rate over
  the bond's own window.

## The run that measured a live agent (agent 10182, 2026-09-22)

Agent 10182 has decided payment claims but no bond, so the workflow reported the measurement and
refused a verdict. Observation mode, exactly as designed:

    measured 1/42 claims true = 238bps (0 undecided, excluded from both sides)
    OBSERVED agent=10182 rate=238bps sample=42 (no bond, no verdict)

That is 1 claim true out of 42 = 238 bps, computed by the workflow from the counts it aggregated,
never read back from the API. Those are the values as of the 2026-09-22 capture. The live endpoint
reflects the agent's whole history, which grows, so re-running this today returns a larger sample and
a higher rate (78 claims, 5 true, 641 bps on 2026-10-03), not the frozen 238 bps. The link at
`https://kanmani.xyz/api/sla/10182` verifies the method and the endpoint, not the snapshot.

## The interesting part is that it refused

Agent 10256 is bonded and has no decided payment claims, so the workflow declined to produce a rate:

    agent 10256 has no decided payment claims in 107757352..107973352, so there is nothing to rate

That refusal is the safety property, not a failed run. A slashing oracle that emits a rate from an empty
sample would let anyone take a bond on the strength of no measurement, which is precisely the
unslashable-bond defect audit Finding 9 closed inside the contract. The same refusal exists in the
deployed contract's `minSample` and in the Assay agent's quote, so all three agree.

**No agent currently has both a bond and a decided sample.** 10256 and 10257 are bonded with empty
samples and 10182 has a decided sample and no bond. Bonding 10182 is impossible on purpose: Finding 9
made `postBond` revert unless the caller owns the agent and we do not own it. So the full
measure-then-slash path cannot be demonstrated end to end without either faking a measurement or
bonding somebody else's agent and both are the things this project exists to detect.

## A defect this found

`config.staging.json` carried `scleraAddress: 0x0000000000000000000000000000000000000000`, a placeholder
from before Sclera was deployed. The workflow had never been run, so nothing had ever caught it. With
that address the simulation would have read an empty bond from nowhere and still printed a plausible
result. Corrected to the deployed address and the target agent moved from 10182 to 10256 so the bond
read has something real to return.

## Recorded run

```
Initializing...
Loading settings...
! Using default private key for chain write simulation. To use your own key, set CRE_ETH_PRIVATE_KEY in your .env file or system environment.
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: 3f5fe3ca942c8f3a13013a0408c41914744f8db5f6ae7769587b83164200947c
  Config hash: 4e5fd42c43f5d94939aec797367fad3b9c75835ad5d7073e35fb1e3c13a5af01
2026-09-25T13:13:41Z [SIMULATION] Simulator Initialized
2026-09-25T13:13:41Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-09-25T13:13:41Z [USER LOG] bond read from chain: floor 8000bps, window 107757352..107973352, minSample 5, nonce 1
2026-09-25T13:13:42Z [USER LOG] agent 10256 has no decided payment claims in 107757352..107973352, so there is nothing to rate
✓ Workflow Simulation Result:
"agent 10256 has no decided payment claims in 107757352..107973352, so there is nothing to rate"
2026-09-25T13:13:42Z [SIMULATION] Execution finished signal received
2026-09-25T13:13:42Z [SIMULATION] Skipping WorkflowEngineV2
╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```
