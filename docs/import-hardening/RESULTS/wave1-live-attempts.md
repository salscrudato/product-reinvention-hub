# Wave-1 live CORE slice — attempt history (2026-07-14/15, tenant accenture-test, deployed sha dc7d2bd)

Honest record; the successful Phase W live gate run happens on the wave-2 deploy.

| # | Window (UTC) | Outcome | Evidence |
|---|---|---|---|
| 1 | ~21:50–22:35 | ✗ client abort at the 45-min default `IMPORT_EVAL_TIMEOUT_MS` while the server was mid-stage-4. Also showed a REAL ~32-min progress silence after `Core Rate Tables … resolving 1 conflicted field(s)` (heartbeats flowing, no stage events) — single occurrence, unexplained; watch for recurrence. | `wave1-core-live-attempt1-aborted45min.log` |
| 2 | 23:14–00:00 | ✗ severed by an **unprompted App Service restart** at 00:00:28Z (no push happened; platform event). Client stall-watchdog correctly classified it as transient. | `wave1-core-live.log` (Node file-buffering delayed tail lines); `az webapp log tail` container events |
| 2-retry | 00:02–01:55 | Server run **COMPLETED** — `[import-brain] run spend: $70.0287 across 461 call(s)` incl. 74 sonnet-5 calls (ladder's sonnet rung is provisioned now). But the client had already aborted at its 100-min timer (run needed ~113 min) — the bundle was emitted to a dead socket and is unrecoverable (ledger F23). | App Service log 01:55:24Z |
| 3 | 02:05–02:5x | Auto-spawned by the eval's 3× retry — guaranteed to fail (timeout < runtime). Client killed manually; the orphaned server run was terminated early by the wave-2 deploy restart. | this file |

Costs: ~2.3 full CORE extractions of spend (~$150–190), telemetry intact throughout (no-cap ≠ no-telemetry).
Lessons ledgered as **F23**; the wave-2 live gate run uses `IMPORT_EVAL_TIMEOUT_MS=9000000` (150 min).
Stage-4 pacing observed on wave-1 code: `Rule References` (1895 gathered rows, capped grid) ≈ 95 AI batches ≈ 20 min; conflict resolution 411 fields ≈ 7 min; total run ≈ 110 min.
