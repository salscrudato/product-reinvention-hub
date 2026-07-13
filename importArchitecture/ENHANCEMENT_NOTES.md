# Import Pipeline — Enhancement Notes

**Purpose:** Prioritized opportunities for an external AI reviewer to evaluate and suggest implementations.
**Last updated:** 2026-07-13

---

## Priority 1 — High impact, low risk

### P1-A: ISO TABLES parser (DEF-010, BLOCKED)

**Problem:** `sample-PR-rating.xlsx` contains an "ISO TABLES" sheet with stacked rate tables (`Rule 85 BG1 Class Loss Costs`, etc.). These are referenced by the PROPERTY ROC rating program's TABLE REFERENCE column, but no parser exists for this format. The sheet uses no `RATE TABLE ID`/`RATE TABLE NAME` block markers — instead each table starts with a descriptive title row in column B.

**Suggested approach:**
1. Detect block boundaries: scan for rows where column A is blank and column B contains a title pattern like `/^Rule \d+|^[A-Z][^:]+Loss Cost|^[A-Z][^:]+Factor/i`.
2. Read the table's column headers from the row immediately after the title.
3. Map the PROPERTY ROC `TABLE REFERENCE` column values to these block titles by normalized text match.
4. Emit `RTTable` entities with `refId` derived from the title slug.
5. Add a safety check: if TABLE REFERENCE value does not match any ISO TABLE title, leave `source.type: 'INPUT'` rather than fabricate a ref.

**Risk:** Low (additive new parser; no existing parsers changed).

### P1-B: Fidelity harness snapshot auto-update workflow

**Problem:** When the importer is improved (e.g., a new alias added that increases the rules count), the developer must manually update snapshot files. A failed snapshot currently prints a diff but requires `--update-snapshots` — easy to miss.

**Suggested approach:**
Add a `pnpm fidelity:accept` script that runs vitest with `--update-snapshots` scoped to `fidelity.test.ts` only. Document it in `shared/CLAUDE.md` under "Fidelity harness". No code changes required — just a script alias.

### P1-C: IM multi-product splitting UI

**Problem:** The IM component model workbook contains 48 distinct product names under one synthesized `IM.PROD.001` product (the source has no `.PROD` row). The importer warns about this but imports all 48 as siblings.

**Suggested approach:**
After import, if `ImportSummary.warnings` contains `multiproduct`, the `UnifiedImportModal.tsx` UI should show a "Split into separate products?" prompt. The user selects which product names to split, and the app runs a second mutate pass creating one product per name with filtered coverages. This is purely a UI + app layer change — `isoImport.ts` does not need modification.

---

## Priority 2 — Medium impact

### P2-A: LD table `defaultValue` population for IM format

**Problem:** The IM LD tables (`LD001`..`LD034`) do not carry a `DEFAULT` or `default` note in their comment column, so `parseLdTables` never sets `defaultValue`. The GL template explicitly marks a row with "Default" in the comment column.

**Suggested approach:**
Check if the table has exactly one numeric entry — if so, treat it as the implied default. Add a heuristic: if no explicit `default` note, use the entry whose `label` matches `/^included$|^standard$|^basic$/i`.

**Risk:** Low but requires understanding of IM product semantics. Flag as a warning in `ImportSummary` when no default is set.

### P2-B: Form edition normalization

**Problem:** Editions appear in multiple formats: `04 13`, `April 2013`, `04-13`, `2013-04`. The `Claims.tsx` UI sorts and displays editions verbatim. A normalized `editionISO` field (YYYY-MM) would enable consistent sorting and deduplication.

**Suggested approach:**
Add an `editionISO` derived field computed at identify time in `identify-base-form.js` and at import time in `parseForms()`. Use a mapping: `04 13 → 2013-04`, `April 2013 → 2013-04`. Store alongside the raw `edition` — never replace it (raw is the authority).

### P2-C: Content-based sheet type detection

