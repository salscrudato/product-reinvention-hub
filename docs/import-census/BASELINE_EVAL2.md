# Import eval-v2 baseline — the honest BEFORE photo (expected RED)

This is the deliverable, not a failure. eval1 is all-green because it grades the deterministic
plan against goldens the SAME parser produced (parse stability on template-shaped goldens —
`docs/baseline/EVAL_BASELINE.md`, TEST_MAP §4 confession, gap #3). eval-v2 grades the plan against
CELL-LEVEL dual-family truth plus deterministic counting-invariant floors. Its run against the
CURRENT deterministic pipeline is RED, and every red is a real place data is lost.

- **Re-baselined: 2026-07-26** · `main` at `7b1fd1d` · supersedes the 2026-07-16 board below
- Command: `pnpm exec tsx scripts/import-eval2.mts --offline`
- Mode: OFFLINE deterministic path (`mapIsoWorkbook`) — no model spend, no network. Accounting uses
  the value-presence proxy (a source cell is accounted iff its numeric-canonicalized value survives
  into the plan); LIVE mode would use exact provenance loci.
- Results dump: `docs/audit/import_eval2_results.json`

## eval2 board — 2026-07-26 (8/8 RED)

Thresholds (blocking): unaccountedEntityCells == 0 · substanceCoverage ≥ 0.985 · goldenEntityRecall
≥ 0.98 (full-coverage files) · goldenNumericFidelity == 1.00 · citationResolve == 1.00 (live) ·
fabrication ≤ 0.00 offline / 0.02 live · parentResolutionRate == 1.00 · ldTableRefResolutionRate ≥
0.95 · countingInvariants == 0 violations · needsReviewRate ≤ 0.10 (band).

| golden | cov | substanceCov | unaccEnt | entityRecall | hierarchyRecall | tables / refs | counting-floor violations | golden-complete |
|---|---|---|---|---|---|---|---|---|
| All_Lines_Master | sampled | 15.6% | 503 | 0.530 | **0%** (0/127) | 0 / 0 | product 1<10, **form 0<259**, refIds 1608<2532 | 9%¹ |
| Client_Master | full | 33.3% | 1 | 0.429 | n/a | 1 / **0** | none | 100% |
| GL_2026_Example | full | 51.5% | 68 | 0.691 | **0%** (0/78) | 0 / 0 | none | 100% |
| GL (base) | full | 9.4% | 22 | 0.831 | 16% (15/94) | 0 / 0 | none | 100% |
| CO_EnthusiastPlus | full | 46.3% | 64 | 0.547 | n/a | 17 / **0** | none | 100% |
| CO_RV125_Rating | sampled | 26.3% | 284 | 0.271 | 0% (0/1) | 44 / **0** | none | 13%¹ |
| PCM_Coverages | sampled | 66.0% | 201 | 0.118 | n/a | 7 / **0** | none | 21%¹ |
| SECURA_Property | sampled | 61.7% | 77 | 0.917 | **0%** (0/83) | 5 / **0** | none | 24%¹ |

Every row also fails `numericFidelity` (0.000) and the zero-tolerance `unaccountedEntityCells == 0`
gate. Fabrication is 0% across the board. ¹ Sampled goldens annotate a stratified subset of
windows, so their golden-completeness is over the sampled scope, not a golden defect; the
deterministic counting floors are computed from ALL cells regardless.

### What moved since 2026-07-16, and what did not

The 24–26 July fix wave was never re-scored until now. It moved real ground:

| golden | substanceCov 07-16 → 07-26 | unaccEnt 07-16 → 07-26 |
|---|---|---|
| SECURA_Property | 15% → **61.7%** | 564 → **77** |
| PCM_Coverages | 45% → **66.0%** | 317 → **201** |
| GL_2026_Example | 34% → **51.5%** | 412 → **68** |
| CO_EnthusiastPlus | 0% → **46.3%** | 163 → **64** |
| Client_Master | 0% → **33.3%** | 10 → **1** |
| CO_RV125_Rating | 0% → **26.3%** | 384 → **284** |
| All_Lines_Master | 16% → 15.6% | 503 → 503 |
| GL (base) | 9% → 9.4% | 59 → **22** |

The wholesale form-drop is largely closed: the 07-16 board carried `form 0<759` (SECURA),
`form 0<30` (GL_2026) and `form 0<36` (PCM) counting violations; only All_Lines still violates a
form floor. Six of eight files improved substance coverage, two materially (SECURA +47pts,
E+ +46pts). **Nothing regressed.**

What did NOT move: `numericFidelity` is still 0.000 on all eight, and hierarchy recall is still
0/127, 0/78 and 0/83. Those two are now the whole story.

### numericFidelity 0.000 is not one defect — see the verdict

`docs/review/2026-07-26-NUMERIC-FIDELITY-VERDICT.md` opens the cited workbook cell for a spread of
claims and classifies all 1218. Summary: **genuine value loss 31.0% · structural loss with bytes
conserved 36.2% · harness join defect 3.4% · unscoreable golden bindings 29.4%.** Not one claim in
the corpus matches by refId. Fixing the harness join alone moves the number 0.000 → 0.034; the
largest real defect underneath is that the fully-populated `EDITION DATE` column is extracted
nowhere, on every framework workbook.

**Do not read a future non-zero fidelity as progress without a class breakdown.**

### The table-reference gate was vacuous and is now restored

`T.ldTableRefResolutionRate = 0.95` has been in the harness since CE2
([scripts/import-eval2.mts:71](../../scripts/import-eval2.mts#L71)) but never fired once. `linkage2`
returns `null` when no entity carries an `ldTableRef`
([scripts/lib/import-eval2-metrics.mts:217](../../scripts/lib/import-eval2-metrics.mts#L217)), and
the gate read `null` as "n/a — pass". At HEAD `ldRefWithRef` is **0 on all eight goldens**, so the
threshold was decorative on every file, including ones that extract 44 tables.

Restored: when the plan HAS tables, an absent pointer set is a resolution rate of **0**, not an
exemption. It now reds 5 of 8 files (Client_Master 1 table, E+ 17, RV125 44, PCM 7, SECURA 5 — all
with zero references). Orphaned tables were previously invisible.

**It does not fire on either GL file, and that is correct, not a weakened gate.** The GL framework
workbooks state no tables to point at: `GL Product Framework!5` is
`STATUS · PRODUCT FRAMEWORK ID · PRODUCT · LINE OF BUSINESS · COVERAGE · SUB-/COVERAGE · COVERAGE
FORM(S) · FORM NUMBER(S) · EDITION DATE · CLAIMS/BASIS · COVERAGE REQUIREMENT · PREMIUM GENERATING ·
BUREAU · PROPRIETARY · ALL ACTIVE STATES` then 50 state columns — no limit, deductible or table
column anywhere. Both GL goldens declare **zero** table entities and zero edges, and the plan
extracts zero tables from them. A "GL table-reference resolution ≥ 0.95" assertion would be an
assertion about data the GL corpus does not contain; the honest gate is the one above, which fires
wherever tables actually exist. See the caveat note in the numeric-fidelity verdict.

---

## Historical: the original 2026-07-16 board

- Date: 2026-07-16 · Lineage: `ce/ce2-goldens` off `0ad8689`

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

### The three headline losses eval1 could not see (2026-07-16 reading)

1. **Forms are dropped wholesale.** SECURA extracts 0 of 759 distinct form tokens; All_Lines 0 of 259;
   GL 0 of 29/30. — *largely closed as of 2026-07-26; only All_Lines still violates a form floor.*
2. **The hierarchy is flattened.** 0 of 127 (All_Lines) / 78 (GL_2026) / 83 (SECURA) golden
   parent-edges reproduced; GL base only 15 of 94. — *unchanged as of 2026-07-26.*
3. **Bulk refId loss.** All_Lines extracts 1608 of 2532 distinct source refIds — 924 governed ids
   gone. — *unchanged as of 2026-07-26.*

## Mutation fuzz (generalization, exact expected goldens)

`gl-2026-example` transformed six ways with computed golden transforms (`--mutate`); scored offline
against each transform's EXACT expected golden. All six — reorder-sheets, synonym-headers,
inject-blank-rows, split-table, hide-sheet, dash-refids — score identically to the base. Reading:
the deterministic mapper is ROBUST to these benign layout transforms, so the mutations create no NEW
loss — but its structural baseline losses persist regardless, which is the point. (During
development the identical fixtures on `gl-base` surfaced a real byte-faithfulness sensitivity —
`dash-refids` degraded gl-base cov 8.8%→3.7% — confirming the fuzz CAN detect a mutation-induced
regression when one exists.)

## Bottom line

A green eval1 board hid all of the above. eval2 turns each into a blocking red with a named cause.
Fixing them is not "make the board green"; it is "make the extraction lossless," which the
counting-invariant floors verify without a single model call. The 07-26 re-baseline shows the fix
wave was real on accounting and forms, and did not touch fidelity or hierarchy at all.
