// shared/src/import/structure/modelBuilder.ts — grid → StructuralModel builder.
// Platform-free: takes pre-flattened cell grids (any source: ExcelJS server-side,
// ExcelJS browser-side, CSV) and produces the same StructuralModel the app-side
// fingerprinter emits, PLUS the real normalized cell grid on each fingerprint
// (SheetFingerprint.cells) so extraction operates on actual rows, never on
// synthetic rows reconstructed from column samples.
//
// Zero platform imports — bundles cleanly into server/lib/import-brain-shared.cjs.

import type {
  StructuralModel, SheetFingerprint, NormalizedCell, MergedCellRange,
  DefinitionsEntry, SubTable, WideMatrixInfo, ColumnProfile, HeaderCandidate,
} from './types'
import { normalizeCellValue } from './sentinels'
import { scoreHeaderCandidates, pickBestHeaderRow } from './headerScore'
import { detectLayoutShape } from './layoutDetector'
import { profileColumns } from './columnProfiler'
import { isDefinitionsSheetName, parseDefinitionsSheet } from './definitionsParser'
import { segmentStackedTables } from './stackedSegmenter'
import { foldWideMatrix } from './wideMatrixFolder'

// Embed caps: bound the grid carried inside a fingerprint (and therefore prompt
// assembly memory) without silently losing data — truncation sets cellsTruncated
// and downstream stages must emit an importWarning.
export const MAX_EMBED_ROWS = 2000
export const MAX_EMBED_COLS = 128

export interface SourceGrid {
  sheet:        string
  cells:        unknown[][]          // raw (pre-normalization) row-major cells
  mergedCells?: MergedCellRange[]
}

/** Fingerprint one grid. Cells are normalized here — pass raw flattened values. */
export function fingerprintGrid(grid: SourceGrid): SheetFingerprint {
  const rawRowCount = grid.cells.length
  const rawColCount = grid.cells.reduce((m, r) => Math.max(m, r?.length ?? 0), 0)

  // Normalize + find the true data extent (trailing all-null rows/cols dropped).
  const normalized: NormalizedCell[][] = grid.cells.map(row =>
    (row ?? []).map(v => normalizeCellValue(v)),
  )
  let lastRow = -1
  let lastCol = -1
  for (let r = 0; r < normalized.length; r++) {
    const row = normalized[r]!
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== null) {
        if (r > lastRow) lastRow = r
        if (c > lastCol) lastCol = c
      }
    }
  }

  if (lastRow < 0) {
    return {
      sheetName: grid.sheet,
      rawRowCount, rawColCount,
      dataRowCount: 0, dataColCount: 0,
      mergedCells: grid.mergedCells ?? [],
      headerCandidates: [],
      bestHeaderRow: -1,
      layoutShape: 'FLAT_TABLE',
      columnProfiles: [],
      isDefinitionsSheet: false,
      cells: [],
      cellsTruncated: false,
    }
  }

  const cellsTruncated = (lastRow + 1) > MAX_EMBED_ROWS || (lastCol + 1) > MAX_EMBED_COLS
  const rowLimit = Math.min(lastRow + 1, MAX_EMBED_ROWS)
  const colLimit = Math.min(lastCol + 1, MAX_EMBED_COLS)

  const cells: NormalizedCell[][] = []
  for (let r = 0; r < rowLimit; r++) {
    const src = normalized[r] ?? []
    const row: NormalizedCell[] = new Array(colLimit).fill(null)
    for (let c = 0; c < colLimit; c++) row[c] = src[c] ?? null
    cells.push(row)
  }

  const headerCandidates = scoreHeaderCandidates(cells)
  const bhr              = pickBestHeaderRow(headerCandidates)
  const layoutShape      = detectLayoutShape(cells, bhr)
  const columnProfiles   = profileColumns(cells, bhr)

  let subTables: SubTable[] | undefined
  if (layoutShape === 'STACKED_TABLES') subTables = segmentStackedTables(cells)

  let wideMatrix: WideMatrixInfo | undefined
  if (layoutShape === 'WIDE_MATRIX') {
    const headerRow = bhr >= 0 ? (cells[bhr] ?? []) : []
    wideMatrix = foldWideMatrix(headerRow)
  }

  const isDefinitionsSheet = isDefinitionsSheetName(grid.sheet)
  const definitions = isDefinitionsSheet ? parseDefinitionsSheet(cells) : undefined

  return {
    sheetName: grid.sheet,
    rawRowCount, rawColCount,
    dataRowCount: lastRow + 1,
    dataColCount: lastCol + 1,
    mergedCells: grid.mergedCells ?? [],
    headerCandidates: headerCandidates.slice(0, 5) as HeaderCandidate[],
    bestHeaderRow: bhr,
    layoutShape,
    columnProfiles: columnProfiles as ColumnProfile[],
    subTables,
    wideMatrix,
    definitions,
    isDefinitionsSheet,
    cells,
    cellsTruncated,
  }
}

/** Build a StructuralModel from flattened grids (one grid per sheet). */
export function buildStructuralModel(
  grids:      SourceGrid[],
  sourceName: string,
  sourceType: StructuralModel['sourceType'],
): StructuralModel {
  const sheets: SheetFingerprint[] = []
  const definitionsBySheet: Record<string, DefinitionsEntry[]> = {}

  for (const grid of grids) {
    const fp = fingerprintGrid(grid)
    sheets.push(fp)
    if (fp.definitions && fp.definitions.length > 0) {
      definitionsBySheet[fp.sheetName] = fp.definitions
    }
  }

  return { sourceName, sourceType, sheets, definitionsBySheet }
}
