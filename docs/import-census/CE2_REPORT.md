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

Actual run (2026-07-16, total spend **$94.09**, all 8 files annotated, citation-resolve **100.00%**
on every accepted entity — 1391/1391):

| golden | coverage | windows | dual-family agree | adjudicated | queued | entities | spend |
|---|---|---|---|---|---|---|---|
| gl-base | full | 30/30 | **94%** | 77 | 482 | 142 | $12.64 |
| pcm-coverages | sampled | 27/181 | **91%** | 84 | 689 | 127 | $9.32 |
| hagerty-co-enthusiast | full | 24/24 | 87% | 66 | 277 | 106 | $9.90 |
| hagerty-co-rv125 | sampled | 34/404 | 82% | 64 | 1532 | 85 | $14.13 |
| secura-property | sampled | 31/167 | 82% | 158 | 1011 | 336 | $14.93 |
| gl-2026-example | full | 40/40 | 81% | 71 | 1363 | 194 | $17.14 |
| all-lines-master | sampled | 41/607 | 76% | 64 | 3132 | 394 | $16.03 |
| client-master | full | 11/11 | 55% | 83 | 67 | 7 | $0.00 |

Agreement is high on clean coverage/framework sheets (gl-base 94%, pcm 91%) and lower on ambiguous
metadata (`client-master`, a refId-sparse template) and dense rating tables. **The queue is large
(8,553 rows) because the run hit a sustained Foundry overload:** the gpt-5.4-pro adjudicator's circuit
breaker opened repeatedly (queue-directly rather than pay for a call that resolves nothing), so many
genuine disagreements are queued rather than adjudicated. That is honest — an overloaded adjudicator
should queue for a human, not guess — but it means a full re-annotation on a quiet endpoint would
sharply raise the adjudicated share and lower the queue. The queue is the `REVIEW_QUEUE.md`
deliverable; every row is a real disagreement, never an auto-resolved one. NOTE: this first pass ran
with the harness BEFORE the `omitted-by-both` / symmetric-both-empty / adjudicator-restrict fixes
(commit ce5c316); the full-coverage goldens nonetheless report `goldenCompleteness` 100%, and a
re-annotation would only tighten quality.

## 4. Baseline (expected RED)

Full numbers in `BASELINE_EVAL2.md`. The offline deterministic path (`mapIsoWorkbook`) already
loses data the counting-invariant floors catch — e.g. SECURA extracts **0 forms** despite hundreds
of form cells across "Property Forms Usage" + the hidden "Forms View - MTG"; GL-base extracts 0
forms and 0 rules. `client-master` scores substanceCoverage 0.0%, entityRecall 0.0, and two
counting-invariant violations (product 1<3, form 0<13). This RED is the deliverable.

## 5. Hostile self-review

A 25-agent adversarial workflow (`ce2-hostile-review`) attacked the factory + eval2 for ways a
green board hides data loss. It returned 15 verified findings (1 critical, 10 high, 4 medium). The
high-impact ones are **CLOSED** (commit `ce5c316`); the rest are disclosed with named fixes.

**1. Dual-family shared blind spot, and which invariant covers it.** Both families read the SAME
rendered window, so their omissions are CORRELATED — a non-empty cell BOTH skip would never enter
the golden, shrinking the accounting denominator invisibly. Coverage: the deterministic
`countingInvariants` floor (`distinctRefIds`/`distinctFormTokens`, computed from RAW cells, not the
golden) independently demands every id-shaped and form-shaped token, so double-omission of the
id/form majority still reds. The residual class is pure-value cells (bare limits, factors, state
codes) that carry no token. **Closed on the generation side:** the factory now forces every
`omitted-by-both` ref into the review queue (`annotate-goldens.mts`), and eval2 REPORTS
`goldenCompleteness` (dispositioned+queued vs raw non-empty). **Still open:** an eval2 *hard-gate*
comparing golden coverage to raw non-empty per sheet — reported, not yet blocking, so as not to
conflate golden-incompleteness with pipeline loss on goldens annotated before the fix.

**2. Worst disagreement sheet — adjudicated or queued?** By the measured `cellExactRate`, the worst
agreement is `client-master` at **55%** — a refId-sparse metadata template where "is this row an
ENTITY or an ATTR" is genuinely ambiguous, so the two families split often; `all-lines-master` at
76% is the worst among the data-rich masters (dense rules/ROC windows). Clean coverage/framework
sheets agree far more (gl-base 94%, pcm 91%). Because the run hit a Foundry overload, most of those
disagreements are **queued, not adjudicated** (the circuit breaker opened) — honest, but it means the
adjudicated share understates what a quiet-endpoint re-run would resolve. Disposition conflicts route
to the
DEEP_REASONER adjudicator (grounded-or-queued) + Haiku byte-verify — trustworthy. Three
adjudicator-adjacent holes were found and **closed**: the adjudicator is now restricted to the
disputed refs (no overriding agreed cells / promoting both-unclassified); the both-empty
degradation guard is symmetric (was an XOR that baked 0-cell windows). **Accepted (medium):** a
kind-only conflict (both agree ENTITY, split product/coverage/subCoverage) is resolved to A
(opus) silently — a truth-LABEL correctness limit, not a substance-loss escape (the loss gate is
disposition-driven and disposition is fully adjudicated).

