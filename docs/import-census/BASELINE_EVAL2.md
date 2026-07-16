# Import eval-v2 baseline — the honest BEFORE photo (expected RED)

This is the deliverable, not a failure. eval1 is all-green because it grades the deterministic
plan against goldens the SAME parser produced (parse stability on template-shaped goldens —
`docs/baseline/EVAL_BASELINE.md`, TEST_MAP §4 confession, gap #3). eval-v2 grades the plan against
CELL-LEVEL dual-family truth plus deterministic counting-invariant floors. Its first run against
the CURRENT deterministic pipeline is RED, and every red is a real place data is lost.

- Date: 2026-07-16 · Lineage: `ce/ce2-goldens` off `0ad8689`
- Command: `pnpm exec tsx scripts/import-eval2.mts --offline`
- Mode: OFFLINE deterministic path (`mapIsoWorkbook`) — no model spend, no network. Accounting uses
  the value-presence proxy (a source cell is accounted iff its numeric-canonicalized value survives
  into the plan); LIVE mode would use exact provenance loci.
- Results dump: `docs/audit/import_eval2_results.json`

## eval1 (all green — parse stability) vs eval2 (RED — data loss)

The eval1 board for reference (from `docs/baseline/EVAL_BASELINE.md`):

| LOB | F1 | numeric | extras | parent-edge | form-attach |
|---|---|---|---|---|---|
| GL / IM / PR / CORE | 1.0000 | 1.0000 | 0 | 1.000 | 1.000 |

All green. It cannot see a cell that never left the workbook.

## eval2 board (expected RED)

Thresholds (blocking): unaccountedEntityCells == 0 · substanceCoverage ≥ 0.985 · goldenEntityRecall
≥ 0.98 (full-coverage files) · goldenNumericFidelity == 1.00 · citationResolve == 1.00 (live) ·
fabrication ≤ 0.00 offline / 0.02 live · parentResolutionRate == 1.00 · ldTableRefResolutionRate ≥
0.95 · countingInvariants == 0 violations · needsReviewRate ≤ 0.10 (band).

Run 2026-07-16, all 8 goldens, `--offline` (`docs/audit/import_eval2_results.json`). **8/8 RED.**

| golden | cov | substanceCov | unaccEnt | hierarchyRecall | golden-complete | counting-floor violations |
|---|---|---|---|---|---|---|
| SECURA_Property | sampled | 15% | 564 | **0%** (0/83) | 24%¹ | product 1<12, **form 0<759**, refIds 0<104 |
| All_Lines_Master | sampled | 16% | 503 | **0%** (0/127) | 9%¹ | product 1<10, form 0<259, **refIds 1608<2532** |
| GL_2026_Example | full | 34% | 412 | **0%** (0/78) | 100% | product 1<6, coverage 124<152, form 0<30 |
| CO_RV125_Rating | sampled | 0% | 384 | 0% (0/1) | 13%¹ | product 0<1, coverage 0<29, form 0<32 |
| PCM_Coverages | sampled | 45% | 317 | n/a | 21%¹ | product 1<2, coverage 1<78, form 0<36 |
| CO_EnthusiastPlus | full | 0% | 163 | n/a | 100% | **coverage 0<71** |
| GL (base) | full | 9% | 59 | 16% (15/94) | 100% | coverage 105<106, form 0<29, refIds 18<22 |
| Client_Master | full | 0% | 10 | n/a | 100% | product 1<4, coverage 0<3, form 0<13 |

Every row also fails `numericFidelity` (0.000 — the numeric attributes the golden binds to entities do
not survive onto them) and the zero-tolerance `unaccountedEntityCells == 0` gate. Fabrication is 0%
across the board (source ids checked against the deterministic whole-workbook refId set, so a real id
is never mis-flagged). ¹ Sampled goldens annotate a stratified subset of windows, so their
golden-completeness is over the sampled scope, not a golden defect; the deterministic counting floors
are computed from ALL cells regardless.

### The three headline losses eval1 could not see

1. **Forms are dropped wholesale.** SECURA extracts 0 of 759 distinct form tokens; All_Lines 0 of 259;
   GL 0 of 29/30. The form column / hidden "Forms View - MTG" sheet never becomes form entities.
2. **The hierarchy is flattened.** 0 of 127 (All_Lines) / 78 (GL_2026) / 83 (SECURA) golden
   parent-edges reproduced; GL base only 15 of 94. Sub-coverages are promoted to top-level — the
   governed Product > Coverage > Sub-Coverage tree is lost. `linkage2` alone was blind to this
   (it only catches a dangling parentId, never a missing one); `hierarchyRecall` catches it.
3. **Bulk refId loss.** All_Lines extracts 1608 of 2532 distinct source refIds — 924 governed ids
   gone. CO_EnthusiastPlus / CO_RV125 extract 0 coverages from carrier config workbooks entirely.

## Known per-file red causes (from the offline mapper, measured pre-baseline)

Measured directly by running `mapIsoWorkbook` on the reference masters (2026-07-16):

- **SECURA_Property** — extracts prod 1 / cov 435 / **forms 0** / rules 0, despite hundreds of form
  cells across "Property Forms Usage" (340 rows) + the HIDDEN "Forms View - MTG" (356 rows / 2,072
  cells). → `countingInvariants` form floor violated; those form cells are unaccounted.
- **GL-base** — prod 1 / cov 105 / **forms 0** / **rules 0**. The framework sheet's form and rule
  columns never become entities.
- **All_Lines_Master** — prod 1 / cov 603 / forms 240 / rules 1608 / ld 0 — richer, but ROC (24,687
  cells), Coverage Summary, and Sheet1 are unrouted → unaccounted substance.
- **client-master** (validated end-to-end) — substanceCoverage 0.0%, entityRecall 0.0, counting
  violations product 1<3 and form 0<13.

## Mutation fuzz (generalization, exact expected goldens)

`gl-2026-example` transformed six ways with computed golden transforms (`--mutate`); scored offline
against each transform's EXACT expected golden. All six — reorder-sheets, synonym-headers,
inject-blank-rows, split-table, hide-sheet, dash-refids — score identically to the base (cov 34.1%,
hier 0/78). Reading: the deterministic mapper is ROBUST to these benign layout transforms (it reads
hidden sheets, tolerates blank rows and reordered/renamed columns), so the mutations create no NEW
loss — but its structural baseline losses (forms 0<30, hierarchy 0/78) persist regardless, which is
the point: benign generalization is fine; the losses are in what the mapper extracts, not how the
source is arranged. (During development the identical fixtures on `gl-base` surfaced a real
byte-faithfulness sensitivity — `dash-refids` degraded gl-base cov 8.8%→3.7% — confirming the fuzz
CAN detect a mutation-induced regression when one exists.)

## Bottom line

A green eval1 board hid all of the above. eval2 turns each into a blocking red with a named cause —
CE3's work order. Fixing them is not "make the board green"; it is "make the extraction lossless,"
which the counting-invariant floors verify without a single model call.
