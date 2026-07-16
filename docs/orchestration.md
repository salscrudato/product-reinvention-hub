# Orchestration — CE golden-factory / eval-v2 program

One row per lane. Lanes work in isolated worktrees (`.claude/worktrees/<lane>`), never in
another lane's tree; CE5 merges locally and reconciles shared files (ledger.json, this file).

| lane | branch | worktree | owns | status |
|---|---|---|---|---|
| ce2 | ce/ce2-goldens | .claude/worktrees/ce2-goldens | golden2 schema + cell-enum + dual-family annotation factory + eval-v2 + mutation fuzz + expected-RED baseline; seals HOLDOUT2 | INFRA DONE (33 locks green, gate green); annotation run + baseline in progress |
| ce3 | ce/ce3-brain | .claude/worktrees/ce3-brain | brain rewire: census into the run, workbook digest, windowed extraction + cache, sweeper 4.5, mapper items 14/15, link ladder (item 4), checkpoint/resume (item 10), observatory API, WORKBOOK_DIGEST fleet role | IN PROGRESS (base = local main after ce1+ce2 merges) |

## CE2 interfaces other lanes consume

- `scripts/lib/golden2-schema.mts` — the pinned GOLDEN2 contract (CE3/CE5 build against it).
- `samples/goldens2/*.golden2.json` — cell-level truth goldens (CE3 fixes reds against these).
- `samples/goldens2/HOLDOUT2.manifest.json` — two sealed blind holdouts (never annotate/tune on).
- `scripts/import-eval2.mts` + `scripts/lib/import-eval2-metrics.mts` — the gated eval-v2 board.
- `docs/import-census/CENSUS_INTERFACE.md` — the CE1-census JSON shape eval2 reconciles against.
- `docs/import-census/BASELINE_EVAL2.md` — the expected-RED baseline (CE3's work order).