**Problem:** `findSheet()` uses regex on the sheet name. A novel workbook whose sheet is named "Coverage Matrix" (not "Product Component Model" or "GL Product Framework") would be missed entirely.

**Suggested approach:**
Add a fallback: if no sheet matches the primary regex, scan all un-matched sheets for their header row content. A sheet whose header contains both a `coverage`-family alias AND an `id`-family alias (from `FW_FIELDS`) is promoted as the framework sheet. This extends `findSheet()` with a content-probe path.

**Risk:** Medium — could produce false positives on complex workbooks. Apply only when primary regex produces no match.

### P2-D: Rate table numeric column detection for LD tables

**Problem:** `parseLdTables` looks for a value column by regex (`/^AVAILABLE\b|^LIMITS?$|^DEDUCTIBLES?$/i`). If a novel format labels the column "AMOUNT" or "VALUE", the parser falls back to `markerCol + 3` (a positional guess).

**Suggested approach:**
Extend the value column regex with additional synonyms:
```
/^AVAILABLE\b|^LIMITS?$|^DEDUCTIBLES?$|^AMOUNT$|^VALUE$|^FACTOR$|^RATE$/i
```
Already the simplest improvement with no algorithm change needed.

---

## Priority 3 — Architectural

### P3-A: Streaming import progress

**Problem:** The `UnifiedImportModal.tsx` import of a large workbook (798 coverages) blocks the UI thread for several seconds while `mapIsoWorkbook()` runs synchronously.

**Suggested approach:**
Move `mapIsoWorkbook()` to a Web Worker. The worker receives the grids (structured-cloneable), runs the pure mapper, and posts back the `ImportPlan`. The modal shows a spinner with a progress counter per entity type.

**Risk:** Medium — requires worker setup, but `isoImport.ts` is already side-effect-free (no DOM, no global state).

### P3-B: Single embedding corpus for Cosmos

**Problem:** Grounding chunks are written under different `id`/`pk` schemes depending on whether they were seeded via `scripts/migrate-to-cosmos.ts` or written at runtime by `mutate()`. The `grounding()` function deduplicates by text content, but duplicate chunks exist in Cosmos (wasted space + retrieval noise).

**Suggested approach:**
Run a one-time migration: `POST /api/ai/reindexProduct` for all products to re-write chunks under the canonical runtime scheme. Then update the seed script to use the same scheme. After migration, remove the text-deduplication workaround in `grounding()`.

### P3-C: ISO SERFF bridge for filing importer

**Problem:** The PDF filing importer re-extracts form numbers, carrier names, and LOB from PDF text. SERFF (the industry-standard filing system) publishes structured XML for the same data. If a SERFF export is available, it is strictly more reliable than AI extraction.

**Suggested approach:**
Add a new ingest pathway: `POST /api/ai/unifiedImport` accepts a `.zip` containing a SERFF XML manifest and form PDFs. Stage 1 parses the XML (no AI needed). Remaining stages reuse the existing pipeline for the PDF text bodies. The XML parse is platform-free and testable without AI.

---

## Appendix: Defect ledger status

See `docs/audit/import_ledger.json` for the full defect record.

| ID | Status | Summary |
|----|--------|---------|
| DEF-001 | fixed | IM Rules Repository sheet not recognized |
| DEF-002 | fixed | PR Forms Library sheet not recognized |
| DEF-003 | fixed | PR Rules Repository sheet not recognized |
| DEF-004 | fixed | PR ROC sheet not recognized as rating |
| DEF-005 | fixed | PR PROPERTY ROC sheet not recognized |
| DEF-006 | fixed | IM LD tables producing 0 (marker format + column) |
| DEF-007 | not-a-bug | Speculative fixture mismatch |
| DEF-008 | acceptable | IM product refId synthesized (no .PROD row in source) |
| DEF-009 | acceptable | PR product refId synthesized (no .PROD row in source) |
| DEF-010 | BLOCKED | PR ISO TABLES format incompatible with existing parser |
