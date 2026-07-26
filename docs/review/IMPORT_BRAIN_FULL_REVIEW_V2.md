# Import Brain — Full Review V2 (merged, re-verified, re-ranked)

**Date**: 2026-07-26 · **HEAD**: 83cc471 · **Supersedes**: `IMPORT_BRAIN_FULL_REVIEW.md` (V1, same day)

**Method.** V1 was audited claim-by-claim, then every deliverable was re-derived blind by agents that were forbidden to read V1, then the top findings were adversarially attacked. 15 analysis agents, 3.15M tokens. **175 cited claims adjudicated**: 107 CONFIRMED, 35 PARTIALLY_CONFIRMED, 11 REFUTED, 3 CITATION_DRIFT. Beyond code reading, this review **ran the gate, both eval harnesses, and headless repros** — several findings below are executed, not inferred.

**What V1 got right.** §2 (the workbook review) is essentially flawless — every cell count, merge count, hidden-row count, marker count and sentinel count re-measured to the unit. §6 (the model catalog) is accurate in all 23 numbered rows plus F1–F4/B1/O1–O4: every model, every `maxTokens`, every batch constant exact. Line-number drift across the whole document is 3 citations out of 175.

**What changed.** V1's top-5 defects were adversarially attacked; **none was fully refuted and none survived intact — in four of five the named causal mechanism is wrong even though a real defect sits nearby.** Its #1-ranked improvement is a provable no-op. Meanwhile the blind re-derivation surfaced defects V1 missed that outrank most of V1's list, including two invariant violations and one CRITICAL durability failure.

---

## 0. Audit of V1 — what did not survive

