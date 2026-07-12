// tests/fixtures/import/registry.ts — registration of the eight real source workbooks the
// format-agnostic importer is judged against. Four ISO GL workbooks physically ship in the
// repo (samples/iso/*.xlsx) and are extracted faithfully; the SECURA Inland Marine framework
// + rules, the Property rating repository, and the multi-domain Property RF .xlsm are NOT in
// the repo, so their fixtures are marked presentInRepo:false and their expected snapshots are
// authored from the DOCUMENTED cross-source variance (sheet names + refId schemes + column
// synonyms). The sheet-name variance recorded here is the exact variance the pipeline handles.
import type { WorkbookFixture } from './types'

export const WORKBOOK_FIXTURES: readonly WorkbookFixture[] = [
  // ── ISO General Liability (four workbooks, physically in the repo) ──────────────
  {
    id: 'gl-framework', line: 'GL',
    files: ['samples/iso/20-ISO-Framework-GL.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Product Framework', 'Definitions-Product Framework', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL template; hierarchy sheet "GL Product Framework" with TWO form columns (COVERAGE FORM(S) titles + FORM NUMBER(S) numbers).',
  },
  {
    id: 'gl-forms', line: 'GL',
    files: ['samples/iso/20-ISO-Forms-GL.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Forms Specifications', 'GL Forms Dynamic Data', 'Definitions-Forms Specification', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL forms; multi-line "PRODUCT FRAMEWORK ID" cells, FORM EFFECTIVE/EXPIRATION DATE + MARKET SEGMENT extras.',
  },
  {
    id: 'gl-rules', line: 'GL',
    files: ['samples/iso/20-ISO-Rules-GL.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Rules Specifications', 'GL Optional Forms Rules', 'Limits and Deductibles', 'Definitions', 'Definitions - Rules Categories', 'Revision History'],
    provenance: 'ISO GL rules; "SUB\\nCOVERAGE" (no hyphen) here vs "SUB-\\nCOVERAGE" in the framework; RULE REFERENCE cites "…(LDTable.008)".',
  },
  {
    id: 'gl-pricing', line: 'GL',
    files: ['samples/iso/20-ISO-Pricing-GL.xlsx'],
    presentInRepo: true,
    sheetNames: ['GL Rating Specifications', 'GL Rating Tables', 'Definitions-Rating Specificants', 'Data Validation', 'Revision History'],
    provenance: 'ISO GL rating; step ids "GL.RAT.1.00" (definitions also show "GL.RAT.0001.0"); CALCULATION column uses = + - * /.',
  },

  // ── SECURA Inland Marine (NOT in repo — authored from the observed variance) ────
  {
    id: 'im-framework', line: 'IM',
    files: ['samples/secura/SECURA-InlandMarine-Framework.xlsx'],
    presentInRepo: false,
    sheetNames: ['Product Component Model', 'Forms Library'],
    provenance: 'SECURA IM framework: hierarchy sheet "Product Component Model" (id column just "ID"); forms on "Forms Library"; refIds like IM.COV044.00.',
  },
  {
    id: 'im-rules', line: 'IM',
    files: ['samples/secura/SECURA-InlandMarine-Rules.xlsx'],
    presentInRepo: false,
    sheetNames: ['Rules Repository'],
    provenance: 'SECURA IM rules: "Rules Repository" sheet; rule ids like IM.RL.001 (RL token, not RU).',
  },

  // ── Property rating repository + multi-domain Property RF (NOT in repo) ──────────
  {
    id: 'pr-rating', line: 'PR',
    files: ['samples/property/Property-Rating-Repository.xlsx'],
    presentInRepo: false,
    sheetNames: ['PROPERTY ROC', 'ROC'],
    provenance: 'Property rating repository: "PROPERTY ROC"/"ROC" sheets; some rows ship "TBD" step ids → refId synthesized as PR.ROC.###.',
  },
  {
    id: 'pr-rf', line: 'PR',
    files: ['samples/property/Property-RF.xlsm'],
    presentInRepo: false,
    sheetNames: ['Product Component Model', 'Forms Library', 'PROPERTY ROC', 'Rules Repository'],
    provenance: 'Multi-domain Property RF (.xlsm, macro-enabled): framework + forms + rating + rules in one book; coverage refIds like PR.COV001.0.',
  },
]

/** Fixtures for one line. */
export function fixturesForLine(line: WorkbookFixture['line']): WorkbookFixture[] {
  return WORKBOOK_FIXTURES.filter(w => w.line === line)
}
