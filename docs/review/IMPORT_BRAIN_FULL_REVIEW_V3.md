# Import Brain — Full Review V3 (audited, re-derived, re-ranked)

**Date**: 2026-07-26 · **HEAD**: `83cc471` · **Supersedes**: `IMPORT_BRAIN_FULL_REVIEW_V2.md` (V2) and `IMPORT_BRAIN_FULL_REVIEW.md` (V1), same day.

**Method.** V2 was audited claim-by-claim in code (170 cited claims adjudicated by six independent verification agents, plus ~45 verified first-hand by the merging reviewer). Every deliverable was then re-derived blind by agents forbidden to read V1 or V2. The top findings of both documents were adversarially attacked. The gate was run. Both workbooks were re-dumped cell-by-cell with ExcelJS.

**Verification result.** V2 is unusually well-grounded *at the line level*: of 170 audited claims, **142 CONFIRMED, 25 PARTIALLY_CONFIRMED, 3 UNVERIFIABLE, 0 refuted on the cited line**. Its `file:line` precision is near-perfect (one off-by-one found: `stage-filing.js:424` → `:425`).

**But line-accuracy is not mechanism-accuracy.** This review's principal result is that **V2's #1-ranked defect is refuted as a production defect**, and that the true top-ranked defect is one neither V1 nor V2 identified: a systemic gap in `canonicalMap` that makes the entire limit/deductible/rate-table vocabulary invisible to the AI column mapper, compounded by both certification harnesses being structurally unable to observe terms at all.

> **Scope note both prior reviews omit.** The removal of the client-side deterministic parse path (`ImportWorkbookModal.tsx`, `readWorkbook.ts`) is **uncommitted working-tree state**, not HEAD. `git status` shows 5 modified/deleted tracked files. All code claims below are against the working tree; where HEAD differs it is stated.

**Gate at time of review**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — **green**, exit 0, **185 test files / 2,025 tests passed**, 4 skipped, build clean. All four canary figures present in their locked tests (`evaluator.test.ts:16` `toBe(1528)`; `workedExample.canary.test.ts:30` `canary: 1002`; `generalLiability.evaluator.test.ts` $2,635; `reconcile.test.ts:100` $1,281).

---

## 0. Audit of V2 — what did not survive

