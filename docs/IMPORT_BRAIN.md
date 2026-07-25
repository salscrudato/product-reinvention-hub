# The Import Brain — How It Works (engineer/agent orientation)

> Audience: a coding agent (or engineer) who will read, extend, or review the ingestion
> pipeline. This is the conceptual map; the code is the source of truth. Every claim below is
> verifiable in the files cited. Verify before you change — do not trust this doc over the code.

---

## 1. Mission & the non-negotiable invariants

The platform turns semi-structured insurance documents (framework workbooks, rate manuals,
carrier filing PDFs) into a **governed canonical Product Component Model (PCM)** and prices it
through a deterministic rating engine. The import brain is the ingestion half. Its whole job is
to convert bytes → cited, canonical entities that a human reviews before anything is written.

Five invariants govern every design decision. If a change violates one, it is a bug:

1. **Citations-or-discarded.** Every extracted field must cite its source cell/sheet. Uncited
   claims are dropped. Free invention is a defect, never a convenience.
2. **Flag-not-invent.** When the source does not establish a value, surface a *notice*; never
   fabricate a plausible one. Silence in the source becomes `UNKNOWN` + a warning, never a guess.
3. **Byte-faithful identifiers.** `refId`s and form-number chips are load-bearing and carried
   byte-for-byte — never normalized, stripped, or re-cased.
4. **Model IDs from the fleet registry only** (`shared/src/ai/fleet.ts`), routed through the
   in-process cost guard. Import runs under a named no-cap exemption (never budget-denied) but
   its telemetry is never bypassed.
5. **Nothing is written until the reviewer confirms.** The pipeline produces a *plan* (a
   proposal). Persistence happens later, client-side, through the atomic mutation envelope.

Certification is against a **frozen holdout corpus** and **four rating canaries** (PH $1,528,
PA $1,002, GL $2,635, filing-import $1,281). "Exact or broken" — a change that moves a canary is
wrong at the cause.

---

## 2. The core architectural idea: two independent extractors, one join

The single most important design decision is that extraction is done **twice, by two decorrelated
systems**, and the results are reconciled:

- **The deterministic ISO mapper** (`shared/src/insurance/isoImport.ts`, `mapIsoWorkbook`) — a
  pure, LLM-free parser built for the ISO-family workbook goldens. Content-driven header
  detection, enum normalization, parentId derivation, stacked-table segmentation, rating-step
  mapping. It is the **canonical-identity oracle**: registry-derived refIds, parent linkage,
  sibling order, cross-sheet form-number joins. Fast, exact, and *golden-tested*.

- **The AI brain** (`server/lib/import-brain/*.js`, orchestrated by
  `server/lib/ai/unified-import.js`) — an ensemble of fleet models that reads the same grids and
  extracts the same entities, but is robust to *messy* inputs the deterministic parser cannot
  shape-match (shifted columns, novel layouts, carrier variants). The brain is the **provenance
  source**: per-field citations + confidence.

At **stage 7** the two are joined (`buildImportPlan` in `server/lib/import-brain/stage7-plan.js`,
`joinGroupWithIso`): identity fields (refId, parentId, order, formNumbers, workflow defaults)
come from the mapper when entities correspond; extracted *value* fields keep the brain's cited
values; mapper-only entities are appended (cited to the deterministic parse); brain-only entities
stay, flagged for review. **Nothing is dropped silently.** This is why the system is both robust
(the AI handles novelty) and exact (the deterministic oracle owns identity + the golden invariants
that keep canaries green).

Routing (`server/lib/import-brain/stage0-router.js`, `sniffContainer` in `workbook.js`):
- A **multi-file all-XLSX** set (the ISO multi-workbook goldens) → deterministic client mapper,
  parsed in-browser (`app/src/import/UnifiedImportModal.tsx` → `mapIsoWorkbook`).
