// xlsxReader.ts — XLSX / XLSM source reader using ExcelJS.
//
// Correctness guarantees:
//   • Extent scan uses ws.eachRow({ includeEmpty: false }) which visits only rows that
//     actually have cell values — ws.rowCount / ws.columnCount are NEVER trusted because
//     whole-column formatting causes them to report 1,048,576 phantom rows.
//   • Merged-cell ranges are read from the ExcelJS internal _merges map and deduplicated.
//   • All cell values pass through normalizeCellValue() to neutralize sentinels.
//   • Layout shape, header candidates, column profiles, sub-tables, and wide-matrix
//     folding are all computed by the pure helpers in @pf/shared.
//
// Also exports CsvSourceReader for flat CSV files (no ExcelJS dependency needed).

import ExcelJS from 'exceljs'
import type {
  StructuralModel, SheetFingerprint, NormalizedCell, MergedCellRange,
  DefinitionsEntry, SubTable, WideMatrixInfo, ColumnProfile, HeaderCandidate,
} from '@pf/shared'
import {
  normalizeCellValue,
  scoreHeaderCandidates, pickBestHeaderRow,
  detectLayoutShape,
  profileColumns,
  isDefinitionsSheetName, parseDefinitionsSheet,
  segmentStackedTables,
  foldWideMatrix,
} from '@pf/shared'
import type { SourceReader, SourceFileType } from './sourceReader'

// ── ExcelJS cell flattener (mirrors readWorkbook.ts but returns unknown for normalizer) ──

function flattenExcelCell(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v          // normalizeCellValue handles dates
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) return typeof o['result'] === 'object' ? null : o['result']
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text'      in o) return String(o['text'])
    if ('error'     in o) return null
  }
  return null
}

// ── Merged-cell range extraction ───────────────────────────────────────────────

function colLetterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1   // 0-based
}

function getMergedRanges(ws: ExcelJS.Worksheet): MergedCellRange[] {
  // ExcelJS stores merged ranges in _merges as { cellAddr: rangeString, … }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (ws as unknown as Record<string, any>)['_merges'] as
    Record<string, string> | undefined
  if (!raw) return []

  const seen   = new Set<string>()
  const ranges: MergedCellRange[] = []

  for (const rangeStr of Object.values(raw)) {
    if (typeof rangeStr !== 'string' || seen.has(rangeStr)) continue
    seen.add(rangeStr)
    const m = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!m) continue
    ranges.push({
      top:    parseInt(m[2]!, 10) - 1,
      left:   colLetterToIndex(m[1]!),
      bottom: parseInt(m[4]!, 10) - 1,
      right:  colLetterToIndex(m[3]!),
    })
  }
  return ranges
}

// ── Per-sheet fingerprinting ───────────────────────────────────────────────────

function fingerprintSheet(ws: ExcelJS.Worksheet): SheetFingerprint {
  const rawRowCount = ws.rowCount
  const rawColCount = ws.columnCount

  // ── Extent scan ─────────────────────────────────────────────────────────────
  // NEVER use ws.rowCount / ws.columnCount as bounds — they report 1,048,576 on
  // sheets with whole-column formatting (Property ROC phantom-row bug).
  // eachRow({ includeEmpty: false }) only visits rows with actual cell values.
  let lastRow = 0
  let lastCol = 0

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      const v = _cell.value
      // Only count cells that have an actual value (not just style)
      if (v !== null && v !== undefined) {
        if (rowNumber > lastRow) lastRow = rowNumber
        if (colNumber > lastCol) lastCol = colNumber
      }
    })
  })

  if (lastRow === 0) {
    return {
      sheetName: ws.name,
      rawRowCount, rawColCount,
      dataRowCount: 0, dataColCount: 0,
      mergedCells: [],
      headerCandidates: [],
      bestHeaderRow: -1,
      layoutShape: 'FLAT_TABLE',
      columnProfiles: [],
      isDefinitionsSheet: false,
    }
  }

  // ── Read normalized cells (only up to the real extent) ──────────────────────
  const cells: NormalizedCell[][] = []
  for (let r = 1; r <= lastRow; r++) {
    const rowObj = ws.getRow(r)
    const arr: NormalizedCell[] = new Array(lastCol).fill(null)
    for (let c = 1; c <= lastCol; c++) {
      arr[c - 1] = normalizeCellValue(flattenExcelCell(rowObj.getCell(c).value))
    }
    cells.push(arr)
  }

  // ── Merge ranges ────────────────────────────────────────────────────────────
  const mergedCells = getMergedRanges(ws)

  // ── Header detection ────────────────────────────────────────────────────────
  const headerCandidates = scoreHeaderCandidates(cells)
  const bhr              = pickBestHeaderRow(headerCandidates)

  // ── Layout shape ────────────────────────────────────────────────────────────
  const layoutShape = detectLayoutShape(cells, bhr)

  // ── Column profiles ─────────────────────────────────────────────────────────
  const columnProfiles = profileColumns(cells, bhr)

  // ── Stacked tables ──────────────────────────────────────────────────────────
  let subTables: SubTable[] | undefined
  if (layoutShape === 'STACKED_TABLES') {
    subTables = segmentStackedTables(cells)
  }

  // ── Wide matrix ─────────────────────────────────────────────────────────────
  let wideMatrix: WideMatrixInfo | undefined
  if (layoutShape === 'WIDE_MATRIX') {
    const headerRow = bhr >= 0 ? (cells[bhr] ?? []) : []
    wideMatrix = foldWideMatrix(headerRow)
  }

  // ── Definitions sheet ───────────────────────────────────────────────────────
  const isDefinitionsSheet = isDefinitionsSheetName(ws.name)
  const definitions = isDefinitionsSheet ? parseDefinitionsSheet(cells) : undefined

  return {
    sheetName: ws.name,
    rawRowCount, rawColCount,
    dataRowCount: lastRow,
    dataColCount: lastCol,
    mergedCells,
    headerCandidates: headerCandidates.slice(0, 5) as HeaderCandidate[],
    bestHeaderRow: bhr,
    layoutShape,
    columnProfiles: columnProfiles as ColumnProfile[],
    subTables,
    wideMatrix,
    definitions,
    isDefinitionsSheet,
  }
}

