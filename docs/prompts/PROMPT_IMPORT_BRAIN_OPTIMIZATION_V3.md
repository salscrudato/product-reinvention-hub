# PROMPT — Enhance and Optimize the Import Brain

*Self-contained. Paste into a fresh AI session with write access to this repository. Derived from `docs/review/IMPORT_BRAIN_FULL_REVIEW_V3.md` (HEAD `83cc471`, 2026-07-26). Every defect below was verified in code; the ones marked **[executed]** were reproduced by running something.*

---

You are working on the **import brain** of an insurance-document ingestion platform: the subsystem that turns semi-structured Excel workbooks and carrier filing PDFs into a governed canonical **Product Component Model (PCM)**, which a deterministic engine then prices. Enhance and optimize it, defect by defect, under hard invariants.

**Orient first, then verify.** Read `docs/IMPORT_BRAIN.md` (stale in ~8 places — it claims stage 7 is inside the brain and that uncited claims are dropped; neither is true), then `server/lib/ai/unified-import.js`, all of `server/lib/import-brain/*.js`, `shared/src/insurance/isoImport.ts`, `shared/src/import/structure/*`, `shared/src/import/canonicalMap.ts`, `shared/src/ai/fleet.ts`. Then read `docs/review/IMPORT_BRAIN_FULL_REVIEW_V3.md` in full.

> **Working-tree note**: the removal of the client-side deterministic parse path (`ImportWorkbookModal.tsx`, `readWorkbook.ts`) is **uncommitted**. Run `git status` before you start and know what is HEAD and what is not.

## 0. Ground rules

- **Verify-first.** Claims about behavior come from running the gate, executing a repro, or hitting an endpoint — never from reading code alone. Several defects below were found only because someone re-executed a loop or dumped a golden.
- **Never weaken a test, threshold, canary, or golden to go green. Fix at the cause.** If a golden must change because behavior legitimately changed, say so explicitly, show the diff, and get it approved. Never regenerate goldens as part of a fix — doing exactly that on 2026-07-25 is what hid a live regression.
- **One writer per worktree.** Stage explicitly; use `git commit --only <paths>`; never `git add -A`.
- **Do not hit a live host** without explicit authorization; credentials live in the gitignored `keys.md`.
- Work the defects **in the order given**. Each has an acceptance gate. Do not start the next until the current gate is green **and** the full certification ritual passes.

## 1. Non-negotiable invariants

1. **Citations-or-discarded.** Every extracted field cites its source cell `{sheet, cell, verbatim}`. Uncited claims must not silently become data. *(Today this is BLOCKING only for strict ids on non-stacked sheets, and any parenthesized verbatim bypasses it entirely — §2.6. Strengthening it is in scope; weakening it is not.)*
2. **Flag-not-invent.** When the source does not establish a value, surface a notice or `UNKNOWN`. Never fabricate a plausible one. **Four live violations are listed in §2.3.**
3. **Byte-faithful identifiers.** refIds and form-number chips are carried byte-for-byte; the only legal transform is `refIdToDocId` (dots→dashes, case preserved). **A filename is never an identifier** (§2.7).
4. **Fleet-registry models only.** Every model comes from `shared/src/ai/fleet.ts` (bridged to `server/lib/fleet-shared.cjs`), routed through the in-process cost guard. Never hardcode a model string. Import runs under the named `IMPORT_CONTEXT = 'import-no-cap'` exemption (`server/lib/fleet.js:77,103` — never budget-denied, never degraded) but telemetry is never bypassed. **`claude-fable-5` is forbidden in the fleet** and is pinned by exactly two tests (`shared/src/ai/fleet.lock.test.ts:60-61`, `shared/src/ai/fleet.test.ts:23`). `fleet.lock.test.ts` is **deploy-blocking** and hard-asserts `DEPLOY_OPUS === 'claude-opus-4-8'` — a model upgrade is a governed re-certification, never an edit-the-constant change.
5. **Four rating canaries stay exact** — PH **$1,528** (`shared/src/rating/evaluator.test.ts`), PA **$1,002** (`shared/src/rating/workedExample.canary.test.ts`), GL **$2,635** (`shared/src/rating/generalLiability.evaluator.test.ts`), filing-import **$1,281** (`shared/src/insurance/filing/reconcile.test.ts`). Exact or broken.
6. **Atomic mutation envelope.** Every entity write goes through `adapter.db.mutate()`; the `/api` host batches entity + auditEvent + version + searchIndex in one Cosmos transactional batch. No bare data-store writes; the audit hash-chain (`/api/db/audit/verify`) stays green.
7. **Adapter seam.** All app reads/writes go through `adapter` (`app/src/lib/backend/`); never import a platform SDK in a component.

