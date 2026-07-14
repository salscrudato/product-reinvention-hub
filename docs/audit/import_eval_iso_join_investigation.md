# CORE eval F1 0.907 — iso-join root-cause investigation (2026-07-14, EM session)

## The failure is NOT extraction noise

The 07:21 AM CORE live run (F1 0.9068) had entityRecall **1.0**, numeric **1.0**, citations **1.0**.
Every lost point comes from a systematic pattern:

- all 112 coverages missing exactly `requirement` / `claimsBasis` / `premiumGenerating` / `source`
- 137 entities missing `allStates`
- product kept brain values (`name` = filename, `status` = DRAFT) instead of mapper values ("Core", ACTIVE)

These are precisely the fields the deterministic ISO-mapper join supplies
(`stage7-plan.js` `joinGroupWithIso` identity-adopt + gap-fill). The bundle shows **zero trace of
iso influence** → `opts.isoPlan` was falsy in `buildImportPlan` for the full CORE workbook.
(The fields that DID match — status/lifecycle/reviewStatus/reviewer/formNumbers on children —
come from `stampDefaults`, which runs before the join; they prove nothing about the join.)

## Eliminated (all verified, don't re-check)

| Theory | Verdict | Evidence |
|---|---|---|
| Mapper can't parse CORE | ✗ | local `mapIsoWorkbook` on all 25 sheets → 1 product, 112 covs, 234 rules, 1359 forms, `requirement=MANDATORY`, `status=ACTIVE` |
| Raw ExcelJS cell values (server passes unflattened) | ✗ | repro with raw `cell.value` grids → identical output |
| Hidden-sheet ordering (server puts hidden last) | ✗ | server-exact isoGrids construction → identical output |
| Stale bridge | ✗ | `git hash-object server/lib/import-brain-shared.cjs` == HEAD == origin/main (236ab774…) |
| Deployment drift | ✗ | origin/main == merge-base; import-brain files identical; pipeline copies `server/lib` verbatim |
| ExcelJS version drift | ✗ | 4.4.0 in root, app, server, server/node_modules |
| Memory pressure | ✗ | plan is P1v3 (8 GB); MemoryWorkingSet peaked ~350 MB during the failing window |
| Node 20 vs 24 | ✗ | repro under portable Node v20.19.0 → identical output; bridge has no post-Node-20 APIs |
| Deployed endpoint join broken | ✗ | live probe (framework-sheet-only trimmed CORE, tenant iso-probe) → `brain:stage7:isoJoin — 112 coverages, 0 rules`, cov[0] `consensus=iso-join, requirement=MANDATORY, status=ACTIVE`, 7 min, $0.62 |

## Still open

The failure reproduces ONLY with the full 25-sheet workbook against the live server. Either
`mapIsoWorkbook(isoGrids)` throws server-side on a sheet combination not covered by the
framework-only probe (the catch in `unified-import.js:159` converts it to an SSE notice), or it
returns a shape without `coverages`. A sheet-bisection probe (framework + rules sheets) is in
flight; result will be appended here.

**The notice text is the answer** — and the old eval client discarded all notices.

## Harness upgrades (scripts/import-eval.mts, this session)

- live runs now log every server `tool` stage event + `notice` (timestamped) and persist notices
  into the results JSON → the skip reason can never be lost again
- extraction dumps (`docs/audit/import_eval_extracted-<ID>.json`) are always written
- new `--rescore` mode: re-score the last dump against golden offline in seconds
  (`npx tsx scripts/import-eval.mts --rescore`, respects `IMPORT_EVAL_ONLY`)

**Any CORE rerun must use the new script** (a run started before the edit runs the old in-memory
code and stays blind). One instrumented CORE live run will print the isoJoin summary or the
mapper-skip notice at ~minute 90 and settle this conclusively.

## Scoring artifact (separate, small)

Golden fields whose value canonicalizes to null (e.g. coverage `claimsBasis: ""`, product
`description: ""`) still count as misses when the extracted entity omits the field entirely
(`ev !== undefined` gate in `score()`). ~113 of the 589 CORE misses are this artifact, worth
~0.015 F1. Decide deliberately whether "golden has no expectation" should skip the field —
it changes metric comparability across runs.

## New data point — the skip is INTERMITTENT (import-brain session, 16:06Z rerun)

A full 25-sheet CORE live rerun (tenant `accenture-test`, finished 16:06:48Z, 5690 s) scored
**F1 0.967 / numeric 1.000 / citations 100% (14,744 rows) / entityRecall 1.000 — PASS**, and its
`missByField` collapsed to exactly one entry: **`allStates` ×137, all on RULES**. The 112-coverage
`requirement`/`claimsBasis`/`premiumGenerating`/`source` misses and the product-identity misses
are GONE → the iso-join *fired for coverages* in this run.

No server code changed between the 07:21 failing run and this one — the two intervening deploys
were docs/tools (`e42de2e`) and a client-only notices fix (`aa4aa60`). Same bits: 07:21 no join,
16:06 join. So the full-workbook `isoPlan` falsy condition is **intermittent** (load/timing/
resource-dependent), not deterministic per workbook. Caveat: this rerun raced the watchdog-only
harness edit, so notices/stage lines weren't captured — the instrumented harness is still the
right tool for catching the skip reason live when it recurs.

