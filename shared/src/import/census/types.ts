// shared/src/import/census/types.ts — the cell census type system (CE1-S4).
//
// The census is the deterministic conservation layer: EVERY cell in a workbook
// is recorded, fingerprinted, and later ACCOUNTED to a disposition, so "how much
// of this workbook did the import actually consume?" becomes ledger math instead
// of vibes. Pure TypeScript, zero platform imports (no ExcelJS, no fs, no DOM):
// the server feeds it RawCensusSheet built from live ExcelJS worksheets
// (formatting only exists there); tests and fuzzers feed it literals.

import type { MergedCellRange } from '../structure/types'

// ── Input contract (fed by server/lib/import-brain/workbook.js) ───────────────

/** One raw cell as the feeder saw it. `v` is the RAW ExcelJS value (formula
 *  objects, richText, Dates — pre-normalization); formatting flags come from the
 *  live worksheet. A null slot in the grid means "no cell stored here". */
export interface RawCensusCell {
  v: unknown
  bold?: boolean
  filled?: boolean
  indent?: number
  topBorder?: boolean
}

/** A data-validation rule attached to a range (Data Validation harvest, det. h). */
export interface RawValidation {
  ref: string           // "E5:E9" or "E5"
  type: string          // 'list' | 'whole' | ...
  formulae: string[]    // e.g. ['"Adds,Replaces,Removes"'] or ['Definitions!$B$2:$B$9']
}

export interface RawCensusSheet {
  name: string
  hidden: boolean
  cells: (RawCensusCell | null)[][]  // row-major, 0-based
  merges: MergedCellRange[]
  validations?: RawValidation[]
}

// ── Census records ────────────────────────────────────────────────────────────

export type CensusCellType = 'string' | 'number' | 'date' | 'bool' | 'formula'

export interface CellRecord {
  ref: string            // "Sheet!A1"
  sheet: string
  row: number            // 0-based
  col: number            // 0-based
  type: CensusCellType
  valueHash: string      // fnv1a64 hex of the FULL verbatim (pre-cap)
  verbatim: string       // raw, untrimmed, capped at 512 chars
  verbatimTruncated: boolean
  merged: { anchor: string; span: [number, number] } | null  // null unless inside a merge
  format: { bold: boolean; filled: boolean; indent: number; topBorder: boolean }
  hidden: boolean        // sheet-level visibility
}

/** Gap-segmented rectangular region: a new region starts after a blank-row run
 *  of >= 2, or when the occupied column band shifts to a disjoint range. */
export interface TableRegion {
  rowStart: number
  rowEnd: number         // inclusive
  colStart: number
  colEnd: number         // inclusive
  headerRow: number | null   // absolute row index of the best header candidate
  headerConfidence: number   // 0 when headerRow is null
}

export interface SheetCensus {
  name: string
  hidden: boolean
  dims: { rows: number; cols: number }   // true extent (trailing empties trimmed)
  nonEmpty: number
  fingerprint: {
    headerSig: string    // fnv1a64 of the best header row's squished labels ('' = none)
    sampleHash: string   // fnv1a64 over sampled cell valueHashes + dims
  }
  tables: TableRegion[]
  cells: CellRecord[]    // every non-empty cell, row-major order
}

export interface WorkbookCensus {
  sourceName: string
  sheets: SheetCensus[]
}

// ── Accounting ────────────────────────────────────────────────────────────────

export type Disposition =
  | 'FACT'          // extracted into the plan as a value
  | 'SCHEMA'        // consumed as structure (headers claimed by a parser, enum domains, definitions)
  | 'NOISE'         // deliberate non-substance (titles, legends, decorative)
  | 'HEADER'        // header cells identified by the census itself
  | 'MERGE_SHADOW'  // covered by a merge; the anchor carries the value
  | 'NEEDS_REVIEW'  // surfaced to a human, not silently dropped
  | 'UNACCOUNTED'   // nobody has claimed it (the risk signal)

export interface AccountingEntry {
  ref: string
  disposition: Disposition
  by: 'code' | 'model' | 'sweeper'
  ruleId: string | null
  factRef: string | null
  citations: string[]
}

export interface SheetRollup {
  sheet: string
  nonEmpty: number
  byDisposition: Record<Disposition, number>
  substanceCoverage: number   // (FACT+SCHEMA) / (nonEmpty - NOISE - HEADER - MERGE_SHADOW); 1 when denominator 0
  unaccounted: string[]       // refs still UNACCOUNTED
}

export interface WorkbookRollup {
  sourceName: string
  nonEmpty: number
  byDisposition: Record<Disposition, number>
  substanceCoverage: number
  sheets: SheetRollup[]
}

/** A span of cells a mapper consumed, with why (S6 instrumentation output). */
export interface ConsumedSpan {
  sheet: string
  rowStart: number
  rowEnd: number        // inclusive
  colStart: number
  colEnd: number        // inclusive
  reason: string        // e.g. 'framework-rows', 'ld-table', 'header'
}