- A **single workbook**, and any **PDF/SERFF/mixed** upload → the server brain (server-side
  ExcelJS parse → the adaptive AI pipeline). Format is sniffed by **magic bytes, never filename**.

---

## 3. The 7-stage brain pipeline (workbook family)

Each stage emits real SSE events (`t: 'tool'`/`'json'`/`'notice'`) that stream to the client
visualizer and the durable run trace. Stages are numbered `brain:stage{N}:{name}`.

- **Stage 0 — Route** (`stage0-router.js`). Magic-byte artifact routing. Classifies each upload as
  workbook / filing PDF / unrecognized, guesses the LOB from refId-prefix majority, escalates a
  low-confidence route to a reasoner. Emits an honest notice on an unroutable artifact.

- **Stage 1 — Digest + Classify** (`stage1-digest.js`). Censuses every sheet (values, merges,
  validations; **used-range clamped** so a whole-column-formatted sheet reporting 1,048,576
  phantom rows parses to its true extent — see `workbook.js` L4 lock). Then classifies each sheet
  into a domain (`framework | forms | rules | rating | definitions | dynamicFields | formRules |
  tables`) — a BULK pre-filter then two decorrelated reasoners (opus + a different-provider model)
  adjudicate.

- **Stage 2 — Header lock** (`stage2-headerLock.js`). Finds the true header row per content sheet
  (deterministic scoring fast-path; AI fallback only when heuristics are unsure). Robust to a
  workbook that starts in a shifted column — detection is content-driven, not index-based.

- **Stage 3 — Column → field map** (`stage3-columnMap.js`). Maps each column to a canonical field
  using `shared/src/import/canonicalMap.ts` (aliases per field). Two reasoners map in parallel and
  reconcile. Unmapped columns are reported, never dropped — the AI-assist overlay can later
  propose mappings the reviewer accepts.

- **Stage 4 — Extract + Sweep** (`stage4-extract.js`, `stage45-sweeper.js`). The heart.
  - *Extract*: for structured sheets whose rows follow a fixed schema, a **deterministic code
    fast-path** reads each row into canonical fields (values are ground truth by construction; the
    only thing checked is the column map). Otherwise dual bulk extractors (haiku + a decorrelated
    OpenAI model) cross-check, and conflicted fields climb a **haiku → sonnet → opus ladder**.
    Every field carries a citation `{sheet, cell, verbatim}` and a confidence.
    - *Section-header forward-fill*: a "Forms Dynamic Data" sheet states the FORM NUMBER once per
      form and blanks it on continuation rows; the extractor carries the last non-blank value down
      **keeping the original header cell's citation**, so continuation fields keep their parent
      link (recovered 198/1,830 orphaned E+ rows). This is faithful extraction of a section header,
      not invention.
  - *Conservation sweep (CE3)*: **every** cell the extractors did not account for is swept — a
    haiku + gpt-mini two-vote, laddering to sonnet on conflict — and resolved to `NOISE`, a cited
    `FACT`, or `NEEDS_REVIEW`. Capped per sheet (`SWEEP_MAX_PER_SHEET`); residue becomes one
    first-class `census_unaccounted` review item. Nothing is silently discarded — the conservation
    guarantee is that no source cell vanishes without a disposition.

- **Stage 5 — Adversarial validate** (`stage5-validate.js`). A cross-provider validator
  (OpenAI-family, decorrelated from the Anthropic extractors) re-checks a sample; discrepancies
  become review-surface findings, never silent rewrites.

- **Stage 6 — Reconcile** (`stage6-reconcile.js`). Pure aggregation — assembles the entity set,
  writes nothing.

- **Stage 7 — ISO join + Plan** (`stage7-plan.js`, `buildImportPlan`). Runs the deterministic
  join (§2), stamps canonical workflow defaults, does refId-remap edge rewriting (identity
  adoption is a graph operation — every edge that references a remapped refId follows it), folds
  dynamic-field rows onto `Form.dynamicFields[]` by form number, attaches RT-table grid metadata,
  runs plan-integrity checks (duplicate refIds, orphan sub-coverages, dangling form references),
  computes a completeness assessment (backbone/forms/rules/rating pillars), and produces the
  reviewable bundle: `{ plan, review, unresolved, importWarnings, provenance, completeness, … }`.

