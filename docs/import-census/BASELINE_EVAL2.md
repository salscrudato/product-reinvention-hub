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

<!-- FILL: the per-golden eval2 table from `pnpm exec tsx scripts/import-eval2.mts --offline` -->

| golden | coverage | substanceCov | unaccEnt | entityRecall | countingInvariants | one-line cause |
|---|---|---|---|---|---|---|
| _(filled by the baseline run)_ | | | | | | |

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

`gl-2026-example` transformed six ways with computed golden transforms; scored offline. See
`docs/audit/import_eval2_results.json` (rows with `__<mutation>` ids).

<!-- FILL: mutation fuzz per-transform result line -->

## Bottom line

A green eval1 board hid all of the above. eval2 turns each into a blocking red with a named cause —
CE3's work order. Fixing them is not "make the board green"; it is "make the extraction lossless,"
which the counting-invariant floors verify without a single model call.