| V1 claim | Verdict | What is actually true |
|---|---|---|
| §1.2/§4.1 "steps ride the ISO oracle into stage 7" | **REFUTED** | `joinGroupWithIso` is called for six kinds; `ratingProgram` is not one ([stage7-plan.js:718-723](server/lib/import-brain/stage7-plan.js#L718-L723)). ISO steps are a **fallback**, adopted only when the brain emitted none (`:760-761`). Both measured runs had 2,024 / 303 brain steps, so `parseRating`'s output was discarded wholesale. |
| §5.1 "one change in `parseRating`" fixes step placement | **REFUTED** | A no-op behind the brain's step array. Also names the wrong field: every consumer reads `coverageRef` (a `;`-joined **string**), not `coverageRefIds`. |
| §4.4 "an internally-consistent mis-extraction passes with zero discrepancies" | **REFUTED** | The deterministic resolver runs first and compares the **claimed verbatim against the actual cited cell** for non-strict fields too ([stage5-validate.js:154-158](server/lib/import-brain/stage5-validate.js#L154-L158)), emitting `ungrounded-field` + `reviewFlag`. An invented verbatim is caught. |
| §4.3 "a 100%-degraded run is indistinguishable from a healthy one" | **REFUTED** | Truncation — the exact starvation shape claimed — emits a named `truncated-model-output` item per call ([constants.js:73-77](server/lib/import-brain/constants.js#L73-L77)). |
| §4.3 "no per-family vote-participation telemetry exists anywhere" | **REFUTED** | Three signals exist: `digest-single-family` ([stage1-digest.js:198](server/lib/import-brain/stage1-digest.js#L198)), per-side named retry items, and `budget.byDeployment`. What is genuinely absent is an **aggregate** parseable-votes-per-family counter. |
| §4.5 "with no per-column review item" | **REFUTED** | Stage 3 emits per-column `disagreement` (`:138`), `unmapped-column` (`:108`) and `low-confidence-map` (`:117,:130`). The truly silent band is narrower: columns **both reasoners agreed on at 0.60–0.79**. |
| §1.3 stage-0 assist fires "only when deterministic LOB inconclusive" | **REFUTED** | [stage0-router.js:344-345](server/lib/import-brain/stage0-router.js#L344-L345) gates on `(!lobRefIdHint \|\| workbooks+filingDocs > 0)`; the second disjunct is true for every real upload, so it **always** fires. (V1's §7 states this correctly — §1 and §7 contradict each other.) |
| §1.4 write order "product → tables → coverages → …" | **REFUTED** | Coverages are written **before** tables ([importProduct.ts:199-229](app/src/lib/import/importProduct.ts#L199-L229)). V1 reproduced the file's own stale header comment. |
| §7 "delete `escalateAnthropic` and `brain:escalation` (dead code)" | **REFUTED** | `escalateAnthropic` has no caller, but `brain:escalation` is fully plumbed — producer [unified-import.js:373](server/lib/ai/unified-import.js#L373), consumer [AgentVisualizer.tsx:245](app/src/import/AgentVisualizer.tsx#L245), **two green tests**. Deleting it turns tests red — barred by "never weaken a test." |
| §7 DOC_OCR "provisioned but unused" | **REFUTED** | A complete, exported, metered `documentOcr()` exists at [foundry.js:94-103](server/lib/external/foundry.js#L94-L103). The gap is a missing **caller** in `stage-filing.js`. |
| §7 `claude-opus-5` is "a drop-in" | **REFUTED** | [fleet.lock.test.ts](shared/src/ai/fleet.lock.test.ts) is **deploy-blocking** and hard-asserts `DEPLOY_OPUS === 'claude-opus-4-8'`. The upgrade requires re-certification, not a swap. |
| §8.2 P1 "assert byte-identical bundles with the flag on" | **REFUTED** | Self-contradictory: skipping ledger-explained rows changes which extractor authored them. AI nondeterminism makes byte-equality unachievable even OFF-vs-OFF. |
| §0/§5/§8 certification ritual cites `pnpm import:eval2` | **REFUTED** | Not a package script. Only `import:eval` exists. Use `pnpm exec tsx scripts/import-eval2.mts --offline`. |
| §4.5 "up to 40% of mapped columns unread" | **UNDERSTATED** | `sheetIsDeterministic` has a **second, looser branch**: any `form`/`rule`/`ratingStep` sheet qualifies on just **two** confident columns with no fraction test ([stage4-extract.js:624-625](server/lib/import-brain/stage4-extract.js#L624-L625)). On a 76-column Forms sheet that permits dropping ~97%, not 40%. |
| §2.1 "forms band differs (+1 col)" | **WRONG** | Core 76 vs E+ 80 = **+4**. (The only factual error found in §2.) |

---

## 1. How the Import Brain Works

*(V1's §1 kept as the base — it is accurate apart from the four refutations above, which are corrected inline.)*

### 1.1 What this system is

The platform converts semi-structured insurance documents into a governed canonical **Product Component Model** and prices it through a deterministic rating engine. The import brain is the ingestion half: bytes → cited, canonical entities that **a human reviews before anything is written**. Nothing auto-persists; the pipeline produces a proposal bundle, the reviewer accepts/excludes, and only then does the client write — as a DRAFT, in dependency order, every entity through `adapter.db.mutate()`.

Five invariants govern everything. **Two of them are violated in code today** (§4 items 3 and 6):

1. **Citations-or-discarded.** Enforced as BLOCKING only for **strict ids on non-stacked sheets**; uncited non-strict fields are WARN + planned + written. Note `docs/IMPORT_BRAIN.md:18-19` says "uncited claims are dropped" — in the workbook path nothing is dropped; a bad strict id blocks the entity into `unresolved`.
2. **Flag-not-invent.** *Violated twice* — see §4.3 and §4.6.
3. **Byte-faithful identifiers.** *Violated on the filing path* — see §4.6.
4. **Fleet-registry models only**, routed through the cost guard; import runs under the named `IMPORT_CONTEXT = 'import-no-cap'` exemption ([fleet.js:77,103](server/lib/fleet.js#L77)) which never denies and never degrades, but never bypasses `fleet.record`. `claude-fable-5` is forbidden and **test-locked** twice.
5. **Four rating canaries stay exact**: PH $1,528, PA $1,002, GL $2,635, filing-import $1,281.

### 1.2 The two-extractor design

Extraction happens twice, by two systems, joined at the end:

- **The deterministic ISO mapper** (`mapIsoWorkbook`, ~2,560 lines, LLM-free) — golden-pinned, refuses rather than guesses. **Correction:** it is *not* uniformly refusal-safe — `deriveTermsFromReferenceTables` fabricates `default: 0` terms (§4.3).
- **The AI brain** (`server/lib/import-brain/*.js`) — an ensemble of fleet models, the provenance source.

At stage 7 they join: `ISO_ORACLE_FIELDS = refId, parentId, order, terms` win outright; `ISO_STAMPED_FIELDS` gap-fill only. **Correction:** V1 says "absence never beats a cited value." For the four oracle fields that is false — a mapper `terms: []` or `parentId: null` **overwrites** a brain-cited value (§4.1). `ratingProgram` is outside the join entirely.

### 1.3 The pipeline, stage by stage

Entry `POST /api/ai/unifiedImport`, SSE-streamed. Stage 0 routes by magic bytes (never filenames) behind OOXML armor (five ceilings, `IMPORT_413`); hidden sheets are included with `hiddenSource`. Stage 1a is a dual-reader digest with windowed grid access; stage 1 classifies each sheet into 8 domains behind a two-of-two cheap prefilter; stage 2 locks header rows; stage 3 maps columns against the canonical dictionary; **stage 4** is the heart (~90% of runtime/cost) with a deterministic fast path, dual bulk votes, a sonnet→opus ladder, a gpt-5.1 judge and a DeepSeek tail judge; stage 4.5 sweeps unaccounted cells; stage 5 validates (deterministic resolver, then a semantic pass); stage 6 aggregates; stage 7 builds the plan.

Three corrections to V1's account:

- **The fast-path trigger is a disjunction**, not "≥60% of mapped columns": `confident/mapped ≥ 0.60` **OR** `confident ≥ 2 && dominant ∈ {form, rule, ratingStep}` ([stage4-extract.js:613-626](server/lib/import-brain/stage4-extract.js#L613-L626)).
- **On Core and E+ the ensemble barely runs at all.** Every qualifying sheet short-circuits to the deterministic path at `:894-899`, so the dual votes, the ladder and both judges are bypassed. This re-scopes V1's §4.3 and §4.8 dramatically.
- **`sampledVerifications` is a hardcoded `[]`** in both producers ([stage7-plan.js:1114](server/lib/import-brain/stage7-plan.js#L1114), [unified-import.js:653](server/lib/ai/unified-import.js#L653)). "Verification by sampling" is a section the client renders empty.

**Durability is broken** — see §4.2.

**Cost posture**: a CORE-class run measures ~$70 / ~110 min. The cache key embeds every cell value, so same-template-new-data is a guaranteed 100% miss; and its durable tier never activates (§4.7).

### 1.4 Review & write path

`UnifiedImportModal.tsx` renders a two-section review; `acceptedPlan()` excludes deselected items. On confirm, `importPlan()` writes product → **coverages** → tables → forms → rules → rating, all through the atomic mutation envelope. **Gap:** `forms` has no independent toggle — deselecting the coverages section silently drops every form ([acceptedPlan.ts:53](app/src/import/acceptedPlan.ts#L53)).

---

## 2. The Source Reality: Core and E+

V1's §2 is retained essentially unchanged — it was re-measured and is exact. Additions from the blind re-measurement:

- **E+ is not the easy book.** It hides **45.6%** of its cells (Core: 8.7%), is the only book with a mixed refId prefix (`EPLS` + `EP`), and the only one with `NULL` literals (**7,736**).
- **The phantom-extent hazard is already defeated**: Core Rating reports 1,378 columns via both `ws.columnCount` and the file's own `<dimension>`, but the real bridge returns `dataColCount = 69`.
- **`RULE ID` is not a stacked-block marker in this codebase and never was** — block detection runs entirely off `TABLE NAME:` ([layoutDetector.ts:36-38](shared/src/import/structure/layoutDetector.ts#L36-L38)). V1's §5.2 proposal to "accept `RULE ID(s):` in the marker grammar" rests on a misunderstanding; the `RULE ID(s):` spelling matters for *content parsing*, not detection.
- **The 2000-row exclusion is deliberate and honest**, not an oversight: [stage0-router.js:400-404](server/lib/import-brain/stage0-router.js#L400-L404) sets `consumesCells = false` for STACKED_TABLES precisely so no false conservation attestation is made.
- **Two sentinel oracles disagree** despite a code comment asserting they cannot ([brain-server-entry.ts:37-43](shared/src/import/brain-server-entry.ts#L37-L43)).
- `<Intentionally Blank>` (1,154 cells) is confirmed **not** neutralized — `NULL_STRINGS` has `<intentionally left blank>`, without which the books' actual string never matches.

---

## 3. Empirical Performance — measured today, not quoted

This section is new. V1 quoted a Jul-17 artifact; this review **re-ran both harnesses at HEAD**.

### 3.1 The eval1/eval2 contradiction resolves the "most important open question"

| | eval1 `--offline` | eval2 `--offline` |
|---|---|---|
| What it scores | `mapIsoWorkbook` | `mapIsoWorkbook` (**same parser**) |
| Result at HEAD | **4/4 green**, numeric **1.0000** | **8/8 red**, numericFidelity **0.000** |
| Golden set last changed | **2026-07-25** (`deecb91`) | 2026-07-16 (frozen) |

The same parser, on the same day, scores perfect and zero. That is not a data-loss signature — it is a **join failure**. `goldenNumericFidelity` resolves claims through an exact refId map ([import-eval2-metrics.mts:124-131](scripts/lib/import-eval2-metrics.mts#L124-L131)); golden2 `entityRef`s are `"17"`, `"Product #4"`, `GLCOV030.01` while the mapper emits `GL.COV.003.001`. Every claim misses → exactly 0.000 across **1,218 checks on 8 heterogeneous files**, which genuine extraction failure could not produce (some values would match by chance).

**V1's §5.5 remedy — "hand-diff ~10 numeric claims… the single most important open question" — is answered here for free.** It is the harness's entity join. Two blind agents reached the same conclusion independently.

### 3.2 An unnoticed regression, hidden by regenerated goldens

Re-running eval2 at HEAD against the frozen Jul-17 baseline, with **harness code unchanged since Jul 16** and **identical golden counts**:

| golden | substanceCoverage Jul-17 → Jul-26 | unaccountedEntityCells |
|---|---|---|
| All_Lines_Master | 0.909 → **0.156** | 64 → 503 |
| Client_Master | 1.000 → **0.333** | 0 → 1 |
| GL_2026_Example | 1.000 → **0.515** | 0 → 68 |
| General_Liability | 1.000 → **0.094** | 0 → 22 |
| EnthusiastPlus | 1.000 → **0.463** | 0 → 64 |
| CO_RV125_Rating | 1.000 → **0.263** | 0 → 284 |
| PCM_Coverages | 1.000 → **0.660** | 0 → 201 |
| SECURA_Property | 1.000 → **0.617** | 0 → 77 |

**All 8 collapsed.** The Jul 24–26 fix wave regressed conservation accounting, and nobody knew — because eval1's goldens were regenerated by the same parser on Jul 25 (`deecb91`), making its green board self-fulfilling. This is V1's "template-shaped green boards" thesis, now proven with git evidence rather than asserted, and it is the single strongest argument in the whole review for gating eval2.

> Working-tree note: the tracked baseline artifact was restored after measurement; both fresh boards are preserved outside the repo. **Committing a re-baseline is a decision for the maintainer, not this review.**

### 3.3 Live round trips

`CORE-ATT` PASS (2,268 entities, 0 failed, promote → LAUNCHED); `EPLUS-R2` PASS; `EPLUS-E2E` FAILED. Placement remains weak: `stepsWithCoverageRef` **90/2024** (CORE) and **17/303** (E+); E+ terms on 8/95 coverages.

**The EPLUS-E2E vs R2 gap is not nondeterminism.** E2E's `failed: 100` is two 50-row batches rejected with `invalid_parent` — the exact failure the later fix wave addressed. (This refutes a blind agent's "output is not reproducible" finding; the better-grounded explanation wins.)

---

## 4. Top 10 Reasons the Import Brain Might Not Work — re-ranked

Ranking is severity × likelihood × *blast radius on a real run*. V1's #1 and #3 fall; three findings V1 never had enter the top 6.

### 1. The ISO join overwrites cited evidence with mapper absence — terms and parentId vanish
- `ISO_ORACLE_FIELDS = [refId, parentId, order, terms]` win **outright** ([stage7-plan.js:256](server/lib/import-brain/stage7-plan.js#L256)); the array-**union** branch (`:290-297`) applies only to `ISO_STAMPED_FIELDS`. A mapper entity carrying `terms: []` or `parentId: null` therefore erases a brain-cited term set. Verified by executed repro.
- This directly contradicts the documented rule ("absence never beats a cited value" — the literal title of commit `deecb91`), which fixed the stamped path and missed the oracle path.
- Live symptom: `EPLUS-E2E` persisted **0 LIMIT and 0 DEDUCTIBLE terms on 0 coverages** and failed its only hard gate; `EPLUS-R2` recovered to 59/22 on 8/95 coverages. Highest-blast-radius defect on the board, and an invariant violation.

### 2. Checkpoint resume is unconditionally broken — every failure re-buys a ~$70 / ~110-min run
- [unified-import.js:333](server/lib/ai/unified-import.js#L333) seeds `resume = { stage4: { sheets: {} } }`, but [index.js:183](server/lib/import-brain/index.js#L183) **always** writes a checkpoint literally named `stage4`, which takes the `/^stage[1-9]/` branch at `:344` and overwrites the sheet map with `{entityCount, flagged}`.
- Re-executing the loop at HEAD throws in **every** artifact ordering (`Cannot set properties of undefined` at `:343`, or `Cannot convert undefined or null to object` at `:348`), is caught at `:352`, and degrades to "resume unavailable — running from the start". Resume works only for runs that died *before* the expensive stage.
- Compounding: split-product runs get **zero** checkpoints (namespaced keys like `split1/stage4/…` are rejected by `sanitizeStage`'s no-slash regex), and the digest checkpoint is written every run but can never be restored. V1 described durability as working; it does not.

### 3. Flag-not-invent is violated three ways — fabricated terms, fabricated nationwide scope, inverted operators
- **Fabricated terms**: `deriveTermsFromReferenceTables` emits `default: 0` LIMIT/DEDUCTIBLE terms for flat tables that parsed **no numeric rows**, because `primaryKind` is set from a header cell (`limitHeaderSeen`, [isoImport.ts:1739](shared/src/insurance/isoImport.ts#L1739)) independent of whether any value parsed — three lines from where the MATRIX branch correctly refuses. This is inside the **golden-pinned oracle**.
- **Fabricated scope**: `stampDefaults` turns silence into `allStates: true` ([stage7-plan.js:571](server/lib/import-brain/stage7-plan.js#L571)) — a positive 51-jurisdiction regulatory claim from absence, unflagged. Found independently by two blind agents.
- **Inverted operators**: `foldStepOp` maps `'/'` → **MUL** and `'-'` → **ADD** ([stage7-plan.js:196-201](server/lib/import-brain/stage7-plan.js#L196-L201)). A stated division silently becomes a multiplication — a rating-correctness defect that no canary covers because seeded programs never traverse it.

### 4. Stacked sheets get no column map — the largest sheet family is dropped with no review item
- [stage2-header-lock.js:75-86](server/lib/import-brain/stage2-header-lock.js#L75-L86) pushes locks **only** under `Sheet::Sub` pseudo-names, then `continue`s; [stage3-column-map.js:192-194](server/lib/import-brain/stage3-column-map.js#L192-L194) looks up the plain name and returns `null`; stage 4 bails at `:850` **with no review item**. The `::` guards at stage3:195 and stage4:846 are provably dead (`classified` holds only fingerprint sheet names).
- Blast radius: Core Rule References is 7,184 rows × 32 cols / 76,198 cells / 237 tables — the most cells in either book. Independently ranked #1 by a blind agent.
- **De-escalated from V1's #2**: three of V1's four aggravators are unreachable. `gatherRows`' stacked branch (`:781`) sits behind the `:850` bail; stage 5's BLOCKING→WARN downgrade can never see a stacked entity; and the marker claim is causally inverted — `TABLE NAME:` **is** in the grammar, which is *why* these sheets get segmented and then bailed. The deterministic mapper reading the uncapped grid still supplies 440 rules and 583 terms on CORE.

### 5. The step→coverage contract is broken at the field level, not the parser level
- `canonicalMap` defines `coverageRef` as a coverage **name** (aliases `COVERAGE`, `COVERAGE NAME`, `COVERAGE GROUP`; examples `'Bodily Injury'` — [canonicalMap.ts:507-512](shared/src/import/canonicalMap.ts#L507-L512)), while **every consumer byte-compares it to a refId** ([pricingLinks.ts:50-55](app/src/lib/insurance/pricingLinks.ts#L50-L55), [import-promote-e2e.mts:233,252](scripts/import-promote-e2e.mts#L233)). A name can never equal `CORE.COV.018`.
- Causation is the reverse of V1's: Core's `COVERAGE NAME` column is non-blank on **exactly 90** rows and `stepsWithCoverageRef` is **exactly 90/2024**. The brain read the column faithfully on every row that stated a value; the loss is the **vertical-ditto forward-fill gap**, not a discard.
- Third defect in the chain: `step.coverageRef` is excluded from the `refIdRemap` rewrite that rules' `coverageRefIds` receive ([stage7-plan.js:784-785](server/lib/import-brain/stage7-plan.js#L784-L785)), so an adopted refId orphans the link. Meanwhile the source *does* state the ID on ~2,000 Core rows in a column `canonicalMap` gives the rating domain no field for.
- **De-escalated from V1's #1**: the symptom "cards show no Pricing figure" is contradicted by `pricingLinks.ts:69-76`, whose heuristic fallback the e2e oracle does not model.

### 6. The filing path makes a filename load-bearing — violating two invariants at once
- [stage-filing.js:424](server/lib/import-brain/stage-filing.js#L424): `baseFormNumber = policyFormDoc.name.replace(/\.[^.]+$/, '')` — a **filename** becomes the product's minted refId, its `baseForm.formNumber`, and the filter admitting or excluding every rate-order variable. It is replaced only if `rawCovs[0].formNumbers[0]` exists, and `formNumbers` is not in the tool's `required` list.
- The classifier is also fed the filename as evidence (`:301`), against the pipeline-wide posture that stage 0's prompt states explicitly: *"from CONTENT ONLY — filenames are not evidence."*
- Byte-faithful form numbers are a stated invariant; a filename-derived form number is neither cited nor byte-faithful.

### 7. Silent drop paths, three of them genuinely silent
- **Prefilter veto**: two 128-token models agreeing sets `domain: 'ignore'`, `confidence: 1.0`, `humanFlagNeeded: false`, **no review item**, and ignored sheets are excluded from the sweep. Worse, [index.js:129](server/lib/import-brain/index.js#L129) guards the digest cross-check on `c.domain !== 'ignore'` — **the two 8192-token digest readers are silenced for exactly the sheets the two starved prefilter models vetoed.** The strongest auditor is disabled precisely where it would fire.
- **Empty-raw votes**: [constants.js:80](server/lib/import-brain/constants.js#L80) returns `null` on an empty raw with no retry and no review item — the one truly silent vote loss, shared by the prefilter and the blind cross-check, both of which bypass `parseWithRetry` entirely.
- **`DERIVED_VERBATIM = /^\(.*\)$/`** ([stage5-validate.js:45,111](server/lib/import-brain/stage5-validate.js#L45)) skips **all** citation checks — strict and non-strict — for any field whose verbatim is parenthesized. A model that emits `"(derived)"` bypasses grounding entirely.

### 8. Mapped-but-uncertain columns are never read — up to ~97% of a sheet's columns
- The fast path extracts only columns at confidence ≥ 0.80 ([stage4-extract.js:629](server/lib/import-brain/stage4-extract.js#L629)) with **no AI fallback for the rest**, while the `form`/`rule`/`ratingStep` escape hatch admits a sheet on **two** confident columns.
- Stage 3's ×0.7 disagreement penalty caps every disagreed column at 0.70 — so *every* disagreed column is excluded, not merely borderline ones.
- Partly visible: stage 3 emits per-column `disagreement` and sub-0.60 items, so the silent band is 0.60–0.79 agreed columns. But no item anywhere says *"this column's data was not extracted"*, and `summaryCounts.columnsMapped` counts columns that were mapped and never read.

### 9. The extraction cache replays poison and disables both recovery mechanisms
- `cachePut` stores raws **before parse validation and without `stopReason`** ([extract-cache.js:113-118](server/lib/import-brain/extract-cache.js#L113-L118)). On a hit, `parseWithRetry` sees `stopReason === undefined`, so the truncation branch never fires and **batch-halving never runs**; the one targeted retry re-invokes the same thunk, hits the cache, and replays identical bytes. There is no `bypassCache` anywhere in the repo.
- The durable tier is **dead on the deployed host**: `extract-cache.js:40` reads `AZURE_STORAGE_CONNECTION_STRING` while every other module in the platform uses `AZURE_BLOB_CONNECTION`. Found independently by two agents.
- Mitigation V1 missed: because the Blob tier never activates and the memory LRU dies with the container, poison does **not** survive a redeploy — which also means V1's "resumes into the poisoned cache" scenario is unreachable, and no caller sends `resumeRunId` at all.

### 10. Consensus arithmetic is acceptance-biased — but barely runs on these workbooks
- `weightedMajority` declares consensus at any 2 agreeing votes with no family-diversity requirement ([stage4-extract.js:237](server/lib/import-brain/stage4-extract.js#L237)); agreement is boosted `max(fa,fb) × 1.05` (`:159`); conflict write-back is `Math.max(existing, resolved)` (`:425`) so **confidence can only ratchet up**; stage-1 disagreements are adjudicated by opus — REASONER_A's own deployment ([stage1-classify.js:198](server/lib/import-brain/stage1-classify.js#L198)).
- The judge verdict is parsed by first character (`charCodeAt(0)-97`), so `"candidate b"` → index 2. A bounds check exists, so with the common two-candidate conflict it falls through harmlessly; the wrong-selection window opens only once the ladder has appended a third candidate.
- **Heavily de-escalated from V1's #8**: on Core and E+ every qualifying sheet short-circuits to the deterministic path at `:894-899`, so this machinery — and the token starvation V1 ranked #3 — is largely bypassed. The two "decorrelated" voters also receive the **identical prompt including the column map** (`:915`), so they are correlated on precisely the decision that matters.

**Dropped from V1's top 10** (real, but out-ranked): token starvation (now #10's tail — budgets are real, every consequence is smaller than claimed, and a starved prefilter fails *safe*); the stage-5 echo chamber (the prompt gap is real but both consequence bullets are refuted; the precise hole is that nothing compares a **non-strict field's value** to its cited cell); review-queue noise (confirmed and correctly scoped — the digest/classify vocabularies overlap on `forms`/`rules`/`definitions` only, so `framework`/`rating`/`tables` disagree on every import).

**Also verified, unranked**: `rowKind` emits a vocabulary stage 7 cannot consume, dropping rate/LD/ROC rows; the conservation invariant is a tautology (nothing measures loss between stage 4 and the plan); `deriveParentIds` reads the placeholder sentinel as a real sub-coverage name; two cells can flip a sheet to STACKED_TABLES at absolute priority; a native-PDF rung can burn ~30 min (300 s × 3 attempts × 2); peak memory holds four concurrent materializations of the same grid; `callOpenAI` never checks or populates `MISSING_DEPLOYMENTS`; the PDF vision ensemble is decided by **item count alone** — more items wins, no agreement check.

---

## 5. Top 10 Improvements — re-ranked, with corrected fixes

Every item is acceptance-gated. **Certification for all**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `pnpm import:eval` + `pnpm exec tsx scripts/import-eval2.mts --offline` + `pnpm exec tsx scripts/phaseg-holdout.mts --check`.

**1. Stop absence from beating evidence in the ISO join.** Move `terms` out of `ISO_ORACLE_FIELDS` into `ISO_STAMPED_FIELDS` so the existing array-union branch applies, and gate `parentId` adoption on the mapper actually having one. ~10 lines, one file. *Gate*: the executed repro (brain coverage with cited `parentId` + one LIMIT term vs iso `terms: []`/`parentId: null`) retains both; `import-promote-e2e` on E+ reports `limitTerms > 0`; canaries untouched (seeded programs don't traverse the join).

**2. Repair checkpoint resume.** Namespace the summary artifact (`stage4.summary`) or make the restore loop check `stage4.sheets` before assignment; allow slashes in `sanitizeStage` for `split<N>/…`; populate `resume.digest`. *Gate*: a test that writes the real checkpoint sequence and restores without throwing; a killed-and-resumed run skips stage 4 for already-checkpointed sheets. Highest ROI on the board — it converts a ~$70 loss into a resume.

**3. Close the three flag-not-invent violations.** (a) Gate `deriveTermsFromReferenceTables` on at least one parsed numeric row, mirroring the MATRIX refusal. (b) When `allStates` is stamped rather than read, also set `allStatesAssumed: true` + `needsReview: true` and aggregate one `importWarnings` item. (c) Split `foldStepOp` into faithful synonyms vs unrepresentable-but-stated operators, which must produce a warning instead of an inverted op. *Gate*: unit tests for each — `{op:'/'}` yields exactly one `rating-step-op-unrepresentable` warning and no MUL; a term-less flat table yields zero terms; **all four canaries re-run exact** (this touches rating shapes, so canary exposure is real and must be proven, not assumed).

**4. Give stacked sheets a column map.** In `stage2-header-lock.js`, also push a lock under the plain `fp.sheetName` (`headerRowIndex` from `subTables[0]`, `isConfirmed: false`) so stages 3–4 see the sheet; carry `absoluteRowStart` per sub-table. *Gate*: a fixture with two stacked blocks yields > 0 entities and a non-empty column map; add the R24 >2000-row fixture. **Do not** delete the stage-5 BLOCKING→WARN downgrade in the same change — it currently never fires, and removing it before rows are anchored converts a dead branch into a live blocker.

**5. Fix the step→coverage contract end to end** (replaces V1's §5.1 no-op). Three files: add a rating-domain `coverageRefId` field in `canonicalMap` mapped from the ID column (`PRODUCT FRAMEWORK ID`/`COVERAGE ID`) rather than the name column; forward-fill it down ditto rows at extraction with the origin cell's citation; and include `step.coverageRef` in the `refIdRemap` rewrite. Decide the contract explicitly — `coverageRef` is a `;`-joined **refId string** — and make `canonicalMap`'s description match. *Gate*: `stepsWithCoverageRef` moves from 90/2024 toward the ~2,000 the source states; the (currently uncommitted) card-figures check goes green; `glRobustness` $2,635 exact.

**6. Make the certification harness able to certify.** Fix eval2's entity join before reading its board: resolve golden `entityRef` through a name→refId index in both `goldenNumericFidelity` and `hierarchyRecall`. Then commit a re-baseline. *Gate*: `numericFidelity` becomes non-zero on at least one golden **and changes when a deliberate mutation is injected** — a metric that cannot move is not a gate. Note `ldTableRefResolutionRate ≥ 0.95` **already exists and already blocks** ([import-eval2.mts:217](scripts/import-eval2.mts#L217)); nothing to restore. Then gate eval2 in CI as a ratchet — §3.2 shows exactly what an ungated harness costs.

**7. Eliminate the genuinely silent paths.** Emit a `prefilter-skip` review item naming both voters and keep prefiltered sheets in sweep scope; **remove the `c.domain !== 'ignore'` guard at `index.js:129`** so the digest readers can contradict the prefilter (the cheapest high-value fix in this list); emit a review item on the stage-4 stacked bail at `:850`; emit `malformed-model-output` on the empty-raw path; delete `DERIVED_VERBATIM` or require the parenthesized form to still byte-resolve.

**8. Fix the extraction cache.** Gate `cachePut` on parse success, persist `{raw, stopReason}`, add `bypassCache` to the retry thunk, and point `extract-cache.js:40` at `AZURE_BLOB_CONNECTION`. Bump `PROMPT_VERSION` once. *Gate*: a stage-4 batch whose first response is `max_tokens` triggers batch-halving on replay, not a silent identical retry; the same workbook imported twice in separate processes yields `cacheHits > 0`.

**9. Unstarve the OpenAI legs and de-correlate adjudication.** Raise prefilter 128→1024, classify 256→2048, judges 400→2048; add `refusal` as an explicit vote class; route stage-1 adjudication to a third family (`VERIFY_DEEPSEEK`) with a ×0.8 haircut. Also fix the **inverted budget** — the escalation ladder gets 4096 while the routine first pass gets 8192. *Gate*: `truncated-model-output` items attributable to REASONER_B drop to 0 on a live CORE run. Note `fleet.lock.test.ts` pins only the six core roles, so re-routing an `EXTENDED_DEPLOYMENTS` consumer is lock-safe.

**10. Honest consensus and honest telemetry.** Require cross-vendor agreement for a 2-vote majority on strict fields; reserve ×1.05 for cross-family agreement; replace `Math.max` write-back with the resolving lineage's own confidence; add aggregate parseable-votes-per-family counters; give `MISSING_DEPLOYMENTS` a TTL and make `callOpenAI` honor it. Lower value than it looks — §4.10 shows this machinery is bypassed on template-family workbooks.

---

## 6. AI Model Catalog

**V1's §6 table is retained verbatim** — all 23 numbered rows plus F1–F4, B1 and O1–O4 were verified exact (model, `maxTokens`, batching, escalation), and an exhaustive grep of `callAnthropic`/`callOpenAI`/`callResponses`/`_forcedToolCall` found no omitted call. Four corrections to its prose:

1. **Row 1's qualifier is wrong** — the stage-0 assist fires on **every** upload, not "only if deterministic LOB inconclusive."
2. **"All share a FIRST_PRINCIPLES preamble" is wrong** — only 4 of 10 `prompts.js` system prompts do, and three prompts §6 quotes (`READER_SYSTEM`, `SWEEPER_SYSTEM`, filing `EXTRACT_SYSTEM`) live in stage files, not `prompts.js`.
3. **`MISSING_DEPLOYMENTS` is asymmetric** — only `callAnthropic` and `callResponses` check and populate it. `callOpenAI` does neither, so gpt-5.1, gpt-5-mini and the DeepSeek tail judge re-pay a full 404 round trip forever. The comment at `stage4-extract.js:376-377` asserting otherwise is false.
4. **"Exactly 1 semantic retry per malformed vote" misses six call sites** that bypass `parseWithRetry` entirely: both prefilters, both blind cross-check votes, the stage-0 assist, and the both-failed recovery rung.

Everything else in the cross-cutting paragraph is exact: no `temperature` anywhere; no `thinking`/`effort` on the import path; timeouts 120/300/90/60 s; 3 transport attempts with capped exponential backoff + 0–500 ms jitter; `ephemeral` cache-control on every Anthropic system block; result caching confined to the two stage-4 bulk votes; guard at $25/h with 80% soft-degrade and a named `IMPORT_CONTEXT` exemption that never bypasses `fleet.record`; fleet pricing current.

---

## 7. Model-Fit Assessment

V1's §7 is largely retained; the model-class analysis was independently confirmed against the `claude-api` skill. Corrections and additions:

- **Budget/model-class mismatch is the headline.** gpt-5-mini at 128 and gpt-5.1 at 256 completion tokens are reasoning models whose reasoning is billed against that same ceiling. Raise per §5.9.
- **The budget ladder is inverted**: the escalation ladder for rows two extractors already disagreed on gets 4096 while the routine first pass gets 8192.
- **Latent truncation trap**: opus-4-8 runs at `maxTokens 256` in three places. Survivable *only because thinking is off* — enabling thinking without raising these caps would truncate immediately.
- **Cache breakpoints are inert**: system prompts top out at ~1,167 tokens against Haiku 4.5's 4,096-token minimum cacheable prefix, so the `ephemeral` blocks on the cheap-tier calls are silent no-ops.
- **Digest synthesis is over-provisioned**: gpt-5.4-pro ($20/$150) merges two pre-normalized JSON objects. Route to opus-4-8 or sonnet-5; lock-safe.
- **Adjudication is not independent** (Class-identical to REASONER_A) — confirmed.
- **DOC_OCR**: `documentOcr()` already exists, exported and metered. The fix is a caller in `stage-filing.js` plus an `IMPORT_CONTEXT` wrapper — much cheaper than V1 implies.
- **`claude-opus-5`**: not a drop-in. `fleet.lock.test.ts` is deploy-blocking and pins `DEPLOY_OPUS`. Treat as a governed re-certification, never an edit-the-constant change. `claude-fable-5` remains correctly forbidden and test-locked.

---

## 8. Architecture Critique and Redesign

### 8.1 The critique, corrected

V1's five structural criticisms mostly stand, with two important corrections and one addition:

1. **The oracle runs last** — stands. `mapIsoWorkbook` runs at `unified-import.js:191` after stages 1–5 spend ~$70.
2. **Ensembles vote on the wrong unit** — stands, but note the two voters share the identical prompt including the column map, so they are correlated on the decision that matters most.
3. **Citations are claims, verified later** — stands, sharpened: `DERIVED_VERBATIM` lets a claim opt out of verification entirely.
4. **Verification is sampling, not re-derivation** — stands, and is worse than stated: `sampledVerifications` is a hardcoded `[]`.
5. **The pipeline learns nothing** — stands. `AliasOverlay` is threaded through four parsers but `harvestAliasOverlay` has no caller.

**Correction that matters for the redesign**: V1's N1 proposes posting the mapper's `consumedSpans` to a per-cell ledger. **Those spans do not exist in production** — `mapIsoWorkbook` records them only when handed a third argument, and `unified-import.js:191` passes one, so `ctx.spans` is null and the entire gridSpan block is dead. N1 must *enable* span recording first; it is not free.

**Correction to the evidence signature**: V1 reads "numericFidelity 0.000 / hierarchyRecall ≈0" as proof the architecture fails at preserving. §3.1 shows those numbers come from an **offline harness scoring the deterministic mapper with a broken entity join** — they are not evidence about the AI ensemble at all. The genuine placement evidence is the live e2e (step linkage 4–6%, term density), and the genuine preservation evidence is §3.2's regression. The conclusion survives, but on different evidence, and it indicts the *deterministic* layer more than V1 allows.

### 8.2 The proposed pipeline

V1's SCAFFOLD → SURVEY → BIND → COURT → RE-DERIVE → LEARN design is **retained as the target architecture** — it is well-reasoned and the blind redesign converged on the same core inversion (run the deterministic maximum first; make the model *point* at cells rather than transcribe them; replace capped sampling with total inverse projection). Its central insight — that pointer-bindings make transcription hallucination unrepresentable rather than post-hoc detectable — is the right idea and should survive.

Three corrections to the migration:

- **P1's acceptance criterion is unachievable.** "Byte-identical bundles with the flag on" is falsified by the flag's own definition. Replace with: *identical entity sets and identical strict-field values*, diffed on `refId`/`parentId`/`order`/`number`, with provenance allowed to differ.
- **P0 omits the four highest-ranked improvements.** V1's P0 lists §5 items 4, 6, 7 and the vocabulary fix; items 1, 2, 3 and 5 appear in no phase. Re-scope P0 to this review's §5 items 1–3 and 6–8, all of which are small, in-architecture, and independently revertible.
- **Sequence P0 before any structural work.** Items 1, 2 and 3 are invariant/durability repairs measured in tens of lines; the redesign is measured in weeks. Nothing should be rebuilt on top of a broken resume, a fabricating oracle and an uncertifiable harness.

---

## 9. Reason Table

Every decision taken in producing this merged artifact. *(K = kept from V1, R = replaced, M = merged, X = rejected, ↕ = re-ranked, N = new.)*

| # | Decision | Affects | Evidence consulted | Why |
|---|---|---|---|---|
| 1 | **R** — replaced "steps ride the ISO oracle" with the brain-wins fallback account | §1.2, §4.1(V1) | stage7-plan.js:718-723, :760-761, :239 | `joinGroupWithIso` is not called for `ratingProgram`; `coverageRef` can only be set by `normalizeRatingStep`, and both audits report it non-zero — proving persisted steps are the brain's |
| 2 | **↕** — V1's #1 demoted to #5 | §4 | import_promote_e2e-CORE-ATT.json; pricingLinks.ts:69-76 | Mechanism wrong and the "no Pricing figure" symptom is contradicted by a heuristic fallback the e2e does not model |
| 3 | **R** — replaced §5.1's fix with a three-file contract fix | §5.1 | canonicalMap.ts:507-512; pricingLinks.ts:50-55; import-promote-e2e.mts:233 | Proposed field name (`coverageRefIds`) is read by no consumer, and patching `parseRating` is a no-op behind the brain's step array |
| 4 | **N** — added the name-vs-refId contract mismatch | §4.5 | canonicalMap.ts:507-512 vs pricingLinks.ts:50-55 | `coverageRef` is documented as a name, compared as a refId; a name can never match |
| 5 | **N** — added the exactly-90 arithmetic as the causal proof | §4.5, §3.3 | Core workbook measurement (COVERAGE NAME non-blank = 90); CORE-ATT `stepsWithCoverageRef` 90 | Unit-exact coincidence establishes faithful reading + ditto gap, not discard |
| 6 | **N** — added `step.coverageRef` missing from `refIdRemap` | §4.5 | stage7-plan.js:784-785 | Rules' `coverageRefIds` are remapped; steps' `coverageRef` is not |
| 7 | **K** — kept the stacked no-column-map bail | §4.4 | stage2-header-lock.js:75-86; stage3-column-map.js:192-194; stage4:850 | Independently confirmed three times; `::` guards provably dead |
| 8 | **↕/M** — V1's #2 demoted to #4, aggravators stripped | §4.4 | stage4:850 vs :781; stage5-validate.js:105-106 | Three of four aggravators unreachable behind the `:850` bail |
| 9 | **X** — rejected "brain markers key on `RATE TABLE ID:`" | §4.4, §5.4 | layoutDetector.ts:36-38 | `TABLE_NAME_SENTINEL_PATTERN` exists; detection runs off `TABLE NAME:`. Causally inverted |
| 10 | **X** — rejected "accept `RULE ID(s):` in the marker grammar" | §5.2(V1) | layoutDetector.ts:36-38 | `RULE ID` was never a detection marker; the spelling affects content parsing only |
| 11 | **N** — added: stage-4 stacked bail emits no review item | §4.4, §5.7 | stage4-extract.js:850 | A silent whole-sheet drop V1's own "silent paths" item omits |
| 12 | **N** — added ISO-join absence-beats-evidence as #1 | §4.1 | stage7-plan.js:256, :282, :290-297; executed repro | Erases cited terms/parentId; explains EPLUS-E2E's 0 terms; violates a stated invariant |
| 13 | **N** — added broken checkpoint resume as #2 | §4.2 | unified-import.js:333, :342-348; index.js:183; loop re-executed | Every failure re-buys ~$70/110 min; V1 described durability as working |
| 14 | **N** — added the three flag-not-invent violations as #3 | §4.3 | isoImport.ts:1739, :1995-1998; stage7-plan.js:571, :196-201 | Invariant violations outrank most performance defects; two found independently by two agents |
| 15 | **N** — added the filing filename→refId defect | §4.6 | stage-filing.js:411, :424, :449, :301 | Violates byte-faithful refIds *and* "filenames are not evidence" |
| 16 | **N** — added `DERIVED_VERBATIM` bypass | §4.7 | stage5-validate.js:45, :111 | Any parenthesized verbatim skips all citation checks |
| 17 | **N** — added the `index.js:129` ignore-guard interaction | §4.7, §5.7 | index.js:129; stage1-classify.js:127-137 | Digest readers silenced exactly where the prefilter vetoed — cheapest high-value fix |
| 18 | **N** — added the empty-raw silent vote loss | §4.7 | constants.js:80 | The one genuinely silent vote path; V1's §4.3 thesis is better served by it |
| 19 | **↕/M** — V1's #5 promoted in severity, corrected in silence | §4.8 | stage4-extract.js:613-626, :629; stage3:108,117,130,138 | OR-branch permits ~97% loss (not 40%); but per-column items do exist |
| 20 | **N** — added the 2-confident-column escape hatch | §1.3, §4.8 | stage4-extract.js:624-625 | Found independently by three agents; materially changes the magnitude |
| 21 | **K** — kept the cache poison mechanism | §4.9 | extract-cache.js:113-118; constants.js:72-82; stage4:927-933 | Traced end to end; guards interlock exactly; no `bypassCache` exists |
| 22 | **N** — added the dead Blob cache tier | §4.9, §5.8 | extract-cache.js:40 vs run-observatory.js:22, filing.js:233 | Found independently by two agents plus my own check |
| 23 | **X** — rejected "resumes into the poisoned cache" | §4.10(V1) | extract-cache.js:40; no `resumeRunId` caller | Memory LRU dies with the container and the Blob tier never activates |
| 24 | **↕** — V1's #8 demoted to #10 | §4.10 | stage4-extract.js:894-899 | Deterministic short-circuit bypasses the ensemble on Core/E+ |
| 25 | **M** — kept the ×1.05 / `Math.max` / self-adjudication findings | §4.10 | stage4-extract.js:159, :425; stage1-classify.js:198 | All three verified exact at their lines |
| 26 | **↕** — softened "candidate b selects candidate c" | §4.10 | stage4-extract.js:364-365 + bounds check | Real only once a third candidate exists; harmless in the common 2-candidate case |
| 27 | **↕** — V1's #3 (token starvation) dropped from the top 10 | §4 | constants.js:73-77; stage1-classify.js:127; stage4:894-899 | Budgets real; every consequence smaller — truncation is telemetered, prefilter fails safe, judges bypassed |
| 28 | **X** — rejected "100%-degraded indistinguishable from healthy" | §4.3(V1) | constants.js:73-77; ai-call.js:184 | `finish_reason: 'length'` produces a named review item |
| 29 | **X** — rejected "no per-family telemetry anywhere" | §4.3(V1) | stage1-digest.js:198; ai-call.js:82-88 | Three signals exist; only the aggregate counter is missing |
| 30 | **↕** — V1's #4 (validator echo chamber) dropped from the top 10 | §4 | stage5-validate.js:154-158 | Deterministic resolver catches invented verbatims; the real hole is value-vs-cell, unnamed by V1 |
| 31 | **M** — kept the prompt-gap half of §4.4, restated the hole | §4, §5 | stage5-validate.js:200-219, :146-158 | Prompt carries no cell content (true); consequence bullets refuted |
| 32 | **X** — rejected "`fpByName` is in scope in the same function" | §4.4(V1) | stage5-validate.js:200 signature vs :233 | It is a parameter of the caller; V1's §5.3 citation is the correct one |
| 33 | **K** — kept the digest/classify vocabulary defect | §4 tail | stage1-digest.js:29; constants.js:8-11; index.js:125-133 | Overlap is exactly `forms`/`rules`/`definitions`; V1 scoped it correctly |
| 34 | **K** — kept the `<Intentionally Blank>` sentinel gap | §2, §5 | sentinels.ts:8-19 | `<intentionally left blank>` ≠ the books' string |
| 35 | **↕** — narrowed the proposed `^<[^>]*>$` catch-all | §5 | workbook.js:394; sentinels.ts | `normalizeCellValue` is the server's ISO-grid reader; a blanket regex is not a safe one-liner |
| 36 | **K** — kept §2 essentially unchanged | §2 | Independent ExcelJS re-dump of both books | Every figure re-measured to the unit; strongest section of V1 |
| 37 | **R** — corrected "forms band +1 col" to +4 | §2.1 | Core 76 vs E+ 80 columns | Direct measurement |
| 38 | **N** — added E+ hides 45.6% of cells / 7,736 `NULL` literals | §2 | Blind workbook re-measurement | Reframes E+ as the harder book, not the smaller one |
| 39 | **N** — added "phantom extent already defeated" | §2 | modelBuilder bridge returns `dataColCount` 69 vs 1,378 reported | Prevents a fix being written for a solved problem |
| 40 | **N** — added "the 2000-row exclusion is deliberate" | §2, §4.4 | stage0-router.js:400-404 comment + code | It exists to avoid a false conservation attestation |
| 41 | **N** — ran the gate | §3 | 185 files / 2,025 tests pass; build clean | Verify-first; canary figures present in locked tests |
| 42 | **N** — ran `pnpm import:eval` at HEAD | §3.1 | 4/4 green, numeric 1.0000 | Behavioral grounding, not prose |
| 43 | **N** — ran eval2 at HEAD | §3.1, §3.2 | 8/8 red, numericFidelity 0.000 | Answers V1's "most important open question" directly |
| 44 | **R** — replaced "nobody knows whether it's a harness bug" with a diagnosis | §4.6(V1), §5.5 | eval1 1.0000 vs eval2 0.000, same parser same day; import-eval2-metrics.mts:124-131 | Same parser cannot be both perfect and zero — it is the entity join |
| 45 | **N** — added the substanceCoverage regression | §3.2 | Jul-17 baseline vs Jul-26 run; harness unchanged since Jul 16; identical `checked` counts | All 8 goldens collapsed; a real regression no gate saw |
| 46 | **N** — added the regenerated-goldens proof | §3.2 | `deecb91` touched tests/golden/import/ on 2026-07-25; goldens2 frozen at Jul-16 | Converts V1's "template-shaped green" assertion into git evidence |
| 47 | **X** — rejected "output is not reproducible run-to-run" | §4 candidate | EPLUS-E2E `failed: 100` = `invalid_parent` batches | Better-grounded explanation wins over a nondeterminism inference |
| 48 | **R** — corrected the certification ritual commands | §0, §5, §8 | package.json scripts; phaseg-holdout.mts:437 | `pnpm import:eval2` does not exist; `--check` does |
| 49 | **K** — kept §6's table verbatim | §6 | All 23 rows + F/B/O re-verified | No omitted call site found by exhaustive grep |
| 50 | **R** — corrected §6 row 1's gating qualifier | §6 | stage0-router.js:344-345 | Second disjunct always true; §6 and §7 contradicted each other |
| 51 | **R** — corrected "all share FIRST_PRINCIPLES" | §6 | prompts.js (4 of 10) | Three quoted prompts live in stage files |
| 52 | **N** — added the `MISSING_DEPLOYMENTS` asymmetry | §6, §5.10 | ai-call.js:104, :200 vs :157-191 | `callOpenAI` neither checks nor populates it |
| 53 | **R** — corrected "exactly 1 semantic retry" | §6 | Six call sites bypass `parseWithRetry` | Materially changes the retry posture |
| 54 | **M** — merged the model-fit analysis, adding budget/class mismatch | §7 | stage1-classify.js:122,144; stage4:302 vs :932 | Independently derived against the `claude-api` skill |
| 55 | **N** — added the inverted budget ladder | §7, §5.9 | stage4-extract.js:302 vs :932-933 | Escalation gets less headroom than the first pass |
| 56 | **N** — added inert cache breakpoints | §7 | ai-call.js:118; measured prompt ≈1,167 tokens | Below Haiku's 4,096-token cacheable minimum |
| 57 | **X** — rejected deleting `brain:escalation` | §7 | unified-import.js:373; AgentVisualizer.tsx:245; 2 tests | Would turn tests red — barred by "never weaken a test" |
| 58 | **R** — corrected DOC_OCR "provisioned but unused" | §7 | foundry.js:94-103 | A metered client exists; only the caller is missing |
| 59 | **R** — corrected `claude-opus-5` "drop-in" | §7 | fleet.lock.test.ts (deploy-blocking) | Requires governed re-certification |
| 60 | **K** — kept §8.2's target architecture | §8.2 | Blind redesign converged on the same inversion | Two independent designs agreeing is the strongest signal available |
| 61 | **N** — added the dead `consumedSpans` correction | §8.1, §8.2 | isoImport.ts:2231; unified-import.js:191 | N1's ledger input does not exist in production |
| 62 | **X** — rejected P1's "byte-identical bundles" | §8.2 | Flag definition + stage-4 nondeterminism | Self-contradictory; replaced with a strict-field diff |
| 63 | **↕** — re-scoped P0 to include items 1–3, 6–8 | §8.2 | V1 P0 omits its own top-ranked items | Ordering defect; invariant repairs must precede structural work |
| 64 | **N** — added `sampledVerifications` is `[]` | §1.3, §8.1 | stage7-plan.js:1114; unified-import.js:653 | Strengthens "verification is sampling" into "sampling does not exist" |
| 65 | **N** — added identical-prompt correlation | §1.3, §8.1 | stage4-extract.js:915 | Voters are correlated on the column map — the decision that matters |
| 66 | **N** — added dead `AliasOverlay` learning channel | §8.1 | `harvestAliasOverlay` has no caller | Supports "the pipeline learns nothing" with a concrete artifact |
| 67 | **N** — added the `forms` review-toggle gap | §1.4 | acceptedPlan.ts:53 | Deselecting coverages silently drops all forms |
| 68 | **R** — corrected the write order | §1.4 | importProduct.ts:199-229 | V1 inherited a stale header comment |
| 69 | **N** — noted `docs/IMPORT_BRAIN.md` is stale in 8 places | §1 | Blind how-it-works derivation | Includes "stage 7 is not in the brain" |
| 70 | **X** — declined to commit an eval2 re-baseline | §3.2 | Tracked artifact; user did not request a commit | Measured and reported; restoring the baseline keeps the tree clean. Committing is the maintainer's call |
| 71 | **X** — declined to run `import:eval --live` / the e2e | §3 | No `BASE_URL` configured; credentials in gitignored `keys.md` | Hitting a live host with stored credentials is outward-facing and unauthorized |
| 72 | **M** — retained V1's §4 items 6/7 as "dropped but real" | §4 tail | Verified individually | Union rather than deletion; they lost rank, not validity |

---

## Appendix — primary sources

Code: `server/lib/ai/unified-import.js`, `server/lib/import-brain/*.js`, `shared/src/insurance/isoImport.ts`, `shared/src/import/{structure,mapper}/*`, `shared/src/import/canonicalMap.ts`, `shared/src/ai/fleet.ts`, `app/src/lib/import/importProduct.ts`, `app/src/lib/insurance/pricingLinks.ts`.
Harnesses: `scripts/import-eval.mts`, `scripts/import-eval2.mts`, `scripts/lib/import-eval2-metrics.mts`, `scripts/phaseg-holdout.mts`, `scripts/import-promote-e2e.mts`.
Evidence: `docs/audit/import_eval2_results.json`, `docs/audit/import_promote_e2e-*.json`, `docs/import-census/BASELINE_EVAL2.md`, `docs/review/AI_TUNING_HANDOFF.md`, plus fresh eval1/eval2 boards measured 2026-07-26.
Workbooks: `latest_samples/Product Specifications _Core.xlsx`, `_E+.xlsx`.
