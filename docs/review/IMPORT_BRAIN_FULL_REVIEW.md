# Import Brain — Full Review, Model Audit, and Redesign

**Date**: 2026-07-26 · **HEAD**: 83cc471 · **Scope**: the server import brain (`server/lib/import-brain/**`, `server/lib/ai/unified-import.js`, `shared/src/insurance/isoImport.ts`, `shared/src/import/**`) after removal of the deterministic client-side upload path.
**Method**: 12 independent analysis agents (7 parallel code/workbook/evidence readers, 3 adversarial analysts with distinct lenses, 2 independent pipeline redesigns), every load-bearing claim re-verified in code at HEAD before inclusion. All file:line citations were checked on 2026-07-26.

---

## 0. PROMPT TO THE REVIEWING AI

> You are an expert AI-systems reviewer with full read access to this repository. Your task has six parts. Do them in order and do not skip the independent-verification step.
>
> 1. **Review this markdown document end to end.** For every claim that carries a `file:line` citation, spot-check at least 20% of citations directly in code, prioritizing the Top-10 failure list (§4) and the model catalog (§6). Record every claim you could not confirm.
> 2. **Review the feedback in this document critically.** For each of the ranked items in §4 and §5, decide independently: is the mechanism real, is the severity/likelihood scoring right, is the proposed fix the cheapest correct one? Where you disagree, say so and say why.
> 3. **Independently review how the import brain works.** Do not trust §1 — read `server/lib/ai/unified-import.js`, `server/lib/import-brain/*.js`, `shared/src/insurance/isoImport.ts`, `shared/src/import/structure/*`, and `docs/IMPORT_BRAIN.md` yourself, and run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` plus (if a live host is configured) `pnpm import:eval` to ground your understanding in behavior, not prose. Also open the two real workbooks in `latest_samples/` (a dump script pattern is described in §2).
> 4. **Complete the same deliverables as this review, independently**: (a) an explanation of how the import brain works for an AI with no context; (b) a review of the Core and E+ workbooks; (c) a ranked top-10 list of reasons the import brain might not work, 3 bullets each; (d) a ranked top-10 list of improvements, 3 bullets each; (e) a catalog of every AI model call in pipeline order with parameters and prompts; (f) a per-call model-fit assessment with substitutions where warranted; (g) a critique of the pipeline/ensemble architecture and an innovative improved pipeline design.
> 5. **Merge your results with this document** into a single best-of-both artifact: keep whichever analysis is better-evidenced on each point, union the non-overlapping findings, and resolve conflicts by going back to code. The merged artifact must be strictly better-grounded than either input.
> 6. **Produce a reason table for every decision you made** — one row per decision (kept / replaced / merged / rejected / re-ranked), with columns: *Decision*, *What §/item it affects*, *Evidence consulted (file:line)*, *Why*. No decision without a row.
>
> **Finally**: distill everything into **one single prompt** — self-contained, pasteable into a fresh AI session with repo access — that instructs that AI to enhance and optimize the import brain. The prompt must encode: the non-negotiable invariants (citations-or-discarded, flag-not-invent, byte-faithful refIds, fleet-registry-only models, never `claude-fable-5` in the fleet, four exact rating canaries, atomic mutation envelope), the ranked defect list with acceptance gates for each fix, the model changes to make, the target pipeline architecture and its migration phases, and the certification ritual (gate + `pnpm import:eval` + `scripts/phaseg-holdout.mts --check` + a committed eval2 re-run) that every change must pass. Constraints: never weaken a test, threshold, canary, or golden to go green; fix at the cause.

---

## 1. How the Import Brain Works (for an AI with zero context)

### 1.1 What this system is

The platform ("Product Reinvention Hub") converts semi-structured insurance documents — product-specification Excel workbooks, rate manuals, carrier filing PDFs — into a governed canonical **Product Component Model (PCM)** and prices it through a deterministic rating engine. The PCM entities (types in `shared/src/types.ts`): **Product** (identity + governance + state scope), **Coverage** (hierarchical via `parentId`, carries `terms` of kind LIMIT/DEDUCTIBLE/OPTION, `formNumbers`), **Form** (identity = byte-faithful `number` + `edition`, carries `dynamicFields[]`), **Rule** (condition/outcome, links coverages and forms), **RatingProgram/RatingStep** (ordered SET/MUL/ADD/MIN_FLOOR steps with `source: {type: RT|LD|INPUT|CONST|SPP, ref}`), and **RTTable/LDTable** (factor tables; a grid-shaped RT table gets `dimensions` + `valueColumn` from `deriveGridModel` so `genericRtLookup` can price it).

The **import brain** is the ingestion half: bytes → cited, canonical entities that a **human reviews before anything is written**. Nothing auto-persists; the pipeline produces a proposal bundle, the reviewer accepts/excludes items, and only then does the client write — as a DRAFT, in dependency order, every entity through `adapter.db.mutate()` (entity + auditEvent + version + searchIndex in one Cosmos transactional batch).

Five invariants govern everything; violating one is a bug, never a convenience:

1. **Citations-or-discarded** — every extracted field must cite its source cell `{sheet, cell, verbatim}`; uncited claims are dropped by the pipeline.
2. **Flag-not-invent** — when the source does not establish a value, surface a notice / `UNKNOWN`; never fabricate a plausible one.
3. **Byte-faithful identifiers** — refIds and form numbers carried byte-for-byte; the only legal transform is `refIdToDocId` (dots→dashes, case preserved).
4. **Fleet-registry models only** (`shared/src/ai/fleet.ts` bridged to `server/lib/fleet-shared.cjs`), routed through the in-process cost guard. Import runs under the named `IMPORT_CONTEXT` exemption (never budget-denied, never degraded) but telemetry is always recorded. Never `claude-fable-5`.
5. **Four rating canaries stay exact**: PH $1,528 (`shared/src/rating/evaluator.test.ts`), PA $1,002 (`workedExample.canary.test.ts`), GL $2,635 (`generalLiability.evaluator.test.ts`), filing-import $1,281 (`shared/src/insurance/filing/reconcile.test.ts`). "Exact or broken."

**Recent change (this session)**: the deterministic client-side parse route for multi-file XLSX uploads was removed. `app/src/import/UnifiedImportModal.tsx` now sends **every** upload to the server brain; `ImportWorkbookModal.tsx` and `app/src/lib/import/readWorkbook.ts` were deleted. The deterministic ISO mapper (`mapIsoWorkbook`) still runs — server-side only — as the stage-7 identity oracle, and remains pinned by its golden suites. The `proposeMapping` API endpoint (`server/lib/ai/propose-mapping.js`, mounted at `server/lib/ai/index.js:84`) lost its only client caller and is now orphaned-but-mounted.

### 1.2 The two-extractor design

Extraction happens **twice, by two decorrelated systems**, joined at the end:

- **The deterministic ISO mapper** (`shared/src/insurance/isoImport.ts`, `mapIsoWorkbook`, ~2,560 lines, pure/LLM-free): finds template sheets by name regex, detects header rows by alias-group scoring (first 20 rows, ≥3 alias matches), maps columns alias-priority-first, and parses framework/forms/dynamic-fields/rules/stacked LD-RT tables/rating deterministically. It derives coverage hierarchy from refId segment nesting + SUB-COVERAGE columns + group context (`coverageHierarchy.ts`), synthesizes SYNTH-marked ids only where the source has content but no id, and refuses rather than guesses (matrix tables refused, non-numeric limits kept as `unpricedRows`, blank requirement → `UNKNOWN`). Golden-pinned: F1 ≥ 0.95, 100% refId exactness, GL canary $2,635 exact.
- **The AI brain** (`server/lib/import-brain/*.js`, orchestrated by `server/lib/ai/unified-import.js`): an ensemble of fleet models that reads the same grids, robust to novel layouts. It is the **provenance source** — per-field citations and confidences.

At **stage 7** (`stage7-plan.js`, `buildImportPlan`/`joinGroupWithIso`) the two join: `ISO_ORACLE_FIELDS = refId, parentId, order, terms` — the mapper **wins outright**; `ISO_STAMPED_FIELDS` (formNumbers, states, status…) gap-fill only ("absence never beats a cited value"); brain-cited values keep the brain's provenance; refId adoption records a `refIdRemap` so every referencing edge follows. Mapper-only entities append; brain-only entities stay, flagged.

### 1.3 The pipeline, stage by stage (entry: `POST /api/ai/unifiedImport`, SSE-streamed)

- **Stage 0 — Route** (`stage0-router.js`): magic-byte sniffing (never filenames). ZIP+workbook → server ExcelJS parse → StructuralModel (used-range clamped — a sheet reporting 1,048,576 phantom rows parses to its true extent); PDF → filing pipeline (text if ≥400 extractable chars, else native-PDF vision blocks); CSV/text → single-sheet structural model. OOXML armor runs before ExcelJS materializes anything: per-entry compression ratio, total uncompressed bytes, entry count, declared-cell ceiling (~3.5M), parse wall-clock — breach throws structured `IMPORT_413`. Hidden sheets are **included** with `hiddenSource` provenance. Deterministic LOB inference first (refId prefixes + stated "LINE OF BUSINESS" cells against the LOB registry); a haiku assist (maxTokens 300) only when inconclusive, escalating to opus below confidence 0.6 — a model can vote on a prefix, never mint a refId. Embed caps (2000 rows × 128 cols) are healed for flat sheets from the uncapped grid (`extendTruncatedGrids`), but **deliberately not for STACKED_TABLES sheets** (see §4 item 2).
- **Stage 1a — Digest** (`stage1-digest.js`): dual readers (opus + gpt-5.1, maxTokens 8192) over a compressed structural digest with up to 12 bounded 40×40 window requests each; synthesis by gpt-5.4-pro on the `/responses` surface (fallback opus). Output is telemetry + a cross-check; digest-vs-classify disagreements become review items.
- **Stage 1 — Classify** (`stage1-classify.js`): per sheet — cheap prefilter (haiku ∥ gpt-5-mini, 128 tokens, both must agree to skip a chrome sheet), then dual classification (opus ∥ gpt-5.1, 256 tokens) into 8 domains (`product-framework | forms | rating-roc | rules | limits-deductibles | rate-tables | definitions | ignore`), opus adjudicating disagreements. Fail-closed to `ignore` + human flag.
- **Stage 2 — Header lock** (`stage2-header-lock.js`): deterministic scoring first (score > 0.80 → no AI); opus fallback (256 tokens) for the ambiguous minority; STACKED sheets lock per sub-table under `"Sheet::Sub"` pseudo-names.
- **Stage 3 — Column map** (`stage3-column-map.js`): state-matrix columns carved out deterministically; the rest mapped by opus ∥ gpt-5.1 (8192 tokens, 24-column batches) against a domain-pruned canonical dictionary (`shared/src/import/canonicalMap.ts` — aliases, enums, `mapsTo` foreign keys). Agreement averages confidence; disagreement ×0.7 + review; unmapped columns surfaced, never dropped.
- **Stage 4 — Extract** (`stage4-extract.js`): the heart, ~90% of runtime/cost. When ≥60% of mapped columns have confidence ≥0.80, a **deterministic code fast-path** reads rows byte-perfectly (only cross-checked by a 2-batch blind AI sample). Otherwise dual bulk votes — haiku ∥ gpt-5-mini, maxTokens 8192, batches of ≤20 rows (cell-budget 480/`mappedCols`), wrapped in a sha256 extraction cache (LRU 512 + Blob). Field-level reconciliation: agreement → ×1.05 confidence boost; single vote ×0.9; conflicts climb a **sonnet → opus ladder** (pooled per sheet), then a **gpt-5.1 judge** (400 tokens) with the actual source cells, then a **DeepSeek-V4-Pro tail judge** (third lineage); no grounded verdict → `consensus-failure` review item, best candidate kept flagged ≤0.5. Truncation halves the batch and recurses ("rows are never dropped for size"). Post-passes (no AI): SYNTH refId minting, multi-refId expansion, parentId derivation, section-header forward-fill (citations point at the origin cell), FACT posting to the conservation ledger.
- **Stage 4.5 — Conservation sweep** (`stage45-sweeper.js`): every cell the extractors did not account for is classified NOISE/FACT/NEEDS_REVIEW by haiku ∥ gpt-5-mini (60-cell batches), sonnet on conflicts, capped at `SWEEP_MAX_PER_SHEET = 300`; a FACT's name must be literally contained in the cited cell ("invention is impossible by construction"); residue becomes one `census_unaccounted` review item. Sweeper FACTs become **nominations** — visible in review, excluded from the write by default (a model proposal is opt-in).
- **Stage 5 — Validate** (`stage5-validate.js`): a deterministic citation resolver runs first — resolves every citation against the real grid, byte-compares strict fields (refId/number/parentId), and its findings can **block** stage-7 auto-accept. Then a gpt-5.1 semantic pass (50 entities/call, WARN-only).
- **Stage 6 — Reconcile** (`stage6-reconcile.js`): pure aggregation, zero AI, writes nothing.
- **Stage 7 — Plan** (`stage7-plan.js`): ISO join (§1.2), workflow defaults, refId-remap edge rewriting, dynamic-field folding onto forms, RT-grid metadata, plan-integrity checks (duplicate refIds, orphans, dangling form refs), completeness pillars, and the reviewable bundle `{plan, review, unresolved, importWarnings, provenance, completeness}`.

**Filing (PDF) path** (`stage-filing.js`): classify each document's role by structure (haiku, forced tool) → extract rateOrder/manual/policyForm through a haiku→sonnet→opus ladder (16k tokens; native-PDF vision blocks race haiku ∥ opus, 5-min timeout). Models return **schemas + verbatim table regions, never transcribed rows** — deterministic code parses the rows (`tableParser.ts`); reconcile is pure and canary-pinned ($1,281). A **fallback** single-pass haiku extractor handles unroutable documents.

**Durability**: a client-minted `runId` persists the finished bundle and per-stage checkpoints to Blob, so a dropped SSE stream is a reconnect, not a re-run; per-stage/per-sheet checkpoints make partial resume possible (caveats in §4).

**Cost posture**: everything flows through `resolveAnthropic`/`resolveOpenAI` → `fleet.guard()`; import passes `IMPORT_CONTEXT` (never denied, never degraded) but every call is recorded (`fleet.record` + per-run `budget.byDeployment` + SSE `brain:spend`). A CORE-class run measures ~$70 / ~110 min today.

### 1.4 Review & write path

`UnifiedImportModal.tsx` renders a two-section review (Detected — with per-section include toggles and per-item exclude; Review & confirm — unresolved, inter-model disagreements, sampled verifications, FormatCard). `acceptedPlan()` provably excludes deselected items. On confirm, `importPlan()` writes in dependency order (product → tables → coverages parent-before-child → forms → rules → rating), all through the atomic mutation envelope; forms are draft-namespaced (`forms/{draftId}__{number}`); partial failures degrade to `skipped`, never lose the draft.

---

## 2. The Source Reality: Core and E+ Workbook Review

Both `latest_samples/Product Specifications _Core.xlsx` and `_E+.xlsx` were dumped cell-by-cell with ExcelJS (structure, markers, hidden rows, sentinel vocabulary, formulas). Both: 9 visible sheets, same template family, zero error cells. **Core is the throughput stressor (~10–40× E+ in most domains); E+ is the schema-drift stressor.**

### 2.1 Inventory (true used ranges vs reported)

| Sheet (Core / E+) | Domain | Core true size | E+ true size | Hazards |
|---|---|---|---|---|
| Revision History | skip | 12r (reports 122) | 12r | phantom ranges |
| Specification Definitions | definitions | 88r×4 | 87r×4 | header at r4 (not r5) |
| Framework | product-framework | 142r×65, 8.8k cells | 102r×65 | STATUS blank on all data rows |
| Forms Specifications | forms | **1,460r×76, 110,733 cells** | 222r×80 | HYPERLINK formula cells; col drift |
| Forms Dynamic Data | dynamicFields | **9,086r×8, 63,293 cells** | 1,835r×8 | **key columns swapped between books** |
| Rules Specifications | rules | 445r×75 | 179r×75 | **Core hides 384 of 440 rule rows** |
| Rule References | rules/reference tables | **7,184r×32, 76,198 cells, 1,034 merges, 1,223 hidden rows** | 3,651r×32, 2,970 hidden rows | stacked tables, no global header |
| Rating Specifications | rating | **2,029r×69, 119,574 cells** (reports 1,378 cols!) | 321r×74 | hidden dup column M; dup headers |
| Data Validation | enum vocab | 51r | 51r | **identical sheet name in both books** |

### 2.2 Structure and identity facts the pipeline must survive

- **Header geometry**: r1 banner / r2 client / r3 phase, r4 merged *group* band ("STATE APPLICABILITY" spanning ~52 columns), r5 true header — except Definitions (r4), Rule References (no sheet header; each stacked table has its own), Data Validation (section banners). Multi-line headers (`"SUB-\nCOVERAGE"`), trailing-space headers (`"CALCULATION "`), duplicate names (two PARENTHESES, two ALL ACTIVE STATES in Core Rating — one hidden and blank).
- **Stacked markers**: only `TABLE NAME:` and `RULE ID:` (Core) / `RULE ID(s):` (E+) exist. **`RATE TABLE ID:` — the brain's primary stacked marker — occurs zero times in either book.** Core markers are non-1:1 (237 TABLE NAME vs 361 RULE ID lines); E+ is exactly 40/40. Widest table 32 cols; 217 vertical merges yield 3,077 blank continuation cells in col A.
- **Hidden content is real content**: Core Rules hides 87% of its rules (leftover autofilter); E+ Rule References hides a 2,970-row vehicle-eligibility table (with literal `NULL` strings). Skipping hidden rows silently drops most of the corpus — the brain correctly ingests them with provenance.
- **refId reality**: `CORE.PRD.001` / `CORE.COV.*` / `CORE.RU*` / `CORE.RAT.0001.01`; E+ uses `EPLS.*` — **except rating steps, which use `EP.RAT.*`** (in-book prefix mismatch that breaks any `<prefix>.RAT` join). 4-segment sub-coverage ids exist (`CORE.COV.010.002`). Multi-ID cells: 13 semicolon-joined coverage refs in single E+ Rating cells; every Rule References RULE ID line is multi-ID. Cross-book anchor drift: the same endorsements anchor at LOB level in Core, PRD level in E+. Form numbers embed spaces and state suffixes (`AC 001 AZ`, `EP 201 MO`) — byte-faithful or broken.
- **Messiness with counts**: `<Intentionally Blank>` ×564 (Core) / ×590 (E+) — appearing as *data* in key and state columns; untrimmed values ×2,421/×2,097 (`"No "` ≠ `"No"`); state vocab drift per sheet (`X`/`N/A` on most sheets but bare `NA` ×86,511 on Core Rating, whose own formulas test `"NA"`; plus one stray `"COLL"` token); 1,875/510 formula cells including `HYPERLINK("#'Core Forms Dynamic Data'!A6","AC 107")` — a free deterministic forms↔dynamicFields join edge; vertical-ditto continuation (COVERAGE NAME blank on **1,934/2,024** Core rating rows); 21–23 ID-less total/summary rows (algorithm terminators, not misses).
- **Core↔E+ drift (5 load-bearing)**: rating columns shifted +2 (E+ inserts Auto/Motorcycle applicability); forms band differs (+1 col, wider attachment band); **Dynamic Data key columns swapped** (Core A=FORM NUMBER,B=FORM NAME; E+ reversed); sheet-name drift (bare `Rule References` vs `E+ Rule References`, identical `Data Validation` in both); `CORE.RAT` vs `EP.RAT`. Any positional assumption fails on exactly one of the two books; header-anchored mapping is the only safe path.

### 2.3 Mapped to pipeline stages

Digest must census by value not reported range (1,378 → 69 real columns); header lock must not reward the 52×-repeated merged band; column map must survive duplicate/hidden headers and ±2 drift; extraction must handle ditto blanks, `<Intentionally Blank>`-as-data, per-sheet state vocab, multi-ID cells, formula `.result`, ID-less totals; segmentation must accept `TABLE NAME:`/`RULE ID(s):` (not `RATE TABLE ID:`) and survive non-1:1 markers + merges; stage 7 must survive `EP.RAT` under `EPLS.*`, anchor drift, and colliding sheet names.

---

## 3. Empirical Performance Today (evidence base for §4–§5)

- **Live round trip passes**: `import_promote_e2e-CORE-ATT.json` (Jul 26) PASS — 2,268 entities persisted, 0 failed, promote → LAUNCHED; `EPLUS-R2` (Jul 25) PASS after a same-day fix wave; `EPLUS-E2E` (earlier Jul 25) FAILED (0 terms survived; 100 failed persists).
- **Zero fabrication everywhere measured** (live smoke, eval1, all 8 eval2 files) — flag-not-invent empirically holds. `parentResolutionRate` 1.0 everywhere.
- **But placement/preservation is weak**: `stepsWithCoverageRef` **90/2024 (CORE ≈ 4.4%)** and **17/303 (E+ ≈ 5.6%)**; E+ terms on only **8/95 coverages**; eval2 — the only cell-level-truth harness — is **8/8 FAIL at its Jul-17 baseline** (`goldenNumericFidelity` **0.000** on every file, `hierarchyRecall` ≈ 0 wherever golden edges exist, entityRecall 0.118–0.917) and has **no committed re-run** after the Jul 24–26 fixes. eval1's green board (offline F1 = 1.0, 4/4 formats) is template-shaped stability, not real-world fidelity (risk R14).
- **Economics**: CORE ≈ $70 / ~110 min, ~90% in stage 4. A redeploy kills an in-flight run (memory: deploy-kills-inflight-imports).
- **Open risk-register items**: R1 docId case split (CRITICAL), R13 GL `ldTableRefResolutionRate` 0.8 report-only, R15/R17 resume/caching gaps, R16 whole-PDF vision reads, R20 >128-column drop, R24 stacked >2000-row WATCH.
- **Parked tuning hypotheses** (`docs/review/AI_TUNING_HANDOFF.md`): S06 o-series token starvation, S03/S05 unhandled refusal stop_reason, S36 validator-without-sources — all confirmed mechanistically present at HEAD by this review.

---

## 4. Top 10 Reasons the Import Brain Might Not Work (ranked)

Ranking = severity × likelihood, merged from three independent adversarial analyses (correctness/grounding, ensemble/architecture, data-reality/ops); every mechanism verified in code at HEAD.

**1. Rating steps lose their coverage links — ~96% of steps price nothing**
- The deterministic rating parser reads the source's step→coverage column (`splitList(at(cells,'ids'))`, `isoImport.ts:1595`) to derive the program refId — then **discards it**; the step object (`:1603-1613`) carries no coverage reference, and since steps ride the ISO oracle into stage 7, the discard is authoritative. Core Rating carries ~2,000 `CORE.COV` refs in that column; E+ carries 293 (13 in semicolon multi-ID cells).
- Compounding source hazards: COVERAGE NAME is blank on 1,934/2,024 Core rows (vertical ditto — group forward-fill exists but `enrichRatingWithGroups` is signature-gated on `refTables.length > 0`), and E+'s `EP.RAT.*` step ids under `EPLS.*` coverages defeat any prefix join.
- Measured end-to-end on persisted data: `stepsWithCoverageRef` 90/2024 (CORE-ATT) and 17/303 (EPLUS-R2). Observable symptom: coverage cards show no Pricing figure — a priced product imports as an unpriceable one (commits 83cc471/c983a4a and the uncommitted e2e card check are all chasing this).

**2. The stacked-table blind spot: Rule References sheets get no column map, wrong-row citations, and a hard 2,000-row cliff**
- Stage 2 locks stacked sheets only under `"Sheet::Sub"` pseudo-names, but stage 3 looks up the plain sheet name (`stage3-column-map.js:192-195`, the `::` guard is dead code) → **no column map ever** → stage 4 bails; the entire dual-vote/ladder/judge machinery is structurally bypassed for the sheet family holding the most cells in both books (Core Rule References: 76,198 cells, 237 tables).
- `extendTruncatedGrids` deliberately excludes STACKED_TABLES from row continuation (`stage0-router.js:400-404`), so on a 7,184-row sheet everything past row 2000 is invisible to stages 2–5 (warned, but permanently lost brain-side); and `gatherRows` returns `gridRows=null` so every citation below the first sub-table carries the **wrong Excel row** (`stage4-extract.js:780-809`) — which stage 5 then can't block because it downgrades BLOCKING→WARN for stacked sheets (`stage5-validate.js:105-106`).
- The deterministic CORE-signature linker partially rescues (it reads the uncapped grid), but the brain's marker heuristics key on `RATE TABLE ID:`/`LDTable.N` — which occur **zero times** in either real workbook (only `TABLE NAME:`/`RULE ID(s):` exist). E+ terms on 8/95 coverages is the live symptom.

**3. Token-starved OpenAI votes silently collapse every "dual-family" ensemble to single-family**
- The OpenAI legs run at tiny completion budgets — prefilter 128, classify 256, judge 400 `max_completion_tokens` (`stage1-classify.js:121-144`, `stage4-extract.js:358,383`) — and reasoning-class models (gpt-5.1/gpt-5-mini) spend that budget on internal reasoning first, returning empty/truncated votes (hypothesis S06, confirmed mechanistically).
- A missing vote is never retried identically (`constants.js:68-86`): stage 1 quietly accepts the surviving Anthropic reasoner ×0.8, stage 4 accepts single-vote fields ×0.9 — the decorrelation the whole architecture is built on exists on paper but often not in effect.
- **No per-family vote-participation telemetry exists anywhere** — a 100%-degraded run is indistinguishable from a healthy one. The starved gpt-5.1 judge also feeds defect #8 (verbose/malformed verdicts).

**4. The stage-5 "grounding" validator never sees the source cells — an echo chamber**
- `buildValidatorPrompt` (`stage5-validate.js:200-219`) ships only each field's value, confidence, and its *claimed* citation verbatim; no grid content — although `fpByName` with full authoritative grids is in scope in the same function (S36, confirmed at HEAD).
- The system prompt demands "does every field value match its cited verbatim text?" — the model can only compare the extractor's claim against itself; an internally-consistent mis-extraction (wrong value + invented matching verbatim) passes with zero discrepancies.
- Only strict fields (refId/number/parentId) get a real byte-compare (deterministic resolver); every non-strict field's grounding is checked by nobody. eval2's systemic `numericFidelity 0.000` is exactly what an unwatched non-strict surface would produce.

**5. Mapped-but-uncertain columns are silently never read, and the 300-cell sweep can't catch them**
- The deterministic fast-path extracts only columns with map confidence ≥ 0.80 (`DET_MAP_CONFIDENCE`, `stage4-extract.js:42,629`) while qualifying a sheet at just 60% confident columns — up to 40% of *mapped* columns are simply not extracted, with no per-column review item.
- Stage-3 disagreement multiplies confidence by 0.7 (`stage3-column-map.js:137`) — a column both reasoners mapped but disagreed on (0.85 avg → 0.595) is guaranteed under the read threshold; the E+ drift columns (+2 shift, swapped keys, duplicate headers) are precisely the columns most likely to disagree.
- The dropped cells fall to a sweeper capped at `SWEEP_MAX_PER_SHEET = 300` against sheets with 60k–120k value cells; cells 301+ get zero AI and collapse into one `census_unaccounted` item listing at most 200 refs. Whole real columns can vanish while the run "passes".

**6. The only cell-level truth harness is all-red and stale — the team is flying on template-shaped green boards**
- `import_eval2_results.json` (Jul 17): 8/8 FAIL, `goldenNumericFidelity` 0.000 on every file (up to 681 checks), `hierarchyRecall` 0/127, 0/78, 15/94, 0/83 — and **no committed re-run after the Jul 24–26 fix wave**; nobody knows whether it's a harness canonicalization bug or genuine data loss.
- The passing e2e gates are shallow: EPLUS-R2 passed with terms on 8/95 coverages and 17/303 step links because the gates are "≥1 term", "≥1 coverage", "steps have source.type" — density is informational; the card-figures FAIL check is still uncommitted.
- The one known live accuracy gap (GL `ldTableRefResolutionRate` 0.8) survives only as prose after the eval-artifact cleanse — a known defect with no failing gate anywhere. Changes ship on gate-green (typecheck/lint/test/build), which contains zero import-accuracy signal.

**7. Guaranteed review-queue noise trains reviewers to rubber-stamp**
- The digest vocabulary (`framework, rating, tables` — `stage1-digest.js:29`) can never literally equal the classify vocabulary (`product-framework, rating-roc, rate-tables` — `constants.js:8-11`), yet `index.js:129` compares them literally: every correctly-read framework/rating/rate-table sheet in **every** import yields a spurious `digest-classify-disagreement` review item.
- `<Intentionally Blank>` (1,154 cells across the books) is **not** in the read-time sentinel list (`sentinels.ts:8-19` has `<intentionally left blank>` but not the string these books actually use) — the cells burn stage-4 tokens, sweep-cap slots, and review attention; the stage-0 AI routing assist also fires 1–2 model calls even when deterministic LOB inference already succeeded.
- Reviewer attention is the scarcest resource in the pipeline (2,268 entities per CORE run); a fixed noise floor directly raises wrong-accept probability (sweeper nominations sit inside the coverage groups — a bulk-accept persists 59 cell fragments as coverages) and drowns real flags (the stray `COLL` token, `NULL` literals).

**8. Consensus arithmetic is acceptance-biased, and same-family echoes count as majorities**
- `weightedMajority` declares consensus at **any 2 agreeing votes** with no family-diversity requirement (`stage4-extract.js:237`), and the ladder appends sonnet+opus candidates *before* the cross-family judge — haiku+sonnet self-agreement resolves conflicts without any non-Anthropic model ever seeing them; stage-1 disagreements are adjudicated by **opus, REASONER_A's own deployment** (`stage1-classify.js:196-201`), with no confidence haircut.
- Agreement gets ×1.05 confidence (correlated-wrong pairs boosted past the 0.85 accept threshold) and conflict write-back is `Math.max(existing, resolved)` (`:160-161, 426`) — confidence can only ratchet up; eval2 shows needsReview rates of 0.07–0.65 on files with entity recall as low as 0.118 — confidence and fidelity are decoupled.
- The judge verdict is parsed by **first character only** (`charCodeAt(0)-97`, `:364-365, 387-388`): a verdict of `"candidate b"` silently selects candidate *c*; nothing validates membership; the 400-token starvation (#3) makes verbose verdicts likely.

**9. Fully silent drop paths exist despite the conservation creed**
- The cheap-tier prefilter veto (haiku+gpt-5-mini agreeing at 128 tokens each) classifies a sheet `ignore` at **confidence 1.0 with no review item**, and ignored sheets are excluded from the stage-4.5 sweep too (`stage1-classify.js:127-137`, `index.js:198`) — the only 100%-silent whole-sheet drop path, gated by the two most-starved models.
- The blind map cross-check — the *only* AI check on the deterministic fast path — swallows all errors to `{raw:''}`; if both voters die, `checkedRows` stays 0 and the indictment loop can't fire (`stage4-extract.js:738-767`): "verified clean" and "checker was dead" are indistinguishable; it is also blind to wrong column→field *reassignment* (joins by fieldName, not column).
- Stage 4 posts conservation FACTs to whatever cell a model *cited*, unverified (`:1063-1075`) — a mis-citation marks the wrong cell as accounted, masking the truly-consumed cell from the sweeper; the honesty ledger is written from unaudited claims.

**10. The stage-7 identity join can graft identity onto the wrong entity — and the cache/resume machinery poisons recovery**
- Pass-2 of the ISO join matches brain↔mapper entities by normalized name with `findIndex` **first-match** (`stage7-plan.js:329-351`); duplicate sub-coverage names (real in these books) are disambiguated by queue order, and one wrong adoption propagates through `refIdRemap` into parentIds, terms, rules, and step sources; the formRule row-slice fold gap-fills conflicting cited scalars silently.
- The extraction cache stores raws **before parse validation, without stopReason** (`extract-cache.js:111-118`): the one targeted retry re-invokes the thunk, hits the cache, and replays identical bad bytes (retry is a structural no-op); replayed truncations skip the batch-halving recovery; an unhandled `refusal` stop_reason (S03/S05) is cacheable as a "vote".
- Resume trusts `runId` alone (`unified-import.js:331-356`) — resuming after swapping the file replays stale stage-1..3 artifacts against new grids — and a redeploy still silently kills a ~$70/110-min run (no drain guard), which then resumes into the poisoned cache.

---

## 5. Top 10 Areas for Improvement (ranked)

Same format; ranked by measured-impact × feasibility. Each is acceptance-gated: the gate + `pnpm import:eval` + holdout re-cert, plus the named metric.

**1. Deterministic step→coverage placement from cells the source already provides**
- One change in `parseRating` (`isoImport.ts:1595-1613`): the coverage refs are already read via `splitList` — attach them as `coverageRefIds` on each step (multi-ID split exists), forward-fill the COVERAGE NAME group with the existing GLOBAL_STEP guard, and make the prefix join segment-flexible so `EP.RAT.*` under `EPLS.*` resolves by name/segments, not literal prefix.
- Highest measured payoff on the board: takes `stepsWithCoverageRef` from 4–6% toward the ~99% the source actually states; unblocks the coverage-card Pricing figures; zero invention risk (every signal is cited source content).
- Gate: commit the card-figures e2e check as the oracle; canaries untouched (seeded programs don't traverse this path — verify with `glRobustness` $2,635 exact).

**2. Recover the stacked sheets: uncapped re-segmentation, real locks/maps, absolute rows**
- In `extendTruncatedGrids`, replace the STACKED_TABLES exclusion with re-running `segmentStackedTables` (pure, deterministic) on the full isoGrid; carry `absoluteRowStart` on each sub-table; register stage-2 locks under names stage 3 actually looks up (or teach stage 3 to iterate `Sheet::Sub`).
- Kills three defects at once: the 2,000-row cliff (recovers ~5,180 Core / ~1,650 E+ rows), the wrong-row citations, and the no-column-map hole; then remove the stage-5 BLOCKING→WARN stacked downgrade (it exists only because rows were unanchored).
- Add the R24 fixture (a >2000-row stacked sheet with a table straddling row 2000) and accept `RULE ID(s):` in the marker grammar alongside `RULE ID:`.

**3. Arm the stage-5 validator with the actual cited cells**
- `fpByName` with full grids is already in scope (`stage5-validate.js:233-255`) — resolve every citation and include the actual cell content (±1 row context, capped) beside the claimed verbatim in the prompt; add a `cited-vs-actual mismatch` discrepancy kind.
- Converts the unfulfillable "GROUNDING" instruction into a real three-way comparison; keeps WARN-only authority (deterministic resolver stays the only blocker). If token math ever forbids it, re-scope the prompt honestly instead of reporting grounding confidence it cannot have.
- Cheap: cells are in memory; no extra reads; S36 closed.

**4. Unstarve the OpenAI legs; handle refusals; measure family participation**
- Raise `max_completion_tokens`: prefilter 128→1024, classify 256→2048, judges 400→2048 (output stays schema-bounded; only reasoning headroom grows); add `refusal` handling as an explicit vote class (a named REFUSAL_STOP set beside TRUNCATED_STOP) instead of an empty raw.
- Add `{familyA_voted, familyB_voted, bothVoted}` counters per stage into the existing `budget.byDeployment`/`brain:spend` telemetry — single-family degradation becomes an alertable condition instead of an invisible posture.
- Re-certify per the standing agreement (`pnpm import:eval` + `scripts/phaseg-holdout.mts --check`) before shipping — this is the S06/S03/S05 package the tuning handoff already scoped.

**5. Re-baseline eval2 and harden the shallow gates**
- Run `scripts/import-eval2.mts` at HEAD and commit the board; hand-diff ~10 numeric claims to determine in an hour whether `numericFidelity 0.000` is harness canonicalization or real loss — the single most important open question about the pipeline.
- Commit the uncommitted card-figures e2e section; promote term-density (`coveragesWithTerms/coverages`) and `stepsWithCoverageRef` from informational to gated floors (EPLUS-R2 would rightly fail today — that is the point).
- Restore a failing gate for GL `ldTableRefResolutionRate ≥ 0.95`; make eval2 part of the pre-commit ritual for any import-brain change.

**6. Fix the extraction cache: validate before caching, store stopReason, let retries bypass**
- Gate `cachePut` on parse success and a clean stopReason; persist `{raw, stopReason}`; have `parseWithRetry`'s retry thunk pass `bypassCache` — restores both named recovery mechanisms (targeted retry, truncation-split) on replays.
- Bump `PROMPT_VERSION` `stage4/v1 → v2` once to invalidate the poisoned population; add contentHash to the key so R17 re-import reuse becomes possible later.
- Certification re-runs (the workflow most likely to hit the cache) stop being systematically worse than first runs.

**7. Schema-forced verdicts everywhere; kill the first-character parse**
- Move stage-1 classify/adjudicate and both stage-4 judges onto forced tools with enum-constrained fields (`verdict ∈ {a,b,c,d,none}`, `domain ∈ SHEET_DOMAINS`) — both call helpers already support forced tools, and the filing pipeline + `_forcedToolCall` prove the pattern under the same plumbing.
- Replace `charCodeAt(0)-97` with validated membership; a non-member burns the existing single retry then falls through to the next lineage.
- Reduces malformed-output retries pipeline-wide and removes a silent wrong-candidate selection on the highest-stakes path (conflict resolution, where confidence can only rise).

**8. Honest consensus: cross-family majorities for strict fields, symmetric confidence**
- In `weightedMajority`, count a 2-vote majority for refId/number/parentId only when the agreeing votes span vendors (candidates already carry `source`; ~10 lines); same-family pairs keep climbing to the cross-family judge instead of stopping at `majority@MID_REASONER`.
- Reserve the ×1.05 boost for cross-family agreement; replace `max(existing, resolved)` write-back with the resolving lineage's own confidence (floor-capped) so later evidence can lower a field.
- Route stage-1 adjudication to a third family (DeepSeek via the proven `callOpenAI`-under-IMPORT_CONTEXT pattern) with a ×0.8 haircut, mirroring stage-3's disagreement penalty.

**9. Eliminate the silent paths: breadcrumbs, liveness, verified FACTs**
- Prefilter skips: emit a `prefilter-skip` review item naming both voters' reasons and keep prefiltered sheets in sweep scope (their census exists; the 300-cap bounds cost) — converts the only fully-silent drop into standard visible-residue posture.
- Blind cross-check: when `checkedRows === 0`, emit `map-unverified` (retry once first); join disagreements by column citation, not fieldName, so wrong-field *reassignment* — the actual wrong-map signature — is counted.
- FACT posting: byte/containment-verify `citation.verbatim` against the grid before posting (the comparator exists in stage 5, ~15 lines); mismatches become `miscited-field` review items instead of ledger masking.

**10. Ops + noise-floor hardening**
- Content-hash-guarded resume (stamp `sha256(workbook)` into every checkpoint; refuse mismatched `resumeRunId`), auto-attach `runId` server-side so durability is default-on, and a deploy drain guard fed by the run tracer ("active imports" probe gating the pipeline).
- Add `'<intentionally blank>'` (and a general `^<[^>]*>$` match) to `sentinels.ts` NULL_STRINGS — one line that removes 1,154 junk cells from votes, sweeps, and review; unify the digest/classify domain vocabulary with a 6-entry crosswalk at `index.js:129`.
- Quarantine sweeper nominations at the persist boundary (server 422s `sweeperFact:true` without an explicit confirmation flag; render nominations in their own review section) — the e2e's client-side filter becomes an invariant.

---

## 6. Complete AI Model Catalog (pipeline order, parameters, prompts)

Fleet registry (`shared/src/ai/fleet.ts`): GROUNDED_CITED = `claude-opus-4-8` · MID_REASONER = `claude-sonnet-5` · BULK_VERIFY = `claude-haiku-4-5` · VISION = `gpt-5.1` · CHEAP_GENERAL = `gpt-5-mini` · EMBED = `text-embedding-3-small`; extended: DEEP_REASONER = `gpt-5.4-pro` (/responses), VERIFY_DEEPSEEK = `DeepSeek-V4-Pro`, VERIFY_XAI = `grok-4.3` (**deprovisioned**, degrades to DeepSeek), FAST_GENERAL = `gpt-5.4-mini`, EMBED_QUALITY, RERANK (Cohere v4), DOC_OCR (`mistral-document-ai-2512`). All via Azure AI Foundry, key in env only.

Cross-cutting parameters (verified): **temperature omitted on every call** (rejected on these models); **no `thinking` or `output_config.effort` is ever passed on the import path**; timeouts 120 s (brain) / 300 s (filing native-PDF) / 90 s (`_forcedToolCall`) / 60 s (proposeMapping GPT validator); 3 transport attempts with exponential backoff + jitter; exactly 1 semantic retry per malformed vote; truncation → batch-halving, never identical retry; a 404'd deployment is skipped for **process lifetime** (`MISSING_DEPLOYMENTS`); system prompts sent as Anthropic `ephemeral` cache-control blocks; only the two stage-4 bulk votes are result-cached (sha256 LRU-512 + Blob). Cost guard: $25/h rolling window, 80% soft-degrade — import wholly exempt via `IMPORT_CONTEXT`, telemetry always on.

| # | Pipeline position | Model (role → concrete) | maxTokens | Batching | Escalation |
|---|---|---|---|---|---|
| 1 | Stage 0 LOB/edition assist | BULK_VERIFY → haiku-4.5 | 300 | 1/upload, only if deterministic LOB inconclusive | opus if parse-fail or conf < 0.6 |
| 2–3 | Stage 1a digest readers A/B | opus-4.8 ∥ gpt-5.1 | 8192 | ≤3 window rounds, ≤12×40×40 windows each | single-family carried flagged |
| 4 | Stage 1a digest synthesis | DEEP_REASONER → gpt-5.4-pro (/responses) | 8192 | 1 call | fallback opus chat |
| 5–6 | Stage 1 prefilter votes | haiku ∥ gpt-5-mini | **128** | per sheet, 4 in flight; both must agree to skip | — |
| 7–8 | Stage 1 classify A/B | opus ∥ gpt-5.1 | **256** | per sheet | adjudication on disagreement |
| 9 | Stage 1 adjudication | opus-4.8 | 256 | disagreements only | fail → ignore + humanFlag |
| 10 | Stage 2 header AI fallback | opus-4.8 | 256 | only when det. score ≤ 0.80 | fail → unconfirmed + review |
| 11–12 | Stage 3 column map A/B | opus ∥ gpt-5.1 | 8192 | 24-col batches, 3 sheets in flight | code reconcile (×0.7 on disagreement) |
| 13 | Stage 4 blind map cross-check | haiku + gpt-5-mini | 8192 | 2 sampled batches/sheet, blind prompt | indicts map only |
| 14–15 | Stage 4 bulk votes (cached) | haiku ∥ gpt-5-mini | 8192 | ≤20 rows/batch (480-cell budget), 3∥×2 sheets | conflicts → ladder |
| 16 | Stage 4 conflict ladder | sonnet-5 → opus-4.8 | 4096 | pooled per sheet, ≤20-row chunks | weighted majority |
| 17 | Stage 4 both-votes-failed | sonnet-5 → opus-4.8 | 8192 | whole batch | dropped-batch review |
| 18 | Stage 4 judge | gpt-5.1 | **400** | per unresolved field, 4 ∥ | verdict 'none' → #19 |
| 19 | Stage 4 tail judge | DeepSeek-V4-Pro | **400** | one pass | consensus-failure review |
| 20–21 | Stage 4.5 sweeper votes | haiku ∥ gpt-5-mini | 4096 | 60-cell batches, cap 300/sheet | disagreement → sonnet |
| 22 | Stage 4.5 sweeper ladder | sonnet-5 | 4096 | conflicted subset once | residue → NEEDS_REVIEW |
| 23 | Stage 5 semantic validator | gpt-5.1 | 4096 | 50 entities/call, 3 groups ∥ | WARN-only |
| F1 | Filing classify | haiku (forced tool) | 500 | per doc, 3 ∥ | — |
| F2–F4 | Filing extract ladder | haiku → sonnet → opus (text); haiku ∥ opus race (vision) | 8192–16000 | per doc | first non-empty sanitized result wins |
| B1 | Fallback single-pass | haiku (forced tool) | 4096 | 1 call | — |
| O1–O4 | `proposeMapping` (orphaned) | sonnet proposer → opus escalation; gpt-5.1 validator → opus adversarial fallback | 1024–2048 | 1 pass | drop-all on validator failure |

**Prompt highlights** (full prompts in `server/lib/import-brain/prompts.js`; all share a FIRST_PRINCIPLES preamble):
- **Stage 0** (`STAGE0_ROUTER_SYSTEM`): "Determine the line of business… from CONTENT ONLY — filenames are not evidence." LOB whitelist PH/PA/GL/IM/PR; "never guess an edition"; rationale must quote the tokens relied on; JSON-only.
- **Stage 1a** (`READER_SYSTEM`): "You never see full grids. If you need to inspect cells, respond ONLY with {\"windowRequests\":[…]} (max 12 windows, each at most 40x40)"; "refIds… byte-exact, never invent"; "UNKNOWN over guessing."
- **Stage 1** (`STAGE1_CLASSIFY_SYSTEM`): "CLASSIFY the sheet into EXACTLY ONE of these eight canonical domains", with dialect disambiguation notes ('"GL Optional Forms Rules" classifies as "rules" — NOT "forms"'); rationale must cite an observed cell.
- **Stage 3** (`STAGE3_MAP_SYSTEM`): "MAP BY CONCEPT, NOT BY EXACT WORDING"; citation must reference a real cell with the actual observed text; "Never map a column to a field NOT present in the canonical dictionary"; below 0.5 → do not map.
- **Stage 4** (`STAGE4_EXTRACT_SYSTEM`): "Extract ONLY values that are present in the source cells. Never invent values"; refIds byte-for-byte; multi-refId cells returned unsplit ("Expansion… happens deterministically downstream"); blank/TBD refIds → `needsRefIdSynthesis=true`, never invented; only mapped columns.
- **Stage 4 judge** (`STAGE4_JUDGE_SYSTEM`): "The correct value must literally appear in (or be a faithful type-normalization of) a source cell"; 'If NO candidate is grounded… verdict="none" — do not invent a value'; refIds byte-for-byte.
- **Sweeper** (`SWEEPER_SYSTEM`): every cell → NOISE (from a fixed rule list) | FACT (name VERBATIM from the cell) | UNKNOWN — "never guess"; acceptance additionally requires literal containment of the name in the cited cell.
- **Stage 5** (`STAGE5_VALIDATE_SYSTEM`): "Your job is to find errors — not to re-extract data"; grounding/refId-fidelity/enum/tree/row-coverage checks (see §4 item 4 for why grounding is currently unfulfillable).
- **Filing** (`EXTRACT_SYSTEM` + per-role tools): "CITATIONS ARE MANDATORY… an uncited item is a wasted item. For tables, return a SCHEMA + the verbatim region; deterministic code parses the rows."

---

## 7. Model-Fit Assessment (per task) and Recommendations

Assessed against the current Anthropic model catalog (Claude Opus 5/4.8, Sonnet 5, Haiku 4.5) and observed Foundry behavior (probed: `output_config.effort` works on opus/sonnet, 400s on haiku; `temperature` 400s; legacy `thinking:{enabled, budget_tokens}` 400s; sub-4096-token cached prefixes are silent no-ops).

| Call | Current model | Verdict | Recommendation |
|---|---|---|---|
| Stage 0 assist | haiku-4.5 → opus | **Good fit** | Tiny JSON task; keep. Gate the call on `lobSource !== 'deterministic'` (today it fires even when deterministic inference succeeded). |
| Digest readers | opus-4.8 + gpt-5.1 | **Good fit, under-configured** | Opus 4.8 runs **without thinking** when `thinking` is omitted — the one deep-reasoning role in the pipeline is running unthinking. Foundry-safe fix: pass `output_config.effort: "high"` (probe-verified working) on the opus digest/adjudication/synthesis-fallback calls; probe `thinking:{type:"adaptive"}` on Foundry before adopting it. |
| Digest synthesis | gpt-5.4-pro ($20/$150) | **Over-provisioned** | Merging two JSON analyses is not the fleet's hardest task. Route routine synthesis to opus-4.8 (effort high) or sonnet-5 and reserve gpt-5.4-pro for `unknown-sheet`/hardest-disambiguation holes. ~10× cost cut on this call with no measured quality basis for the pro tier here. |
| Prefilter votes | haiku + gpt-5-mini @128 | **Right models, starved** | Keep the pair; raise to ≥1024 tokens and remove the silent-veto (see §5 item 9). |
| Classify + adjudicate | opus + gpt-5.1 @256; opus adjudicates | **Wrong adjudicator** | Keep the A/B pair (raise budgets); move adjudication to a third family (DeepSeek-V4-Pro via the proven import-context path) or at minimum apply a confidence haircut. Opus judging its own disagreement defeats the decorrelation design. |
| Column map | opus + gpt-5.1 | **Good fit** | This is the highest-leverage AI decision in the pipeline (a wrong map poisons every row) — opus is justified. Add effort high; keep the 24-column batching. |
| Bulk extraction votes | haiku + gpt-5-mini | **Right economics, wrong job** | For template-family sheets, models transcribing 20-row windows is the pipeline's core inefficiency (~90% of $70/run) and its main mis-citation source. Short-term keep; medium-term replace with pointer-bindings + code reads (§8). Note: haiku system prompts below 4096 tokens don't cache on Foundry — the ephemeral cache block on these calls is likely a silent no-op; verify and pad or restructure if so. |
| Conflict ladder | sonnet-5 → opus-4.8 @4096 | **Good fit, one caveat** | Sonnet 5 runs adaptive thinking **by default** — thinking tokens share the 4096 `max_tokens` cap, so ladder responses can truncate (which today feeds the batch-halving path). Raise ladder maxTokens to 8192 or probe Foundry for an effort/`thinking` control on sonnet. |
| Judges | gpt-5.1 @400 → DeepSeek @400 | **Right lineages, starved + fragile parsing** | Keep cross-family judging (it is the correct design); raise to ≥2048; forced-tool verdicts with enum membership (§5 item 7). |
| Sweeper | haiku + gpt-5-mini → sonnet | **Good fit** | Keep; the improvement is structural (region-level sweeping), not model choice. |
| Stage-5 validator | gpt-5.1 | **Right model, blind** | Keep the cross-family choice; give it the source cells (§5 item 3). |
| Filing ladder | haiku → sonnet → opus; vision haiku ∥ opus | **Mostly right** | Haiku-4.5 vision on native PDFs is the weak rung — for `heavyDoc` manuals start at sonnet/opus. Wire **DOC_OCR (mistral-document-ai-2512)** — provisioned but unused — for scanned/image PDFs (risk R16, S27/S32/S40): OCR-to-markdown then the text ladder beats whole-PDF vision reads on cost and fidelity. |
| Fallback single-pass | haiku @4096 | **Under-powered** | This is the last-resort path for unrecognized formats — exactly where reasoning helps most. Use sonnet-5 (rare path, negligible cost delta); also make this call visible to the per-run budget (today it bypasses it). |
| `proposeMapping` | sonnet/opus/gpt-5.1 | **Orphaned** | No client caller remains after the deterministic-path removal. Either delete the endpoint or repurpose the proposer/validator pattern inside stage 3; if kept, put it under IMPORT_CONTEXT (R21). |
| Fleet upgrade | opus-4.8 as GROUNDED_CITED | **Upgrade candidate** | `claude-opus-5` is a drop-in at the **same price** ($5/$25) with thinking on by default and stronger reasoning/agentic behavior — the natural upgrade for GROUNDED_CITED once provisioned in Foundry. Until then: opus-4.8 + explicit `effort`. Governance: `claude-fable-5` remains forbidden in the fleet (correctly — cost profile and 30-day-retention requirements don't fit this pipeline). |

**Fleet-level notes**: `escalateAnthropic` and its `brain:escalation` SSE event are dead code (no caller) — delete or adopt; `verify-lineage.js` has no production caller; `MISSING_DEPLOYMENTS` needs a TTL or startup re-probe (a transient 404 currently amputates a ladder rung for the process lifetime); pricing table in `fleet.ts` is current (Opus $5/$25, Sonnet $3/$15, Haiku $1/$5).

---

## 8. Pipeline & Ensemble Architecture Critique + Proposed Redesign

### 8.1 Is the current architecture optimal for accuracy? No — five structural reasons

1. **The oracle runs last.** `mapIsoWorkbook` — the pinned, LLM-free, most-accurate component — runs at `unified-import.js:191` *after* stages 1–5 spend ~$70/~110 min, and stage 7 then overwrites the AI's identity fields with the mapper's. The system pays twice for identity and keeps the cheaper copy; the join needed to reconcile the two parallel extractions is itself a new error source (§4 item 10).
2. **Ensembles vote on the wrong unit.** Consensus is computed per field but *failure* is per 20-row JSON batch — one malformed character costs an entire batch vote and the survivor wins everything at ×0.9. Token starvation makes the cross-family leg frequently absent; same-family agreement counts as majority; the confidence algebra only ratchets up. Decorrelation is bought and then spent.
3. **Citations are claims, verified later — not structures that cannot lie.** Models assert `{sheet, cell, verbatim}` free-text; the ledger trusts them; stage 5 samples and WARNs. A pointer-based contract (model points, code reads) would make fabrication and transcription error unrepresentable instead of post-hoc detectable.
4. **Verification is second-opinion sampling, not re-derivation.** Given the plan and the column map, the expected content of every mapped cell is computable — diffing that projection against the grid is free, exact, and total. The census/accounting layer already implements most of this ledger; it is used only to feed a 300-cell-capped sweeper.
5. **The pipeline learns nothing.** Core and E+ are one template with five mechanical drifts; every import re-buys the same discovery at full price. The ISO mapper is a hand-compiled dialect; nothing compiles new dialects from approved runs.

The evidence signature matches: **zero fabrication everywhere measured** (the invention defenses work) but numericFidelity 0.000 / hierarchyRecall ≈0 / step-linkage 4–6% (placement and preservation fail). The architecture is superb at *not inventing* and mediocre at *placing and preserving* — the profile of a system whose deterministic layer is authoritative but late and whose AI layer generates values instead of resolving structure.

### 8.2 The proposed pipeline: SCAFFOLD → SURVEY → BIND → COURT → RE-DERIVE → LEARN

A merge of two independently-derived redesigns (structure-first; agentic/verification-first) that converged on the same core inversion. Kept byte-identical: stage-0 armor/census, `mapIsoWorkbook`, the rating engine, the filing reconciler, the review UI, the conservation law, all four canaries.

```
N0  Intake + armor + census + fingerprints        (today's stage 0; unchanged)
N1  SCAFFOLD  — oracle first, deterministic maximum   ($0, no AI)
N2  SURVEY    — one agentic surveyor with tools over the live grid   (only for holes)
N3  BIND      — pointer-extraction: models point, code reads          (AI fills holes only)
N4  COURT     — claim admission + adversarial verify + reconciliation court
N5  RE-DERIVE — total inverse projection replaces sampling + capped sweep
N6  ASSEMBLE  — thin plan projection (today's stage 7 minus the ISO join)
N7  LEARN     — FormatCard dialect memory (post-review distillation)
CI  EVAL GATE — eval1 + eval2 + holdout + canaries on every brain change
```

- **N1 Scaffold (the inversion)**: run `mapIsoWorkbook` and every deterministic capability *first* — layout detection, stacked segmentation from the **uncapped** grid, header locks, alias-based column mapping, refId-prefix hierarchy, HYPERLINK join edges (Core's Forms→DynamicData links are free), Data-Validation sheets compiled into enum crosswalks (today unused, yet they *define* the legal vocabulary). Post the mapper's `consumedSpans` (already pinned byte-neutral) to a **per-cell provenance ledger** — the pipeline's core data structure: every censused cell gets a typed disposition (`FACT | SCHEMA | NOISE | HEADER | MERGE_SHADOW | SENTINEL | NEEDS_REVIEW | UNACCOUNTED`) with a `consumer` back-pointer and a `CellID` that includes workbook identity (killing the "Data Validation"×2 collision class). What remains UNACCOUNTED becomes a typed **HoleSet** (`unknown-sheet`, `unmapped-column`, `unparsed-block`, `ambiguous-enum`, `unlinked-entity`, `sentinel-region`). On template-family books the scaffold explains the overwhelming majority of cells for $0 — converting ~90% of today's stage-4 spend into code.
- **N2 Survey (AI, small and curious)**: one surveyor per workbook (cross-sheet context is exactly what per-sheet windows destroy) over a **tool server** — `sheet_stats / read_range / find_text / find_refids / list_markers / resolve_merge` — served deterministically from the census + uncapped grids, budget-enforced in code (≤60 calls, ≤400KB served). Sonnet-5 first pass; opus (effort high) only for sheets sonnet marks ambiguous. Output: a forced-tool **SheetPlan** per hole — domain (one shared vocabulary), per-table headers/bodies, header-anchored bindings with `carryDown`/`sentinelMap`/`stateMatrix` declarations, join recipes, hazards. **Structural must-cite**: every evidence cell is checked against the served-log — the model cannot cite what it never asked to see.
- **N3 Bind (models point, code reads)**: for each hole, a forced tool `propose_bindings` whose schema makes ungrounded output unrepresentable: each field claim is a **pointer** `{cell: {r,c}, transform: verbatim|split-multi-id|enum:<crosswalk>|carry-from-above}`; out-of-window pointers are schema violations; `value := grid[cell]` is read by **code**, byte-faithful — the model never types a refId, form number, or rate, eliminating transcription hallucination as a class (and making eval2's numericFidelity axis pass by construction on scaffold-covered sheets). Escalation is **entropy-driven per binding**: haiku k=2 self-consistency (decorrelate by prompt-order shuffle) → cross-family gpt-5.1 vote only on disagreement → one sonnet arbitration with candidate pointers rendered as actual cell bytes. Opus leaves the extraction hot loop entirely. Caches store only validated binding sets, keyed by content hash, with stopReason.
- **N4 Court (claims, not confidence arithmetic)**: every model-originated claim (bindings, survey facts, sweep explanations) is admitted through the current stage-5 deterministic resolver **at the front door** — byte/containment compare, merge-anchor resolution, placeholder law; strict-field failures are rejected to unresolved (the stacked WARN-downgrade dies because rows are now absolute). Conservation FACTs post **only for admitted claims** (ledger can't be poisoned). Disputes go to a court: cross-family verifiers (haiku ∥ gpt-5-mini, ≥4096 tokens, each holding the re-served source bytes + 2 probes of their own; a REFUTE must carry counter-citations); judge = sonnet (not a party), forced-tool ruling whose `groundedCell` must byte-resolve; appellate tier for identity-bearing fields = gpt-5.4-pro on /responses. Hung court → unresolved **with the complete case file attached** for the reviewer. No ×1.05, no ×0.9, no max-only write-back anywhere.
- **N5 Re-derive (total, deterministic verification)**: forward check — every planned field must equal `normalize(grid[consumer.ref])` (an invariant, CI-asserted). Inverse projection — every cell must carry a disposition; region rules explain residue wholesale (banners → NOISE, merge shadows, sentinel vocab incl. `<Intentionally Blank>`/`NA`/`NULL` → SENTINEL); true residue loops back to N2/N3 at most twice, then NEEDS_REVIEW. This replaces the 300-cell sweeper with an uncapped, mostly-free mechanism (O(regions), not O(cells)); the semantic LLM pass narrows to what code cannot check, always with source cells.
- **N6 Assemble**: today's stage 7 minus `joinGroupWithIso` — there is nothing to join because there was never a second parallel extraction; the six documented mis-pair modes disappear as a class. SYNTH stubs, completeness pillars, review partition, bundle shape unchanged (client compatibility).
- **N7 Learn (FormatCards)**: after reviewer **approval** (human-confirmed truth as the only training signal), code distills the run into a FormatCard — dialect fingerprint (header signatures, marker grammar incl. `RULE ID(s):`, prefix grammar incl. `EP.RAT`-under-`EPLS`, sentinel vocab, geometry) + accepted header-anchored SheetPlans + reviewer corrections. Promotion gate is deterministic: the compiled card must reproduce the approved plan byte-for-byte on identity fields against the stored census. Cards are audited entities through `adapter.db.mutate()` (versioned, hash-chained, revertible), **data consumed by deterministic code, never model-emitted code**. Import #2 of a known template becomes audit-probes-only. The hand-written ISO mapper becomes the factory-installed first entry of a growing library.
- **CI Eval gate**: any diff touching brain prompts/models/budgets triggers `import:eval` + `import:eval2` + holdout + canaries as a ratchet (no metric may regress); holdout fingerprints are denylisted from FormatCards (learning must not memorize the exam); every hung court/overturn is logged and periodically folded into new eval2 golden rows — the eval corpus grows from real disagreements.

**Expected deltas** (CORE reference: ~$70 / ~110 min today): new-dialect runs ≈ **$8–16 / 15–25 min** (bounded by residue, not book size); known-dialect (card hit) ≈ **<$1 / ~2 min**; numericFidelity → ~1.0 by construction on scaffold-covered sheets; citation fabrication structurally impossible; step-linkage and term-attachment gaps routed through explicit `unlinked-entity` holes (where the drafted Total Placement work order slots in unchanged). A 15-minute run also fits between deploys — halving the ops exposure of §4 item 10.

**Migration (canary-safe, each phase independently shippable and flag-gated)**:
- **P0 (~1 wk)**: defect burn-down inside the current architecture — §5 items 4, 6, 7, and the vocabulary/sentinel fixes. Gate green + import:eval.
- **P1 (~2 wks)**: scaffold-first behind `IMPORT_SCAFFOLD_FIRST=1` — mapper runs first, consumedSpans posts to the ledger, stage 4 skips ledger-explained rows; stage-7 join becomes a no-op assertion. Assert **byte-identical bundles** with the flag on across the 8-workbook fidelity suite.
- **P2 (~2–3 wks)**: tool server + shadow survey; then `propose_bindings` on holes, shadow-diffed against old stage-4 before per-domain cutover. This is the phase that must move eval2.
- **P3 (~1–2 wks)**: court + re-derivation replace dual-vote arithmetic and the capped sweeper; delete `joinGroupWithIso` after two clean shadow cycles on the live e2e harness.
- **P4**: FormatCards + CI ratchet.
- **Rollback**: every phase is a flag; `mapIsoWorkbook` and `reconcile.ts` bytes are frozen throughout, so the deterministic floor and all four canaries cannot move.

---

## 9. Changes Made in This Session

1. **Removed the deterministic path for document uploads**: deleted the multi-file all-XLSX in-browser branch, the `xlsx-plan` review pane, and the client AI-assist overlay from `app/src/import/UnifiedImportModal.tsx`; deleted `app/src/components/product/ImportWorkbookModal.tsx` (unmounted legacy deterministic importer) and `app/src/lib/import/readWorkbook.ts`; removed `readinessFromLocalXlsx` from `app/src/lib/import/provenance.ts`. Every upload now routes to the server brain. `mapIsoWorkbook` is unchanged (server-side oracle + goldens + eval scripts). `sweeperNominations` and its pin test kept. Consequence: `proposeMapping` is now an orphaned endpoint (see §7).
2. **Gate green**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all pass at exit 0 (canaries exact; only pre-existing lint warnings; `UnifiedImportModal` chunk shrank to 47.26 kB gzip 13.31 kB).

## Appendix — Primary sources

- Orientation: `docs/IMPORT_BRAIN.md` · Stage code: `server/lib/import-brain/*.js`, `server/lib/ai/unified-import.js` · Oracle: `shared/src/insurance/isoImport.ts`, `shared/src/import/structure/*`, `shared/src/import/canonicalMap.ts` · Fleet: `shared/src/ai/fleet.ts`, `server/lib/fleet.js`, `server/lib/import-brain/ai-call.js`, `prompts.js`
- Evidence: `docs/audit/import_promote_e2e-{CORE-ATT,EPLUS-E2E,EPLUS-R2}.json`, `docs/audit/import_eval2_results.json`, `docs/reveng/{RISK_REGISTER,INGESTION_PIPELINE}.md`, `docs/review/AI_TUNING_HANDOFF.md`, `docs/prompts/PROMPT_TOTAL_PLACEMENT.md`, `scripts/import-{eval,eval2,promote-e2e}.mts`
- Workbooks: `latest_samples/Product Specifications _Core.xlsx`, `_E+.xlsx`
