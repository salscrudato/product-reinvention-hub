// import/__eval__/fixtures.ts — fixture matrix for the unified import pipeline evaluation.
//
// ADDITIVE ONLY: this file adds new fixtures and golden assertions.
// It NEVER modifies the existing canaries:
//   - HO-3 $1,528  (shared/src/rating/evaluator.test.ts)
//   - PA  $1,002   (shared/src/rating/personalAuto.evaluator.test.ts)
//   - GL  $2,635   (shared/src/rating/generalLiability.evaluator.test.ts)
//   - $1,281 Lemonade filing canary (shared/src/insurance/filing/reconcile.test.ts)
//   - 17-family archetype canaries (shared/src/lines/__fixtures__/lineIntelligence.canary.test.ts)
//
// Format × line matrix:
//   ISO_WORKBOOK      × GL    — GL product framework sheet names → PlanExtraction → DETERMINISTIC_TABLE
//   SERFF_PACKAGE     × PH    — SERFF schedule signals → line guess PH.LOB.001
//   ERC_PACKAGE       × WC    — ERC member name prefixes → WC.FAMILY
//   COMPANY_FILING_PDF× PH    — Lemonade NJ fixture (reuses existing NJ_LEMONADE_EXTRACTION)
//   UNKNOWN           × (n/a) — Unrecognized format → FormatCard proposed

import type { UploadDoc, FormatFingerprint } from '@pf/shared'
import { NJ_LEMONADE_EXTRACTION } from '@pf/shared'

// ─── ISO_WORKBOOK fixture (GL line) ──────────────────────────────────────────

export const ISO_WORKBOOK_GL_DOC: UploadDoc = {
  name:       'ISO-GL-Workbook.xlsx',
  mediaType:  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sheetNames: [
    'GL Product Framework',
    'GL Forms Specifications',
    'GL Rules Specifications',
    'Limits and Deductibles',
    'GL Rating Specifications',
  ],
}

export const ISO_WORKBOOK_PH_DOC: UploadDoc = {
  name:       'ISO-HO-Workbook.xlsx',
  mediaType:  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sheetNames: [
    'HO Product Framework',
    'HO Forms Specifications',
    'HO Rules Specifications',
    'HO Rating Specifications',
  ],
}

// Expected fingerprint for GL ISO workbook
export const GOLDEN_ISO_WORKBOOK_GL_FINGERPRINT: Partial<FormatFingerprint> = {
  container:      'XLSX',
  detectedFormat: 'ISO_WORKBOOK',
}

// ─── SERFF_PACKAGE fixture (PH line) ─────────────────────────────────────────
// Minimal text that triggers SERFF schedule detection + 04.xxxx TOI code (Homeowners).

export const SERFF_PH_DOC: UploadDoc = {
  name:     'SERFF-HO-Filing.pdf',
  mediaType: 'application/pdf',
  text: `
SERFF TRACKING NUMBER: DEMO-12345678
STATE: New Jersey
TOI: 04.0000 — Homeowners
Sub-TOI: 04.0003
Filing Type: Rate
Rate/Rule Schedule
    Form Number   Form Name       Form Type   Edition Date   Action
    HO 00 03      Homeowners      Coverage    10/00          Replacement
Form Schedule
    Form Number   Form Name       Form Type   Edition Date   Action
    HO 00 03      Homeowners      Coverage    10/00          Replacement
Supporting Documentation Schedule
Rate Filing Organization: ISO
NAIC Company Code: 99999
  `.trim(),
}

export const GOLDEN_SERFF_FINGERPRINT: Partial<FormatFingerprint> = {
  detectedFormat: 'SERFF_PACKAGE',
}

// ─── ERC_PACKAGE fixture (WC line) ────────────────────────────────────────────
// Minimal manifest text that triggers ERC detection: two or more ERC member prefixes.

export const ERC_WC_DOC: UploadDoc = {
  name:     'ERC-WC-Package.zip',
  mediaType: 'application/zip',
  text: `
ReadMe.txt
ALG_NJ_2025_01.csv
RCRN_NJ_2025_01.xml
RC_NJ_2025_01.csv
DS_NJ_2025_01.xml
TC_NJ_2025_01.csv
LOB Code: 01 (Workers Compensation)
State: NJ
Effective Date: 2025-01-01
Refer to company for class codes not listed.
Not supported: maritime employees.
  `.trim(),
}

export const GOLDEN_ERC_FINGERPRINT: Partial<FormatFingerprint> = {
  container:      'ZIP',
  detectedFormat: 'ERC_PACKAGE',
}

// ─── COMPANY_FILING_PDF fixture (PH line, Lemonade NJ) ───────────────────────
// Uses the existing NJ_LEMONADE_EXTRACTION to test the reconcile wrapper path.
// The $1,281 canary is asserted in shared/src/insurance/filing/reconcile.test.ts
// and is NOT re-asserted here — this test only checks the unified bundle shape.

export const LEMONADE_RATE_ORDER_DOC: UploadDoc = {
  name:      'RATE ORDER OF CALCULATIONS.pdf',
  mediaType: 'application/pdf',
  text:      'rate order of calculations homeowners manual loss cost LCM territory',
}

export const LEMONADE_MANUAL_DOC: UploadDoc = {
  name:      'HOMEOWNERS MANUAL.pdf',
  mediaType: 'application/pdf',
  text:      'homeowners manual rating manual loss cost rule 1 rule 205 minimum premium',
}

export const LEMONADE_POLICY_FORM_DOC: UploadDoc = {
  name:      'LEM 03 05 23.pdf',
  mediaType: 'application/pdf',
  text:      'section i section ii insuring agreement ho 00 03 coverage a coverage b',
}

export const LEMONADE_DOCS = [LEMONADE_RATE_ORDER_DOC, LEMONADE_MANUAL_DOC, LEMONADE_POLICY_FORM_DOC]

// Re-export the existing Lemonade extraction for use in reconcile path tests
export { NJ_LEMONADE_EXTRACTION }

export const GOLDEN_LEMONADE_FINGERPRINT: Partial<FormatFingerprint> = {
  container:      'PDF',
  detectedFormat: 'COMPANY_FILING_PDF',
}

// UNRESOLVED items golden set — Protection-Construction and Key Factor are known
// to be unresolvable in the NJ Lemonade filing (they appear in the rate order but
// have no matching manual table). Asserted by existing reconcile.test.ts.
export const GOLDEN_LEMONADE_UNRESOLVED_NAMES = ['Protection-Construction', 'Key Factor']

// ─── UNKNOWN format fixture ───────────────────────────────────────────────────

export const UNKNOWN_FORMAT_DOC: UploadDoc = {
  name:      'mystery-insurance-doc.txt',
  mediaType: 'text/plain',
  text:      'PROPERTY SCHEDULE REPORT — Market Value Assessment Version 3.2 Custom Carrier Format',
}

export const GOLDEN_UNKNOWN_FINGERPRINT: Partial<FormatFingerprint> = {
  container:      'TXT',
  detectedFormat: 'UNKNOWN',
}
