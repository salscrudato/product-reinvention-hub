# ISO Workbook Import — Fidelity Review

**Date:** 2026-07-13
**Branch:** main
**Scope:** `shared/src/insurance/isoImport.ts` — pure importer only. Zero changes to rating engine, adapters, or platform code.
**Canaries:** HO-3 $1,528, PA $1,002, GL $2,635 — all byte-exact throughout.

---

## 1. Sample corpus

| File | Format | LOB |
|------|--------|-----|
| `sample-GL-framework.xlsx` | ISO GL Product Framework | GL |
| `sample-GL-forms.xlsx` | ISO GL Forms Specifications + Dynamic Data | GL |
| `sample-GL-rules.xlsx` | ISO GL Rules Specifications + Limits and Deductibles | GL |
| `sample-GL-pricing.xlsx` | ISO GL Rating Specifications + Rating Tables | GL |
| `sample-IM-framework.xlsx` | Component Model — Product Component Model | IM |
| `sample-IM-rules.xlsx` | Component Model — Rules Repository + Limits and Deductibles Tables | IM |
| `sample-PR-framework.xlsx` | Component Model — Product Component Model + Forms Library + Rules Repository | PR |
| `sample-PR-rating.xlsx` | Component Model — ROC + PROPERTY ROC + ISO TABLES | PR |

PDFs in `samples/filings/` and `samples/iso/` are **out of scope** for the Excel importer — they are handled by the filing importer (`server/lib/import-brain/stage-filing.js`).

---

## 2. Fidelity matrix — before and after

| Metric | GL (Phase 0) | IM before | IM after | PR before | PR after |
|--------|-------------|-----------|----------|-----------|----------|
| coverages | 105 | 798 | 798 | 603 | 603 |
| forms | 795 | 0 | 0 | 0 | 240 |
| rules | 146 | 0 | 752 | 0 | 1,608 |
| formRules | 259 | 0 | 0 | 0 | 0 |
| ldTables | 37 | 0 | **34** | 0 | 0 |
| rtTables | 4 | 0 | 0 | 0 | 0 |
| ratingSteps | 55 | 0 | 0 | 0 | 909 |

GL was already at the golden baseline before any work began.

---

## 3. Iteration history

### Wave 1 — Sheet-name regexes (DEF-001 to DEF-005)
**Root cause:** The importer used ISO GL template sheet names exclusively. The IM/PR component-model template uses completely different sheet names:

| Logical role | GL template | IM/PR template |
|---|---|---|
| Coverage framework | GL Product Framework | Product Component Model |
| Forms | GL Forms Specifications | Forms Library |
| Rules | GL Rules Specifications | Rules Repository |
| Rating | GL Rating Specifications | ROC / PROPERTY ROC |

**Fix:** Extended three regexes in `mapIsoWorkbook()`:
- `formGrid`: `/forms specifications?|forms library/i`
- `ruleGrid`: `/rules specifications?|rules repository/i`
- `rateGrid`: `/rating specifications?|property roc|^roc$/i`

**Result:** IM rules 0→752, PR forms 0→240, PR rules 0→1,608, PR ratingSteps 0→909.

### Wave 2 — RATE_FIELDS aliases (PR ROC column names)
**Root cause:** The PR ROC sheet uses "RULES" (not "RATING RULES") for step labels, and "TABLE REFERENCE" (not "RATE REFERENCE") for table references.

**Fix:** Extended `RATE_FIELDS`:
- `rules: ['RATING RULES', 'RULES']`
- `reference: ['RATE REFERENCE', 'TABLE REFERENCE']`

### Wave 3 — FORM_FIELDS aliases (PR Forms Library column names)
**Root cause:** The PR Forms Library uses "ADMITTED/NOT ADMITTED" and "ATTACHMENT CONDITIONS" (plural).

**Fix:** Extended `FORM_FIELDS`:
- `admitted: [...existing..., 'ADMITTED/NOT ADMITTED', 'ADMITTED / NOT ADMITTED']`
- `attachment: ['ATTACHMENT CONDITION', 'ATTACHMENT CONDITIONS']`