## 2. The ranked defect list

Fix in this order. §2.0 and §2.0b come first because they are the only defects with a *proven* live symptom. Then the harness (§2.1) — **it cannot currently observe the thing most of the remaining defects break**, so nothing after it can be certified without it. Then the extraction dictionary (§2.2), because several later fixes depend on it.

**Leads worth checking — mechanism-stated by an analysis pass but not independently re-verified. Treat as investigation targets, not findings**: `parseJudge` passes `confidence` through untyped, so a non-numeric value can write `NaN` into `field.confidence` and silently disable the low-confidence review gate; `acceptedPlan()` never filters `plan.ratePlaceholders`, so they bypass both the section toggles and the exclusion set and are written as `rtTables`; import spend is never attributed to a tenant despite the router wrapping `unifiedImport` in `metering.withTenant`; the accounting ledger is keyed by sheet name while `mergeStructurals` renames colliding sheets in multi-workbook uploads, so those FACT posts miss; a running import has no abort path; stage 5's dropped-row check compares a full sheet row count against a capped 100-entity sample, so large deterministic sheets always yield false `dropped-row` findings.

### 2.0 The ISO join destroys the parent-before-child ordering the write path depends on *(highest blast radius — the one hard live failure on the board)*
`stage7-plan.js:690-695` sorts coverages parents-first, and says why in a comment: *"importPlan flushes batches on forward-references; sorting parents first minimizes flushes and orphan risk."* Then `joinGroupWithIso` (`:317-350`) **rebuilds the array from scratch** — pass 1 pushes refId-matched brain entities in brain order, pass 2 appends name-matched and mapper-only entities in iso order. The ordering the write path depends on does not survive the join.
**Why this is the root cause of the live failure**: `docs/audit/import_promote_e2e-EPLUS-E2E.json` records `failed: 100` — exactly two 50-row batches — and simultaneously zeroes `limitTerms`, `deductibleTerms` **and** `stepsWithCoverageRef`. A batch-level persist rejection explains all three at once. A field-level join bug explains none of them, and `EPLUS-R2` kept 59 + 22 terms through the identical field-level join. **Do not chase the terms-erasure story that earlier reviews told; fix the ordering.**
**Fix**: re-apply the parent-before-child sort *after* the join, or make `joinGroupWithIso` order-preserving.
**Gate**: `scripts/import-promote-e2e.mts` on an E+ workbook reports `failed: 0`; a unit test asserts every child coverage appears after its parent in the post-join array.

### 2.0b `stampDefaults` runs before the join, so "absence never beats a cited value" is a no-op for every scalar
`stampDefaults` is applied to all six groups at `stage7-plan.js:699-701` — **before** `joinGroupWithIso` at `:717-723` — and unconditionally fills `status`, `lifecycle`, `reviewStatus`, `reviewer`, `allStates`, `formNumbers` whenever they are `undefined`. The `ISO_STAMPED_FIELDS` gap-fill then only writes when `brainHas` is false (`:299-300`), which by that point is **never**. Arrays still union (so `formNumbers` works); every scalar is dead.
**The consequence is the reverse of what earlier reviews claimed.** The mapper genuinely reads state scope from the grid (`isoImport.ts:423-428`); the brain's stamped `allStates: true` / `status: 'ACTIVE'` defaults now beat it unconditionally. This is **importer defaults overwriting mapper-read evidence** — the same invariant broken in the opposite direction. Commit `deecb91` fixed the union branch and left this ordering bug untouched.
**Fix**: move `stampDefaults` after the join, or have it record which fields it stamped so the join can still fill them.
**Gate**: a test where the mapper reads `states: ['TX']` and the brain read none retains `['TX']` with `allStates: false`; all four canaries exact.

