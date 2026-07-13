// tests/fixtures/import/registry.ts — registration of the eight real source workbooks the
// format-agnostic importer is judged against. All eight workbooks are present in samples/iso/,
// named as generic per-line TEST DATA (sample-<LINE>-<content>): four ISO GL workbooks extracted
// by the deterministic mapIsoWorkbook parser, plus a component-model Inland Marine framework +
// rules and a multi-domain Property book which require the Brain pipeline (AI stages) for full
// coverage. The sheet-name variance recorded here is the exact variance the pipeline must handle
// across carriers and lines. All files are scrubbed of client identifiers (see
// scripts/scrub-company-data.ts).
import type { WorkbookFixture } from './types'

export const WORKBOOK_FIXTURES: readonly WorkbookFixture[] = [
  // ── General Liability (four workbooks, physically in the repo) ──────────────
  {
    id: 'gl-framework', line: 'GL',
    files: ['samples/iso/sample-GL-framework.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Product Framework', 'Definitions-Product Framework', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL template; hierarchy sheet "GL Product Framework" with TWO form columns (COVERAGE FORM(S) titles + FORM NUMBER(S) numbers).',
  },
  {
    id: 'gl-forms', line: 'GL',
    files: ['samples/iso/sample-GL-forms.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Forms Specifications', 'GL Forms Dynamic Data', 'Definitions-Forms Specification', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL forms; multi-line "PRODUCT FRAMEWORK ID" cells, FORM EFFECTIVE/EXPIRATION DATE + MARKET SEGMENT extras.',
  },
  {
    id: 'gl-rules', line: 'GL',
    files: ['samples/iso/sample-GL-rules.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Rules Specifications', 'GL Optional Forms Rules', 'Limits and Deductibles', 'Definitions', 'Definitions - Rules Categories', 'Revision History'],
    provenance: 'ISO GL rules; "SUB\\nCOVERAGE" (no hyphen) here vs "SUB-\\nCOVERAGE" in the framework; RULE REFERENCE cites "…(LDTable.008)".',
  },
  {
    id: 'gl-pricing', line: 'GL',
    files: ['samples/iso/sample-GL-pricing.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Rating Specifications', 'GL Rating Tables', 'Definitions-Rating Specificants', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL rating; step ids "GL.RAT.1.00" (definitions also show "GL.RAT.0001.0"); CALCULATION column uses = + - * /.',
  },

  // ── Inland Marine (component-model template, files present in samples/iso/) ──────
  {
    id: 'im-framework', line: 'IM',
    files: ['samples/iso/sample-IM-framework.xlsx'],
    presentInRepo: true,
    sheetNames: ['Product Component Model', 'Forms Library'],
    provenance: 'IM framework: hierarchy sheet "Product Component Model" (id column just "ID"); forms on "Forms Library"; refIds like IM.COV044.00.',
  },
  {
    id: 'im-rules', line: 'IM',
    files: ['samples/iso/sample-IM-rules.xlsx'],
    presentInRepo: true,
    sheetNames: ['Rules Repository'],
    provenance: 'IM rules: "Rules Repository" sheet; rule ids like IM.RL.001 (RL token, not RU).',
  },

  // ── Commercial Property rating repository + multi-domain framework (present in samples/iso/) ──
  {
    id: 'pr-rating', line: 'PR',
    files: ['samples/iso/sample-PR-rating.xlsx'],
    presentInRepo: true,
    sheetNames: ['PROPERTY ROC', 'ROC'],
    provenance: 'Property rating repository: "PROPERTY ROC"/"ROC" sheets; some rows ship "TBD" step ids → refId synthesized as PR.ROC.###.',
  },
  {
    id: 'pr-rf', line: 'PR',
    files: ['samples/iso/sample-PR-framework.xlsx'],
    presentInRepo: true,
    sheetNames: ['Product Component Model', 'Forms Library', 'PROPERTY ROC', 'Rules Repository'],
    provenance: 'Multi-domain Property book (framework + forms + rating + rules in one workbook; coverage refIds like PR.COV001.0). Scrubbed to a data-only .xlsx (was a macro-enabled .xlsm).',
  },
]

/** Fixtures for one line. */
export function fixturesForLine(line: WorkbookFixture['line']): WorkbookFixture[] {
  return WORKBOOK_FIXTURES.filter(w => w.line === line)
}