### Wave 4 — LD table format (DEF-006)
**Root cause:** IM template uses `LD001`, `LD002` (without `Table.` segment) in column B (index 1), while GL uses `LDTable.001` in column A (index 0). The existing `LD_MARKER` regex and hardcoded `col 0` check both missed the IM format.

**Fix:** `parseLdTables()` now:
1. Scans the first 20 rows to detect `markerCol` (0 for GL, 1 for IM)
2. Uses a combined regex `LD_MARKER = /^LD ?TABLE\.\s*\w+|^LD\d+$/i`
3. Reads refId, name, value, and comment columns relative to `markerCol`
4. Uses `markerCol` in the loop-break check to stop at the next marker

**Result:** IM ldTables 0→34.

---

## 4. Blocked defects

### DEF-010 — PR "ISO TABLES" sheet (BLOCKED)
The `sample-PR-rating.xlsx` workbook has an "ISO TABLES" sheet containing stacked rate tables (e.g. "Rule 85 BG1 Class Loss Costs" with Construction/ContentType/Value columns). This sheet does NOT use the "RATE TABLE ID"/"RATE TABLE NAME" markers that `parseRtTables()` requires.

Investigation found:
- The sheet name ("ISO TABLES") has no matching regex in `mapIsoWorkbook()` for the `rtGrid` slot
- Even if matched, `parseRtTables()` would produce zero tables (no block markers)
- The PR ROC "TABLE REFERENCE" column contains step-level table names, but there is no reliable mapping from those names to the ISO TABLES block titles — the linkage would require fabrication

**Decision:** BLOCKED. The no-fabrication invariant takes precedence. The PR rating program (ratingSteps=909) is already parsed and fully usable; ISO TABLES is supplementary rate data requiring a custom format extension.

---

## 5. Remaining gaps and rationale

| Gap | Category | Rationale |
|-----|----------|-----------|
| IM forms = 0 | Source gap | The IM component-model workbooks do not contain a forms sheet; forms are referenced from coverages via `COVERAGE FORM` column (unmapped supplementary field) |
| IM/PR formRules = 0 | Source gap | GL `GL Optional Forms Rules` sheet has no equivalent in IM/PR component-model templates |
| PR rtTables = 0 | Blocked (DEF-010) | ISO TABLES format incompatible with existing parser; blocked |
| IM ratingSteps = 0 | Source gap | IM workbooks contain no ROC/rating sheet |
| IM/PR dynamicFields = 0 | Source gap | `GL Forms Dynamic Data` sheet has no equivalent in IM/PR templates |

---

## 6. Hostile self-review checklist

- [x] **No harness weakening.** Snapshots only updated upward (counts increased). No assertion was relaxed.
- [x] **No canary movement.** $1,528 / $1,002 / $2,635 byte-exact before and after every commit.
- [x] **No fabrication.** All entity data comes from source cells. Where source cells are absent the field is absent (not defaulted or invented).
- [x] **RefIds verbatim.** `refId = text(cell(...))` — raw cell value, no transformation except `docId` dot→dash normalisation.
- [x] **All writes through mutate().** The importer is pure — it returns `ImportPlan` only. The app calls `adapter.db.mutate()` per entity. Zero bare writes.
- [x] **Scope strictly to importer.** Every changed line is in `shared/src/insurance/isoImport.ts`. No other source files touched in importer waves.
- [x] **No hard-coded hex.** isoImport.ts has no UI code.
- [x] **shared/ stays platform-free.** No platform imports added.
- [x] **Gate green.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes after every commit.

---

## 7. Open follow-up items (not in scope of this review)

1. **ISO TABLES parser** (DEF-010): a new `parseIsoTables()` function that detects block boundaries from a title row pattern (e.g. `/^Rule \d+/`) and maps to the ROC `TABLE REFERENCE` column by exact name match. This is feasible but needs cross-reference validation against PR sample data first.
2. **IM multi-product splitting**: 48 distinct product names under one `IM.PROD.001` product. The source genuinely has no `.PROD` row — a follow-up could add a UI flow to let the user split on import.
3. **Fuzzy column matching**: Novel templates may use synonym headers not yet in the alias lists. A content-based column-type inference pass (if no squish-match, try word-overlap scoring) would handle these without requiring alias list updates.