The **filing family** (PDFs) is analogous with document-role stages
(`filing:classify → extract:rateOrder/manual/policyForm → reconcile`); a **fallback** single-pass
coverage extractor exists for legacy robustness.

---

## 4. The canonical data model (what extraction targets)

Types live in `shared/src/types.ts`. The PCM entities:

- **Product** — top identity; `GovernanceBlock` (status/lifecycle/reviewStatus) + `StateScope`
  (allStates/states) + LOB.
- **Coverage** — the atomic unit of protection; hierarchical (`parentId`), carries `terms`
  (`CoverageTerm[]` of kind LIMIT/DEDUCTIBLE/OPTION, each with `optionSet: StandardOption[]`),
  `formNumbers`, `premiumGenerating`, `claimsBasis`, requirement/source.
- **Form** — how the product is presented; `number` (identity, byte-faithful), `edition`,
  category, attachment condition, `StateScope`, and **`dynamicFields: DynamicField[]`** — the data
  *printed on* the form (one form → many fields; each `{name, dataType, repeating, options?,
  notes?, effectiveDate?, expirationDate?}`).
- **Rule** — how the product is governed; `condition`/`outcome`, `coverageRefIds`, `formNumbers`,
  `StateScope`, optional table refs.
- **RatingProgram** + **RatingStep** — how it's priced; ordered steps
  (`op: SET|MUL|ADD|MIN_FLOOR`, `source: {type: RT|LD|INPUT|CONST|SPP, ref, keys}`), optional
  `creditFloor` and `ratingGroups`.
- **RTTable / LDTable** — factor tables. An RT table is grid-shaped when it has 1–3 key columns ×
  one value column; the importer attaches explicit `dimensions` + `valueColumn`
  (`deriveGridModel`, `shared/src/rating/rtGrid.ts`) so `deriveGridInputSpec` can build a pricing
  worksheet (`genericRtLookup` keys off `dimensions`) — this is what makes an imported product
  *priceable*. Seeded PH/PA/GL tables carry no `dimensions` (bespoke getters), so canaries are
  untouched.

`shared/src/import/canonicalMap.ts` is the crosswalk: for each entity + field it lists `role`
(`stored`/`source`), `type`, `mapsTo` (for foreign keys like `dynamicField.formNumber →
form.number`), and human-authored `aliases` that the column-mapper matches against.

---

## 5. Structure detection (before the AI ever runs)

`shared/src/import/structure/`:
- **`layoutDetector.ts`** — classifies a sheet's shape: `STACKED_TABLES` (multiple sub-tables with
  marker rows) > `WIDE_MATRIX` (≥3 state-code columns) > `INDENTED_HIERARCHY` > `FLAT_TABLE`.
  Primary stacked markers are `RATE TABLE ID:` / `RTTable.N` / `LD TABLE ID:` / `LDTable.N`; a
  secondary `TABLE NAME:` sentinel handles formats (E+ Rule References) that use it as the block
  delimiter *only when no primary markers exist* (safe for GL/LD workbooks where TABLE NAME is meta
  within a block).
- **`stackedSegmenter.ts`** — splits a `STACKED_TABLES` sheet into named sub-tables, each with its
  own meta block, header row (scored), and column profiles. Fully deterministic.

Getting shape right up front is what lets the deterministic fast-path handle most real cells with
zero AI cost and perfect fidelity.

---

## 6. The fleet & cost discipline

