// shared/src/import/structure/columnProfiler.ts — per-column value profiling.
// Profiles each column from the data rows (rows below the header) with type mix,
// a distinct sample, and derived flags (enum-like, date-pattern, dollar-pattern).
// Fully deterministic, LLM-free.

import type { NormalizedCell, ColumnProfile, CellType } from './types'

// ISO dates, MM/DD/YYYY, MM YY (form edition format used in ISO workbooks)
const DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{2}\s+\d{2}$|^\d{1,2}-\d{1,2}-\d{2,4}$/

// Dollar amounts or large round numbers (rate tables)
const DOLLAR_PATTERN = /^\$[\d,]+(\.\d{0,2})?$|^[\d]{1,3}(,\d{3})+$/

const MAX_DISTINCT_SAMPLE = 20
const ENUM_MAX_DISTINCT   = 20
const ENUM_RATIO_CAP      = 0.35   // distinct / nonEmpty ≤ 35 % → enum-like

/** Profile all columns of a normalized cell grid.
 *  @param cells    Full normalized cell grid (all rows including header).
 *  @param bestHeaderRow  0-based row index of the header row; -1 if none.
 *  @returns One ColumnProfile per column, indexed by colIndex. */
export function profileColumns(
  cells: NormalizedCell[][],
  bestHeaderRow: number,
): ColumnProfile[] {
  if (cells.length === 0) return []

  const headerRow  = bestHeaderRow >= 0 ? (cells[bestHeaderRow] ?? []) : []
  const dataStart  = bestHeaderRow >= 0 ? bestHeaderRow + 1 : 0
  const dataRows   = cells.slice(dataStart)
  if (dataRows.length === 0) return []

  const colCount   = cells.reduce((m, r) => Math.max(m, r.length), 0)
  const profiles: ColumnProfile[] = []

  for (let c = 0; c < colCount; c++) {
    const headerLabel = typeof headerRow[c] === 'string'
      ? (headerRow[c] as string).trim() || null
      : null

    const typeMix: Record<CellType, number> = {
      text: 0, number: 0, date: 0, boolean: 0, empty: 0, sentinel: 0,
    }
    const distinctSet = new Set<unknown>()
    const sample: unknown[] = []
    let totalDataCells = 0

    for (const row of dataRows) {
      const v = row[c]
      totalDataCells++

      if (v === null || v === undefined || v === '') {
        typeMix.empty++
        continue
      }
      if (v === 'NO_EXPIRY') {
        typeMix.sentinel++
        continue
      }

      if (typeof v === 'boolean') {
        typeMix.boolean++
      } else if (typeof v === 'number') {
        typeMix.number++
      } else if (typeof v === 'string') {
        if (DATE_PATTERN.test(v)) typeMix.date++
        else typeMix.text++
      }

      if (!distinctSet.has(v)) {
        distinctSet.add(v)
        if (sample.length < MAX_DISTINCT_SAMPLE) sample.push(v)
      }
    }

    const nonEmpty = totalDataCells - typeMix.empty
    // Small vocabulary (≤ 5 distinct) is always enum-like regardless of ratio —
    // the ratio cap only matters for larger sets to exclude free-text columns.
    const isEnumLike =
      distinctSet.size <= ENUM_MAX_DISTINCT &&
      nonEmpty > 0 &&
      (distinctSet.size <= 5 || distinctSet.size / nonEmpty <= ENUM_RATIO_CAP)

    const hasDatePattern = typeMix.date > 0 ||
      sample.some(v => typeof v === 'string' && DATE_PATTERN.test(v))

    const hasDollarPattern =
      sample.some(v => typeof v === 'string' && DOLLAR_PATTERN.test(v)) ||
      (typeMix.number > 0 && sample.some(v => typeof v === 'number' && v >= 100 && v % 1 === 0))

    profiles.push({
      colIndex: c,
      headerLabel,
      typeMix,
      totalDataCells,
      distinctSample: sample,
      isEnumLike,
      hasDatePattern,
      hasDollarPattern,
    })
  }

  return profiles
}
