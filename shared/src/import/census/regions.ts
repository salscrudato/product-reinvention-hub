// shared/src/import/census/regions.ts — gap segmentation into TableRegions.
//
// A sheet is rarely one table. Real corpus sheets stack independent blocks
// vertically (SECURA "Ref Connect Pull" stacks regions across blank runs up to
// 16 rows). Segmentation is DETERMINISTIC and layout-only:
//   * a new region starts after a blank-row run of >= 2 (single blank rows are
//     common INSIDE tables — group separators — and do not split), OR
//   * when a row's occupied column band is DISJOINT from the running region's
//     band (a column-band shift: a new block that shares no columns).
// Occupancy is judged on RAW non-emptiness (conservation view), never on
// normalized values — a row of "N/A  N/A  N/A" is substance to account, not a gap.
// Header discovery per region reuses the EXISTING stage-2 scorer (headerScore.ts)
// — this module feeds it, never replaces it.

import type { NormalizedCell } from '../structure/types'
import { scoreHeaderCandidates, pickBestHeaderRow } from '../structure/headerScore'
import type { TableRegion } from './types'

/** Occupied column band per row: [minCol, maxCol], or null for a blank row. */
export function rowBands(occupied: boolean[][]): Array<readonly [number, number] | null> {
  return occupied.map(row => {
    let min = -1, max = -1
    for (let c = 0; c < row.length; c++) {
      if (row[c]) { if (min < 0) min = c; max = c }
    }
    return min < 0 ? null : ([min, max] as const)
  })
}

const BLANK_RUN_SPLIT = 2

/**
 * Segment a sheet into table regions.
 * @param occupied  row-major raw-occupancy grid (true = cell holds substance)
 * @param normalized  the sentinel-normalized grid, ONLY for header scoring
 */
export function segmentTableRegions(occupied: boolean[][], normalized: NormalizedCell[][]): TableRegion[] {
  const bands = rowBands(occupied)
  const regions: TableRegion[] = []

  let start = -1, end = -1, colMin = 0, colMax = 0, gapRun = 0

  const close = () => {
    if (start < 0) return
    regions.push(finishRegion(start, end, colMin, colMax, normalized))
    start = -1
  }

  for (let r = 0; r < bands.length; r++) {
    const band = bands[r]
    if (band === null) {
      if (start >= 0) gapRun++
      continue
    }
    if (start < 0) {
      start = r; end = r; colMin = band[0]; colMax = band[1]; gapRun = 0
      continue
    }
    const bandDisjoint = band[1] < colMin || band[0] > colMax
    if (gapRun >= BLANK_RUN_SPLIT || bandDisjoint) {
      close()
      start = r; end = r; colMin = band[0]; colMax = band[1]; gapRun = 0
      continue
    }
    end = r
    gapRun = 0
    if (band[0] < colMin) colMin = band[0]
    if (band[1] > colMax) colMax = band[1]
  }
  close()
  return regions
}

function finishRegion(rowStart: number, rowEnd: number, colStart: number, colEnd: number, normalized: NormalizedCell[][]): TableRegion {
  // Score headers on the region's own window (its rows, its columns) so a
  // stacked block's header competes only against its own rows.
  const slice: NormalizedCell[][] = []
  for (let r = rowStart; r <= rowEnd; r++) {
    const row = normalized[r] ?? []
    slice.push(row.slice(colStart, colEnd + 1))
  }
  const candidates = scoreHeaderCandidates(slice)
  const best = pickBestHeaderRow(candidates)
  const headerRow = best >= 0 ? rowStart + best : null
  const headerConfidence = best >= 0 ? (candidates.find(c => c.rowIndex === best)?.score ?? 0) : 0
  return { rowStart, rowEnd, colStart, colEnd, headerRow, headerConfidence }
}