Roles route through `shared/src/ai/fleet.ts` (bridged to `server/lib/fleet-shared.cjs`):
`GROUNDED_CITED = opus` (reasoning + citations), `MID_REASONER = sonnet` (escalation),
`BULK_VERIFY = haiku` (bulk checks), plus VISION, CHEAP_GENERAL, EMBED, and specialty surfaces.
**Never a hardcoded model string in a handler** — always a fleet role, always metered through the
in-process cost guard (`server/lib/fleet.js`). Import runs under `IMPORT_CONTEXT` (no-cap, never
degraded) but every call is still recorded (`metering.js`, `run-trace.js`).

Decorrelation is deliberate: the second extractor and the validator are a **different provider**
than the first, so correlated model errors don't pass a consensus check.

---

## 7. Armor & failure posture

`server/lib/import-brain/workbook.js` pre-inspects the OOXML container from the raw central
directory (no inflation) and enforces layered ceilings *before* ExcelJS materializes anything:
per-entry compression ratio, total uncompressed bytes, entry count, and a **declared-cell** ceiling
(`ceil(sheet-XML-bytes / 24)`, default 3.5M — sits above the CORE-class 3.03M outlier and below the
~3.9M zip-bomb). A breach throws a structured `IMPORT_413` the router surfaces as an honest notice,
never a crash. A parse wall-clock ceiling bounds how long the pipeline *waits*.

Fail-safe is a first-class principle end-to-end:
- Extraction that can't classify a cell → `NEEDS_REVIEW`, surfaced, never dropped.
- A blocked/low-confidence entity → `unresolved` with evidence, never silently planned.
- The **write path** (`app/src/lib/import/importProduct.ts`) coalesces every plan array up front
  and collects per-batch failures (non-fatal, reported as `skipped`) so a partial/malformed plan
  **writes everything it can** instead of losing the whole draft. A data issue degrades gracefully
  and is shown to the reviewer.

---

## 8. The write path & review

The bundle is **not** auto-persisted. `UnifiedImportModal.tsx` shows a two-section review:
"Detected" (entities with per-section include toggles **and** per-item exclude, refId chips,
confidence, plain-English confidence flags) and "Review & confirm" (unresolved, disagreements,
FormatCard). `acceptedPlan()` turns the reviewer's choices into the exact plan to write; excluded
data provably never reaches the write (`app/src/import/acceptedPlan.ts` + test). Only on confirm
does `importPlan()` write — as a **DRAFT**, in dependency order (product → tables → coverages
parent-before-child → forms → rules → rating), every entity through
`adapter.db.mutate()` / `mutateBatch()` (entity + audit + version + searchIndex, atomic per
transactional batch). Forms are namespaced to the draft (`forms/{draftId}__{number}`), so an
import can never clobber a launched product's shared forms.

Durability (F23): a client-supplied `runId` persists the finished bundle to Blob so a dropped SSE
stream is a reconnect, not a $70 re-run.

---

## 9. Why this design is optimal (the argument)

- **Correct-by-construction where possible, robust where necessary.** The deterministic mapper
  handles the golden shapes with zero AI cost and perfect fidelity; the AI ensemble absorbs
  novelty. Neither alone is sufficient — together they are both exact and adaptive.
- **Decorrelated ensemble + adversarial validation** catches the failure mode a single model
  can't: confident, correlated error. Different providers, cross-checked, laddered only on
  conflict — so cost scales with *difficulty*, not volume.
- **Grounding is structural, not aspirational.** Citations ride every field; uncited output is
  dropped by the pipeline, not by reviewer diligence. The conservation sweep makes "no cell
  vanishes" a checkable invariant.
- **Identity is owned by a tested oracle.** refIds/parentId/order/form-joins come from the
  deterministic mapper, so the graph the reviewer sees is the graph the goldens certify — which is
  why four canaries can stay exact through heavy ingestion changes.
- **Human-in-the-loop by construction.** Nothing writes without review; the plan is a proposal;
  the reviewer can exclude any item; a data issue is surfaced, not swallowed.
</content>
