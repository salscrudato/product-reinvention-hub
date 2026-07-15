# Phase W — offline full run (1 of the 2 consecutive clean runs)

Run at local tree = origin/main `7d78d90` + local `75f7517` (F13, filing-path only — the
Phase W workbook corpus is untouched by it). 2026-07-15.

| Check | Result |
|---|---|
| Corpus enumeration (`node scripts/import-enumerate.mjs`) — every hardening workbook + adversarial + mixed request through the REAL unifiedImport handler, stubbed AI | **24/24 completed, 0 unhandled**, 1 handled error event (corrupt container — correct); conservation counts byte-identical to committed baseline |
| Offline eval (`pnpm import:eval`) — parse-stability + F20 gates | **4/4 formats**: F1 1.0000 · numeric 1.0000 · extras 0 · linkage parent=1.000 edges=1.000 forms=1.000 |
| Full suite (`pnpm test`) | green (all workspaces), canaries PH $1,528 / PA $1,002 / GL $2,635 |
| Hidden-sheet + cap policy | explicit + warned with exact loss counts (F09 fixture-locked); truncated visible sheets extract via continuation |

Run 2 of 2 = the live CORE slice on the wave-2 deploy (`wave2-core-live.log`, in flight at
handoff — see IH3_HANDOFF.md §Live run).