// ── XlsxSourceReader ──────────────────────────────────────────────────────────

export class XlsxSourceReader implements SourceReader {
  readonly fileType: SourceFileType

  constructor(fileType: 'XLSX' | 'XLSM' = 'XLSX') {
    this.fileType = fileType
  }

  async read(bytes: Uint8Array, sourceName: string): Promise<StructuralModel> {
    const wb = new ExcelJS.Workbook()
    // ExcelJS load: pass as unknown to avoid the ArrayBuffer|SharedArrayBuffer union
    // that TypeScript infers from ArrayBuffer.slice(). In practice the bytes come from
    // readFileSync (Node Buffer) or File.arrayBuffer() (ArrayBuffer) — never SAB.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(bytes as unknown as any)

    const sheets: SheetFingerprint[] = []
    const definitionsBySheet: Record<string, DefinitionsEntry[]> = {}

    for (const ws of wb.worksheets) {
      const fp = fingerprintSheet(ws)
      sheets.push(fp)
      if (fp.definitions && fp.definitions.length > 0) {
        definitionsBySheet[fp.sheetName] = fp.definitions
      }
    }

    return {
      sourceName,
      sourceType: this.fileType as 'XLSX' | 'XLSM',
      sheets,
      definitionsBySheet,
    }
  }
}

// ── CsvSourceReader ───────────────────────────────────────────────────────────
// Parses a CSV file into a single-sheet StructuralModel without any external library.

export class CsvSourceReader implements SourceReader {
  readonly fileType: SourceFileType = 'CSV'

  async read(bytes: Uint8Array, sourceName: string): Promise<StructuralModel> {
    const text  = new TextDecoder('utf-8').decode(bytes)
    const lines = text.split(/\r?\n/)

    const cells: NormalizedCell[][] = lines
      .filter(l => l.trim().length > 0)
      .map(line => parseCsvLine(line).map(v => normalizeCellValue(v)))

    if (cells.length === 0) {
      return {
        sourceName, sourceType: 'CSV',
        sheets: [{
          sheetName: sourceName, rawRowCount: 0, rawColCount: 0,
          dataRowCount: 0, dataColCount: 0, mergedCells: [],
          headerCandidates: [], bestHeaderRow: -1, layoutShape: 'FLAT_TABLE',
          columnProfiles: [], isDefinitionsSheet: false,
        }],
        definitionsBySheet: {},
      }
    }

    const headerCandidates = scoreHeaderCandidates(cells)
    const bhr              = pickBestHeaderRow(headerCandidates)
    const layoutShape      = detectLayoutShape(cells, bhr)
    const columnProfiles   = profileColumns(cells, bhr)
    const colCount         = cells.reduce((m, r) => Math.max(m, r.length), 0)

    const sheet: SheetFingerprint = {
      sheetName: sourceName,
      rawRowCount: cells.length, rawColCount: colCount,
      dataRowCount: cells.length, dataColCount: colCount,
      mergedCells: [],
      headerCandidates: headerCandidates.slice(0, 5) as HeaderCandidate[],
      bestHeaderRow: bhr,
      layoutShape,
      columnProfiles: columnProfiles as ColumnProfile[],
      isDefinitionsSheet: isDefinitionsSheetName(sourceName),
    }

    return { sourceName, sourceType: 'CSV', sheets: [sheet], definitionsBySheet: {} }
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let inQuotes = false
  let current  = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; continue }
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      values.push(current); current = ''
    } else {
      current += ch
    }
  }
  values.push(current)
  return values
}
