// shared/src/import/structure/stackedSegmenter.ts — stacked sub-table segmentation.
// Splits a STACKED_TABLES sheet (e.g., "GL Rating Tables", "Limits and Deductibles")
// into named sub-tables, each carrying its own metadata block (RATE TABLE ID, TABLE NAME, …).
// Fully deterministic, LLM-free.

import type { NormalizedCell, SubTable, ColumnProfile } from './types'
import { rowMatchesStackedMarker } from './layoutDetector'
import { scoreHeaderCandidates, pickBestHeaderRow } from './headerScore'
import { profileColumns } from './columnProfiler'

// Patterns that extract a structured refId from a marker row.
const REF_ID_PATTERNS: RegExp[] = [
  /RATE\s+TABLE\s+ID\s*:\s*(RTTable\.\d+)/i,
  /LD\s*TABLE\s+ID\s*:\s*(LDTable\.\d+)/i,
  /^(RTTable\.\d+)$/i,
  /^(LDTable\.\d+)$/i,
]

const TABLE_NAME_PATTERN = /TABLE\s+NAME\s*:\s*(.+)/i
const META_KEY_VALUE_PATTERN = /^([^:]{1,60}):\s*(.*)$/

/** Extract a refId from a single row (scans first 3 columns). */
function extractRefId(row: NormalizedCell[]): string | undefined {
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c]
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    for (const p of REF_ID_PATTERNS) {
      const m = trimmed.match(p)
      if (m?.[1]) return m[1]
    }
  }
  return undefined
}

/** Extract a table name from a row. Returns undefined when not found. */
function extractTableName(row: NormalizedCell[]): string | undefined {
  for (const v of row) {
    if (typeof v !== 'string') continue
    const m = v.trim().match(TABLE_NAME_PATTERN)
    if (m?.[1]) return m[1].trim()
  }
  return undefined
}

/** Parse a sequence of rows into a key→value meta block. */
function parseMetaBlock(rows: NormalizedCell[][]): Record<string, string> {
  const meta: Record<string, string> = {}
  for (const row of rows) {
    // ① Single-cell "KEY: value" — only store when value is non-empty.
    //    "TABLE NAME:" with nothing after the colon is NOT stored here;
    //    the split-cell scan below handles "TABLE NAME:" | "Occurrence Limits".
    for (const v of row) {
      if (typeof v !== 'string') continue
      const m = v.trim().match(META_KEY_VALUE_PATTERN)
      if (m?.[1] && m[2]?.trim()) {
        meta[m[1].trim().toUpperCase()] = m[2].trim()
      }
    }
    // ② Split key/value across ANY adjacent cells: cell[c] = "KEY:", cell[c+1] = value.
    //    Handles the GL LD Tables pattern: "TABLE NAME:" | "Occurrence Limits".
    for (let c = 0; c < row.length - 1; c++) {
      const keyCell = row[c]
      if (typeof keyCell !== 'string') continue
      if (!/:\s*$/.test(keyCell.trim())) continue
      const key = keyCell.trim().replace(/:\s*$/, '').trim().toUpperCase()
      if (!key) continue
      const valCell = row[c + 1]
      if (typeof valCell === 'string' && valCell.trim()) {
        meta[key] = valCell.trim()
      } else if (typeof valCell === 'number') {
        meta[key] = String(valCell)
      }
    }
  }
  return meta
}

/** Segment a STACKED_TABLES sheet into an array of named SubTable descriptors. */
export function segmentStackedTables(cells: NormalizedCell[][]): SubTable[] {
  // ① Find all marker row indices
  const markerRows: number[] = []
  for (let r = 0; r < cells.length; r++) {
    if (rowMatchesStackedMarker(cells[r] ?? [])) markerRows.push(r)
  }
  if (markerRows.length === 0) return []

  const subTables: SubTable[] = []

  for (let i = 0; i < markerRows.length; i++) {
    const blockStart = markerRows[i]!
    // Block ends just before the next marker, or at the last row of the sheet.
    const blockEnd   = i + 1 < markerRows.length ? markerRows[i + 1]! - 1 : cells.length - 1

    // ② Walk rows to collect the meta block and find data start
    const metaRows: NormalizedCell[][] = []
    let refId = extractRefId(cells[blockStart] ?? [])
    let name: string | undefined

    // Always include the marker row itself in the meta block
    metaRows.push(cells[blockStart] ?? [])

    let dataStart = blockStart + 1  // first row after the marker
    for (let r = blockStart + 1; r <= blockEnd; r++) {
      const row = cells[r] ?? []
      const rowIsEmpty = row.every(v => v === null || v === '' || v === undefined)
      if (rowIsEmpty) continue

      // Check for additional meta-info rows (table name, more attributes)
      const tName = extractTableName(row)
      if (tName) {
        name = tName
        metaRows.push(row)
        dataStart = r + 1
        continue
      }

      // Check if this row looks like another meta key-value entry
      const firstCell = row[0]
      if (typeof firstCell === 'string' && META_KEY_VALUE_PATTERN.test(firstCell.trim())) {
        metaRows.push(row)
        dataStart = r + 1
        continue
      }

      // Otherwise, data starts here
      dataStart = r
      break
    }

    const metaBlock = parseMetaBlock(metaRows)

    // Derive name from meta if not found inline
    name = name
      ?? metaBlock['TABLE NAME']
      ?? metaBlock['RATE TABLE NAME']
      ?? metaBlock['LD TABLE NAME']

    // ③ Find the column header row within the data range via scoring
    const dataSlice  = cells.slice(dataStart, blockEnd + 1)
    const candidates = scoreHeaderCandidates(dataSlice)
    const subHdrOff  = pickBestHeaderRow(candidates)
    const subHdrRow  = subHdrOff >= 0 ? dataStart + subHdrOff : dataStart

    // ④ Collect cells from column-header row to block end
    const subCells: NormalizedCell[][] = cells.slice(subHdrRow, blockEnd + 1)
    const colProfiles: ColumnProfile[] = profileColumns(subCells, 0)

    subTables.push({
      name:            (name || undefined) ?? (refId || undefined) ?? `Table ${i + 1}`,
      refId,
      startRow:        blockStart,
      endRow:          blockEnd,
      headerRowIndex:  subHdrRow,
      cells:           subCells,
      columnProfiles:  colProfiles,
      metaBlock,
    })
  }

  return subTables
}