### 2.1 Neither certification harness can see a term *(fix first — everything else is uncertifiable without it)* **[executed]**
`scripts/import-eval.mts:139-148` (`scalarFields`) keeps **only** scalars plus `formNumbers`; `SKIP_FIELDS` (`:134`) additionally drops `citation`. So `terms[]`, `states[]`, rating `source{}`, `coverageRefIds[]` and RT/LD `rows`/`dimensions` are absent from every golden. Confirmed: `tests/golden/import/CORE.golden.json` holds 521 entities and **0 of its 112 coverages carry a `terms` array**; `grep terms scripts/import-eval.mts` returns nothing. eval2 keeps arrays (`scripts/import-eval2.mts:90`) but `goldenNumericFidelity` flattens only one level (`scripts/lib/import-eval2-metrics.mts:131`) and `canonicalizeNumeric` (`scripts/lib/golden2-schema.mts:185-193`) renders a term object as `"[object object]"`, which never equals a numeric claim.
**Consequence**: eval1's "4/4 green, F1 1.0000" certifies the scalar surface only. A change that deleted every limit in the product would leave the board green.
**Fix**: project `terms`/`states`/`source`/`coverageRefIds` in `scalarFields` under a deterministic canonical ordering; make `goldenNumericFidelity` walk nested objects. Separately, fix eval2's entity join — resolve golden `entityRef` through a name→refId index in both `goldenNumericFidelity` and `hierarchyRecall`.
**Gate**: inject a deliberate mutation that deletes one LIMIT term and prove a board turns **red**. *A metric that cannot move is not a gate.* Note `ldTableRefResolutionRate >= 0.95` already exists and already blocks (`scripts/import-eval2.mts:217`) — nothing to restore there. Then commit a re-baseline **as an explicit, reviewed decision**, and gate eval2 in CI as a ratchet.
> Caution: eval2's `0.000` has **two** causes, not one. On 4–5 goldens the `entityRef`s are name-shaped and nothing joins (harness bug). On `gl-base`, 93/99 refIds join and 0/110 numeric values still match (genuine extraction loss). Do not "fix the join" and declare victory.

### 2.2 The AI brain is never told that limits, deductibles or rate-table structure exist
`buildDomainDictionary` filters `f.role !== 'system' && f.role !== 'derived'` (`server/lib/import-brain/stage3-column-map.js:31`), and aliases are referenced nowhere else in stage 3 (`:37` is the only other use; there is no deterministic alias pre-pass). **15 of 88 canonical fields therefore carry aliases that can never match anything** — and they are the valuable ones:

| field | role | dead aliases |
|---|---|---|
| `terms` | derived | `LIMIT`, `DEDUCTIBLE`, `AVAILABLE LIMITS` |
| `rows.value` | derived | `AVAILABLE LIMITS`, `AVAILABLE DEDUCTIBLES`, `LIMITS`, `DEDUCTIBLES` |
| `valueColumn` | derived | `ILF`, `RATE`, `FACTOR`, `VALUE` |
| `dimensions` | derived | `DIMENSION`, `LOOKUP KEY` |
| `ldTableRef` | derived | `RULE REFERENCE`, `RATE REFERENCE`, `REFERENCE` |
| `ratingProgram.refId` | derived | `PRODUCT FRAMEWORK ID`, `RATING STEP ID` |
| `dynamicFields` | derived | `DYNAMIC DATA` |
| `mandatory` | derived | `MANDATORY`, `MANDATORY/ OPTIONAL` |

**Consequence**: every term in the system comes from the deterministic mapper alone; the ensemble, judges and sweeper contribute nothing to the limit/deductible surface, and no review item says so. This is also *why* §2.5 is broken.
**Fix**: promote genuinely-extractable fields to `role: 'source'` with an explicit `mapsTo`, or introduce a third dictionary category for structural concepts the model may point at.
**Gate**: a test asserting **no** `derived`/`system` field carries a non-empty `aliases` array; a Core rating sheet yields ≥1 column mapped to a term-bearing field; `summaryCounts` distinguishes mapped-and-read from mapped-and-dropped.

### 2.3 Four flag-not-invent violations
- **(a) Fabricated terms.** `deriveTermsFromReferenceTables` (`shared/src/insurance/isoImport.ts:1995-2031`) sets `primaryKind` from a header cell (`limitHeaderSeen`, `:1739`) *independently of whether any value parsed*, then emits `default: data.defaultValue ?? data.rows?.[0]?.value ?? 0`. A flat table that parsed **no rows** yields a `default: 0` term. The MATRIX branch three lines above refuses for exactly this reason and says so in its comment: *"`default:` below would fall through to 0, which prices — so withhold the term entirely."* The refusal was applied to one shape and not the other.
- **(b) Fabricated nationwide scope, in TWO places.** `stampDefaults` sets `allStates = !states.length` (`server/lib/import-brain/stage7-plan.js:571`) — a positive 51-jurisdiction regulatory claim from silence, unflagged, three lines below where `status` correctly sets `statusAssumed` + `needsReview`. **The deterministic mapper does the same at `shared/src/insurance/isoImport.ts:428`** — and that site **is** golden-pinned (`CORE.golden.json` carries `allStates: true` on `CORE.COV.001`).
- **(c) Inverted operators, documented in TWO files.** `foldStepOp` maps `'/'` → **MUL** and `'-'` → **ADD** (`stage7-plan.js:196-201`), and falls back to `'MUL'` for any unrecognized operator. **`shared/src/import/canonicalMap.ts:515` documents the same inversion** (`"+"/"-"→ADD, "*"/"/"→MUL`), so the dictionary teaches the model the wrong mapping upstream. Fixing only `foldStepOp` is incomplete.

