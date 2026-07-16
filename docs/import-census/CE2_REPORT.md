# CE2 report — the golden factory and eval-v2 (expected-red baseline)

Lane `ce/ce2-goldens`. Deliverable: make it impossible for a green board to hide data loss.
The v1 board is all-green on template-shaped goldens graded by the same parser that produced
them (TEST_MAP §4 confession, gap #3). CE2 replaces that with **cell-level truth** annotated by
two independent model families and a set of **deterministic counting-invariant floors** that need
no model at all — then an eval-v2 board whose first run against the current pipeline is RED.

## 1. What shipped (all gate-green, zero runtime code)

| artifact | what it is |
|---|---|
| `scripts/lib/golden2-schema.mts` | the pinned GOLDEN2 contract (CE3/CE5 build against it): dispositions, kinds, noiseRules, edges, validators, numeric canonicalization, A1 helpers, the 6 pure mutation transforms |
| `scripts/lib/cell-enum.mts` | CE2's own ExcelJS enumerator: sparse merge-anchored non-empty enumeration (hidden sheets INCLUDED), `buildWindows`, `sheetDigest`, deterministic `classifySheet`, `distinctRefIds`/`distinctFormTokens` floors |
| `scripts/lib/import-eval2-metrics.mts` | PURE gated metrics: accounting, entity recall, numeric fidelity, citation resolve, floor-based fabrication, linkage, counting invariants, needsReview band, census reconcile |
| `scripts/annotate-goldens.mts` | the dual-family factory (see §2) |
| `scripts/import-eval2.mts` | eval-v2 board + `--mutate` fixture generation + `--review-queue` |
| `tests/eval/import-eval2-metrics.test.ts` | 33 locks incl. the anti-leakage grep |
| `samples/goldens2/HOLDOUT2.manifest.json` | two sealed blind holdouts |
| `docs/import-census/CENSUS_INTERFACE.md` | the CE1-census JSON shape eval2 reconciles against |
| `docs/import-census/BASELINE_EVAL2.md` | the expected-RED baseline (CE3's work order) |

## 2. The factory (annotate-goldens.mts)

Per file → deterministic sheet disposition for NOISE/SCHEMA/LOG sheets (TOC, revision/version
history, definitions, data-validation, contacts, dropdowns, archives — no model) → substance
sheets are windowed at **24×14 (≤336 cells)** so both families emit a COMPLETE annotation within
token limits (a 40×40 dense window is ~1370 cells and truncates the model output to empty).

Each window: **Annotator A = GROUNDED_CITED (claude-opus-4-8)** and **Annotator B = VISION
(gpt-5.1)** annotate the SAME window + digest + glossary INDEPENDENTLY, under a compact ref-list
contract. Deterministic reconcile on DISPOSITION (the accounting-critical label); kind is
reconciled but never blocks. A genuine disposition conflict or a one-family cell goes to
**DEEP_REASONER (gpt-5.4-pro)** which returns only what it can ground in the raw window, else
`none` → the human review queue. No family disagreement is ever auto-resolved. Every accepted
citation is byte-verified locally, and the ambiguous ones by a **BULK_VERIFY (claude-haiku-4-5)**
swarm; a failed resolve rejects the entity to the queue.

Model ids route through the fleet registry (`@pf/shared`) only. Spend is metered through
`FLEET_PRICING` and HARD-STOPPED at 250 USD (ledger-note BLOCKED). Per-window checkpoints under
`samples/goldens2/.progress/` make the run idempotent and resumable; a window where one family
returned empty (a Foundry-overload 200) is skipped WITHOUT a checkpoint so a resume re-attempts it
— a dual-family golden is never manufactured from a single family.

## 3. Coverage strategy — NO SILENT CAPS

Full dual-family annotation of all ~243k non-empty cells across the 8 files would exceed the 250
USD hard stop, so coverage is TIERED and every bound is recorded in the golden and here:

- **Full** (every substance window annotated): `client-master`, `gl-base`, `gl-2026-example`,
  `hagerty-co-enthusiast` — small/medium files where full coverage is affordable. `entityRecall`
  is gated only on these.
- **Sampled** (`coverage:"sampled"`, `sampledWindows/totalWindows` recorded): `pcm-coverages`,
  `secura-property`, `all-lines-master`, `hagerty-co-rv125` — the giant masters. First window of
  every sheet (structure) + a stratified stride sample. Their goldens carry `coverage:"sampled"`;
  eval2 does NOT treat their entity list as exhaustive. Their anti-loss gate is the
  **deterministic counting-invariant floor** (distinct refId / form-token cardinality computed from
  ALL cells, no model), which is exact regardless of how many windows were annotated.

<!-- FILL: per-file agreement rate, windows annotated/total, spend, queue size (from the run) -->

## 4. Baseline (expected RED)

Full numbers in `BASELINE_EVAL2.md`. The offline deterministic path (`mapIsoWorkbook`) already
loses data the counting-invariant floors catch — e.g. SECURA extracts **0 forms** despite hundreds
of form cells across "Property Forms Usage" + the hidden "Forms View - MTG"; GL-base extracts 0
forms and 0 rules. `client-master` scores substanceCoverage 0.0%, entityRecall 0.0, and two
counting-invariant violations (product 1<3, form 0<13). This RED is the deliverable.

## 5. Hostile self-review

<!-- FILL from the ce2-hostile-review workflow synthesis -->

## 6. What CE3 / CE5 must consume

- CE3 fixes the reds against `samples/goldens2/*.golden2.json` (the truth) and the
  `BASELINE_EVAL2.md` work order; re-run `pnpm exec tsx scripts/import-eval2.mts --offline`.
- CE5 merges lanes locally and reconciles the shared files (`docs/import-census/ledger.json`,
  `docs/orchestration.md`), then runs `--census <ce1-census.json>` so eval2's `reconcileCensus`
  proves CE1 and CE2 agree on nonEmpty per sheet before trusting any coverage number.
- The two HOLDOUT2 workbooks stay sealed — a "green means right" claim is only credible if it holds
  on a workbook the factory never saw.
