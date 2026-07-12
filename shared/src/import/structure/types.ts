// shared/src/import/structure/types.ts — structural extraction types (platform-free).
// All downstream readers (XLSX, CSV, PDF stub) emit one StructuralModel per file.
// Pure TypeScript; zero platform imports.

export type LayoutShape =
  | 'FLAT_TABLE'
  | 'INDENTED_HIERARCHY'
  | 'STACKED_TABLES'
  | 'WIDE_MATRIX'

export type CellType = 'text' | 'number' | 'date' | 'boolean' | 'empty' | 'sentinel'

// A cell that may be 'NO_EXPIRY' (from 9999-12-31 sentinel) or null (from other sentinels).
export type SentinelValue = null | 'NO_EXPIRY'

// A fully normalized cell: sentinels replaced, ExcelJS complex values flattened.
export type NormalizedCell = string | number | boolean | SentinelValue

export interface ColumnProfile {
  colIndex: number
  headerLabel: string | null
  typeMix: Record<CellType, number>   // occurrence count per cell type
  totalDataCells: number
  distinctSample: unknown[]           // up to 20 distinct non-null values
  isEnumLike: boolean                 // low distinct/non-empty ratio and ≤ 20 distinct values
  hasDatePattern: boolean
  hasDollarPattern: boolean
}

export interface HeaderCandidate {
  rowIndex: number        // 0-based index into the cells array
  score: number           // 0–1; higher = more header-like
  labels: string[]        // non-empty string values found in this row
  distinctCount: number
  followedByData: boolean
}

export interface DefinitionsEntry {
  columnName: string
  description: string
  example?: string
}

export interface MergedCellRange {
  top: number    // 0-based row, inclusive
  left: number   // 0-based col, inclusive
  bottom: number // 0-based row, inclusive
  right: number  // 0-based col, inclusive
}

export interface SubTable {
  name: string
  refId?: string
  startRow: number        // 0-based index in the parent cells array (first marker row)
  endRow: number          // 0-based, inclusive (last row before next marker or sheet end)
  headerRowIndex: number  // 0-based index in the parent cells array where column headers live
  cells: NormalizedCell[][] // cells from headerRowIndex to endRow (inclusive)
  columnProfiles: ColumnProfile[]
  metaBlock: Record<string, string>  // key: value pairs parsed above the column headers
}

export interface WideMatrixInfo {
  allStatesColIndex: number | null             // index of "ALL ACTIVE STATES" column (0-based)
  stateColIndices: Record<string, number>      // 'AZ' -> 0-based col index
  nonStateColCount: number                     // cols that are not state codes
}

export interface SheetFingerprint {
  sheetName: string
  // Raw extent reported by ExcelJS (may be 1,048,576 for whole-column-formatted sheets)
  rawRowCount: number
  rawColCount: number
  // True extent: last row/col that actually contains a non-null value
  dataRowCount: number
  dataColCount: number
  mergedCells: MergedCellRange[]
  // Top header candidates ranked by score (at most 5)
  headerCandidates: HeaderCandidate[]
  // 0-based row index of the best header; -1 when no header is detectable
  bestHeaderRow: number
  layoutShape: LayoutShape
  // Column profiles for the data area (from bestHeaderRow + 1 onward)
  columnProfiles: ColumnProfile[]
  // Present only when layoutShape === 'STACKED_TABLES'
  subTables?: SubTable[]
  // Present only when layoutShape === 'WIDE_MATRIX'
  wideMatrix?: WideMatrixInfo
  // Present only when isDefinitionsSheet === true
  definitions?: DefinitionsEntry[]
  isDefinitionsSheet: boolean
}

export interface StructuralModel {
  sourceName: string
  sourceType: 'XLSX' | 'XLSM' | 'CSV' | 'PDF'
  sheets: SheetFingerprint[]
  // Definitions index: sheet name -> parsed entries (every Definitions/Glossary sheet)
  definitionsBySheet: Record<string, DefinitionsEntry[]>
}