**3. Prove goldens cannot leak — name the lock.** The lock is the anti-leakage `it()` in
`tests/eval/import-eval2-metrics.test.ts`. It was source-only (two dirs) and could pass vacuously.
**Closed:** it now also scans the runtime AI handlers (`server/lib/ai`), every `*-shared.cjs`
bridge (the runtime artifacts), and `app/src/import`, and is NON-VACUOUS (required roots must
exist; >20 files must be scanned or the lock fails). **Honest residual (accepted, medium):** it
matches the NAME `goldens2`, not golden CONTENT — a determined insider could obfuscate
(`'goldens'+'2'`) or key on the golden's source sha without the literal string. A content
fingerprint over all runtime code is the specified upgrade; the content-level accounting/counting
gates remain the real defense.

**4. CE1 census vs cell-enum disagreement — which is wrong, how detected?** eval2 ships
`reconcileCensus` (wired at the `--census` path): per sheet it compares CE1's `nonEmpty` against
cell-enum's `cells.length` and REDS the board on any mismatch — so a divergence between the two
independent enumerators is caught and blocks, stopping a single buggy enumerator from defining
truth. It reports THAT they disagree and on which sheet, but does NOT auto-adjudicate WHICH is
right (deliberate — two counts disagreeing is a human signal); the tiebreak authority is
cell-enum's merge-anchored sparse pass. Caveat: it compares raw-vs-raw, not golden-vs-raw, so it
guards enumerator correctness, not golden completeness (that is Q1's job). **Status: MITIGATED.**

**5. What makes it green while data is lost — closed?**

| vector | status |
|---|---|
| Offline accounting was a per-VALUE global bag (state=CA on 1 of 200 → all 200 accounted) | **CLOSED** — now entity-bound (ENTITY→id/name, ATTR+ofEntity→that entity); ATTR-without-ofEntity keeps a documented global fallback |
| Hierarchy flattening passed vacuously (subs → top-level, no parentId) | **CLOSED** — `hierarchyRecall` gate on golden `parentRef` + `BELONGS_TO` edges |
| Counting floor: `other` bucket unfloored, no file-level floor, SYNTH padding | **CLOSED (file-level)** — `__TOTAL__` distinct-refId floor (SYNTH/junk excluded); broadening `REFID_RE` for separator-less ids remains open |
| Correlated omission of pure-value cells | **MITIGATED** — `omitted-by-both` queue + `goldenCompleteness` report; per-sheet hard-gate open |
| Numeric fidelity vacuous when `checked==0`; same-entity limit↔deductible swap | **OPEN (high)** — fix specified: bind each claim to the golden cell's kind and match the corresponding field; make `checked==0` a hard-fail when the golden declares numeric ATTRs |
| Enumerator OOM on a far-coordinate merge | **CLOSED** — `ROW_CAP`/`COL_CAP` on the anchor bounds extension |

**Bottom line, stated hostilely:** the headline promise — *green cannot hide data loss* — now holds
for the `coverage:"full"` goldens across accounting (entity-bound), hierarchy, counting floors, and
the zero-tolerance `unaccountedEntityCells==0` backstop. It is NOT yet unconditional: the numeric
same-entity swap and the pure-value per-sheet completeness hard-gate are named, unclosed, and are
the highest-leverage next commits. Do not read a green board on a heavily pure-value or numeric-
swap-vulnerable golden as proof of losslessness until those land. This disclosure is the honest
state, not a claim of completeness.

## 6. What CE3 / CE5 must consume

- CE3 fixes the reds against `samples/goldens2/*.golden2.json` (the truth) and the
  `BASELINE_EVAL2.md` work order; re-run `pnpm exec tsx scripts/import-eval2.mts --offline`.
- CE5 merges lanes locally and reconciles the shared files (`docs/import-census/ledger.json`,
  `docs/orchestration.md`), then runs `--census <ce1-census.json>` so eval2's `reconcileCensus`
  proves CE1 and CE2 agree on nonEmpty per sheet before trusting any coverage number.
- The two HOLDOUT2 workbooks stay sealed — a "green means right" claim is only credible if it holds
  on a workbook the factory never saw.