**Fix**: gate term derivation on ≥1 parsed numeric row, mirroring the MATRIX refusal verbatim; flag stamped `allStates` at **both** sites with `allStatesAssumed` + `needsReview` and one aggregated `importWarnings` item; split `foldStepOp` into faithful synonyms vs unrepresentable-but-stated operators (the latter producing a warning, never a wrong op) **and correct `canonicalMap.ts:515`'s description in the same change**.
**Gate**: `{op:'/'}` and `{op:'-'}` each yield exactly one `rating-step-op-unrepresentable` warning and no inverted op; a term-less flat table yields zero terms; a coverage planned from a source with no state columns carries `allStatesAssumed === true`. **This touches rating shapes — re-run all four canaries and prove them exact; do not assume they are untouched.** The `isoImport.ts:428` half **will** change `CORE.golden.json`: that is a legitimate behavior change requiring an explicit reviewed re-baseline, never a silent regeneration. The (a) fix is golden-safe — no golden records terms today (§2.1).

### 2.4 Stacked sheets never get a column map
`server/lib/import-brain/stage2-header-lock.js:75-86` pushes locks **only** under `Sheet::Sub` pseudo-names, then `continue`s. `stage3-column-map.js:194` looks up the plain name and returns `null`. `stage4-extract.js:850` bails `return null` **with no review item**. The `::` guards at `stage3:195` and `stage4:846` are provably dead — `classified` holds only plain fingerprint sheet names.
**Blast radius**: Core `Rule References` (7,184 × 32, 76,198 cells, 230 census tables) and E+ `E+ Rule References` (3,651 × 32, 2,970 hidden rows). *Note: this is the **third** largest sheet, not the largest — Core Rating is 119,574 cells and Core Forms 110,733.*
**Fix**: in `stage2-header-lock.js`, also push a lock under the plain `fp.sheetName` (`headerRowIndex` from `subTables[0]`, `isConfirmed: false`) so stages 3–4 see the sheet; carry `absoluteRowStart` per sub-table.
**Gate**: a fixture with two stacked blocks yields >0 entities and a non-empty column map; add the >2000-row fixture. **Do not** delete the stage-5 BLOCKING→WARN downgrade in the same change — it currently never fires, and removing it before rows are anchored converts a dead branch into a live blocker.

### 2.5 The step→coverage contract is broken at the field level
`canonicalMap.ts:506-511` defines `coverageRef` as a coverage **name** (aliases `COVERAGE`, `COVERAGE NAME`, `COVERAGE GROUP`; examples `'Bodily Injury'`), while **every consumer byte-compares it to a refId** (`app/src/lib/insurance/pricingLinks.ts:47-56`; the uncommitted card check in `scripts/import-promote-e2e.mts` does the same). A name can never equal `CORE.COV.018`. The code has already decided the contract; `canonicalMap` is the outlier.
Core's `COVERAGE NAME` column is non-blank on exactly **90** rows and `stepsWithCoverageRef` is exactly **90/2,024** — the brain read faithfully every row that stated a value. Meanwhile ~2,003 Core rows state `CORE.COV.###` in `PRODUCT FRAMEWORK ID`, whose only canonical home is a `derived` field (§2.2) and is therefore never offered to the mapper. Third defect in the chain: `step.coverageRef` is excluded from the `refIdRemap` rewrite that rules' `coverageRefIds` receive (`stage7-plan.js:784-785`), so an adopted refId orphans the link.
**Fix** (three files, and it depends on §2.2): add a rating-domain `coverageRefId` field mapped from the **ID** column; forward-fill it down ditto rows carrying the origin cell's citation; include `step.coverageRef` in the `refIdRemap` rewrite; correct `canonicalMap`'s description to a `;`-joined **refId string**.
**Gate**: `stepsWithCoverageRef` moves from 90/2,024 toward the ~2,003 the source states; the card-figures check goes green; GL **$2,635** exact.
> Do **not** "fix" this by patching `parseRating` in the deterministic mapper — `joinGroupWithIso` is not called for `ratingProgram` (`stage7-plan.js:718-723`) and ISO steps are adopted only as a fallback when the brain emitted none (`:760-761`). It would be a no-op.

