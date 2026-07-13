# Insurance Product Import Architecture

**Audience:** External AI systems, future engineers, product architects.
**Codebase:** `314358_InsurancePlatformsAI` — Product Reinvention Hub (pnpm monorepo).
**Last updated:** 2026-07-13

---

## 1. Purpose and scope

The import system translates two distinct source artifact types into the canonical insurance product model:

| Source type | File format | Handler |
|---|---|---|
| ISO/bureau template workbooks | `.xlsx` (Excel) | `shared/src/insurance/isoImport.ts` |
| Carrier rate-filing PDFs | `.pdf` | `server/lib/import-brain/` (multi-stage AI pipeline) |

Both pipelines are **read-only producers**: they return a typed `ImportPlan` or `ProposalBundle` that the application layer commits through `adapter.db.mutate()`. Neither pipeline writes directly to the data store.

---

## 2. The canonical data model

Defined in `shared/src/types.ts`. Every imported artifact maps to one of these entity types:

```
Product
  Coverage  (parent-before-child order; can be nested)
    Coverage.terms[]
  Form
  Rule
  FormRule
  LDTable   (limits and deductibles lookup table)
  RTTable   (rate table)
  RatingProgram
    RatingProgram.steps[]
```

All entities carry `refId` — the source identifier (form number, framework ID, rule ID) preserved verbatim. `docId` is derived from `refId` by replacing dots with dashes to produce a Cosmos-safe document ID.

---

## 3. ISO Workbook Importer

### 3.1 Entry point

`shared/src/insurance/isoImport.ts` exports `mapIsoWorkbook(grids: IsoGrid[]) → ImportPlan`.

`IsoGrid` is a pure 2D grid (array of rows of cells) with a sheet name. The app reads the `.xlsx` bytes with ExcelJS and produces grids; `isoImport.ts` is entirely platform-free — no ExcelJS import, no `window`, no `process.env`.

### 3.2 Supported template families

| Template family | Sheet names | LOB |
|---|---|---|
| ISO GL template | `GL Product Framework`, `GL Forms Specifications`, `GL Rules Specifications`, `GL Rating Specifications`, `Limits and Deductibles Tables` | GL |
| ISO/carrier component model | `Product Component Model`, `Forms Library`, `Rules Repository`, `ROC` / `PROPERTY ROC`, `Limits and Deductibles Tables` | IM, PR, HO, PA |

Sheet names are matched by regex (not exact string), so minor variations (extra spaces, leading/trailing words) resolve correctly.

### 3.3 Processing pipeline

```
mapIsoWorkbook(grids[])
├── findSheet()          — locate each logical sheet by regex
├── parseFramework()     — coverages + product + LOB identity
│   ├── findHeaderRow()  — find header row by field-alias scoring
│   ├── mapColumns()     — alias + fuzzy word-overlap column mapping
│   └── resolveCoverageHierarchy()  — first-principles parent/child resolution
├── parseForms()         — form entities (number, edition, category, states)
├── parseRules()         — rule entities (condition, outcome, LD table ref)
├── parseFormRules()     — optional forms rules
├── parseRating()        — RatingProgram + RatingStep[]
├── parseLdTables()      — limits & deductibles lookup tables
└── parseRtTables()      — rate tables
```

### 3.4 Header detection (format-agnostic)

`findHeaderRow(grid, aliasGroups, limit=20)` scans the first 20 rows and scores each row by how many of the expected column families it matches. A row clears the confidence threshold (score >= 3) to become the header. This allows headers at arbitrary row positions (common in bureau templates with title/description rows above the data).

`mapColumns(header, fields)` runs in two passes:

**Pass 1 — Exact squish match:**
Each alias is `squishStr()`-normalised (uppercase, alphanumerics only). A column header matches if its squish equals any alias squish. This handles punctuation, embedded newlines, trailing `?`, and all whitespace variants.

**Pass 2 — Fuzzy word-overlap (novel templates):**
For any unmapped field, score every column header by the fraction of significant words it shares with any alias. A score >= 0.5 maps the column. Stop-words (THE, A, AN, OF, etc.) are excluded from scoring. This covers paraphrase variants like "CALCULATION DESCRIPTION" matching the `algorithm` field whose aliases include "ALGORITHM STEP" and "FORMULA".

### 3.5 Alias tables

Each parser defines a `FIELDS` record mapping logical key → list of known column header aliases:

| Record | Parser | Key fields |
|---|---|---|
| `FW_FIELDS` | `parseFramework` | id, coverage, subCoverage, requirement, premiumGen |
| `FORM_FIELDS` | `parseForms` | number, edition, category, admitted, mandatory |
| `RULE_FIELDS` | `parseRules` | id, condition, outcome, reference |
| `FORMRULE_FIELDS` | `parseFormRules` | id, condition, outcome |
| `RATE_FIELDS` | `parseRating` | stepId, rules, algorithm, reference, rounding |
| `DYN_FIELDS` | `parseDynamicFields` | number, fieldName, dataType |

Aliases are additive — adding a new alias for a field never breaks existing mappings.

### 3.6 Coverage hierarchy resolution

`shared/src/insurance/coverageHierarchy.ts` implements first-principles parent/child inference:

1. **refId nesting:** `PR.COV001.0` is a child of `PR.COV001`.
2. **Sub-coverage name signal:** rows with a non-empty `subCoverage` column are likely children.
3. **Sequence proximity:** adjacent rows in the same refId "family" group.

Orphans (sub-coverages with no resolvable parent) are promoted to top-level and warned. The result is a parent-before-child ordered list safe to write through `mutate()` in sequence.

### 3.7 LD table format variants

The `parseLdTables` function handles two distinct LD marker formats:

| Template | Marker location | Marker pattern | Example |
|---|---|---|---|
| ISO GL | Column A (index 0) | `LDTable.NNN` | `LDTable.001` |
| Component model | Column B (index 1) | `LDNNN` | `LD001` |

Auto-detection: scans the first 20 rows for either pattern and sets `markerCol` (0 or 1) before parsing. The combined regex `LD_MARKER` drives both loop entry and loop-break detection.

### 3.8 What the importer never does

- Never writes to the data store (returns `ImportPlan` only).
- Never invents coverages, forms, rules, limits, or factors.
- Never strips or transforms `refId` values (except `docId` dot→dash, which mirrors the seed).
- Never imports `shared/` platform SDKs (Cosmos, Firebase, Azure).

---

## 4. PDF Filing Importer

### 4.1 Entry point

`server/lib/import-brain/` — multi-stage server-side AI pipeline. Endpoint: `POST /api/ai/unifiedImport`.

### 4.2 Pipeline stages

```
Stage 1 — Classify filing type (regulatory / product / rate / form)
Stage 2 — Extract filing metadata (carrier, state, LOB, effective date)
Stage 3 — Extract coverage structure (coverages, exclusions, conditions)
Stage 4 — Extract rate tables and factors
Stage 5 — Extract forms list and form-level metadata
Stage 6 — Reconcile + produce ProposalBundle
```

Each stage uses the Foundry Claude AI fleet (`server/lib/fleet.js`):
- Reasoning stages: `claude-opus-4-8` via `GROUNDED_CITED` role
- Bulk extraction: `claude-haiku-4-5` via `BULK_VERIFY` role

The AI is always server-side only — never called from the browser.

### 4.3 AI grounding invariant

Every AI response must cite its source document. The system prompt enforces grounded + cited extraction: the model returns structured data with `sourceRef` citations. Responses without citations are rejected.

---

## 5. Base Form Upload (Claims Analysis)

### 5.1 Entry point

`app/src/components/claims/BaseFormsLibrary.tsx` — three-step upload flow.

### 5.2 Upload flow

```
Step 1 — File → Azure Blob Storage
  adapter.storage.upload(storagePath, file)
  → POST /api/storage/upload (base64 body → blob → returns URL)

Step 2 — Lightweight DB record (status: PROCESSING)
  adapter.db.mutate({ op: 'create', path: 'baseForms/{id}', data: { storagePath, url, ... } })

Step 3 — Server-side identify (grounded header read)
  adapter.fns.call('identifyBaseForm', { formBase64, fileName })
  → POST /api/ai/identifyBaseForm
  → regex fast path → AI fallback (BULK_VERIFY/haiku)
  → adapter.db.mutate({ op: 'update', ..., data: { ...ALL_FIELDS, title, formNumber, edition, lob, status } })
```

**Critical:** `adapter.db.mutate()` op:`update` is a FULL Cosmos Upsert (not a partial patch). Every field that must survive MUST be re-sent on every update, including `storagePath`, `url`, `mediaType`, `fileName`, `uploadedBy`, `uploadedByName` from Step 1.

### 5.3 identifyBaseForm endpoint

`server/lib/ai/identify-base-form.js`

Fast path (no AI cost): regex extracts the form number using the ISO 2-pair pattern `[A-Z]{1,4} NN NN`. If a known bureau prefix (CG, HO, PA, CP, IM, etc.) is found, returns immediately with `verified: true`.