| V2 claim | Verdict | What is actually true |
|---|---|---|
| §4.1 "The ISO join overwrites **cited evidence** — terms and parentId vanish" (ranked **#1**) | **REFUTED as a production defect** | The brain **can never author `terms` or `order`**. Both are `role: 'derived'` ([canonicalMap.ts:256](shared/src/import/canonicalMap.ts#L256), [:216](shared/src/import/canonicalMap.ts#L216)), and `buildDomainDictionary` filters `role !== 'derived'` ([stage3-column-map.js:31](server/lib/import-brain/stage3-column-map.js#L31)); `grep terms server/lib/import-brain/stage4-extract.js` returns **zero hits**. `brainP.data.terms` is always `undefined`, so `adoptIdentity`'s `!== undefined` guard only ever *writes*, never *overwrites*. Nothing cited exists to erase. See §4.1. |
| §4.1 live symptom: EPLUS-E2E's 0 terms was **caused by** the join | **REFUTED** | `EPLUS-R2` ran the identical join and kept **59 LIMIT + 22 DEDUCTIBLE**; `CORE-ATT` kept **366 + 217 = 583**. E2E's artifact shows `failed: 100` and all three metrics at zero — a persist-class failure, not a field-level join bug. **V2 contradicts itself**: §3.3 attributes the E2E/R2 gap to `invalid_parent` batch rejections while §4.1 attributes it to the join. §3.3 is the better-grounded explanation. |
| §0 "block detection runs **entirely** off `TABLE NAME:`"; V1's `RATE TABLE ID:` finding rejected (reason rows 9, 10) | **WRONG — V1 was right** | [layoutDetector.ts:26-34](shared/src/import/structure/layoutDetector.ts#L26-L34): the **primary** `STACKED_MARKER_PATTERNS` are `RATE TABLE ID:`, `RTTable.N`, `LD TABLE ID:`, `LDTable.N`, and the comment states *"TABLE NAME is intentionally absent from the primary set."* `TABLE_NAME_SENTINEL_PATTERN` (`:38`) is **secondary**, used only when no primary marker exists (`:65`). My dump: `RATE TABLE ID:` occurs **0 times** in both books. V1's claim was accurate; V2 inverted the causality it accused V1 of inverting. |
| §4.4 "Core Rule References … the most cells in either book" | **WRONG** | Measured: Core Rating **119,574** > Core Forms Specifications **110,733** > Rule References **76,198**. Rule References is the *third* largest. (Census tables 230, not 237.) |
| §3.1 "The same parser, on the same day, scores perfect and zero" | **MISLEADING** | Same function (`mapIsoWorkbook`), **disjoint corpora**: eval1 scores `samples/iso/*` + `Product_Specifications_Core_07_13_2026.xlsx` ([import-eval.mts:75-83](scripts/import-eval.mts#L75-L83)); eval2 scores `samples/corpus-2026-07/**` ([import-eval2.mts:47,76-80](scripts/import-eval2.mts#L47)). **Zero file overlap.** The rhetorical force of the contradiction evaporates. |
| §3.1 "0.000 is a join failure, **not** a data-loss signature" | **HALF WRONG** | Two distinct mechanisms. On 4–5 goldens entityRefs are name-shaped and nothing joins (join failure, as V2 says). But on `gl-base` **93/99 refIds join** and **0/110 golden numeric values appear anywhere in the plan** — that is genuine extraction loss. V2 collapses two causes into one. |
| §3.2 "**All 8 collapsed** … a real regression no gate saw" | **OVERSTATED** | The board was **already 8/8 RED at the Jul-17 baseline**. The collapse is confined to **one metric family** (`substanceAccounted` / `unaccountedEntityCells`); `entityRecall`, `numericFidelity`, `hierarchyRecall` and `substanceCells` are **bit-for-bit unchanged**. It is a conservation-*accounting* regression, not a board flip. |
| §3.2 "The **Jul 24–26 fix wave** regressed conservation accounting" | **UNVERIFIABLE** | No bisect was performed. Any commit from 2026-07-17 onward is a candidate. |
| §4.2 "Every failure re-buys a **~$70 / ~110-min** run" | **UNVERIFIABLE** | No committed artifact carries spend or duration (`import_promote_e2e-*.json` keys: `label, baseUrl, runId, productId, promoted, counts, fails, notes`). The *structural* claim is confirmed; the price tag is inherited from V1 unverified. |
| §4.2 "Resume works only for runs that died **before** the expensive stage" | **IMPRECISE** | Resume also works for runs killed **mid**-stage-4 (per-sheet artifacts restore). The breakage is exactly: a run that **completed** stage 4 (so `index.js:183` wrote the `stage4` blob) and died later loses **everything**, including stages 1–3, because the throw nulls the whole `resume` object. |
| §4.2 "**Split-product** runs get zero checkpoints" | **PARTIAL** | True only for **secondary** split products (`gi > 0`, [unified-import.js:494-496](server/lib/ai/unified-import.js#L494-L496)). Group 0 keeps the un-prefixed `onStage` and checkpoints normally. |
| §4.9 "On a hit … **batch-halving never runs**" | **OVERSTATED** | `cachedCall` returns the **original `res`** on a miss ([extract-cache.js:117-118](server/lib/import-brain/extract-cache.js#L117-L118)), so `stopReason` survives and batch-halving fires correctly on live truncations. The real defect is narrower: **the one semantic retry for the two cached bulk votes is guaranteed to be a no-op**, because the retry re-enters the cache and replays identical bytes. |
| §5.8 "point `extract-cache.js:40` at `AZURE_BLOB_CONNECTION`" | **DANGEROUS AS SEQUENCED** | Fixing the env var **activates** the dormant poison: a truncated raw cached in a prior run would then be replayed with no `stopReason` in a later run. `cachePut` must be gated on parse success **first**. |
| §5.7 "**delete `DERIVED_VERBATIM`**" | **WRONG FIX** | `deriveParentIds` legitimately emits `verbatim: '(derived from row context)'` ([stage4-extract.js:489](server/lib/import-brain/stage4-extract.js#L489)). Deleting the bypass turns every derived `parentId` into an `ungrounded-field` violation. Correct fix: replace the open regex with a **closed vocabulary** + require `cell === ''`. |
| §4.8 "up to **~97%** of a sheet's columns" | **UNVERIFIABLE** | An arithmetic upper bound from the `>= 2` escape hatch, not an observed measurement. No fixture or artifact establishes it. |
| §6 correction 4: "**six** call sites bypass `parseWithRetry`" | **UNDERSTATED** | At least **eleven**: 2 prefilters (`stage1-classify.js:121,122`), 2 blind cross-check votes (`stage4:738,739`), the both-failed rung (`:961`), **both** stage-0 rungs (`stage0-router.js:182,191`), and **all four** stage-1a digest sites (`stage1-digest.js:124,185,189,225`). |
| §0 "truncation emits a named `truncated-model-output` item per call" | **PARTIAL** | Stage 4's dual bulk votes — the dominant call population — pass `onTruncation` and short-circuit *before* that line; they emit `truncated-batch-split` (`:937`, only when `batch.length > 1`) or `dropped-batch` (`:967`). |
| §1.1 "**Nothing auto-persists**" | **PARTIAL** | True for entities. The **proposal bundle itself** is auto-persisted server-side by `persistIfRequested()` (run result + observatory artifact) before any reviewer action. |
| §4.10 judge parse "falls through **harmlessly**" | **IMPRECISE** | It fails *safe* (no wrong pick) but **discards a valid verdict** — `"candidate b"` → `charCodeAt(0)` of `'c'` → index 2 → out of bounds with 2 candidates → `pick = null`. |

**What V2 got right and is retained**: the stacked-sheet bail chain (§4.4), the `DERIVED_VERBATIM` bypass mechanism, the `index.js:129` ignore-guard, the cache env-var divergence, the filing filename→refId defect, the consensus arithmetic, the inverted budget ladder, the `foldStepOp` inversion, the model catalog's numbers, and the `sampledVerifications = []` observation — all independently re-confirmed here.

---

## 1. How the Import Brain Works

*(Self-contained. V2 deferred §2/§6/§7 to V1 by reference; this document inlines everything.)*

### 1.1 What the system is

The platform converts semi-structured insurance documents — product-specification Excel workbooks, rate manuals, carrier filing PDFs — into a governed canonical **Product Component Model (PCM)** and prices it with a deterministic rating engine. PCM entities (`shared/src/types.ts`): **Product**, **Coverage** (hierarchical via `parentId`, carrying `terms` of kind LIMIT/DEDUCTIBLE/OPTION and `formNumbers`), **Form** (identity = byte-faithful `number` + `edition`), **Rule**, **RatingProgram/RatingStep** (ordered SET/MUL/ADD/MIN_FLOOR steps with `source: {type, ref}`), **RTTable/LDTable**.

The import brain is the ingestion half: bytes → cited canonical entities that **a human reviews before anything is written**. No *entity* auto-persists; the pipeline emits a proposal bundle, the reviewer accepts/excludes, and only then does the client write — as a DRAFT, in dependency order, every entity through `adapter.db.mutate()`. (The *bundle* itself is persisted server-side automatically.)

**Five invariants.** Three are violated in code today (§4 items 6, 8, 9):

1. **Citations-or-discarded.** Enforced BLOCKING only for **strict ids on non-stacked sheets**; uncited non-strict fields are WARN + planned + written. `docs/IMPORT_BRAIN.md:18-19` says "uncited claims are dropped" — in the workbook path **nothing is dropped**; a bad strict id blocks the entity into `unresolved`. Any field whose verbatim is parenthesized skips citation checking entirely (§4.8).
2. **Flag-not-invent.** Violated in **four** places (§4.6).
3. **Byte-faithful identifiers.** Violated on the filing path (§4.8).
4. **Fleet-registry models only**, routed through the cost guard. `IMPORT_CONTEXT = 'import-no-cap'` ([fleet.js:77](server/lib/fleet.js#L77)) returns `{allow: true, degrade: false}` at [:103](server/lib/fleet.js#L103) — never denies, never degrades, never bypasses `fleet.record`. `CEILING_USD = 25` at `:81`. `claude-fable-5` is forbidden and **test-locked exactly twice** ([fleet.lock.test.ts:60-61](shared/src/ai/fleet.lock.test.ts#L60-L61), [fleet.test.ts:23](shared/src/ai/fleet.test.ts#L23)).
5. **Four rating canaries stay exact**: PH $1,528, PA $1,002, GL $2,635, filing-import $1,281.

### 1.2 The two-extractor design — and the asymmetry that governs everything

Extraction happens twice and is joined at the end:

- **The deterministic ISO mapper** (`mapIsoWorkbook`, `shared/src/insurance/isoImport.ts`, ~2,560 lines, LLM-free), golden-pinned. It runs at [unified-import.js:191](server/lib/ai/unified-import.js#L191) — **after** the brain has spent its entire budget.
- **The AI brain** (`server/lib/import-brain/*.js`), the provenance source.

At stage 7 they join ([stage7-plan.js:278-300](server/lib/import-brain/stage7-plan.js#L278-L300)):

```js
const ISO_ORACLE_FIELDS  = ['refId', 'parentId', 'order', 'terms']              // :256 — win outright
const ISO_STAMPED_FIELDS = ['formNumbers','allStates','states','status', …]     // :262 — gap-fill / array-union
```

**The decisive fact neither prior review states**: of the four oracle fields, **three (`terms`, `order`, `parentId`) are `role: 'derived'` in `canonicalMap` and are therefore filtered out of the dictionary the AI is shown** ([stage3-column-map.js:31](server/lib/import-brain/stage3-column-map.js#L31)). The brain cannot map a column to them and never emits them. The oracle/stamped split is not a bug — it is *coherent*: the mapper is the only possible source for those fields. What *is* a bug is that the same filter silently kills 15 fields' worth of alias vocabulary (§4.3).

The one exception: `deriveParentIds` ([stage4-extract.js:471-493](server/lib/import-brain/stage4-extract.js#L471-L493)) *does* synthesize a brain-side `parentId` at confidence 0.90 with `verbatim: '(derived from row context)'`. That single field is genuinely overwritable by a mapper `parentId: null` — the narrow surviving sliver of V2's #1.

### 1.3 The pipeline, stage by stage

Entry `POST /api/ai/unifiedImport`, SSE-streamed with a `:hb` keepalive (App Service closes idle connections at ~230 s).

- **Stage 0** (`stage0-router.js`) — routes by magic bytes, never filenames, behind OOXML armor (five ceilings, `IMPORT_413`); hidden sheets included with `hiddenSource`. The LOB/edition assist fires on **every** upload: the gate at `:344-345` is `(!lobRefIdHint || workbooks + filingDocs > 0)`, whose second disjunct is true for every real upload. `consumesCells = false` is set for STACKED_TABLES at `:400-404`, deliberately, so no false conservation attestation is made.
- **Stage 1a digest** (`stage1-digest.js`) — two 8192-token readers (opus ∥ gpt-5.1) with windowed grid access (≤12 windows of 40×40, ≤3 rounds), synthesized by gpt-5.4-pro on `/responses`.
- **Stage 1 classify** (`stage1-classify.js`) — a **two-of-two 128-token prefilter** (`:121-122`) can set `domain: 'ignore'`, `confidence: 1.0`, `humanFlagNeeded: false` with **no review item** (`:129-138`). Then opus ∥ gpt-5.1 classify at 256 tokens; disagreements are adjudicated by **opus — REASONER_A's own deployment** (`:198`).
- **Stage 2 header lock** (`stage2-header-lock.js`) — deterministic scoring, opus fallback at 256 tokens. **STACKED_TABLES sheets get locks only under `Sheet::Sub` pseudo-names, then `continue`** (`:75-86`).
- **Stage 3 column map** (`stage3-column-map.js`) — opus ∥ gpt-5.1 at 8192, 24-column batches; code reconcile applies a ×0.7 penalty on disagreement. Bails to `null` for any sheet without a plain-name lock (`:194`).
- **Stage 4 extract** (`stage4-extract.js`, ~90% of runtime and cost) — the heart. `sheetIsDeterministic` (`:611-626`) short-circuits to code extraction when `confident/mapped ≥ 0.60` **OR** `confident ≥ 2 && dominant ∈ {form, rule, ratingStep}`. On the short-circuit path (`:894-899`) the dual bulk votes, the sonnet→opus ladder, the gpt-5.1 judge and the DeepSeek tail judge are **all bypassed**; the only AI oversight is `sampleVerifyMap` (§4.5). Otherwise: dual cached bulk votes → weighted majority → ladder → judges.
- **Stage 4.5 sweeper** (`stage45-sweeper.js`) — classifies unaccounted cells (cap `SWEEP_MAX_PER_SHEET = 300`).
- **Stage 5 validate** (`stage5-validate.js`) — a deterministic resolver that compares claimed verbatim against the actual cited cell, then a gpt-5.1 semantic pass (WARN-only).
- **Stage 6 reconcile** (`stage6-reconcile.js`) — aggregation.
- **Stage 7 plan** (`stage7-plan.js`) — **outside the brain**, called from `unified-import.js`. Builds the plan and performs the ISO join. `docs/IMPORT_BRAIN.md` is stale on this point.

`sampledVerifications` is a hardcoded `[]` in both producers ([stage7-plan.js:1114](server/lib/import-brain/stage7-plan.js#L1114), [unified-import.js:653](server/lib/ai/unified-import.js#L653)) — the client renders an empty "verification by sampling" section.

### 1.4 Review & write path

`UnifiedImportModal.tsx` renders a two-section review; `acceptedPlan()` drops deselected items. On confirm, `importPlan()` writes product → **coverages** → tables → forms → rules → rating ([importProduct.ts:199-229](app/src/lib/import/importProduct.ts#L199-L229)) — coverages **before** tables, contradicting the file's own stale header comment.

**Gap**: `forms: keep(p.forms, accepted.has('coverages'))` ([acceptedPlan.ts:53](app/src/import/acceptedPlan.ts#L53)) — forms have no independent toggle; deselecting the coverages section silently drops every form.

---

## 2. The Source Reality: Core and E+

Both books re-dumped cell-by-cell with ExcelJS for this review. Every figure below is measured, not quoted.

### 2.1 Inventory (true used range vs reported)

| Sheet | Core true | Core reported | Core cells | merges | hidden rows | E+ true | E+ cells |
|---|---|---|---|---|---|---|---|
| Revision History | 12r×9 | **122r** | 35 | 0 | 0 | 12r×9 | 35 |
| Specification Definitions | 88r×4 | 95r | 345 | 0 | 0 | 87r×4 | 341 |
| Framework | 142r×65 | 154r×69 | 8,757 | 2 | 0 | 102r×65 | 1,873 |
| Forms Specifications | 1,460r×76 | 1,460r×76 | **110,733** | 4 | 0 | 222r×**80** | 7,541 |
| Forms Dynamic Data | 9,086r×8 | 9,086r×**90** | 63,293 | 0 | 0 | 1,835r×8 | 13,316 |
| Rules Specifications | 445r×75 | 457r | 32,710 | 4 | **384** | 179r×75 | 5,195 |
| Rule References | 7,184r×32 | 7,203r×**77** | 76,198 | **1,034** | **1,223** | 3,651r×32 | 39,098 (**2,970** hidden) |
| Rating Specifications | 2,029r×69 | 2,031r×**1,378** | **119,574** | 4 | 0 (1 hidden **col**) | 321r×74 | 6,021 (reports 681r×104) |
| Data Validation | 51r×9 | 51r×9 | 157 | 5 | 0 | 51r×9 | 149 |
| **TOTAL** | | | **411,802** | | **1,607** | | **73,569** (**2,970**) |

**Correction to V2**: Rule References is the **third** largest sheet, not "the most cells in either book" — Core Rating (119,574) and Core Forms (110,733) both exceed it.

**New**: the phantom-extent hazard is **pervasive, not isolated to Core Rating's 1,378**. Six of nine sheets over-report: Forms Dynamic Data claims 90 columns for 8 real; Rule References claims 77 for 32 in both books; E+ Rating claims 681r×104 for 321r×74. Any census that trusts `ws.columnCount` mis-sizes most of the corpus. (The real bridge returns `dataColCount = 69` for Core Rating — the hazard is defeated *there*, but the reported/true gap is systemic.)

### 2.2 Messiness, measured

| Signal | Core | E+ |
|---|---|---|
| `<Intentionally Blank>` cells | **564** | **590** |
| `NULL` string literals | 0 | **7,736** |
| Untrimmed values (`"No "` ≠ `"No"`) | **2,421** | **2,097** |
| Formula cells (non-empty result) | 691 | 223 |
| `TABLE NAME:` markers | **237** | **40** |
| `RULE ID:` / `RULE ID(s):` | **361** / 0 | 0 / **40** |
| **`RATE TABLE ID:`** | **0** | **0** |
| refId prefixes | `CORE.COV` 2,896 · `CORE.RAT` 2,004 · `CORE.PRD` 777 | `EPLS.COV` 559 · **`EP.RAT` 293** · `EPLS.PRD` 204 · **`EPLS.RAT` 1** |

`<Intentionally Blank>` is confirmed **not** neutralized: `NULL_STRINGS` in `sentinels.ts` contains `<intentionally left blank>`, which never matches the books' actual string.

**New**: the E+ rating-prefix split is not clean — `EP.RAT` appears **293** times and `EPLS.RAT` **exactly once**. Any join keyed on `<productPrefix>.RAT` breaks on 293 rows and *appears* to work on one.

**E+ is the harder book, not the smaller one.** It hides **2,970 of 3,651** Rule References rows (81% of that sheet), is the only book with mixed refId prefixes, and the only one with `NULL` literals. Core hides 384 of 445 Rules rows (86%) behind a leftover autofilter. Skipping hidden rows would silently drop most of the corpus; the brain correctly ingests them with `hiddenSource` provenance.

### 2.3 Load-bearing Core↔E+ drift

Rating columns shift +2 (E+ inserts Auto/Motorcycle applicability); the forms band differs by **+4** (76 → 80 — V2's correction of V1's "+1" is right); **Dynamic Data key columns are swapped** (Core A=FORM NUMBER, B=FORM NAME; E+ reversed); sheet names drift (`Rule References` vs `E+ Rule References`, but `Data Validation` is identical in both); `CORE.RAT` vs `EP.RAT`. **Any positional assumption fails on exactly one of the two books** — header-anchored mapping is the only safe path.

### 2.4 Stacked-marker grammar — resolved

`layoutDetector.ts:29-34` defines the **primary** markers as `RATE TABLE ID:` / `RTTable.N` / `LD TABLE ID:` / `LDTable.N`, with an explicit comment that `TABLE NAME` is *intentionally absent from the primary set*. `TABLE_NAME_SENTINEL_PATTERN` (`:38`) is a **secondary** fallback used only when no primary markers exist (`hasTableNameOnlyMarkers`, `:62-65`). Since `RATE TABLE ID:` occurs **zero** times in either book, the fallback fires and the sheets *do* segment — which is why they reach the stage-4 bail (§4.5) rather than being missed outright. `RULE ID` is in neither pattern set; it is a `canonicalMap` alias used for content parsing only, so V1's §5.2 proposal to add it to the marker grammar is correctly rejected — but V2's *stated reason* for rejecting it is wrong.

---

## 3. Empirical Performance

### 3.1 The gate

Green at HEAD+worktree: 185 files / 2,025 tests / build clean.

### 3.2 The certification harnesses cannot certify the thing that matters

This is the central empirical finding of V3, proven across three files.

**eval1** (`scripts/import-eval.mts`, the 4/4-green board) projects entities through `scalarFields()` ([:139-148](scripts/import-eval.mts#L139-L148)):

```js
if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
else if (k === 'formNumbers' && Array.isArray(v)) out[k] = [...v].sort()
```

Only scalars survive, plus `formNumbers` as the single whitelisted array. `terms[]`, `states[]`, `dynamicFields[]`, rating `source{}`, `coverageRefIds[]`, RT/LD `dimensions`/`rows` are **all dropped**. `SKIP_FIELDS` additionally drops **`citation`**. Confirmed by inspection of the committed goldens: `tests/golden/import/CORE.golden.json` holds 521 entities (1 product, 112 coverages, 234 rules, 51 ldTables, 123 ratePlaceholders) and **0 coverages carry a `terms` array**. `grep terms scripts/import-eval.mts` returns **nothing**.

**eval2** keeps arrays ([import-eval2.mts:90](scripts/import-eval2.mts#L90)) — but `goldenNumericFidelity` flattens only **one level** ([import-eval2-metrics.mts:131](scripts/lib/import-eval2-metrics.mts#L131)) and `canonicalizeNumeric` ([golden2-schema.mts:185-193](scripts/lib/golden2-schema.mts#L185-L193)) renders a term **object** as `"[object object]"`, which can never equal a numeric claim.

> **Therefore: neither certification harness can observe a numeric value that lives inside `terms[]`.** The limit/deductible surface — the single most valuable output of an insurance product import — is outside both gates. This is why the term-fabrication defect (§4.6a) and the term-vocabulary gap (§4.3) have survived undetected, and it is the strongest argument in this review for fixing the harness before anything else.

**Secondary**: `goldenNumericFidelity` joins claims through an exact case-insensitive refId map ([:124-131](scripts/lib/import-eval2-metrics.mts#L124-L131)). On 4–5 goldens the golden `entityRef`s are name-shaped ("Standard Auto Program", "Arkansas") and nothing joins — a genuine harness bug. On `gl-base`, 93/99 refIds *do* join and 0/110 numeric values still match — genuine extraction loss. **Two causes, not one.**

`ldTableRefResolutionRate ≥ 0.95` already exists and already blocks ([import-eval2.mts:217](scripts/import-eval2.mts#L217)).

### 3.3 Live round trips (from committed artifacts)

| | CORE-ATT | EPLUS-R2 | EPLUS-E2E |
|---|---|---|---|
| promoted | true | true | true |
| `stepsWithCoverageRef` | **90** / 2,024 | **17** / 303 | **0** |
| `limitTerms` | **366** | 59 | **0** |
| `deductibleTerms` | **217** | 22 | **0** |
| `failed` | 0 | 0 | **100** |
| `fails` | [] | [] | "no limit or deductible term survived the round trip" |

`CORE-ATT` persisted 366 + 217 = **583 terms** through the exact ISO join V2 said erases terms. E2E's simultaneous zeroing of *all three* metrics alongside `failed: 100` is a persist-class failure signature, not a field-level join bug. No artifact records spend, duration, or an `invalid_parent` status code — the `invalid_parent` attribution rests on 100 being exactly two 50-caps plus commit timing, which is suggestive but not recorded.

---

## 4. Ranked Reasons the Import Brain Might Not Work

Ranked by **severity × demonstrated reachability × blast radius on the real corpus**. The deliverable asked for a top 10; the union of both reviews plus this one yields 12 defects worth ranking, so items 11–12 are kept below an explicit line rather than dropped. **V2's #1-ranked defect falls off the board entirely** (§0), and four findings neither prior review had take #1, #2, #3 and #4.

### 1. The ISO join destroys the parent-before-child ordering the write path depends on — whole batches die with `invalid_parent`

- [stage7-plan.js:690-695](server/lib/import-brain/stage7-plan.js#L690-L695) sorts coverages parents-first, with a comment naming the reason: *"importPlan flushes batches on forward-references; sorting parents first minimizes flushes and orphan risk."* The sort is documented as load-bearing for the write path.
- [`joinGroupWithIso`](server/lib/import-brain/stage7-plan.js#L317-L350) then **rebuilds the array from scratch**: pass 1 pushes refId-matched brain entities in *brain* order, unmatched ones are deferred to `unmatchedBrain`, and pass 2 appends name-matched and mapper-only entities in *iso* order. The parents-first ordering does not survive.
- **This is the best-grounded explanation of the one hard live failure on the board.** `EPLUS-E2E` records `failed: 100` — exactly two 50-row batches — and zeroes `limitTerms`, `deductibleTerms` **and** `stepsWithCoverageRef` simultaneously. A batch-level persist rejection explains all three at once; a field-level join bug explains none of them, and `EPLUS-R2` kept 59 + 22 terms through the identical field-level join. *Fix*: re-apply the parent-before-child sort **after** the join, or make `joinGroupWithIso` order-preserving. *Gate*: `import-promote-e2e` on E+ reports `failed: 0`.

### 2. `stampDefaults` runs before the join, so "absence never beats a cited value" is a no-op for every scalar

- `stampDefaults` is applied to all six groups at [stage7-plan.js:699-701](server/lib/import-brain/stage7-plan.js#L699-L701) — **before** `joinGroupWithIso` at `:717-723`. It unconditionally fills `status`, `lifecycle`, `reviewStatus`, `reviewer`, `allStates` and `formNumbers` whenever they are `undefined`.
- The `ISO_STAMPED_FIELDS` branch then gap-fills only when `brainHas` is false (`:299-300`). Because `stampDefaults` already filled every one of those scalars, `brainHas` is **always true** — so the mapper's values can never gap-fill. Arrays still union (`formNumbers` works); every scalar is dead.
- **The consequence inverts the prior reviews' framing.** The mapper genuinely *reads* state scope from the grid ([isoImport.ts:423-428](shared/src/insurance/isoImport.ts#L423-L428)); the brain's stamped `allStates: true` and `status: 'ACTIVE'` defaults now beat it unconditionally. It is not "mapper absence overwrites brain evidence" (V2's #1) — it is **importer defaults overwriting mapper-read evidence**, which is the same invariant broken in the opposite direction. Commit `deecb91` fixed the union branch and left this ordering bug in place. *Fix*: move `stampDefaults` after the join, or have it record which fields were stamped so the join can still fill them.

### 3. The AI brain is never told that limits, deductibles, or rate-table structure exist

- `buildDomainDictionary` filters `f.role !== 'system' && f.role !== 'derived'` ([stage3-column-map.js:31](server/lib/import-brain/stage3-column-map.js#L31)), and **aliases are used nowhere else** in stage 3 (`:37` is the only other reference; there is no deterministic alias pre-pass). Therefore every alias on a `derived`/`system` field is dead metadata.
- **15 of 88 canonical fields carry aliases that can never match anything** — and they are precisely the valuable ones: `terms` → `LIMIT`, `DEDUCTIBLE`, `AVAILABLE LIMITS`; `rows.value` → `AVAILABLE LIMITS`, `AVAILABLE DEDUCTIBLES`, `LIMITS`, `DEDUCTIBLES`; `valueColumn` → `ILF`, `RATE`, `FACTOR`, `VALUE`; `dimensions` → `DIMENSION`, `LOOKUP KEY`; `ldTableRef` → `RULE REFERENCE`, `RATE REFERENCE`; `ratingProgram.refId` → `PRODUCT FRAMEWORK ID`, `RATING STEP ID`; `mandatory` → `MANDATORY`; `dynamicFields` → `DYNAMIC DATA`.
- **Consequence**: every term in the system comes from the deterministic mapper alone; the ensemble, the judges and the sweeper contribute nothing to the limit/deductible surface, and no review item ever says so. It also explains §4.7: the ~2,003 Core rating rows stating `CORE.COV.###` in `PRODUCT FRAMEWORK ID` have no live destination, because the only field carrying that alias is `derived`. **Fix**: promote the genuinely-extractable fields to `role: 'source'` with an explicit `mapsTo`, and add a test asserting no `derived`/`system` field carries aliases.

### 4. Neither certification harness can see a term — so the highest-value defects are structurally undetectable

- eval1 drops every array but `formNumbers` and drops `citation` ([import-eval.mts:134-148](scripts/import-eval.mts#L134-L148)); eval2 keeps arrays but `canonicalizeNumeric` turns term objects into `"[object object]"` ([golden2-schema.mts:185-193](scripts/lib/golden2-schema.mts#L185-L193)).
- Verified against the committed corpus: 0 of 112 golden coverages carry terms; `grep terms scripts/import-eval.mts` = 0 hits.
- **Consequence**: eval1's "4/4 green, F1 1.0000" certifies the scalar surface only. A change that deleted every limit in the product would leave the board green. This inverts the priority order of every fix list: the harness must be able to see terms **before** any term fix can be certified.

### 5. Stacked sheets get no column map — a whole sheet family drops with no review item

- [stage2-header-lock.js:75-86](server/lib/import-brain/stage2-header-lock.js#L75-L86) pushes locks **only** under `Sheet::Sub` pseudo-names, then `continue`s. [stage3-column-map.js:194](server/lib/import-brain/stage3-column-map.js#L194) looks up the plain name → `null`. [stage4-extract.js:850](server/lib/import-brain/stage4-extract.js#L850) bails `return null` — **silently**. The `::` guards at `stage3:195` and `stage4:846` are provably dead: `classified` holds only fingerprint (plain) sheet names.
- Blast radius: Core Rule References (7,184 × 32, 76,198 cells, 230 census tables) and E+ Rule References (3,651 × 32). Real, but **third** largest, not first.
- De-escalated aggravators (V2 was right to strip them): `gatherRows`' stacked branch (`:781`) sits behind the `:850` bail, and stage 5's BLOCKING→WARN downgrade can never see a stacked entity. The deterministic mapper reading the uncapped grid still supplies 440 rules on CORE.

### 6. Flag-not-invent is violated four ways

- **(a) Fabricated terms** — `deriveTermsFromReferenceTables` ([isoImport.ts:1995-2031](shared/src/insurance/isoImport.ts#L1995-L2031)) sets `primaryKind` from a header cell (`limitHeaderSeen`, `:1739`) *independently of whether any value parsed*, then emits `default: data.defaultValue ?? data.rows?.[0]?.value ?? 0`. A flat table that parsed **no rows** yields a `default: 0` term. The MATRIX branch three lines above refuses *for exactly this reason*, and says so: *"`default:` below would fall through to 0, which prices — so withhold the term entirely."* The refusal was applied to one shape and not the other. **Inside the golden-pinned oracle** — but §3.2 shows the goldens cannot see terms, so no golden pins the fabrication and the fix is golden-safe.
- **(b) Fabricated nationwide scope, in two places.** `stampDefaults` sets `allStates = !states.length` ([stage7-plan.js:571](server/lib/import-brain/stage7-plan.js#L571)) — a positive 51-jurisdiction regulatory claim from silence, unflagged, three lines below where `status` correctly sets `statusAssumed: true` + `needsReview: true`. **The mapper does the same at [isoImport.ts:428](shared/src/insurance/isoImport.ts#L428)** — a site neither prior review names, and one that **is** golden-pinned (`CORE.COV.001` carries `allStates: true`). Fixing the mapper half will change the golden; fixing the stage-7 half will not.
- **(c) Inverted operators, documented in two files.** `foldStepOp` maps `'/'` → **MUL** and `'-'` → **ADD** ([stage7-plan.js:196-201](server/lib/import-brain/stage7-plan.js#L196-L201)), and falls back to `'MUL'` for *any* unrecognized operator. Critically, **`canonicalMap.ts:515` documents the same inversion** (`"+"/"-"→ADD, "*"/"/"→MUL`) — so the dictionary teaches the model the wrong mapping upstream. A fix touching only `foldStepOp` is incomplete.
- No canary covers this: seeded rating programs never traverse `foldStepOp`.

### 7. The step→coverage contract is broken at the field level

- `canonicalMap` defines `coverageRef` as a coverage **name** (aliases `COVERAGE`, `COVERAGE NAME`, `COVERAGE GROUP`; examples `'Bodily Injury'` — [canonicalMap.ts:506-511](shared/src/import/canonicalMap.ts#L506-L511)), while **every consumer byte-compares it to a refId** ([pricingLinks.ts:47-56](app/src/lib/insurance/pricingLinks.ts#L47-L56); the uncommitted `import-promote-e2e.mts` card check does the same). A name can never equal `CORE.COV.018`. The code has already decided the contract; `canonicalMap` is the outlier.
- Causation: Core's `COVERAGE NAME` column is non-blank on exactly **90** rows and `stepsWithCoverageRef` is exactly **90/2,024**. The brain read faithfully every row that stated a value; the loss is the **vertical-ditto forward-fill gap** — though note no forward-fill mechanism exists in the rating path to point at, so this remains an inference from the 1:1 correspondence.
- Third defect in the chain: `step.coverageRef` is excluded from the `refIdRemap` rewrite that rules' `coverageRefIds` receive ([stage7-plan.js:784-785](server/lib/import-brain/stage7-plan.js#L784-L785)), so an adopted refId orphans the link.
- The symptom "cards show no Pricing figure" is softened by the heuristic fallback at [pricingLinks.ts:69-76](app/src/lib/insurance/pricingLinks.ts#L69-L76), which the e2e oracle does not model.

### 8. The filing path makes a filename load-bearing

- [stage-filing.js:425](server/lib/import-brain/stage-filing.js#L425): `baseFormNumber = policyFormDoc.name.replace(/\.[^.]+$/, '')` — a **filename** becomes the product's minted refId, its `baseForm.formNumber`, and the filter admitting every rate-order variable. It is replaced only if `rawCovs[0].formNumbers[0]` exists (`:449`) — and **`formNumbers` is genuinely absent from the tool's `required` list** (`:411`), so the model may legally omit it.
- The classifier is also fed the filename as evidence (`:301`), against stage 0's own prompt: *"from CONTENT ONLY — filenames are not evidence."*
- Violates byte-faithful identifiers **and** the filenames-are-not-evidence posture. (V2's citation `:424` is one line off.)

### 9. Silent drop paths — four of them genuinely silent

- **Prefilter veto**: two 128-token models agreeing sets `domain: 'ignore'` with **no review item** ([stage1-classify.js:129-138](server/lib/import-brain/stage1-classify.js#L129-L138)). An `ignore` verdict then removes the sheet from **seven** downstream stages (`index.js:129,135,198`; `stage2:67`; `stage3:188`; `stage4:839`; `stage5:254`). Worst of these: [index.js:129](server/lib/import-brain/index.js#L129) guards the digest cross-check on `c.domain !== 'ignore'` — **the two 8192-token digest readers are silenced for exactly the sheets the two starved 128-token models vetoed.** It does fail *safe* on transport error (a null parse means not-both-ignore).
- **Any transport exception is an untelemetered missing vote.** `parseWithRetry` opens `try { res = await call() } catch { res = { raw: '' } }`, then `if (!res || !res.raw) return null` ([constants.js:80](server/lib/import-brain/constants.js#L80)) — no review item. This is broader than V2's "empty raw": a 3-attempt transport failure is indistinguishable from silence. The same pathology is independently reimplemented at `stage1-classify.js:121-122` and `stage4-extract.js:738-739` via `.catch(() => ({ raw: '' }))`.
- **`DERIVED_VERBATIM = /^\(.*\)$/`** ([stage5-validate.js:45](server/lib/import-brain/stage5-validate.js#L45), used at `:111`) `continue`s past **all** citation checks — strict and non-strict — for any parenthesized verbatim. The irony is on the page: the comment at `:113-119` explains precisely why skipping is dangerous.
- **`rowKind` emits a vocabulary stage 7 cannot consume**: it returns `'rating'` ([stage4-extract.js:584-598](server/lib/import-brain/stage4-extract.js#L584-L598)) while stage 7 consumes `byKind('ratingProgram')` and `byKind('ratingStep')` (`:526-527`). Rate/LD/ROC rows fall through.

### 10. On the real corpus the ensemble barely runs — and its only guard is blind to omission

- `sheetIsDeterministic` short-circuits at [stage4-extract.js:894-899](server/lib/import-brain/stage4-extract.js#L894-L899) whenever `confident/mapped ≥ 0.60` (`DET_SHEET_FRACTION`) **or** `confident ≥ 2 && dominant ∈ {form, rule, ratingStep}` (`:625`, no fraction test). `deterministicExtract` then reads only columns at `confidence ≥ 0.80` (`DET_MAP_CONFIDENCE`), with **no AI fallback for the rest**, while stage 3's ×0.7 disagreement penalty caps every disagreed column at 0.70 — so every disagreed column is excluded.
- The only AI oversight on that path is `sampleVerifyMap` ([:725-767](server/lib/import-brain/stage4-extract.js#L725-L767)): `DET_SAMPLE_BATCHES = 2` × `BATCH_ROWS = 20` = **≤40 rows per sheet** (1.97% of Core Rating's 2,029; **0.44%** of Dynamic Data's 9,086), needing **>30%** disagreement to raise one item.
- **It is structurally blind to omission**: `if (!detField) continue` (`:749`) means it only compares fields the deterministic path *already* produced. A mapped-but-unread column can never be flagged. No review item anywhere says "this column's data was not extracted," while `summaryCounts.columnsMapped` counts it as mapped.
- *(V2's "~97%" is an unverified upper bound; the mechanism is real, the magnitude is not measured.)*

---

*Below the top-10 line — real, mechanism-proven, but out-ranked because neither is reachable or consequential on a production run today:*

### 11. Checkpoint resume is broken — and unreachable

- [unified-import.js:333](server/lib/ai/unified-import.js#L333) seeds `resume = { stage4: { sheets: {} } }`, but [index.js:183](server/lib/import-brain/index.js#L183) always writes a checkpoint literally named `stage4`, which fails `stage.startsWith('stage4.')` and takes the `/^stage[1-9]/` branch at `:344`, overwriting the sheet map with `{entityCount, flagged}`. It then throws in **every** artifact ordering (`Cannot set properties of undefined` at `:343`, or `Cannot convert undefined or null to object` at `:348`), is caught at `:352`, and nulls the **entire** resume object — losing stages 1–3 as well.
- **Precise scope** (sharper than V2): resume *works* for a run killed mid-stage-4. It breaks for any run that **completed** stage 4 and died later. Split runs lose checkpoints only for **secondary** products (`gi > 0`).
- **Reachability**: `grep -rn resumeRunId` finds the server handler and docs — **no production caller passes it**. So the feature is dead at *two* levels, and V2's fix (namespace the artifact, allow slashes, populate `resume.digest`) is **necessary but not sufficient**: without a caller, or V1's dropped proposal to auto-attach `runId` server-side, fixing the restore loop changes nothing observable. The `~$70/110-min` blast radius is not evidenced by any committed artifact.

### 12. The escalation ladder is inverted twice, and consensus arithmetic is acceptance-biased

- **The ladder's top rung reasons *less* than the rung below it.** `callAnthropic` never sets `thinking` ([ai-call.js:115-120](server/lib/import-brain/ai-call.js#L115-L120)). Per the Anthropic model contract, omitting `thinking` means **opposite** things on the two ladder models: `claude-opus-4-8` runs **without** thinking, while `claude-sonnet-5` runs **adaptive** thinking. The stage-4 conflict ladder escalates sonnet-5 → opus-4-8 (`:302-310`), so escalating a contested row **downgrades** reasoning. It is inverted on budget too: the ladder gets `maxTokens 4096` (`:302`) while the routine first pass gets `8192` (`:932-933`) — and sonnet's thinking shares that smaller cap.
- A **single-vote field is accepted outright** at a 0.9 haircut ([stage4-extract.js:152](server/lib/import-brain/stage4-extract.js#L152)) — the strongest acceptance-bias fact, named in neither prior review.
- `weightedMajority` declares consensus at any **2 agreeing votes with no family-diversity requirement** (`:237`); agreement is boosted `max(fa,fb) × 1.05` (`:159`); conflict write-back is `Math.max(existing, resolved)` (`:426`) so **confidence can only ratchet up**, even when a judge resolves at low confidence; stage-1 disagreements are adjudicated by opus — REASONER_A's own deployment (`stage1-classify.js:198`).
- The two "decorrelated" voters receive the **identical prompt including the column map** (`:915`) — correlated on precisely the decision that matters.
- Judge verdicts are parsed by first character (`charCodeAt(0) - 97`, `:364-365`); a bounds check makes a wrong pick impossible with two candidates, but a valid verdict phrased `"candidate b"` is **silently discarded**.
- Heavily de-escalated: on template-family workbooks this machinery is largely bypassed (§4.10).

**Also verified, unranked**: the conservation invariant is a tautology (nothing measures loss between stage 4 and the plan); `deriveParentIds` reads the placeholder sentinel as a real sub-coverage name; two cells can flip a sheet to STACKED_TABLES at absolute priority; `callOpenAI` never checks or populates `MISSING_DEPLOYMENTS`; the PDF vision ensemble is decided by **item count alone** (`stage-filing.js:246-247` — the *richest* result wins, not the first non-empty); a native-PDF rung can burn ~30 min only if the first failure is non-throwing; `AliasOverlay` is threaded through four parsers but `harvestAliasOverlay` has no caller; two in-code comments (`stage1-classify.js:14`, `stage3-column-map.js:12`) claim "Temperature 0 on all Claude calls" while **no `temperature` is ever sent** — sampling runs at model default, so run-to-run reproducibility is not what the comments assert.

**Two operational defects no prior review found, both verified here:**
- **One import denies every other AI surface for an hour.** `guard(IMPORT_CONTEXT)` returns `{allow: true}` before the ceiling check ([fleet.js:103](server/lib/fleet.js#L103)), but `record()` is deliberately **not** exempt (`:112-116`, and the comment at `:99` says so): a ~$70 import accumulates into the same `windowSpendUsd` that gates every non-import surface against `CEILING_USD = 25`. The exemption protects the import *from* the ceiling while pushing every other feature *over* it. *Fix*: track import spend in a separate window, or exclude `IMPORT_CONTEXT` spend from the gating total while keeping it in telemetry.
- **Truncation-split recursion escapes every concurrency bound.** Sheets run 2-wide and batches 3-wide via `pMap`, but the batch-halving recovery is a bare `Promise.all([extractBatch(left), extractBatch(right)])` (`stage4-extract.js:939-943`) that recurses outside both pools. A blind agent measured 194 simultaneous upstream calls and 39× call amplification on a synthetic worst case. *Fix*: route the split through the same bounded pool.

**Three more, found by the blind model-catalog derivation and verified here:**
- **A fleet-registry bypass on the fallback path.** `HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT` ([unified-import.js:28](server/lib/ai/unified-import.js#L28)) is used at `:566` as `HAIKU_OVERRIDE || fleet.resolveModel('BULK_VERIFY', …)` — an arbitrary model string that never passes through the registry, against the stated invariant. *Context that tempers severity*: this is a repo-wide convention (7 other modules do the same), and `fleet.ts:80-87` already exposes `resolveDeployment(role, overrides)`, which keeps overrides inside the seam. Fix by routing through it, not by deleting the override.
- **`escalateAnthropic` is the only caller of `budget.onEscalation`** (`ai-call.js:250`) and has no caller itself; every real ladder re-implements the walk inline and omits the hook. So `brain:escalation` is fully plumbed and test-covered end to end, yet **can never fire on a production run**. The fix is to call the hook at the four inline ladder sites — not to delete the event (which would turn two tests red).
- **`callResponses` gets the generic 120 s timeout.** [ai-call.js:210-213](server/lib/import-brain/ai-call.js#L210-L213) calls `fetchWithRetry` with no third argument, so the `gpt-5.4-pro` deep reasoner — registered as "quality ≫ latency" — runs under the same ceiling as a bulk vote, and its `incomplete` status is never treated as truncation.

---

## 5. Top 10 Improvements — ranked, with corrected fixes

**Certification for every item**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `pnpm import:eval` + `pnpm exec tsx scripts/import-eval2.mts --offline` + `pnpm exec tsx scripts/phaseg-holdout.mts --check`. (`pnpm import:eval2` **does not exist**; `--check` does, at [phaseg-holdout.mts:437](scripts/phaseg-holdout.mts#L437).)

**0. Restore the write-path ordering the join destroys** *(the only fix with a proven live symptom)*. Re-apply the parent-before-child sort **after** `joinGroupWithIso`, or make the join order-preserving. ~5 lines. *Gate*: a unit test asserting every child coverage follows its parent in the post-join array; `import-promote-e2e` on E+ reports `failed: 0` where it previously reported `100`.

**0b. Move `stampDefaults` after the join** (or have it record what it stamped), so the `ISO_STAMPED_FIELDS` gap-fill can actually fire. Today the gaps are filled one step earlier and the branch is dead for every scalar. *Gate*: a test where the mapper read `states: ['TX']` and the brain read none retains `['TX']` with `allStates: false`; all four canaries exact.

**1. Make the harness able to see a term — before fixing any term.** Extend eval1's `scalarFields` to project `terms`/`states`/`source`/`coverageRefIds` under a canonical ordering, and make `goldenNumericFidelity` walk nested objects. *Gate*: a deliberately injected mutation that deletes one LIMIT term turns a board red. **A metric that cannot move is not a gate** — prove movement before trusting any subsequent green.

**2. Give the brain the limit/deductible vocabulary.** Promote the extractable `derived` fields to `role: 'source'` with explicit `mapsTo`, or add a third dictionary category for structural concepts. *Gate*: a test asserting **no** `derived`/`system` field carries `aliases`; a Core rating sheet produces ≥1 column mapped to a term-bearing field; `columnsMapped` telemetry distinguishes mapped-and-read from mapped-and-dropped.

**3. Close the four flag-not-invent violations.** (a) Gate `deriveTermsFromReferenceTables` on ≥1 parsed numeric row, mirroring the MATRIX refusal verbatim. (b) Flag stamped `allStates` in **both** sites (`stage7-plan.js:571` **and** `isoImport.ts:428`) with `allStatesAssumed` + `needsReview`. (c) Split `foldStepOp` into faithful synonyms vs unrepresentable-but-stated operators — **and fix `canonicalMap.ts:515`'s description in the same change**, or the model keeps being taught the inversion. *Gate*: `{op:'/'}` yields exactly one `rating-step-op-unrepresentable` warning and no MUL; a term-less flat table yields zero terms; **all four canaries re-run exact**. The `isoImport.ts:428` half **will** change `CORE.golden.json` — that is a legitimate behavior change requiring an explicit, reviewed, approved re-baseline, never a silent regeneration.

**4. Give stacked sheets a column map.** In `stage2-header-lock.js`, also push a lock under the plain `fp.sheetName` (`headerRowIndex` from `subTables[0]`, `isConfirmed: false`); carry `absoluteRowStart` per sub-table. *Gate*: a two-block fixture yields >0 entities and a non-empty column map. **Do not** delete the stage-5 BLOCKING→WARN downgrade in the same change — it currently never fires, and removing it before rows are anchored converts a dead branch into a live blocker.

**5. Fix the step→coverage contract end to end.** Add a rating-domain `coverageRefId` field mapped from the **ID** column (`PRODUCT FRAMEWORK ID`) rather than the name column — which requires item 2, since that alias currently sits on a `derived` field; forward-fill it down ditto rows carrying the origin cell's citation; include `step.coverageRef` in the `refIdRemap` rewrite; and correct `canonicalMap`'s description to match what every consumer already does (a `;`-joined **refId string**). *Gate*: `stepsWithCoverageRef` moves from 90/2,024 toward the ~2,003 the source states; the card-figures check goes green; GL $2,635 exact.

**6. Eliminate the silent paths.** Emit `prefilter-skip` naming both voters and keep prefiltered sheets in sweep scope; **remove the `c.domain !== 'ignore'` guard at `index.js:129`** so the digest readers can contradict the prefilter (cheapest high-value fix on the list); emit a review item at the stage-4 stacked bail (`:850`); emit `malformed-model-output` on the silent-null path **and** at the three `.catch(() => ({raw:''}))` sites; reconcile `rowKind`'s vocabulary with stage 7's. Replace `DERIVED_VERBATIM`'s open regex with a **closed vocabulary** (`(derived from row context)`, `(synthesized)`) plus a `cell === ''` requirement — **do not delete it**, or every derived `parentId` becomes an ungrounded-field violation.

**7. Fix the extraction cache in the correct order.** First gate `cachePut` on parse success and persist `{raw, stopReason}`; add `bypassCache` to the retry thunk. **Only then** point `extract-cache.js:40` at `AZURE_BLOB_CONNECTION`. Reversing that order activates a dormant poison across runs. Bump `PROMPT_VERSION` once. *Gate*: a batch whose first response is `max_tokens` triggers batch-halving on replay; the same workbook imported twice in separate processes yields `cacheHits > 0`.

**8. Repair resume — and make it reachable.** Namespace the summary artifact (`stage4.summary`) or check `stage4.sheets` before assignment; permit `split<N>/` in `sanitizeStage`; populate `resume.digest`; **and auto-attach `runId` server-side** so durability is default-on (V1's proposal, which V2 dropped). *Gate*: a test that writes the real checkpoint sequence and restores without throwing; a killed-and-resumed run demonstrably skips checkpointed stage-4 sheets. Record spend/duration in the run artifact so the ROI claim becomes measurable.

**9. Unstarve the legs, un-invert the ladder, de-correlate adjudication.** Raise prefilter 128→1024, classify 256→2048, judges 400→2048; add `refusal` as an explicit vote class; route stage-1 adjudication to a third family (`VERIFY_DEEPSEEK`) with a ×0.8 haircut. Fix **both** ladder inversions: raise escalation 4096→8192 (`stage4:302`), and set `thinking: {type:'adaptive'}` + `output_config.effort` on the opus rung so the top rung stops reasoning less than the rung below it — lifting the deployment-gated pattern that already exists at [`_shared.js:74-76`](server/lib/ai/_shared.js#L74-L76) (the gate matters: `effort` errors on Haiku 4.5). Also give `callResponses` an explicit 300 s timeout. *Gate*: `truncated-model-output` items attributable to REASONER_B drop to 0 on a live CORE run; a ladder call shows non-zero thinking usage. `fleet.lock.test.ts` pins only the six core roles, so re-routing an `EXTENDED_DEPLOYMENTS` consumer is lock-safe. **Probe Foundry before adopting `thinking`/`effort`** — and note opus-4-8 runs at `maxTokens 256` in three places, which would truncate immediately with thinking on.

**10. Honest consensus and honest telemetry.** Require cross-vendor agreement for a 2-vote majority on strict fields; stop accepting single-vote strict fields outright; reserve ×1.05 for cross-family agreement; replace the `Math.max` write-back with the resolving lineage's own confidence; parse judge verdicts by forced-tool enum instead of `charCodeAt`; add aggregate parseable-votes-per-family counters; give `MISSING_DEPLOYMENTS` a TTL and make `callOpenAI` honor it. Lower value than it looks — §4.10 shows this machinery is bypassed on template-family workbooks.

---

## 6. Complete AI Model Catalog (pipeline order)

**Fleet registry** ([shared/src/ai/fleet.ts](shared/src/ai/fleet.ts)): GROUNDED_CITED = `claude-opus-4-8` · MID_REASONER = `claude-sonnet-5` · BULK_VERIFY = `claude-haiku-4-5` · VISION = `gpt-5.1` · CHEAP_GENERAL = `gpt-5-mini` · EMBED = `text-embedding-3-small`. Extended (`:128-140`): DEEP_REASONER = `gpt-5.4-pro` (/responses) · VERIFY_DEEPSEEK = `DeepSeek-V4-Pro` · VERIFY_XAI = `grok-4.3` (**deprovisioned**, aliased to DeepSeek at `:152`) · FAST_GENERAL = `gpt-5.4-mini` · EMBED_QUALITY · RERANK (`Cohere-rerank-v4.0-pro`) · DOC_OCR (`mistral-document-ai-2512`). All via Azure AI Foundry; keys in env only.

**Cross-cutting, all verified at HEAD**: **no `temperature` is passed on any import call** (only comments explaining its omission); **no `thinking` and no `output_config.effort` anywhere on the import path** — the one deep-reasoning role runs unthinking; timeouts 120 s (brain) / 300 s (filing native-PDF) / 90 s (`_forcedToolCall`) / 60 s (proposeMapping validator); 3 transport attempts with exponential backoff capped at 8 s + 0–500 ms jitter ([ai-call.js:47-70](server/lib/import-brain/ai-call.js#L47-L70)); `cache_control: {type:'ephemeral'}` on every Anthropic system block (`:118`); result caching confined to the two stage-4 bulk votes (single call site, `stage4:927`); cost guard $25/h with 80% soft-degrade and the named `IMPORT_CONTEXT` exemption that never bypasses `fleet.record`.

| # | Pipeline position | Model | maxTokens | Batching | Escalation |
|---|---|---|---|---|---|
| 1 | Stage 0 LOB/edition assist | haiku-4.5 → opus | **300** both rungs (`stage0-router.js:183,192`) | fires on **every** upload | opus on parse-fail or conf < 0.6 |
| 2–3 | Stage 1a digest readers A/B | opus-4.8 ∥ gpt-5.1 | 8192 (`stage1-digest.js:185,189`) | ≤3 window rounds, ≤12×40×40 | single-family carried flagged |
| 4 | Stage 1a digest synthesis | gpt-5.4-pro (/responses) | 8192 (`:225`) | 1 call | fallback opus chat |
| 5–6 | Stage 1 prefilter votes | haiku ∥ gpt-5-mini | **128** (`stage1-classify.js:121,122`) | per sheet; both must agree to skip | — (fails safe on error) |
| 7–8 | Stage 1 classify A/B | opus ∥ gpt-5.1 | **256** (`:143,144`) | per sheet | adjudication on disagreement |
| 9 | Stage 1 adjudication | opus-4.8 | 256 (`:198`) | disagreements only | fail → ignore + humanFlag |
| 10 | Stage 2 header AI fallback | opus-4.8 | 256 (`stage2:144`) | det. score ≤ 0.80 only | fail → unconfirmed + review |
| 11–12 | Stage 3 column map A/B | opus ∥ gpt-5.1 | 8192 (`stage3:263,264`) | 24-col batches, 3 sheets in flight | code reconcile (×0.7) |
| 13 | Stage 4 blind map cross-check | haiku + gpt-5-mini | 8192 (`stage4:738,739`) | **≤2 batches × 20 rows per sheet** | indicts map only |
| 14–15 | Stage 4 bulk votes (**cached**) | haiku ∥ gpt-5-mini | 8192 (`:932,933`) | ≤20 rows/batch (480-cell budget) | conflicts → ladder |
| 16 | Stage 4 conflict ladder | sonnet-5 → opus-4.8 | **4096** (`:302`) — *less than the first pass* | pooled per sheet | weighted majority |
| 17 | Stage 4 both-votes-failed | sonnet-5 → opus-4.8 | 8192 (`:961`) | whole batch | dropped-batch review |
| 18 | Stage 4 judge | gpt-5.1 | **400** (`:358`) | per unresolved field, 4 ∥ | verdict 'none' → #19 |
| 19 | Stage 4 tail judge | DeepSeek-V4-Pro | **400** (`:383`) | one pass | consensus-failure review |
| 20–21 | Stage 4.5 sweeper votes | haiku ∥ gpt-5-mini | 4096 (`stage45:173,174`) | 60-cell batches, cap 300/sheet | disagreement → sonnet |
| 22 | Stage 4.5 sweeper ladder | sonnet-5 | 4096 (`:189`) | conflicted subset once | residue → NEEDS_REVIEW |
| 23 | Stage 5 semantic validator | gpt-5.1 | 4096 (`stage5:283`) | 50 entities/call, 3 groups ∥ | WARN-only |
| F1 | Filing classify | haiku (forced tool) | 500 | per doc, 3 ∥ | — |
| F2–F4 | Filing extract ladder | haiku → sonnet → opus (text); haiku ∥ opus (vision) | 16000/16000/8192 (`stage-filing:347,369,437`) | per doc | text: first non-empty; **vision: richest by item count** (`:246-247`) |
| B1 | Fallback single-pass | haiku (forced tool) | 4096 | 1 call | — |
| O1–O4 | `proposeMapping` (**orphaned**) | sonnet → opus; gpt-5.1 validator → opus | 1024–2048 | 1 pass | drop-all on validator failure |

**Prompts** (`prompts.js` unless noted; only 4 of 10 carry the FIRST_PRINCIPLES preamble; `READER_SYSTEM`, `SWEEPER_SYSTEM` and filing `EXTRACT_SYSTEM` live in stage files):
**Stage 0** — *"Determine the line of business… from CONTENT ONLY — filenames are not evidence"*; LOB whitelist; "never guess an edition". **Stage 1a** — *"You never see full grids… respond ONLY with {windowRequests} (max 12 windows, each at most 40x40)"*; "UNKNOWN over guessing". **Stage 1** — *"CLASSIFY the sheet into EXACTLY ONE of these eight canonical domains"*. **Stage 3** — *"MAP BY CONCEPT, NOT BY EXACT WORDING"*; "Never map a column to a field NOT present in the canonical dictionary" — *the dictionary it means is the one missing 15 fields' aliases (§4.3)*. **Stage 4** — *"Extract ONLY values that are present in the source cells. Never invent values"*; refIds byte-for-byte; multi-refId cells returned unsplit. **Judge** — *"If NO candidate is grounded… verdict='none' — do not invent a value"*. **Sweeper** — every cell → NOISE | FACT (name VERBATIM) | UNKNOWN. **Stage 5** — *"Your job is to find errors — not to re-extract data"*. **Filing** — *"CITATIONS ARE MANDATORY… an uncited item is a wasted item"*.

**Corrections to prior catalogs**: `MISSING_DEPLOYMENTS` is asymmetric — only `callAnthropic` and `callResponses` check/populate it; `callOpenAI` does neither, so gpt-5.1, gpt-5-mini and the DeepSeek judge re-pay a full 404 round trip forever, and the comment at `stage4-extract.js:376-377` asserting otherwise is false. **At least eleven** call sites bypass `parseWithRetry` (not six).

---

## 7. Model-Fit Assessment

| Call | Current | Verdict | Recommendation |
|---|---|---|---|
| Stage 0 assist | haiku → opus @300 | Good fit, wrong gate | Keep the model; gate on `lobSource !== 'deterministic'` so it stops firing on every upload. |
| Digest readers | opus-4.8 + gpt-5.1 @8192 | **Good fit, under-configured** | The one deep-reasoning role runs with **no thinking and no effort** — and on opus-4-8 omitting `thinking` means it runs *without* thinking. The fix pattern already exists in this repo: [`_shared.js:74-76`](server/lib/ai/_shared.js#L74-L76) sets `body.output_config = { effort }` gated on `deployment === DEPLOY_OPUS \|\| DEPLOY_SONNET` — correct, because `effort` errors on Haiku 4.5. Lift that guard into `callAnthropic` and pass `effort: "high"` plus `thinking: {type:"adaptive"}` on the opus digest/adjudication/ladder calls. |
| Digest synthesis transport | `callResponses` (gpt-5.4-pro) | **Under-timed** | `fetchWithRetry` is called with no timeout argument ([ai-call.js:210](server/lib/import-brain/ai-call.js#L210)), so the "quality ≫ latency" reasoner runs under the generic 120 s ceiling. Pass `{timeoutMs: 300_000}`, matching the filing-document precedent. |
| Digest synthesis | gpt-5.4-pro ($20/$150) | **Over-provisioned** | Merging two pre-normalized JSON objects is not the fleet's hardest task. Route to opus-4-8 or sonnet-5; reserve the pro tier for `unknown-sheet` holes. Lock-safe. |
| Prefilter | haiku + gpt-5-mini @**128** | **Right models, starved** | Reasoning models bill reasoning against the same ceiling. Raise to ≥1024 and emit a review item on veto. |
| Classify + adjudicate | opus + gpt-5.1 @256; **opus adjudicates itself** | **Wrong adjudicator** | Move adjudication to `VERIFY_DEEPSEEK` with a haircut. Opus judging its own disagreement defeats the decorrelation design. |
| Column map | opus + gpt-5.1 @8192 | **Good fit; the highest-leverage AI decision** | Justified spend — a wrong map poisons every row. But it is being asked to map against a dictionary missing its 15 most valuable aliases (§4.3). Fix the dictionary before touching the model. |
| Bulk extraction | haiku + gpt-5-mini @8192 | **Right economics, wrong job** | Transcribing 20-row windows is the pipeline's core inefficiency and its main mis-citation source. Medium-term: pointer-bindings + code reads (§8). |
| Conflict ladder | sonnet-5 → opus @**4096** | **Inverted twice — the headline model defect** | (a) *Budget*: the escalation for rows two extractors already disagreed on gets **half** the routine pass's 8192. (b) *Reasoning*: because `callAnthropic` never sets `thinking`, omission means **opposite** things on the two rungs — `claude-sonnet-5` runs **adaptive thinking**, `claude-opus-4-8` runs **without thinking**. So escalating sonnet → opus **downgrades** reasoning while also halving headroom. Fix: raise the ladder to 8192 and set `thinking`/`effort` explicitly on the opus rung. |
| Judges | gpt-5.1 @400 → DeepSeek @400 | **Right lineages, starved + fragile parsing** | Keep cross-family judging; raise to ≥2048; replace `charCodeAt` with forced-tool enum verdicts. |
| Stage-5 validator | gpt-5.1 @4096 | **Right model, blind** | Keep the cross-family choice; give it the source cells. |
| Filing ladder | haiku → sonnet → opus; vision haiku ∥ opus | **Mostly right** | Haiku-4.5 vision on native PDFs is the weak rung. **Wire `DOC_OCR`** — a complete, exported, metered `documentOcr()` already exists at [foundry.js:94-103](server/lib/external/foundry.js#L94-L103); only a caller in `stage-filing.js` plus an `IMPORT_CONTEXT` wrapper is missing. Much cheaper than V1 implied. |
| Fallback single-pass | haiku @4096 | **Under-powered** | Last-resort path for unrecognized formats — use sonnet-5; make it visible to the per-run budget. |
| Cache breakpoints | `ephemeral` on every Anthropic block | **Inert on the cheap tier only** | Minimum cacheable prefix is **4,096 tokens on Haiku 4.5** but **1,024 on Opus 4.8 and Sonnet 5**. A ≈1,167-token system prompt therefore *does* cache on the opus/sonnet legs and is a **silent no-op on every haiku call** — the two bulk votes, the prefilter and the sweeper, i.e. the highest-volume calls in the pipeline. Either pad/restructure the haiku system prompts past 4,096 or stop claiming the saving; log `usage.cache_read_input_tokens` into `budget` so inertness is measurable rather than assumed. |
| Fleet upgrade | opus-4-8 as GROUNDED_CITED | **Not a drop-in** | [fleet.lock.test.ts](shared/src/ai/fleet.lock.test.ts) is deploy-blocking and hard-asserts `DEPLOY_OPUS === 'claude-opus-4-8'`. Treat `claude-opus-5` as a governed re-certification, never an edit-the-constant change. `claude-fable-5` remains correctly forbidden and locked twice. |

`escalateAnthropic` has no caller, but **`brain:escalation` is fully plumbed** (producer `unified-import.js:373`, consumer `AgentVisualizer.tsx:245`, two green tests) — deleting it would turn tests red and is barred.

---

## 8. Architecture Critique and Redesign

### 8.1 The critique

1. **The oracle runs last.** `mapIsoWorkbook` runs at `unified-import.js:191`, *after* the brain's entire spend — and it is the sole source of the four identity fields *and* of every term. The cheapest, most reliable extractor is used as a post-hoc corrector rather than a scaffold.
2. **The ensemble votes on the wrong unit, with correlated voters.** Both bulk voters receive the identical prompt *including the column map* (`:915`), so they are correlated on the decision that matters most. And a single vote suffices to emit a field (`:152`).
3. **Citations are claims, verified later — and one regex opts out entirely.** `DERIVED_VERBATIM` lets any parenthesized verbatim skip all grounding.
4. **Verification is sampling that does not exist.** `sampledVerifications` is a hardcoded `[]`; the real sampler (`sampleVerifyMap`) reads ≤40 rows and is blind to omission by construction.
5. **The pipeline learns nothing.** `AliasOverlay` is threaded through four parsers; `harvestAliasOverlay` has no caller.
6. **The dictionary is the real bottleneck** (new). The most valuable extraction vocabulary is unreachable by design (§4.3) — no amount of model upgrade compensates for concepts the model is never shown.
7. **Nothing measures what was lost.** The conservation invariant is a tautology; no metric spans stage 4 → plan. And the gates cannot see terms at all (§3.2).

**Correction for the redesign**: V1's N1 proposed posting the mapper's `consumedSpans` to a per-cell ledger. **Those spans do not exist in production** — `mapIsoWorkbook` records them only when handed a third argument, and `unified-import.js:191` passes one. N1 must *enable* span recording first; it is not free.

### 8.2 Target architecture

The **SCAFFOLD → SURVEY → BIND → COURT → RE-DERIVE → LEARN** inversion is retained as the target; two independent blind redesigns converged on the same core move. Its central insight — that **pointer-bindings make transcription hallucination unrepresentable rather than post-hoc detectable** — is right and should survive.

- **SCAFFOLD**: run the deterministic maximum *first* (mapper + structure detectors), emitting a per-cell consumption ledger. Everything downstream is scoped to the residue.
- **SURVEY**: models read *structure*, not values — which region means what, at what confidence.
- **BIND**: models emit **pointers** (`sheet!cell` → canonical field), never transcribed values. Code dereferences. A hallucinated value becomes unrepresentable.
- **COURT**: adjudicate only genuinely contested bindings, cross-family, with refusal as a first-class vote.
- **RE-DERIVE**: total inverse projection — reconstruct the source grid from the plan and diff against the original, replacing capped sampling.
- **LEARN**: harvest confirmed alias bindings into the overlay that already exists but is never fed.

**Migration, re-sequenced.** P0 is now §5 items **1, 2, 3, 6, 7** — the harness must see terms *before* term fixes can be certified, and the dictionary must expose term vocabulary before any structural work is meaningful. Items 4, 5, 8 follow. The structural redesign is last. Each phase independently revertible.

P1's acceptance criterion must **not** be "byte-identical bundles" — that is falsified by the flag's own definition and by stage-4 nondeterminism (which is real: no `temperature` is set anywhere despite two comments claiming 0). Use instead: **identical entity sets and identical strict-field values**, diffed on `refId`/`parentId`/`order`/`number`, with provenance allowed to differ.

---

## 9. Reason Table

*(K = kept, R = replaced, M = merged, X = rejected, ↕ = re-ranked, N = new.)*

| # | Decision | Affects | Evidence consulted | Why |
|---|---|---|---|---|
| 1 | **X/N** — refuted V2's #1 as a production defect; replaced; the dictionary finding now ranks #3 | §4.3, §0 | canonicalMap.ts:216,256; stage3-column-map.js:31,37; `grep terms stage4-extract.js` = 0 | The brain can never author `terms`/`order`; `adoptIdentity`'s `!== undefined` guard has nothing to overwrite |
| 2 | **X** — rejected V2's live-symptom attribution for #1 | §4.3, §3.3 | import_promote_e2e-{CORE-ATT,EPLUS-R2,EPLUS-E2E}.json | R2 kept 59+22 terms and CORE-ATT 366+217 through the same join; E2E zeroed all three metrics with `failed:100` |
| 3 | **N** — added the dead-alias finding (now #3) | §4.3, §5.2 | 15/88 fields parsed from canonicalMap.ts; stage3:31 | Explains the term gap, the step→coverage gap and why only the mapper makes terms |
| 4 | **N** — added "neither harness can see a term" (now #4) | §3.2, §5.1 | import-eval.mts:134-148; import-eval2.mts:84-93; import-eval2-metrics.mts:131; golden2-schema.mts:185-193; CORE.golden.json | Three-file proof; 0/112 golden coverages carry terms; `grep terms import-eval.mts` = 0 |
| 5 | **R** — reversed V2's rejection of V1's `RATE TABLE ID:` finding | §0, §2.4 | layoutDetector.ts:26-34, :38, :62-65; own dump (0 occurrences) | `TABLE NAME` is *explicitly* excluded from the primary set; V2 inverted the causality it accused V1 of |
| 6 | **R** — corrected "Rule References is the most cells" | §0, §2.1, §4.5 | Own ExcelJS dump: 119,574 / 110,733 / 76,198 | It is third; the blast-radius claim overstated |
| 7 | **↕** — demoted stacked-sheet bail from V2 #4 to #5 | §4.5 | stage2:75-86; stage3:194; stage4:846,850 | Mechanism confirmed exactly; magnitude corrected downward by #6 |
| 8 | **N** — added `isoImport.ts:428` as a second `allStates` fabrication site | §4.6b, §5.3 | isoImport.ts:428; CORE.golden.json `allStates:true` | Neither prior review names it; it *is* golden-pinned, unlike the stage-7 site |
| 9 | **N** — added `canonicalMap.ts:515` as a second operator-inversion site | §4.6c, §5.3 | canonicalMap.ts:515 vs stage7-plan.js:196-201 | Fixing only `foldStepOp` leaves the dictionary teaching the model the inversion |
| 10 | **K** — kept the `deriveTermsFromReferenceTables` fabrication | §4.6a | isoImport.ts:1739, :1995-2031 | The MATRIX branch's own comment is the proof; refusal applied to one shape only |
| 11 | **N** — established the fix is golden-safe | §5.3 | CORE.golden.json: 0 coverages with terms | Contradicts the natural fear that the golden pins the fabrication |
| 12 | **K/↕** — kept the step→coverage contract defect, held at #5 | §4.7 | canonicalMap.ts:506-511; pricingLinks.ts:47-56, :69-76; stage7-plan.js:784-785 | Confirmed exactly; heuristic fallback softens the symptom |
| 13 | **R** — corrected V2's "canonicalMap gives the rating domain no field" | §4.7 | canonicalMap.ts:448 (`ratingProgram.refId`, role derived) | The alias exists but sits on a `derived` field, so it is never offered — a different mechanism |
| 14 | **K** — kept the filing filename→refId defect at #6 | §4.8 | stage-filing.js:411, :425, :449, :301 | `formNumbers` genuinely absent from `required`; V2's `:424` is one line off |
| 15 | **M/N** — merged the silent paths and added two | §4.9 | constants.js:80; stage1-classify.js:121-122; stage4:738-739; stage5-validate.js:45,111; stage4:584-598 | Transport exceptions (not just empty raw) are silent; `rowKind` vocabulary added |
| 16 | **X** — rejected V2's "delete `DERIVED_VERBATIM`" | §5.6 | stage4-extract.js:489 (`(derived from row context)`) | Deleting it makes every derived `parentId` ungrounded; closed vocabulary is the correct fix |
| 17 | **N** — added the seven-stage `ignore` exclusion cascade | §4.9 | index.js:129,135,198; stage2:67; stage3:188; stage4:839; stage5:254 | Larger blast radius than V2's single citation |
| 18 | **N** — added `sampleVerifyMap` is blind to omission | §4.10, §8.1 | stage4-extract.js:725-767, esp. :749; DET_SAMPLE_BATCHES=2, BATCH_ROWS=20 | The only guard on the dominant path cannot detect the dominant failure |
| 19 | **↕** — de-escalated V2's "97%" to an unverified upper bound | §4.10 | stage4:625; no measurement in repo | Mechanism real, magnitude unmeasured |
| 20 | **↕** — demoted resume from #2 to #9 | §4.11 | `grep resumeRunId` → no production caller | Dead at two levels; V2's fix is necessary but not sufficient |
| 21 | **R** — restored V1's "auto-attach runId server-side" into the fix | §5.8 | V1:225; unified-import.js:331 | V2 dropped the half of the fix that makes the other half observable |
| 22 | **R** — corrected V2's resume scope | §4.11 | unified-import.js:342-355; index.js:183 | Works mid-stage-4; breaks only for runs that completed stage 4 |
| 23 | **R** — corrected the split-run checkpoint claim | §4.11 | unified-import.js:494-496; run-observatory.js:47-50 | Only secondary products (`gi > 0`) lose checkpoints |
| 24 | **X** — rejected "~$70/110-min" as evidence | §4.11, §3.3 | e2e artifact keys carry no spend or duration | Inherited from V1 unverified |
| 25 | **R** — corrected V2's "batch-halving never runs" | §0, §4.9 | extract-cache.js:108-119 (`return res`); stage4:922,937 | `stopReason` survives on a miss; the real defect is the guaranteed no-op retry |
| 26 | **N** — added the fix-ordering hazard for the cache env var | §5.7 | extract-cache.js:40 vs :113-118 | Fixing the env var first *activates* the poison |
| 27 | **K** — kept the cache env-var divergence | §4.9, §5.7 | extract-cache.js:40 vs run-observatory.js:22, run-results.js:15, _shared.js:264, filing.js:233 | Five modules use `AZURE_BLOB_CONNECTION`; one does not |
| 28 | **K/N** — kept the consensus findings, added single-vote acceptance | §4.12 | stage4:152, :159, :237, :364-365, :426, :915; stage1-classify.js:198 | All verified exact; `:152` is the strongest acceptance-bias fact and is in neither prior review |
| 29 | **R** — corrected "falls through harmlessly" | §4.12 | stage4:364-365 + bounds check | Fails safe but discards a valid verdict |
| 30 | **R** — corrected V2's eval1/eval2 "same parser same day" framing | §0, §3.2 | import-eval.mts:75-83 vs import-eval2.mts:47,76-80 | Disjoint corpora; the contradiction's rhetorical force is unearned |
| 31 | **R** — split V2's single-cause 0.000 diagnosis into two | §3.2 | import-eval2-metrics.mts:124-131; gl-base 93/99 joined, 0/110 matched | Join failure on some goldens, genuine loss on others |
| 32 | **R** — corrected "all 8 collapsed / a regression no gate saw" | §0 | import_eval2_results.json baseline vs fresh; one metric family moved | Board was already 8/8 red; only accounting metrics moved |
| 33 | **X** — rejected the "Jul 24–26 fix wave" attribution | §0 | no bisect performed | Any commit since Jul 17 is a candidate |
| 34 | **K** — kept §2's measurements, re-measured independently | §2 | Own ExcelJS dump of both books | Every figure re-derived to the unit; V2's `+4` forms-band correction confirmed |
| 35 | **N** — added pervasive phantom extents | §2.1 | 6 of 9 sheets over-report; Dynamic Data 90→8, Rule Refs 77→32 | Prior reviews flagged only Core Rating's 1,378 |
| 36 | **N** — added `EPLS.RAT` occurs exactly once | §2.2 | Own dump: EP.RAT 293 vs EPLS.RAT 1 | A prefix-keyed join fails on 293 rows and appears to work on 1 |
| 37 | **K** — kept §6's catalog, re-verified every `maxTokens` | §6 | grep of all 28 `maxTokens:` sites | No wrong model, maxTokens or batch constant found in any row |
| 38 | **R** — corrected "six call sites bypass `parseWithRetry`" | §6 | 11 sites enumerated | Materially changes the retry posture |
| 39 | **R** — corrected the vision-race escalation cell | §6 | stage-filing.js:246-247 | Richest-by-item-count wins, not first non-empty |
| 40 | **K** — kept the no-temperature / no-thinking finding | §6, §7 | `grep temperature\|thinking\|effort` on the import path | Confirmed: only comments, never a parameter |
| 41 | **N** — added the stale "Temperature 0" comments | §4 tail | stage1-classify.js:14; stage3-column-map.js:12 | They assert a determinism property the code does not set |
| 42 | **K** — kept the inverted budget ladder | §6, §7, §5.9 | stage4:302 (4096) vs :932-933 (8192) | Verified exact |
| 43 | **X** — rejected deleting `brain:escalation` | §7 | unified-import.js:373; AgentVisualizer.tsx:245; 2 tests | Would turn tests red — barred |
| 44 | **K** — kept DOC_OCR "client exists, caller missing" | §7 | foundry.js:94-103 | Confirmed exported and metered |
| 45 | **K** — kept `claude-opus-5` "not a drop-in" | §7 | fleet.lock.test.ts (deploy-blocking) | Requires governed re-certification |
| 46 | **N** — verified `claude-fable-5` is locked exactly twice | §1.1 | fleet.lock.test.ts:60-61; fleet.test.ts:23 | V2 said "twice" without citing both |
| 47 | **K** — kept the target architecture | §8.2 | Two independent blind redesigns converged | Strongest available signal |
| 48 | **↕** — re-sequenced P0 around the harness and the dictionary | §8.2, §5 | §3.2 + §4.3 | A term fix cannot be certified by a harness blind to terms |
| 49 | **K** — kept the dead `consumedSpans` correction | §8.1 | isoImport.ts:2231; unified-import.js:191 | N1's ledger input does not exist in production |
| 50 | **K** — kept `sampledVerifications` is `[]` | §1.3, §8.1 | stage7-plan.js:1114; unified-import.js:653 | Verified |
| 51 | **K** — kept the `forms` review-toggle gap | §1.4 | acceptedPlan.ts:53 | Verified exact |
| 52 | **R** — corrected "nothing auto-persists" | §1.1 | `persistIfRequested()` in unified-import.js | True for entities, false for the bundle |
| 53 | **N** — recorded that the client-path removal is uncommitted | Header | `git status`, `git diff --stat` | Both prior reviews analyze the working tree while claiming HEAD |
| 54 | **N** — ran the gate | §3.1 | 185 files / 2,025 tests green, build clean | Verify-first |
| 55 | **N** — confirmed all four canaries in their locked tests | §1.1 | evaluator.test.ts:16; workedExample.canary.test.ts:30; generalLiability; reconcile.test.ts:100 | Named in CLAUDE.md as exact-or-broken |
| 56 | **X** — declined to commit an eval2 re-baseline | §3.2 | Tracked artifact; not requested | The maintainer's call, not this review's |
| 57 | **X** — declined to hit a live host | §3.3 | No `BASE_URL`; credentials in gitignored `keys.md` | Outward-facing and unauthorized |
| 58 | **M** — retained V2's dropped-but-real items | §4 tail | Verified individually | Union rather than deletion |
| 59 | **N** — added the ladder's **reasoning** inversion (not just budget) | §4.12, §7, §5.9 | ai-call.js:115-120 (no `thinking` ever set); `claude-api` skill thinking-defaults table | Omitting `thinking` means opposite things on the two rungs: sonnet-5 runs adaptive, opus-4-8 runs *without*. Escalation downgrades reasoning |
| 60 | **R** — corrected the inert-cache claim's scope | §7 | `claude-api` skill cache minimums: Haiku 4.5 = 4096, Opus 4.8 / Sonnet 5 = 1024 | A ~1,167-token prefix caches fine on opus/sonnet; it is inert only on the haiku calls — V2 implied a blanket no-op |
| 61 | **N** — added `_shared.js:74-76` as the in-repo `effort` precedent | §7, §5.9 | server/lib/ai/_shared.js:74-76 | Makes the fix a proven pattern rather than a speculative one, and encodes why Haiku must be excluded |
| 62 | **N** — added the `HAIKU_OVERRIDE` fleet-registry bypass | §4 tail | unified-import.js:28, :566; fleet.ts:80-87 | An env var injects an arbitrary model string; tempered because it is a repo-wide convention with an existing in-seam alternative |
| 63 | **N** — added that `brain:escalation` can never fire | §4 tail, §7 | ai-call.js:250; `escalateAnthropic` has no caller | Reconciles V2's "fully plumbed" with the blind agent's "dead": the SSE path is real and tested, but nothing triggers it. Fix = call the hook, not delete the event |
| 64 | **N** — added the `callResponses` missing timeout | §4 tail, §7 | ai-call.js:210-213 vs :129 | The deep reasoner runs under the generic 120 s ceiling |
| 65 | **N** — promoted the join's **ordering** destruction to #1 | §4.3 | stage7-plan.js:690-695 (sort + its comment) vs :317-350 (`out` rebuilt) | The sort is documented as load-bearing for the write path and the join discards it; explains `failed: 100` / two 50-row batches, which a field-level bug cannot |
| 66 | **R** — replaced V2's #1 causal story with the `stampDefaults` ordering bug | §4.4 | stage7-plan.js:699-701 before :717-723; the `brainHas` guard at :299-300 | The gap-fill can never fire because the gaps were filled one step earlier — so it is importer defaults beating mapper-read evidence, the reverse of V2's claim |
| 67 | **N** — added the cost-guard window leak | §4 tail | fleet.js:99 (comment), :103, :112-116; CEILING_USD=25 | The import exemption protects the import while pushing every other surface over the ceiling |
| 68 | **N** — added unbounded truncation-split recursion | §4 tail | stage4-extract.js:939-943 vs the `pMap` bounds | Blind agent measured 194 concurrent calls / 39× amplification |
| 69 | **X** — did **not** re-rank on unverified blind findings | §4 | NaN judge confidence, `ratePlaceholders` bypassing `acceptedPlan`, tenant attribution, ledger sheet-name collisions | Plausible and mechanism-stated, but I did not personally re-verify them in code; recorded as leads for the fix session rather than ranked findings |

---

## Appendix — primary sources

**Code**: `server/lib/ai/unified-import.js`, `server/lib/import-brain/*.js`, `shared/src/insurance/isoImport.ts`, `shared/src/import/{structure,canonicalMap}.ts`, `shared/src/ai/fleet.ts`, `app/src/lib/import/importProduct.ts`, `app/src/import/acceptedPlan.ts`, `app/src/lib/insurance/pricingLinks.ts`.
**Harnesses**: `scripts/import-eval.mts`, `scripts/import-eval2.mts`, `scripts/lib/{import-eval2-metrics,golden2-schema}.mts`, `scripts/phaseg-holdout.mts`, `scripts/import-promote-e2e.mts`.
**Evidence**: `tests/golden/import/*.golden.json`, `docs/audit/import_promote_e2e-*.json`, own ExcelJS dump of both workbooks, own gate run.
**Workbooks**: `latest_samples/Product Specifications _Core.xlsx`, `_E+.xlsx`.