### 2.6 Silent drop paths
- **Prefilter veto**: two 128-token models agreeing sets `domain: 'ignore'`, `confidence: 1.0`, `humanFlagNeeded: false` with **no review item** (`stage1-classify.js:129-138`). An `ignore` verdict then removes the sheet from **seven** downstream stages (`index.js:129,135,198`; `stage2:67`; `stage3:188`; `stage4:839`; `stage5:254`). Worst: `index.js:129` guards the digest cross-check on `c.domain !== 'ignore'`, so the two 8192-token digest readers are silenced for exactly the sheets the two starved 128-token models vetoed.
- **Any transport exception is an untelemetered missing vote**: `parseWithRetry` opens `try { res = await call() } catch { res = { raw: '' } }`, then `if (!res || !res.raw) return null` (`constants.js:80`) with no review item. The same pathology is independently reimplemented via `.catch(() => ({ raw: '' }))` at `stage1-classify.js:121-122` and `stage4-extract.js:738-739`.
- **`DERIVED_VERBATIM = /^\(.*\)$/`** (`stage5-validate.js:45`, used at `:111`) `continue`s past **all** citation checks — strict and non-strict — for any parenthesized verbatim.
- **`rowKind` emits a vocabulary stage 7 cannot consume**: it returns `'rating'` (`stage4-extract.js:584-598`) while stage 7 consumes `byKind('ratingProgram')` / `byKind('ratingStep')` (`:526-527`). Rate/LD/ROC rows fall through.

**Fix**: emit `prefilter-skip` naming both voters and keep prefiltered sheets in sweep scope; **remove the `c.domain !== 'ignore'` guard at `index.js:129`** (cheapest high-value fix on this list); emit a review item at the stage-4 stacked bail; emit `malformed-model-output` on the silent-null path and at all three `.catch` sites; reconcile `rowKind`'s vocabulary with stage 7's.
**Do NOT delete `DERIVED_VERBATIM`.** `deriveParentIds` legitimately emits `verbatim: '(derived from row context)'` (`stage4-extract.js:489`); deleting the bypass turns every derived `parentId` into an `ungrounded-field` violation. Replace the open regex with a **closed vocabulary** (`(derived from row context)`, `(synthesized)`) **and** require `cell === ''`.
**Gate**: a prefiltered sheet produces exactly one named review item; a forced transport failure produces one; a fabricated `"(derived)"` verbatim on a strict id is now **caught**, while a real `deriveParentIds` output still passes.

### 2.7 The filing path makes a filename load-bearing
`server/lib/import-brain/stage-filing.js:425`: `baseFormNumber = policyFormDoc.name.replace(/\.[^.]+$/, '')` — a **filename** becomes the product's minted refId, its `baseForm.formNumber`, and the filter admitting every rate-order variable. It is replaced only if `rawCovs[0].formNumbers[0]` exists (`:449`), and **`formNumbers` is genuinely absent from the tool's `required` list** (`:411`), so the model may legally omit it. The classifier is also fed the filename as evidence (`:301`), against stage 0's own prompt: *"from CONTENT ONLY — filenames are not evidence."*
**Fix**: never derive an identifier from a filename. If no coverage states a form number, mint a placeholder refId marked `needsRefIdSynthesis` + `needsReview` and emit a notice. Add `formNumbers` to the tool's `required` list or handle its absence explicitly. Remove the filename from the classifier's evidence block.
**Gate**: a filing whose documents are renamed to random strings produces an **identical** plan; a policy form with no stated form number yields a flagged placeholder, never a filename-derived id.