AI fallback (BULK_VERIFY/haiku): forced tool call to `identify_form` schema. Returns empty strings for fields it cannot read — never invents.

### 5.4 Form number format

ISO base form number: `PREFIX NN NN` — a 1-4 letter bureau prefix followed by exactly two 2-digit pairs (e.g. `CG 00 01`). The edition (`04 13`) follows as a separate pair and is parsed by `EDITION_RE`, not included in the form number.

```
FORM_NUM_RE = /\b([A-Z]{1,4}[\s-]?\d{2}[\s-]\d{2}|[A-Z]{1,4}[\s-]\d{4})\b/g
EDITION_RE  = /(?:[A-Z]{1,4}[\s-]?\d{2}[\s-]\d{2}[\s-]|Ed(?:ition)?s?\.?\s*)(\d{1,2}[\s/-]\d{2,4}|\d{4})\b/
```

---

## 6. Mutation invariant

Every entity write goes through `adapter.db.mutate()` (client-side adapter contract) which calls `POST /api/db/mutate` (server-side). The server atomically batches in a single Cosmos transactional batch:

```
1. Entity Upsert    (the actual data)
2. Audit Create     (who/when/op)
3. Version Upsert   (field diff for each revision)
4. SearchIndex Upsert
5. GroundingChunk Upsert (if the entity type is chunkable)
```

Role enforcement: `VIEWER` = read-only. Every write is `EDITOR+` enforced server-side. The client cannot bypass this.

---

## 7. Key invariants

| Invariant | Enforcement |
|---|---|
| No bare data-store writes | All writes via `adapter.db.mutate()` |
| RefId preserved verbatim | `refId = text(cell(...))` — raw cell value |
| No fabrication | Importers return only what source cells contain |
| platform-free shared/ | Zero platform imports in `shared/src/insurance/isoImport.ts` |
| AI server-side only | No AI SDK in `app/src/` |
| HO-3 canary $1,528 | `shared/src/rating/evaluator.test.ts` — CI gate |
| Model IDs | `claude-opus-4-8` (GROUNDED_CITED), `claude-haiku-4-5` (BULK_VERIFY) |

---

## 8. File map

| File | Role |
|---|---|
| `shared/src/insurance/isoImport.ts` | ISO workbook → canonical model (pure TS, no platform) |
| `shared/src/insurance/coverageHierarchy.ts` | First-principles coverage parent/child resolution |
| `shared/src/insurance/lobRegistry.ts` | LOB code → name/prefix mapping |
| `shared/src/types.ts` | Canonical domain types |
| `app/src/lib/import/ExcelReader.ts` | Browser ExcelJS reader → IsoGrid[] |
| `app/src/lib/import/fidelity.test.ts` | Deterministic regression harness (8 XLSX files) |
| `app/src/import/UnifiedImportModal.tsx` | UI: file pick → grids → ImportPlan → mutate loop |
| `app/src/components/claims/BaseFormsLibrary.tsx` | Base form upload (3-step: blob, create, identify) |
| `server/lib/import-brain/` | PDF filing AI pipeline (6 stages) |
| `server/lib/ai/identify-base-form.js` | Form identification: regex fast path + AI fallback |
| `server/lib/storage.js` | Azure Blob Storage upload endpoint |
| `server/lib/data.js` | Cosmos mutate endpoint (atomic 5-op batch) |
| `samples/iso/` | 8 XLSX sample files used by fidelity harness |
| `docs/audit/import_ledger.json` | Defect ledger (DEF-001 through DEF-010) |
| `docs/audit/IMPORT_REVIEW.md` | Fidelity matrix + gap analysis |

---

## 9. Fidelity harness

`app/src/lib/import/fidelity.test.ts` — deterministic, no LLM, reads all 8 XLSX files from `samples/iso/`. Uses ExcelJS in Node mode. Snapshots entity counts per LOB/type as regression anchors.

Baseline counts (as of 2026-07-13):

| LOB | coverages | forms | rules | ldTables | rtTables | ratingSteps |
|-----|-----------|-------|-------|----------|----------|-------------|
| GL  | 105 | 795 | 146 | 37 | 4 | 55 |
| IM  | 798 | 0   | 752 | 34 | 0 | 0  |
| PR  | 603 | 240 | 1608 | 0 | 0 | 909 |

---

## 10. Enhancement opportunities

See [ENHANCEMENT_NOTES.md](./ENHANCEMENT_NOTES.md) for a prioritized list of suggested improvements.
