# Orchestration — CE golden-factory / eval-v2 program

One row per lane. Lanes work in isolated worktrees (`.claude/worktrees/<lane>`), never in
another lane's tree; CE5 merges locally and reconciles shared files (ledger.json, this file).

| lane | branch | worktree | owns | status |
|---|---|---|---|---|
| ce2 | ce/ce2-goldens | .claude/worktrees/ce2-goldens | golden2 schema + cell-enum + dual-family annotation factory + eval-v2 + mutation fuzz + expected-RED baseline; seals HOLDOUT2 | **DONE** — 35 locks + gate green; 8/8 goldens annotated ($94.09, citation-resolve 100%); 8/8 expected-RED baseline; 6 mutation fixtures; 15-finding hostile review with high-impact holes closed |
| ce3 | ce/ce3-brain | .claude/worktrees/ce3-brain | brain rewire COMPLETE: Step 0 fleet reality (xai->deepseek + WORKBOOK_DIGEST); Steps 5/14/15 mapper conservation under the single-workbook gate (the S2 "irreducible" conflict dissolved — locked sets are multi-file/CORE-sig; conserve.ts token/name/region harvests + enum-domain schema-learning; Property master rt>0/ld>0; coverageEffect @ Data Validation!E5:E9); accounted-census export; Steps 1-4 live pipeline (census+ledger into stage 0, hidden-sheet flip w/ provenance, dup-cluster fold, digest w/ bounded window tool + /responses synthesis, region windows, column continuation, FACT posting, deepseek judge tail, extraction cache, sweeper 4.5 w/ code-enforced vocabulary); Step 7 checkpoints/resume + SIGKILL kill-test green; Step 8 observatory. eval2 offline 7/8 files at ALL FOUR CE3 gates (all-lines = PROVEN value-twin of sample-PR, live-path venue); eval1 4/4 F1=1.0 ZERO regen; canaries exact. | **DONE** (CE3_REPORT.md has red-to-green table + impossibility proofs + CE5 live-run instructions); zero pushes to origin from lane |

## CE2 interfaces other lanes consume

- `scripts/lib/golden2-schema.mts` — the pinned GOLDEN2 contract (CE3/CE5 build against it).
- `samples/goldens2/*.golden2.json` — cell-level truth goldens (CE3 fixes reds against these).
- `samples/goldens2/HOLDOUT2.manifest.json` — two sealed blind holdouts (never annotate/tune on).
- `scripts/import-eval2.mts` + `scripts/lib/import-eval2-metrics.mts` — the gated eval-v2 board.
- `docs/import-census/CENSUS_INTERFACE.md` — the CE1-census JSON shape eval2 reconciles against.
- `docs/import-census/BASELINE_EVAL2.md` — the expected-RED baseline (CE3's work order).