### 2.8 The extraction cache — fix in this exact order
`cachePut` stores raws **before parse validation and without `stopReason`** (`extract-cache.js:113-118`); `cacheGet` returns only the raw string. On a hit, `cachedCall` returns `{raw, cached:true}` with no `stopReason`, so the truncation branch cannot fire and **the one semantic retry for the two cached bulk votes is guaranteed to replay identical bytes and fail**. There is no `bypassCache` anywhere. Separately, `extract-cache.js:40` reads `AZURE_STORAGE_CONNECTION_STRING` while every other module in the platform uses `AZURE_BLOB_CONNECTION` (`run-observatory.js:22`, `run-results.js:15`, `_shared.js:264`, `filing.js:233`), so the durable tier never activates.
> **Correction to an earlier review**: batch-halving is *not* globally broken. `cachedCall` returns the original `res` on a **miss**, so `stopReason` survives and halving fires correctly on live truncations. The defect is the no-op retry.
> **Ordering hazard**: fixing the env var **first** would *activate* a dormant cross-run poison. Gate `cachePut` on parse success first.
**Fix**: (1) gate `cachePut` on parse success and persist `{raw, stopReason}`; (2) add `bypassCache` to the retry thunk; (3) *then* point `extract-cache.js:40` at `AZURE_BLOB_CONNECTION`; (4) bump `PROMPT_VERSION` once.
**Gate**: a stage-4 batch whose first response is `max_tokens` triggers batch-halving on replay, not a silent identical retry; the same workbook imported twice in separate processes yields `cacheHits > 0`.

### 2.9 Checkpoint resume is broken — and unreachable
`unified-import.js:333` seeds `resume = { stage4: { sheets: {} } }`, but `index.js:183` always writes a checkpoint literally named `stage4`, which fails `stage.startsWith('stage4.')` and takes the `/^stage[1-9]/` branch at `:344`, overwriting the sheet map. It then throws in **every** artifact ordering, is caught at `:352`, and nulls the entire `resume` object — losing stages 1–3 too. Precisely: resume *works* for a run killed mid-stage-4; it breaks for any run that **completed** stage 4 and died later. Split runs lose checkpoints only for **secondary** products (`gi > 0`, `unified-import.js:494-496`).
**Reachability**: `grep -rn resumeRunId` finds the server handler and docs only — **no production caller passes it**. The feature is dead at two levels.
**Fix**: namespace the summary artifact (`stage4.summary`) or check `stage4.sheets` before assignment; permit `split<N>/` in `sanitizeStage`; populate `resume.digest`; **and auto-attach `runId` server-side so durability is default-on** — without a caller, fixing the restore loop changes nothing observable. Record spend and duration in the run artifact so the ROI of this work becomes measurable (today no committed artifact carries either, so the widely-quoted "~$70 / ~110 min" is unevidenced).
**Gate**: a test that writes the real checkpoint sequence and restores without throwing; a killed-and-resumed run demonstrably skips already-checkpointed stage-4 sheets.

### 2.10 Consensus, telemetry, and the sampling that isn't
- A **single-vote field is accepted outright** at a 0.9 haircut (`stage4-extract.js:152`).
- `weightedMajority` declares consensus at any **2 agreeing votes with no family-diversity requirement** (`:237`); agreement is boosted `max(fa,fb) × 1.05` (`:159`); conflict write-back is `Math.max(existing, resolved)` (`:426`) so confidence can only ratchet up; stage-1 disagreements are adjudicated by opus — REASONER_A's own deployment (`stage1-classify.js:198`); both bulk voters receive the **identical prompt including the column map** (`:915`).
- Judge verdicts are parsed by first character (`charCodeAt(0) - 97`, `:364-365`); a bounds check prevents a wrong pick with two candidates but **silently discards** a verdict phrased `"candidate b"`.
- `sampledVerifications` is a hardcoded `[]` (`stage7-plan.js:1114`, `unified-import.js:653`). The real sampler, `sampleVerifyMap` (`stage4-extract.js:725-767`), reads at most `DET_SAMPLE_BATCHES(2) × BATCH_ROWS(20) = 40` rows per sheet (**1.97%** of Core Rating's 2,029 rows, **0.44%** of Dynamic Data's 9,086), needs >30% disagreement to raise one item, and **is structurally blind to omission** — `if (!detField) continue` (`:749`) means it only compares fields the deterministic path already produced.
- `callOpenAI` never checks or populates `MISSING_DEPLOYMENTS` (the comment at `stage4-extract.js:376-377` asserting otherwise is false), so gpt-5.1, gpt-5-mini and the DeepSeek judge re-pay a full 404 round trip forever.

