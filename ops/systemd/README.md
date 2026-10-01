# Scheduled workers

The units installed on the host, kept here so the schedule is in the repository rather than in
somebody's memory. Install or update:

```bash
sudo cp ops/systemd/kanmani-*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kanmani-usage.timer kanmani-sweep.timer kanmani-recheck.timer kanmani-probe.timer
```

| unit | runs | does |
|---|---|---|
| `kanmani-usage` | every 10 min | access log to daily counts, no IPs stored (`scripts/usage-aggregate.mjs`) |
| `kanmani-sweep` | hourly | every Monad evidence document without a verdict goes down the ladder (`scripts/verdict-sweep.mjs`) |
| `kanmani-recheck` | every 6 hours | rechecks documents that can change (http, ipfs) and every unknown. `data:` documents are on chain and cannot change, so they are not rechecked |
| `kanmani-probe` | daily, 03:30 UTC | asks every distinct registration document once, one request at a time per host (`verifier/src/cli/probe-records.ts`) |
