// shared/src/import/structure/layoutDetector.ts — layout shape detection.
// Priority order: STACKED_TABLES → WIDE_MATRIX → INDENTED_HIERARCHY → FLAT_TABLE.
// Detection is content-based: scanning for sub-table markers, state-code columns,
// and indentation patterns. Fully deterministic, LLM-free.

import type { NormalizedCell, LayoutShape } from './types'

// All two-letter US state + DC codes.
export const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
])

// Variants of "all states" column headers found in real workbooks.
export const ALL_STATES_LABELS = new Set([
  'ALL ACTIVE STATES',
  'ALL STATES',
  'STATE APPLICABILITY',
  'ALL',
])

// Regex patterns that mark the START of a stacked sub-table block.
// Checked against the first 3 columns of each row.
// NOTE: TABLE NAME is intentionally absent from the primary set — in GL/LD-table workbooks
// it appears on the same row as the RATE/LD TABLE ID (meta WITHIN a block, not a start).
// The secondary TABLE_NAME_SENTINEL_PATTERN is only used when no primary markers exist.
//
// WHICH BOOKS EMIT WHAT (counted over the first 3 columns of every row):
//   samples/iso/sample-GL-pricing.xlsx  "GL Rating Tables"       RATE TABLE ID: ×7, RTTable.N ×7
//   samples/iso/sample-GL-rules.xlsx    "Limits and Deductibles" LDTable.N ×37, TABLE NAME: ×34
//   latest_samples/…_Core.xlsx          "Rule References"        TABLE NAME: ×237, RULE ID: ×361
//   latest_samples/…_E+.xlsx            "E+ Rule References"     TABLE NAME: ×40,  RULE ID(s): ×40
// The RATE/LD primaries are real — but ONLY in the ISO corpus. The two Hagerty
// spec books emit neither, so their sheets segment on TABLE NAME and identify
// themselves with RULE ID / RULE ID(s). Both spellings are grammar, not typos.
const STACKED_MARKER_PATTERNS: RegExp[] = [
  /RATE\s+TABLE\s+ID\s*:/i,
  /^(RTTable)\.\d+$/i,
  /^LD\s*TABLE\s+ID\s*:/i,
  /^(LDTable)\.\d+$/i,
]

// Secondary sentinel: TABLE NAME: rows that ARE block delimiters when no primary
// RATE/LD markers are present (e.g. E+ Rule References format).
export const TABLE_NAME_SENTINEL_PATTERN = /^TABLE\s+NAME\s*:/i

// The rule-id marker: the only self-identification the Hagerty spec books emit for a
// stacked block. Singular in the CORE book ("RULE ID: CORE.RU018; …"), parenthesized
// plural in the E+ book ("RULE ID(s): EPLS.RU019; …"). Bare-plural and possessive
// spellings are accepted too so a third book's punctuation is not a silent data loss.
// This marker identifies a block; it never delimits one (a block states TABLE NAME
// first, then RULE ID — treating both as starts would split every block in two).
export const RULE_ID_MARKER_PATTERN = /^RULE\s+ID(?:\(\s*S\s*\)|S|['’]S)?\s*:/i

/** Canonical meta-block key for a rule-id marker cell, so downstream readers key on
 *  ONE name regardless of which spelling the workbook used. Non-rule-id keys pass
 *  through unchanged. Input is expected already trimmed + uppercased. */
export function canonicalMetaKey(key: string): string {
  return /^RULE\s+ID(?:\(\s*S\s*\)|S|['’]S)?$/i.test(key) ? 'RULE ID' : key
}

/** Returns true when the row's first 3 cells carry a rule-id marker (either form). */
export function rowMatchesRuleIdMarker(row: NormalizedCell[]): boolean {
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c]
    if (typeof v === 'string' && RULE_ID_MARKER_PATTERN.test(v.trim())) return true
  }
  return false
}

/** Returns true when the row's first 3 cells contain a stacked-table marker. */
export function rowMatchesStackedMarker(row: NormalizedCell[]): boolean {
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c]
    if (typeof v === 'string' && v.trim().length > 0) {
      if (STACKED_MARKER_PATTERNS.some(p => p.test(v.trim()))) return true
    }
  }
  return false
}

/** Returns true when ≥ 2 rows in the sheet match a stacked-table marker pattern. */
export function hasStackedTableMarkers(cells: NormalizedCell[][]): boolean {
  let count = 0
  for (const row of cells) {
    if (rowMatchesStackedMarker(row)) {
      if (++count >= 2) return true
    }
  }
  return false
}

/** Returns true when ≥ 2 rows match TABLE NAME: and NO primary RATE/LD markers exist.
 *  This detects formats like E+ Rule References where TABLE NAME: IS the block delimiter. */
export function hasTableNameOnlyMarkers(cells: NormalizedCell[][]): boolean {
  if (hasStackedTableMarkers(cells)) return false   // primary markers take precedence
  let count = 0
  for (const row of cells) {
    for (let c = 0; c < Math.min(row.length, 2); c++) {
      const v = row[c]
      if (typeof v === 'string' && TABLE_NAME_SENTINEL_PATTERN.test(v.trim())) {
        if (++count >= 2) return true
        break
      }
    }
  }
  return false
}

/** Returns true when the header row contains ≥ 3 state-code or all-states columns.
 *  The threshold of 3 avoids false positives from sheets that happen to have 1-2
 *  state columns for a different purpose (e.g., a "STATE OF DOMICILE" text column). */
export function hasWideStateColumns(headerRow: NormalizedCell[]): boolean {
  let count = 0
  for (const v of headerRow) {
    if (typeof v !== 'string') continue
    const upper = v.trim().toUpperCase()
    if (US_STATE_CODES.has(upper) || ALL_STATES_LABELS.has(upper)) {
      if (++count >= 3) return true
    }
  }
  return false
}

/** Returns true when ≥ 20 % of data rows show an indented-hierarchy pattern:
 *  the first column is empty but the second has a value (child rows indented under parents). */
export function hasIndentedHierarchy(cells: NormalizedCell[][], bestHeaderRow: number): boolean {
  const startRow = Math.max(0, bestHeaderRow + 1)
  let total = 0
  let indented = 0

  for (let r = startRow; r < cells.length; r++) {
    const row = cells[r] ?? []
    const hasAny = row.some(v => v !== null && v !== '' && v !== undefined)
    if (!hasAny) continue
    total++
    const col0Empty = row[0] === null || row[0] === '' || row[0] === undefined
    const col1Filled = typeof row[1] === 'string' && (row[1]?.trim().length ?? 0) > 0
    if (col0Empty && col1Filled) indented++
  }

  return total >= 4 && indented / total >= 0.20
}

/** Detect the layout shape of a sheet from its normalized cells.
 *  Priority: STACKED_TABLES > WIDE_MATRIX > INDENTED_HIERARCHY > FLAT_TABLE. */
export function detectLayoutShape(cells: NormalizedCell[][], bestHeaderRow: number): LayoutShape {
  if (hasStackedTableMarkers(cells) || hasTableNameOnlyMarkers(cells)) return 'STACKED_TABLES'

  const headerRow = bestHeaderRow >= 0 ? (cells[bestHeaderRow] ?? []) : []
  if (hasWideStateColumns(headerRow)) return 'WIDE_MATRIX'

  if (hasIndentedHierarchy(cells, bestHeaderRow)) return 'INDENTED_HIERARCHY'

  return 'FLAT_TABLE'
}