Residual, now precisely scoped: the join contributes **0 rules** even when it fires (matches the
live probe's `112 coverages, 0 rules`), leaving golden `allStates: true` unmet on all 137 rules
(≈0.033 F1). That is a stage-7 rules-join gap-fill gap, separable from the intermittent skip.
Diagnostics: `docs/audit/import_eval_results-CORE.json` (runAt 2026-07-14T16:06:48Z).

> Correction (EM session): the "0 rules" reading is an artifact of probe #1, which kept ONLY the
> framework sheet — no rules sheets were uploaded, so 0 mapper rules was expected. Probe #2
> (framework + Core Rules Specifications + Rule References, 16:29Z) shows the deployed server
> emitting `brain:stage7:isoJoin — deterministic mapper: 112 coverages, 234 rules` and a bundle
> with 468 rules. The rules join path works; the rule VALUES were the problem — see below.

## ROOT CAUSE FOUND, FIXED, VERIFIED (EM session, 2026-07-14 ~12:45)

`server/lib/import-brain/workbook.js` fed **raw ExcelJS cell values** (formula `{result}` objects,
richText) into `isoGrids`, violating the mapper's `IsoCell` scalar contract. `buildStructuralModel`
normalizes internally (so the AI brain never saw the problem), but `mapIsoWorkbook` got the raw
objects. Its state-scope X-marker tests fail on object cells → rules fall back to sparse per-state
columns → wrong `allStates`/`states`.

Reproduced deterministically (same file, same mapper bridge):

| input grids | rules allStates | coverages allStates |
|---|---|---|
| RAW cell.value (server path, pre-fix) | true=18 / false=216 | true=52 / false=60 |
| FLATTENED (eval golden path) | **true=155 / false=79** | true=52 / false=60 |

Delta = **137 rules — exactly the 137 `allStates` misses** (the only misses) in the 16:06Z passing
run. Each also scores as an FP, so the fix removes 274 error units → projected F1 ≈ 0.999.

**Fix:** `workbook.js` now maps every cell through `brainShared.normalizeCellValue(...)` when
building grids (idempotent for `buildStructuralModel`, which re-normalizes scalars). Verified
end-to-end: buffer → patched `readWorkbookToStructural` → `mapIsoWorkbook` reproduces the golden
profile exactly (`rules true=155 false=79`, `cov[0] requirement=MANDATORY status=ACTIVE`).
`pnpm typecheck` green. Repro/verify harnesses: session scratchpad `check-allstates.cjs`,
`verify-workbook-fix.cjs`.

This may also explain the 07:21Z "no join at all" run: object-typed cells make the mapper's
sheet-recognition/scope heuristics data-dependent in ways scalar grids are not (the intermittency
observation above still stands for that run — the instrumented harness will catch the notice if a
full skip ever recurs post-fix).

**Ship path:** the fix must deploy (push to main → ADO auto-deploy) before the next `--live` CORE
run can confirm; `--rescore` cannot validate it (server-side change).

## Brain wall-clock: where the minutes go + ranked speed-ups (EM session, 2026-07-14 ~12:50)

Profile of the runs so far: CORE full = 95 min / 647 calls / $70; forms-library GL (in flight
12:07 PM) is dominated by one sheet — **Forms Library: 611 rows × 312 columns**. Wide matrices hurt
three ways: stage 3 maps columns in SEQUENTIAL batches of 24 (13 round-trips × 2 models), stage-4
prompts embed full-width rows (~20k tokens per 20-row batch), and stage 5 re-validates it all.

Foundry capacity is NOT the constraint (verified via az): claude-haiku-4-5 2000K TPM,
gpt-5-mini 14666K, claude-opus-4-8 / claude-sonnet-5 1000K each. Peak brain concurrency today is
~12 calls (2 sheets × 3 batches × 2 models) — a small fraction of quota.

Ranked (impact × effort):
1. **State-matrix pre-fold (biggest, forms/rules sheets):** detect the 50-state column block
   (the deterministic mapper already does — `stateColIndices` / `allStatesColIndex` in the bridge)
   and fold it into `states[]`/`allStates` BEFORE stage-3/4 prompting. Cuts prompt width ~6× on
   312-col sheets and makes the deterministic fast path reachable for them.
2. **Concurrency bumps:** stage-4 `pMap(contentSheets, …, 2)` → 4 and per-sheet batches 3 → 6;
   stage-3 column batches currently sequential per sheet → parallelize. ~2-3× wall-clock on big
   workbooks, well inside quota.
3. **Cell-budgeted batches:** BATCH_ROWS is a flat 20 regardless of width. Budget by CELLS
   (target ~5k cells/batch): narrow sheets get 100+-row batches (fewer calls), wide sheets stay
   small (no truncation risk against the 8192 output cap).
4. **Iterate on trimmed inputs:** `node scripts/trim-workbook.mjs in.xlsx out.xlsx --rows 60
   [--sheets "A|B"]` (new) builds row-capped copies — same code paths, ~1/10 time/spend. Full
   files only for final confirmation. Probe pattern: scratchpad `probe-any.mjs` (import-brain
   session) / `probe-live-iso.mjs` (EM session).
5. **`--rescore`** for all scoring/canonicalization iteration (already landed in import-eval.mts).

Items 1-3 change the system under test — land them as measured changes using the stage-timing
profile probe-any.mjs already emits, not mid-iteration.

Measured confirmation (forms-library GL run, finished 12:45 PM, 38.2 min, $28.29, 166 calls,
0 errors): stage0 16s · stage1 7s · stage2 3s · stage3 39s · **stage4 2059s (90% of wall-clock)**
· stage5 168s · stage6 0s. Stage 4 is the only target worth optimizing; the concurrency bump
alone (~3×) would have made this a ~13-minute run.
