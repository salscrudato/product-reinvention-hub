# IH operating notes (advisory; the eval is law; hard cap 40 lines)

Created by IH2, 2026-07-14. Updated by IH3 (self-tune). Prune stale lines every self-tune.

## Standing (from IH1/IH2 + orchestration; each also exists as a fixture or gate)
- Gate the exact sha you push: `node tools/verify-commit.mjs` (shared dirty tree lies).
- Before EVERY commit: `node tools/stowaway-check.mjs <files…>`; commit with `git commit --only -m "…" -- <files>` (flags BEFORE the `--`).
- Touch server-consumed `shared/src/**` → rebuild + commit the bundle (`build:import-brain` / `build:filing`; BOTH when a file feeds both).
- F19/PCM-C are DISPROVEN — version WRITES work; never "fix" the write path.
- Live tests only in isolated tenants (accenture-test); never testco; tear down drafts.
- brain-routing.test.ts mocks server/lib/fleet — new fleet exports must be added to the mock.
- vi.mock does NOT intercept lazy CJS requires (filing-shared.cjs) — rebuild the bundle or you test stale code.
- Judges: synchronous, fresh-context, corpus-probe mandate; give them the mint-site/consumer SWEEP explicitly (F25/F26 were judge side-findings).
- docs/audit/import_eval_results*.json + fidelity artifacts churn on every local run — commit only at wave tips with the diff explained; else `git checkout --`.
- Goldens move ONLY in lockstep with the parse, as separate explained commits; regen surfaces UNRELATED drift (stale valueHeader/ldTableRefText in GL/IM) — leave it; tightening is a wave-boundary decision. Cross-era rescores (old dump vs new golden) false-miss.

## Generalization amendment (user directive, 2026-07-14 — BINDING)
- TWO-FIXTURE RULE: every production fix needs the original red fixture PLUS one structurally
  different fixture passing for the same reason; otherwise presumed overfit.
- Judge question 6 (every hostile review): "Does this diff encode knowledge of the fixture,
  or knowledge of the document structure and insurance meaning?"
- Generic pipeline code never branches on fixture/carrier/workbook filenames, exact sheet
  names, exact row counts, exact expected values, or a single exact header string. Format
  specializations only behind an adapter/registry seam with predicate, provenance, fallback, non-match test.
- Prefer honest unresolved over unsupported canonical values; Phase G runs after W/P/M:
  G0 baseline → G1 assumption audit → G2 frozen holdout (HOLDOUT_SHA) → G3 no-edit baseline →
  G4 clusters → G5 fix loop → blind challenge. Final status: PROVEN / PARTIALLY_PROVEN / NOT_PROVEN / PARKED.

## Tiered validation (user directive, 2026-07-15 — the full CORE run is the final gate, not the loop)
- Tier 0 (free, offline): `pnpm import:eval` (parse-stability) / `--rescore`. ALL scoring/golden work.
- Tier 1 (cheap, live): `IMPORT_EVAL_ONLY=GL --live` — live smoke for import-path/F23 changes.
- Tier 2 (~$70/110min): full `--live` CORE, ONCE, as the FINAL Phase W gate, detached, F23 run-id
  recovery armed, IMPORT_EVAL_MAX_ATTEMPTS=1. Overlap its wall-clock with push-free offline work;
  watch via `az webapp log tail` (local detached log lags ~64KB). Only the PUSH is barred mid-run.
- Log the tier used in each ledger evidence line. A full-run retry is a bill, not a recovery (F23).