**Fix**: require cross-vendor agreement for a 2-vote majority on strict fields and stop accepting single-vote strict fields outright; reserve ×1.05 for cross-family agreement; replace the `Math.max` write-back with the resolving lineage's own confidence; parse judge verdicts by forced-tool enum; add aggregate parseable-votes-per-family counters; give `MISSING_DEPLOYMENTS` a TTL and make `callOpenAI` honor it; make `sampleVerifyMap` able to flag a *mapped-but-unread column*, not only a wrong value.
**Gate**: a synthetic two-vote agreement from the same family no longer reaches consensus on a strict field; a mapped column that the deterministic path never read produces a named review item.

## 3. Model changes

The catalog is in `docs/review/IMPORT_BRAIN_FULL_REVIEW_V3.md` §6, verified row by row. Make these changes, all fleet-role-only:

1. **Unstarve the reasoning-model legs.** Prefilter **128 → 1024** (`stage1-classify.js:121,122`); classify **256 → 2048** (`:143,144`); adjudication **256 → 2048** (`:198`); both judges **400 → 2048** (`stage4-extract.js:358,383`). These are reasoning models whose reasoning bills against the same ceiling.
2. **Fix the escalation ladder — it is inverted twice.**
   - *Budget*: escalation gets **4096** (`stage4-extract.js:302`) while the routine first pass gets **8192** (`:932-933`). Raise the ladder to 8192.
   - *Reasoning*: `callAnthropic` never sets `thinking` (`ai-call.js:115-120`), and omitting it means **opposite things on the two rungs** — `claude-sonnet-5` runs **adaptive thinking**, `claude-opus-4-8` runs **without thinking**. The ladder escalates sonnet → opus, so **escalating a contested row currently downgrades reasoning.** Set `thinking: {type: "adaptive"}` and `output_config.effort` explicitly on the opus rung.
3. **De-correlate adjudication.** Route stage-1 adjudication to a third family (`VERIFY_DEEPSEEK`) with a ×0.8 haircut. `fleet.lock.test.ts` pins only the six core roles, so re-routing an `EXTENDED_DEPLOYMENTS` consumer is lock-safe.
4. **Turn reasoning on for the deep roles — using the pattern this repo already has.** No `thinking` and no `output_config.effort` is passed anywhere on the import path. `server/lib/ai/_shared.js:74-76` already implements the correct deployment-gated form (`body.output_config = { effort }` only when `deployment === fleet.DEPLOY_OPUS || deployment === fleet.DEPLOY_SONNET`) — **that gate is load-bearing: `effort` errors on Haiku 4.5.** Lift it into `callAnthropic` as an optional parameter. **Probe Foundry before adopting**, and note opus-4-8 runs at `maxTokens 256` in three places: enabling thinking without raising those caps truncates immediately.
4b. **Give `callResponses` an explicit timeout.** `ai-call.js:210-213` calls `fetchWithRetry` with no third argument, so the `gpt-5.4-pro` deep reasoner — registered as "quality ≫ latency" — runs under the generic 120 s ceiling. Pass `{timeoutMs: 300_000}`, matching the filing-document precedent, and treat an `incomplete` status as truncation.
5. **Down-tier digest synthesis.** `gpt-5.4-pro` ($20/$150) merges two pre-normalized JSON objects (`stage1-digest.js:225`). Route to opus-4-8 or sonnet-5; reserve the pro tier for `unknown-sheet` holes. Lock-safe.
6. **Wire `DOC_OCR`.** A complete, exported, metered `documentOcr()` already exists at `server/lib/external/foundry.js:94-103`. It needs a caller in `stage-filing.js` plus an `IMPORT_CONTEXT` wrapper — OCR-to-markdown then the text ladder beats whole-PDF vision reads on cost and fidelity.
7. **Do not** delete `brain:escalation` — it is fully plumbed (`unified-import.js:373` → `AgentVisualizer.tsx:245`) with two green tests. `escalateAnthropic` alone has no caller.
8. **Do not** treat `claude-opus-5` as a drop-in (see invariant 4). **Never** `claude-fable-5` (it is also the wrong economics here — higher per-token cost than Opus and a 30-day-retention requirement).
9. **Scope the inert-cache claim correctly.** The minimum cacheable prefix is **4,096 tokens on Haiku 4.5** but **1,024 on Opus 4.8 and Sonnet 5**. The ≈1,167-token system prompts therefore *do* cache on the opus/sonnet legs and are silent no-ops **only on the haiku calls** — which are the highest-volume calls in the pipeline (both bulk votes, the prefilter, the sweeper). Either pad/restructure those prompts past 4,096 or stop claiming the saving; log `usage.cache_read_input_tokens` into `budget` so this is measured, not assumed.
10. Two comments (`stage1-classify.js:14`, `stage3-column-map.js:12`) claim "Temperature 0 on all Claude calls" while **no `temperature` is ever sent**. Either set it or correct the comments — do not let them justify a reproducibility claim the code does not make.
11. **Close the fleet-registry bypass without deleting the escape hatch.** `HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT` (`unified-import.js:28`, used at `:566`) lets an env var inject an arbitrary model string that never passes through the registry — a violation of invariant 4. Note this is a **repo-wide convention** (7 other modules do the same), so do not treat it as an import-brain slip: route it through `resolveDeployment(role, overrides)`, which `fleet.ts:80-87` already provides and which keeps the override inside the seam. Also make that fallback call visible to the per-run budget.
12. **Make `brain:escalation` actually fire.** `escalateAnthropic` is the only code path that invokes `budget.onEscalation` (`ai-call.js:250`) and has no caller; every real ladder re-implements the walk inline and omits the hook. The SSE event is fully plumbed (`unified-import.js:373` → `AgentVisualizer.tsx:245`) and covered by two green tests, yet **can never fire on a production run**. Fix by calling the hook at the four inline ladder sites — **not** by deleting the event.

