# PROMPT — Enhance and Optimize the Import Brain

*Self-contained. Paste into a fresh AI session with write access to this repository. Derived from `docs/review/IMPORT_BRAIN_FULL_REVIEW_V2.md` (HEAD 83cc471, 2026-07-26); every defect below was verified in code, and several were reproduced by execution.*

---

You are working on the **import brain** of an insurance-document ingestion platform: the subsystem that converts semi-structured Excel workbooks and carrier filing PDFs into a governed canonical Product Component Model, which a deterministic engine then prices. Your job is to enhance and optimize it, defect by defect, under hard invariants.

**Read these before changing anything**: `docs/IMPORT_BRAIN.md` (orientation — but note it is stale in ~8 places, including that stage 7 is not inside the brain), `server/lib/ai/unified-import.js` (the orchestrator), all of `server/lib/import-brain/*.js`, `shared/src/insurance/isoImport.ts` (the deterministic oracle), `shared/src/import/{structure,mapper}/*`, `shared/src/import/canonicalMap.ts`, `shared/src/ai/fleet.ts`. Then read `docs/review/IMPORT_BRAIN_FULL_REVIEW_V2.md` in full.

## 0. Ground rules

- **Verify-first.** Claims about behavior come from running the gate, executing a repro, or hitting an endpoint — never from reading code alone. Several defects below were found only because someone re-executed a loop.
- **Never weaken a test, threshold, canary, or golden to go green. Fix at the cause.** If a golden must change because behavior legitimately changed, say so explicitly, show the diff, and get it approved — do not regenerate goldens as part of a fix. (Regenerating `tests/golden/import/` on 2026-07-25 is precisely what hid a live regression; see §3.)
- **One writer per worktree.** Stage explicitly; use `git commit --only <paths>`; never `git add -A`.
- Work the defects in the order given. Each has an acceptance gate. Do not proceed to the next until the current one's gate is green and the full certification ritual passes.

## 1. Non-negotiable invariants

1. **Citations-or-discarded.** Every extracted field cites its source cell `{sheet, cell, verbatim}`. Uncited claims must not silently become data. *(Today this is BLOCKING only for strict ids on non-stacked sheets — strengthening it is in scope; weakening it is not.)*
2. **Flag-not-invent.** When the source does not establish a value, surface a notice or `UNKNOWN`. Never fabricate a plausible one. **Three live violations are listed in §2.3 — they are the reason this invariant is stated first.**
3. **Byte-faithful identifiers.** refIds and form numbers are carried byte-for-byte; the only legal transform is `refIdToDocId` (dots→dashes, case preserved). **A filename is never an identifier** (§2.6).
4. **Fleet-registry models only.** Every model comes from `shared/src/ai/fleet.ts` (bridged to `server/lib/fleet-shared.cjs`), routed through the in-process cost guard. Never hardcode a model string. Import runs under the named `IMPORT_CONTEXT = 'import-no-cap'` exemption (never budget-denied, never degraded) but telemetry is never bypassed. **`claude-fable-5` is forbidden in the fleet** and is pinned by two tests.
5. **Four rating canaries stay exact** — PH **$1,528** (`shared/src/rating/evaluator.test.ts`), PA **$1,002** (`shared/src/rating/workedExample.canary.test.ts`), GL **$2,635** (`shared/src/rating/generalLiability.evaluator.test.ts`), filing-import **$1,281** (`shared/src/insurance/filing/reconcile.test.ts`). Exact or broken.
6. **Atomic mutation envelope.** Every entity write goes through `adapter.db.mutate()`; the `/api` host batches entity + auditEvent + version + searchIndex in one Cosmos transactional batch. No bare data-store writes, and the audit hash-chain (`/api/db/audit/verify`) stays green.
7. **Adapter seam.** All app reads/writes go through `adapter` (`app/src/lib/backend/`); never import a platform SDK in a component.

## 2. The ranked defect list

Each defect states the mechanism, the file:line, and the acceptance gate that proves the fix. Fix in this order — invariant and durability repairs first, structural work last.

