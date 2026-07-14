# IH operating notes (advisory; the eval is law; hard cap 40 lines)

Created by IH2, 2026-07-14. Prune stale lines every self-tune.

## Standing (from IH1 + orchestration; each also exists as a fixture or gate)
- Gate the exact sha you push: `node tools/verify-commit.mjs` (shared dirty tree lies).
- Before EVERY commit: `node tools/stowaway-check.mjs <files…>`; commit with `git commit --only -- <files>`.
- Touch server-consumed `shared/src/**` → rebuild + commit `server/lib/*-shared.cjs` (`pnpm build:import-brain` etc.).
- F19/PCM-C are DISPROVEN — version WRITES work; never "fix" the write path. Gap is read-side (PCM-B).
- Detached live runs: PowerShell Start-Process on CRLF/ASCII .cmd (Set-Content -Encoding Ascii); tee to log; never pipe a probe to head.
- Live tests only in isolated tenants (accenture-test); never testco; tear down drafts.
- `--rescore` re-scores the last extraction dump offline in seconds; server-side changes need fresh `--live`.
- brain-routing.test.ts mocks server/lib/fleet — new fleet exports must be added to the mock.
- Node 24 env artifacts: sources.test.ts resolveImageUrl + isoFixture snapshot churn are NOT regressions (verify via clean-tree stash).

## Generalization amendment (user directive, 2026-07-14 — BINDING)
- TWO-FIXTURE RULE: every production fix needs the original red fixture PLUS one structurally
  different fixture passing for the same reason; otherwise presumed overfit.
- Judge question 6 (every hostile review): "Does this diff encode knowledge of the fixture,
  or knowledge of the document structure and insurance meaning?"
- Generic pipeline code must never branch on fixture/carrier/workbook filenames, exact sheet
  names, exact row counts, exact expected values, one carrier/form-family, or a single exact
  header string. Format specializations only behind an adapter/registry seam with a match
  predicate, provenance, generic fallback, and a non-match test.
- Prefer honest unresolved over unsupported canonical values; novel source fields must survive
  even without a canonical destination. Origin taxonomy target: EXPLICIT / NORMALIZED /
  DERIVED / DEFAULTED / SYNTHESIZED / MODEL_INFERRED.
- Phase G (Generalization) runs AFTER W/P/M gates: G0 baseline → G1 assumption audit →
  G2 frozen holdout suite (HOLDOUT_SHA) → G3 no-edit baseline → G4 failure clustering →
  G5 fix loop → blind challenge. Final status vocabulary: PROVEN / PARTIALLY_PROVEN /
  NOT_PROVEN / PARKED — never stronger than the evidence.

## Learned this run (IH2)
- (none yet)