## 4. Target architecture and migration

**SCAFFOLD → SURVEY → BIND → COURT → RE-DERIVE → LEARN.** The central inversion: run the deterministic maximum *first* and make models **point at cells rather than transcribe them**, so hallucinated transcription becomes *unrepresentable* rather than post-hoc detectable.

- **SCAFFOLD** — run `mapIsoWorkbook` and the structure detectors **first** (today it runs at `unified-import.js:191`, *after* the entire AI spend), emitting a per-cell consumption ledger. Scope everything downstream to the residue. *Note*: the mapper records `consumedSpans` only when handed a third argument, and `unified-import.js:191` passes one — so `ctx.spans` is null today. **This phase must enable span recording first; it is not free.**
- **SURVEY** — models read *structure*, not values: which region means what, at what confidence.
- **BIND** — models emit **pointers** (`sheet!cell` → canonical field), never values. Code dereferences.
- **COURT** — adjudicate only genuinely contested bindings, cross-family, with `refusal` as a first-class vote class.
- **RE-DERIVE** — total inverse projection: reconstruct the source grid from the plan and diff against the original, replacing capped sampling.
- **LEARN** — harvest confirmed alias bindings into `AliasOverlay`, which is threaded through four parsers but whose `harvestAliasOverlay` has no caller.

**Phases.** **P0** = §2.0, §2.0b, §2.1, §2.2, §2.3, §2.6, §2.8 — the two join-ordering bugs are the only ones with a proven live symptom; the harness must see terms before term fixes can be certified; the dictionary must expose term vocabulary before structural work is meaningful. **P1** = §2.4, §2.5, §2.9. **P2** = §2.7, §2.10, plus the two operational defects (one import pushing every other AI surface over the `$25` hourly ceiling because `record()` is not exempt from the window at `fleet.js:112-116`; and the truncation-split recursion at `stage4-extract.js:939-943` escaping both `pMap` bounds). **P3** = the SCAFFOLD/BIND rebuild. Each phase independently revertible and shippable.

**P1's acceptance criterion must not be "byte-identical bundles"** — that is falsified by the flag's own definition and by real stage-4 nondeterminism. Use **identical entity sets and identical strict-field values**, diffed on `refId`/`parentId`/`order`/`number`, with provenance allowed to differ.

## 5. The certification ritual

Every change, without exception, must pass:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build     # the gate — currently 185 files / 2,025 tests green
pnpm import:eval                                            # eval1 (offline by default)
pnpm exec tsx scripts/import-eval2.mts --offline            # eval2 — NOTE: `pnpm import:eval2` does not exist
pnpm exec tsx scripts/phaseg-holdout.mts --check            # frozen holdout corpus
```

Then **commit a re-run of eval2** alongside the change so the board is auditable, and confirm the four canaries are exact.

**Rules that override convenience**:
- Never weaken a test, threshold, canary, or golden to go green. Fix at the cause.
- A golden change is a reviewed, approved, explicitly-diffed decision — never a regeneration folded into a fix.
- Before trusting any green board, prove the metric **can move**: inject a deliberate mutation and watch it turn red. Two of the defects above survived precisely because the boards watching them were structurally incapable of failing.