### 2.1 The ISO join overwrites cited evidence with mapper absence *(highest blast radius)*
`ISO_ORACLE_FIELDS = [refId, parentId, order, terms]` win outright at `stage7-plan.js:256`; the array-**union** branch at `:290-297` applies only to `ISO_STAMPED_FIELDS`. A mapper entity carrying `terms: []` or `parentId: null` therefore **erases** a brain-cited term set. This contradicts the rule whose name is the literal title of commit `deecb91` ("absence never beats a cited value"), which fixed the stamped path and missed the oracle path. Live symptom: `EPLUS-E2E` persisted 0 LIMIT / 0 DEDUCTIBLE terms on 0 coverages.
**Fix**: move `terms` into `ISO_STAMPED_FIELDS` so the union branch applies; gate `parentId` adoption on the mapper actually having one.
**Gate**: a test where a brain coverage with a cited `parentId` and one LIMIT term is joined against an iso entity with `terms: []`/`parentId: null` retains both; `scripts/import-promote-e2e.mts` on an E+ workbook reports `limitTerms > 0`; all four canaries exact.

### 2.2 Checkpoint resume is unconditionally broken
`unified-import.js:333` seeds `resume = { stage4: { sheets: {} } }`, but `index.js:183` always writes a checkpoint literally named `stage4`, which takes the `/^stage[1-9]/` branch at `:344` and overwrites the sheet map. Re-executing the loop throws in every artifact ordering, is caught at `:352`, and degrades to "resume unavailable — running from the start". A ~$70 / ~110-minute run is re-bought on every failure. Additionally: split-product runs get zero checkpoints (`split<N>/stage4/…` keys are rejected by `sanitizeStage`'s no-slash regex), and the digest checkpoint is written every run but can never be restored.
**Fix**: namespace the summary artifact (e.g. `stage4.summary`) or make the restore loop check `stage4.sheets` before assignment; permit `split<N>/` in `sanitizeStage`; populate `resume.digest`.
**Gate**: a test that writes the real checkpoint sequence and restores without throwing; a killed-then-resumed run demonstrably skips already-checkpointed stage-4 sheets.

### 2.3 Three flag-not-invent violations
- **Fabricated terms**: `deriveTermsFromReferenceTables` emits `default: 0` LIMIT/DEDUCTIBLE terms for flat tables that parsed **no numeric rows**, because `primaryKind` comes from a header cell (`limitHeaderSeen`, `isoImport.ts:1739`) independently of whether any value parsed — three lines from where the MATRIX branch correctly refuses. This is inside the golden-pinned oracle.
- **Fabricated regulatory scope**: `stampDefaults` turns silence into `allStates: true` (`stage7-plan.js:571`) — a positive 51-jurisdiction claim from absence, unflagged.
- **Inverted operators**: `foldStepOp` maps `'/'` → **MUL** and `'-'` → **ADD** (`stage7-plan.js:196-201`). A stated division silently becomes a multiplication.

**Fix**: gate term derivation on ≥1 parsed numeric row; when `allStates` is stamped rather than read, also set `allStatesAssumed: true` + `needsReview: true` and aggregate one `importWarnings` item; split `foldStepOp` into faithful synonyms vs unrepresentable-but-stated operators, the latter producing a warning instead of a wrong op.
**Gate**: `{op:'/'}` and `{op:'-'}` each yield exactly one `rating-step-op-unrepresentable` warning and no inverted op; a term-less flat table yields zero terms; a coverage planned from a source with no state columns carries `allStatesAssumed === true`. **This touches rating shapes — re-run all four canaries and prove them exact; do not assume they are untouched.**

### 2.4 Stacked sheets never get a column map
`stage2-header-lock.js:75-86` pushes locks **only** under `Sheet::Sub` pseudo-names, then `continue`s; `stage3-column-map.js:192-194` looks up the plain sheet name and returns `null`; stage 4 bails at `:850` **with no review item**. The `::` guards at `stage3:195` and `stage4:846` are dead code — `classified` only ever holds fingerprint sheet names. Blast radius: Core "Rule References" is 7,184 rows × 32 cols / 76,198 cells / 237 tables, the largest sheet family in the corpus.
**Fix**: in `stage2-header-lock.js`, also push a lock under the plain `fp.sheetName` (`headerRowIndex` from `subTables[0]`, `isConfirmed: false`) so stages 3–4 see the sheet; carry `absoluteRowStart` per sub-table so citations resolve to true Excel rows; emit a review item on any remaining bail.
**Gate**: a fixture with two stacked blocks yields > 0 entities and a non-empty column map; add an R24 fixture with a table straddling row 2000.
**Do not** remove the stage-5 BLOCKING→WARN stacked downgrade in the same change — it currently never fires, and deleting it before rows are anchored converts a dead branch into a live blocker.

### 2.5 The step→coverage contract is broken at the field level
`canonicalMap` defines `coverageRef` as a coverage **name** (aliases `COVERAGE`, `COVERAGE NAME`, `COVERAGE GROUP`; examples `'Bodily Injury'` — `canonicalMap.ts:507-512`), while **every consumer byte-compares it to a refId** (`pricingLinks.ts:50-55`, `scripts/import-promote-e2e.mts:233,252`). A name can never equal `CORE.COV.018`. Causation, proven to the unit: Core's `COVERAGE NAME` column is non-blank on exactly **90** rows and `stepsWithCoverageRef` is exactly **90/2024** — the brain read faithfully on every row that stated a value; the loss is the vertical-ditto forward-fill gap. Third link in the chain: `step.coverageRef` is excluded from the `refIdRemap` rewrite that rules' `coverageRefIds` receive (`stage7-plan.js:784-785`).
**Do not** "fix" this in `isoImport.parseRating` — `stage7-plan.js:760-761` adopts ISO steps only when the brain emitted none, which was false on both measured runs, so that edit is a provable no-op.
**Fix** (three files): add a rating-domain `coverageRefId` field in `canonicalMap` mapped from the **ID** column (`PRODUCT FRAMEWORK ID` / `COVERAGE ID`), not the name column; forward-fill it down ditto rows at extraction time **carrying the origin cell's citation** (faithful extraction of a section header, never invention); include `step.coverageRef` in the `refIdRemap` rewrite. Decide and document the contract explicitly: `coverageRef` is a `;`-joined **refId string**.
**Gate**: `stepsWithCoverageRef` moves from 90/2024 toward the ~2,000 the source states; commit the currently-uncommitted card-figures check in `scripts/import-promote-e2e.mts` as the oracle; `glRobustness` $2,635 exact.

### 2.6 The filing path makes a filename load-bearing
`stage-filing.js:424`: `baseFormNumber = policyFormDoc.name.replace(/\.[^.]+$/, '')` — a **filename** becomes the product's minted refId, its `baseForm.formNumber`, and the filter admitting or excluding every rate-order variable. It is replaced only if `rawCovs[0].formNumbers[0]` exists, and `formNumbers` is not in the tool's `required` list. The classifier is also fed the filename as evidence (`:301`), against stage 0's own prompt: *"from CONTENT ONLY — filenames are not evidence."*
**Fix**: derive the base form number only from cited document content; when absent, surface `UNKNOWN` + a review item rather than substituting the filename. Remove the filename from the classifier prompt.
**Gate**: a filing fixture whose filename differs from its stated form number produces the stated number or `UNKNOWN`, never the filename; filing canary **$1,281** exact.

### 2.7 Genuinely silent drop paths
- The two-of-two prefilter veto sets `domain: 'ignore'`, `confidence: 1.0`, `humanFlagNeeded: false`, **no review item**, and excludes the sheet from the sweep. Worse, `index.js:129` guards the digest cross-check on `c.domain !== 'ignore'` — **the two 8192-token digest readers are silenced for exactly the sheets the two 128-token prefilter models vetoed.**
- `constants.js:80` returns `null` on an empty raw with no retry and no review item — the one truly silent vote loss, shared by the prefilter and the blind cross-check, both of which bypass `parseWithRetry`.
- `DERIVED_VERBATIM = /^\(.*\)$/` (`stage5-validate.js:45,111`) skips **all** citation checks for any parenthesized verbatim.

**Fix**: emit `prefilter-skip` naming both voters and keep prefiltered sheets in sweep scope; **remove the `!== 'ignore'` guard at `index.js:129`** (cheapest high-value change in this document); emit a review item on the empty-raw path; delete `DERIVED_VERBATIM` or require the parenthesized form to still byte-resolve.
**Gate**: every entry in `plan.summary.sheetsSkipped` has a matching `importWarnings` item; no code path can reach the plan without either a citation that byte-resolves or a review item.

### 2.8 Mapped-but-uncertain columns are never read
The fast path extracts only columns at confidence ≥ `DET_MAP_CONFIDENCE` 0.80 (`stage4-extract.js:629`) with **no AI fallback for the rest**. Qualification is a disjunction: `confident/mapped ≥ 0.60` **OR** `confident ≥ 2 && dominant ∈ {form, rule, ratingStep}` (`:613-626`) — the second branch admits a 76-column Forms sheet on two confident columns, permitting ~97% loss. Stage 3's ×0.7 disagreement penalty caps every disagreed column at 0.70, so every disagreed column is excluded. `summaryCounts.columnsMapped` still counts them as mapped.
**Fix**: extract every column with `canonicalField !== null`, carrying sub-threshold ones at their real (low) confidence with `reviewFlag = true`, rather than dropping the value. Correct `columnsMapped` to report columns actually read.
**Gate**: a 5-column fixture with 3 sub-threshold columns yields an entity with 5 fields (or 2 fields plus 3 named `low-confidence-column-dropped` items); no sheet reports more columns mapped than read.

### 2.9 The extraction cache replays poison; its durable tier is dead
`cachePut` stores raws **before parse validation and without `stopReason`** (`extract-cache.js:113-118`). On a hit, `parseWithRetry` sees `stopReason === undefined`, so the truncation branch never fires and **batch-halving never runs**; the one targeted retry re-invokes the same thunk, hits the cache and replays identical bytes. No `bypassCache` exists. Separately, `extract-cache.js:40` reads `AZURE_STORAGE_CONNECTION_STRING` while every other module in the platform uses `AZURE_BLOB_CONNECTION` — the durable tier never activates.
**Fix**: gate `cachePut` on parse success; persist `{raw, stopReason}` and restore `stopReason` on read; add `bypassCache` to the retry thunk; point line 40 at `AZURE_BLOB_CONNECTION`; bump `PROMPT_VERSION` once.
**Gate**: a stage-4 batch whose first response carries `stop_reason: 'max_tokens'` triggers batch-halving on replay, not a silent identical retry; the same workbook imported twice in separate processes yields `cacheHits > 0`.

### 2.10 Consensus arithmetic is acceptance-biased
`weightedMajority` declares consensus at any 2 agreeing votes with no family-diversity requirement (`stage4-extract.js:237`); agreement is boosted `max(fa,fb) × 1.05` (`:159`); conflict write-back is `Math.max(existing, resolved)` (`:425`), so confidence can only ratchet up; stage-1 disagreements are adjudicated by opus — REASONER_A's own deployment (`stage1-classify.js:198`). The judge verdict is parsed by first character (`charCodeAt(0)-97`), which selects a wrong candidate once a third candidate exists.
**Fix**: require cross-vendor agreement for a 2-vote majority on strict fields (candidates already carry `source`); reserve ×1.05 for cross-family agreement; replace `Math.max` write-back with the resolving lineage's own confidence; move judges and classify/adjudicate onto forced tools with enum-constrained verdicts and validated membership instead of a character index.
**Gate**: a same-family agreeing pair on a strict field escalates to the cross-family judge rather than resolving; a malformed verdict burns the retry and falls through instead of selecting a candidate.
**Priority note**: this is *lower* value than it appears — on template-family workbooks every qualifying sheet short-circuits to the deterministic path at `:894-899`, so this machinery is largely bypassed. Do not spend structural effort here before §2.1–§2.5.

## 3. Fix the certification harness before trusting any board

**The eval boards currently cannot certify anything, and this is the highest-leverage governance fix in the document.**

- `pnpm import:eval` (offline) is **4/4 green with numeric 1.0000**; `pnpm exec tsx scripts/import-eval2.mts --offline` is **8/8 red with numericFidelity 0.000**. Both score the **same** `mapIsoWorkbook`. A parser cannot be simultaneously perfect and zero — the eval2 number is an **entity-join artifact**: `goldenNumericFidelity` resolves claims through an exact refId map (`scripts/lib/import-eval2-metrics.mts:124-131`) while golden2 `entityRef`s are `"17"`, `"Product #4"`, `GLCOV030.01` against a mapper emitting `GL.COV.003.001`. Every one of 1,218 checks misses.
- Between 2026-07-17 and 2026-07-26, with harness code unchanged and golden counts identical, `substanceCoverage` **collapsed on all 8 goldens** (1.000 → 0.094–0.660; `unaccountedEntityCells` 0 → up to 503). A real regression landed in the Jul 24–26 fix wave and no gate saw it — because `tests/golden/import/` was regenerated by the same parser on 2026-07-25 (`deecb91`), making eval1's green board self-fulfilling.

**Do first, before any defect above whose gate cites eval2**: resolve golden `entityRef` through a name→refId index in both `goldenNumericFidelity` and `hierarchyRecall`; then commit a re-baseline board; then wire eval2 into CI as a **ratchet** (no metric may regress).
**Gate**: `numericFidelity` becomes non-zero on at least one golden **and changes when a deliberate mutation is injected**. A metric that cannot move is not a gate. Note `ldTableRefResolutionRate ≥ 0.95` already exists and already blocks (`scripts/import-eval2.mts:217`) — nothing to restore there.

## 4. Model changes

All models come from the fleet registry. Current: `GROUNDED_CITED = claude-opus-4-8`, `MID_REASONER = claude-sonnet-5`, `BULK_VERIFY = claude-haiku-4-5`, `VISION/REASONER_B = gpt-5.1`, `CHEAP_GENERAL = gpt-5-mini`, plus `EXTENDED_DEPLOYMENTS` (`DEEP_REASONER = gpt-5.4-pro`, `VERIFY_DEEPSEEK = DeepSeek-V4-Pro`, `DOC_OCR = mistral-document-ai-2512`, …).

1. **Unstarve the reasoning legs.** Prefilter 128 → 1024; classify 256 → 2048; both judges 400 → 2048. These are reasoning-class models whose reasoning is billed against `max_completion_tokens`. Add `refusal` as an explicit vote class beside `TRUNCATED_STOP`.
2. **Fix the inverted budget ladder.** The escalation ladder for already-disagreed rows gets 4096 (`stage4-extract.js:302`) while the routine first pass gets 8192 (`:932-933`). Raise the ladder to at least 8192 — sonnet-5 runs adaptive thinking by default and thinking shares the cap.
3. **De-correlate adjudication.** Stage-1 adjudication uses opus — REASONER_A's own deployment. Route it to a third family (`VERIFY_DEEPSEEK` via the proven `callOpenAI`-under-`IMPORT_CONTEXT` pattern) with a ×0.8 haircut. Lock-safe: `fleet.lock.test.ts` pins only the six core roles and the escalation ladder.
4. **Down-tier digest synthesis.** `gpt-5.4-pro` ($20/$150 per MTok) merges two pre-normalized JSON objects. Route routine synthesis to opus-4-8 or sonnet-5 and reserve the pro tier for genuine unknown-sheet holes. Lock-safe.
5. **Make `MISSING_DEPLOYMENTS` symmetric and self-healing.** `callOpenAI` neither checks nor populates it (`ai-call.js:157-191` vs `:104`, `:200`), so every OpenAI leg re-pays a 404 forever. Add the check, and give the set a TTL so a transient outage self-heals. The comment at `stage4-extract.js:376-377` claiming otherwise is false and should be corrected.
6. **Wire DOC_OCR for scanned PDFs.** A complete, exported, metered `documentOcr()` already exists at `server/lib/external/foundry.js:94-103`; `stage-filing.js` simply never calls it. Add the caller plus an `IMPORT_CONTEXT` budget wrapper — OCR-to-markdown then the text ladder beats whole-PDF vision on cost and fidelity.
7. **Fix the PDF vision ensemble.** It is currently decided by **item count alone** — the model returning more items wins, with no agreement check, no confidence haircut and no disagreement telemetry (`stage-filing.js:240-247`). Make it an agreement-based reconciliation like stage 4's.
8. **Prompt caching is inert on the cheap tier.** System prompts top out around 1,167 tokens against Haiku 4.5's 4,096-token minimum cacheable prefix, so the `ephemeral` blocks on those calls are silent no-ops. Either restructure to exceed the minimum or stop claiming the saving.
9. **Do not treat `claude-opus-5` as a drop-in.** `shared/src/ai/fleet.lock.test.ts` is **deploy-blocking** and hard-asserts `DEPLOY_OPUS === 'claude-opus-4-8'`. Any upgrade is a governed re-certification with the full ritual, never an edited constant. **`claude-fable-5` stays forbidden.**
10. **Before recommending any Claude model, pricing, or parameter change, consult the `claude-api` skill** rather than memory. Note empirically: `temperature` is rejected on these deployments; `output_config.effort` works on opus/sonnet and 400s on haiku; opus-4-8 runs *without* thinking when `thinking` is omitted — and it currently runs at `maxTokens: 256` in three places, which is survivable only because thinking is off.

## 5. Target architecture and migration

The end state is an inversion of today's "two parallel extractions joined at the end":

```
N0  Intake + armor + census + fingerprints            (today's stage 0, unchanged)
N1  SCAFFOLD  — deterministic oracle FIRST, $0, no AI
N2  SURVEY    — one agentic surveyor with tools over the live grid, holes only
N3  BIND      — pointer-extraction: models point at cells, CODE reads bytes
N4  COURT     — claim admission + adversarial verify + reconciliation
N5  RE-DERIVE — total inverse projection replaces sampling + the capped sweep
N6  ASSEMBLE  — thin plan projection (today's stage 7 minus the ISO join)
N7  LEARN     — FormatCard dialect memory, distilled after human approval
CI  EVAL GATE — eval1 + eval2 + holdout + canaries on every brain change
```

The load-bearing idea is **N3**: each field claim is a pointer `{cell: {r,c}, transform}` and `value := grid[cell]` is read by code, so the model never types a refId, form number or rate. Transcription hallucination stops being detectable-after-the-fact and becomes unrepresentable. Keep byte-frozen throughout: `mapIsoWorkbook`, the filing reconciler, the rating engine, the review-bundle shape (client compatibility), and all four canaries.

**Phases** — each independently shippable, flag-gated and revertible:

- **P0 (do this first)**: §3 (harness) then §2.1–§2.3 and §2.6–§2.9. All small, in-architecture, high-value. *Do not skip to structural work: nothing should be rebuilt on top of a broken resume, a fabricating oracle and an uncertifiable harness.*
- **P1**: scaffold-first behind `IMPORT_SCAFFOLD_FIRST=1`. **Note `consumedSpans` do not exist in production** — `mapIsoWorkbook` records them only when passed a third argument and `unified-import.js:191` passes one, so `ctx.spans` is null and the gridSpan block is dead. P1 must enable span recording first. Acceptance is **identical entity sets and identical strict-field values** (diff on `refId`/`parentId`/`order`/`number`), *not* byte-identical bundles — that assertion is self-contradictory once rows are skipped, and stage-4 nondeterminism defeats byte-equality anyway.
- **P2**: tool server + shadow survey, then `propose_bindings` on holes, shadow-diffed against stage 4 before per-domain cutover. This is the phase that must move eval2.
- **P3**: court + re-derivation replace the vote arithmetic and the 300-cell sweeper; delete `joinGroupWithIso` only after two clean shadow cycles.
- **P4**: FormatCards + CI ratchet. Learning is data consumed by deterministic code, never model-emitted code; cards are audited entities through `adapter.db.mutate()`; holdout fingerprints are denylisted so learning cannot memorize the exam.

## 6. Certification ritual — every change passes all of it

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build     # the gate
pnpm import:eval                                            # offline parse-stability
pnpm exec tsx scripts/import-eval2.mts --offline            # cell-level truth (NOT `pnpm import:eval2` — no such script)
pnpm exec tsx scripts/phaseg-holdout.mts --check            # frozen holdout corpus
```

Plus, for any change touching extraction, placement or the plan: a committed **eval2 re-run board**, and `pnpm exec tsx scripts/import-promote-e2e.mts` against a live host when one is configured (needs `BASE_URL`, `IMPORT_USER`, `IMPORT_PASS`, `IMPORT_TENANT`).

Rules for the ritual:
- All four canaries exact, every time — including for changes that "obviously" cannot touch rating.
- No metric may regress. eval2 is a ratchet, not a snapshot.
- If a board moves in the right direction for the wrong reason, that is a failure. §3 exists because a green board was produced by regenerating its own goldens.
- Report outcomes faithfully: if a gate fails, say so with the output; if a step was skipped, say which and why.

## 7. What to hand back

For each defect you close: the diff, the acceptance-gate output proving it, the four canary results, and a one-line statement of the cause you fixed (not the symptom you suppressed). For anything you decline to fix, say why and what you would need. Do not report a defect as closed on the strength of a green gate alone — the gate contains no import-accuracy signal.
