# Live CORE slice — attempt history (2026-07-14/15, tenant accenture-test)

Honest record. Wave-1 attempts ran on deploy dc7d2bd; wave-2 attempt on 7d78d90 (run 2478);
wave-3 attempts on 1c47f25 (IH4).

## Wave-3 attempts (IH4, 2026-07-15)

| # | Window (EDT) | Outcome | Evidence |
|---|---|---|---|
| W3-GL | 03:35–03:52 | **Tier-1 GL smoke** — pipeline green end-to-end ($4.16, 112 calls), F23 persist+fetch PROVEN live (run `eval-3c8b53d1…`, 5.6MB bundle recovered by id). Gate ✗ ON MERIT: formAttachmentRecall 0.9603 < 0.98 — the first GL run ever scored under F20's linkage gates exposed **F28** (formRule row-slices surviving the ISO join as same-refId near-duplicates; 5 groups, 22 near-dups). Fixed + fixture-locked same session. | `wave3-gl-live.log`, `import_eval_results-GL.json`, ledger F28 |
| W3-CORE | 04:00–06:30 (client) / →~07:15 (server) | **Tier-2 CORE** — stage 4 completed all 1455+2146 rows (~131 min, slower than wave-1's ~110); conflict resolution of 1618 fields began at t=7910s and the **150-min client timer aborted mid-silence**. The abort message missed the transient regex → recovery never armed → **F29** (fixed: classifier exported+locked, run id logged at mint, recover-by-runId eval mode). The server computed on headless and **persisted the bundle** (run `eval-fc23c0df…`, found by listing Blob); recovered + scored via the new mode: **F1 0.999 · P 1.000 · numeric 1.000 · citations resolve 100% · linkage 1.00 — GREEN**. The 49.9% extras red decomposed into golden-blind content (234 real rules + 111 per-state factor tables, all SYNTH-marked + cited) → **F30** (fabrication/synthetic metric split + source-scheme synthesis prefixes). | `wave3-core-live.log`, `wave3-core-recover-score.log`, `import_eval_results-CORE.json`, `import_eval_extracted-CORE.json`, ledger F29/F30 |

Consequences: the conflict-resolution phase emits NO progress events — wave-1's "unexplained
32-min silence" (the F24? watch item) followed the same `resolving N conflicted field(s)`
marker and is now explained as expected compute. CORE wall-clock at wave-3 scale exceeds the
150-min client window; the durable result is the designed path, not an emergency.

**Wave-2 cost correction** (platform-log forensics, 2026-07-15): the wave-2 run did NOT die
with its stream — `_shared.js emit()` already swallowed write errors, so it completed
HEADLESS at 05:57:16Z with **$110.81 / 7,652 calls** (not the ~$60 recorded below) and
evaporated unpersisted (pre-F23 deploy). The bundle-loss class F23 fixed was three-for-three.

## Wave-2 attempt (IH3)

| # | Window (UTC) | Outcome | Evidence |
|---|---|---|---|
| W2-1 | 03:01–04:42 | ✗ stream death at ~97 min (row ~1310/1455 of Core Forms; Rule References complete at 2146 — F09/F10 confirmed live again). `fetch: terminated`, then 3×45s reconnect re-POSTs all `fetch failed`. **The app did NOT restart**: platform docker/status logs show no container event after the 02:46Z deploy swap; `/api/health` 200 immediately after. Transport-level death (local network blip suspected), server likely computed on headless with no persistence deployed — bundle unrecoverable (F23's exact class, 3rd occurrence). Cost ~$60+. | `wave2-core-live.log`; `import_eval_results-CORE.json` failure record; App Service LogFiles pulled 04:55Z |

Consequences: F23 (durable run results + opt-in retries + 150-min default) built and staged for wave 3;
tiered-validation directive adopted (full CORE = final Phase W gate only, detached, F23 armed).

## Wave-1 attempts (IH2)

| # | Window (UTC) | Outcome | Evidence |
|---|---|---|---|
| 1 | ~21:50–22:35 | ✗ client abort at the 45-min default `IMPORT_EVAL_TIMEOUT_MS` while the server was mid-stage-4. Also showed a REAL ~32-min progress silence after `Core Rate Tables … resolving 1 conflicted field(s)` (heartbeats flowing, no stage events) — single occurrence, unexplained; watch for recurrence. | `wave1-core-live-attempt1-aborted45min.log` |
| 2 | 23:14–00:00 | ✗ severed by an **unprompted App Service restart** at 00:00:28Z (no push happened; platform event). Client stall-watchdog correctly classified it as transient. | `wave1-core-live.log` (Node file-buffering delayed tail lines); `az webapp log tail` container events |
| 2-retry | 00:02–01:55 | Server run **COMPLETED** — `[import-brain] run spend: $70.0287 across 461 call(s)` incl. 74 sonnet-5 calls (ladder's sonnet rung is provisioned now). But the client had already aborted at its 100-min timer (run needed ~113 min) — the bundle was emitted to a dead socket and is unrecoverable (ledger F23). | App Service log 01:55:24Z |
| 3 | 02:05–02:5x | Auto-spawned by the eval's 3× retry — guaranteed to fail (timeout < runtime). Client killed manually; the orphaned server run was terminated early by the wave-2 deploy restart. | this file |

Costs: ~2.3 full CORE extractions of spend (~$150–190), telemetry intact throughout (no-cap ≠ no-telemetry).
Lessons ledgered as **F23**; the wave-2 live gate run uses `IMPORT_EVAL_TIMEOUT_MS=9000000` (150 min).
Stage-4 pacing observed on wave-1 code: `Rule References` (1895 gathered rows, capped grid) ≈ 95 AI batches ≈ 20 min; conflict resolution 411 fields ≈ 7 min; total run ≈ 110 min.
