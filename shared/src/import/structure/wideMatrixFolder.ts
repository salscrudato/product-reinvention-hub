// shared/src/import/structure/wideMatrixFolder.ts — wide-matrix state-column folding.
// Records which header columns are US state codes and which is the "ALL STATES" column,
// so the structural model can describe per-state applicability without duplicating the
// full grid. Fully deterministic, LLM-free.

import type { NormalizedCell, WideMatrixInfo } from './types'
import { US_STATE_CODES, ALL_STATES_LABELS } from './layoutDetector'

/** Fold per-state columns in the header row into a WideMatrixInfo descriptor.
 *  @param headerRow  The normalized header row of a WIDE_MATRIX sheet. */
export function foldWideMatrix(headerRow: NormalizedCell[]): WideMatrixInfo {
  let allStatesColIndex: number | null = null
  const stateColIndices: Record<string, number> = {}
  let nonStateColCount = 0

  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (typeof v !== 'string') { nonStateColCount++; continue }
    const upper = v.trim().toUpperCase()
    if (ALL_STATES_LABELS.has(upper)) {
      allStatesColIndex = c
    } else if (US_STATE_CODES.has(upper)) {
      stateColIndices[upper] = c
    } else if (v.trim().length > 0) {
      nonStateColCount++
    }
  }

  return { allStatesColIndex, stateColIndices, nonStateColCount }
}
