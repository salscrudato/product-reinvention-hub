// shared/src/import/structure/headerScore.ts — header candidate scoring.
// Scores rows by header-likeness: text density, label distinctness, and whether
// data-shaped rows follow. Handles merged super-headers (which score low due to
// sparseness) and title rows (penalized for single long-string). Deterministic, LLM-free.

import type { NormalizedCell, HeaderCandidate } from './types'

// Only scan this many rows for header candidates; headers are always near the top.
const MAX_CANDIDATE_ROWS = 15

/** Score all candidate header rows in a 2-D normalized cell grid.
 *  Returns candidates sorted by score descending (best first). */
export function scoreHeaderCandidates(cells: NormalizedCell[][]): HeaderCandidate[] {
  if (cells.length === 0) return []

  const colCount = cells.reduce((m, r) => Math.max(m, r.length), 0)
  if (colCount === 0) return []

  const candidates: HeaderCandidate[] = []
  const limit = Math.min(MAX_CANDIDATE_ROWS, cells.length)

  for (let r = 0; r < limit; r++) {
    const row = cells[r] ?? []

    // Collect non-null, non-empty string values
    const textCells: string[] = []
    for (let c = 0; c < colCount; c++) {
      const v = row[c]
      if (typeof v === 'string' && v.trim().length > 0) textCells.push(v.trim())
    }
    if (textCells.length === 0) continue

    // Text density: what fraction of columns have a non-empty string value.
    const textDensity = textCells.length / colCount

    // Distinct ratio: how many of the text cells are unique labels.
    const distinctSet = new Set(textCells.map(t => t.toUpperCase()))
    const distinctRatio = distinctSet.size / textCells.length

    // Caps ratio: headers are usually ALL-CAPS or Title-Case short labels.
    const capsCount = textCells.filter(
      t => t === t.toUpperCase() || /^[A-Z][A-Za-z0-9\s/()#.-]+$/.test(t),
    ).length
    const capsRatio = capsCount / textCells.length

    // Title-like penalty: a single long string is likely a sheet title, not a header.
    const isTitleLike = textCells.length === 1 && (textCells[0]?.length ?? 0) > 25

    // Data below check: the next 1-3 rows have a meaningful fill rate.
    const followedByData = hasDataBelow(cells, r, colCount)

    const rawScore =
      textDensity    * 0.45 +
      distinctRatio  * 0.30 +
      capsRatio      * 0.05 +
      (followedByData ? 0.20 : 0) -
      (isTitleLike   ? 0.30 : 0)

    const score = Math.max(0, Math.min(1, rawScore))

    candidates.push({
      rowIndex: r,
      score,
      labels: textCells,
      distinctCount: distinctSet.size,
      followedByData,
    })
  }

  return candidates.sort((a, b) => b.score - a.score)
}

/** Return the 0-based row index of the best header candidate.
 *  Returns -1 when no candidate scores above 0.25 (sheet is likely empty or unstructured). */
export function pickBestHeaderRow(candidates: HeaderCandidate[]): number {
  const best = candidates[0]
  return best && best.score > 0.25 ? best.rowIndex : -1
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function hasDataBelow(cells: NormalizedCell[][], headerRow: number, colCount: number): boolean {
  const effective = Math.max(1, colCount)
  let totalFill = 0
  let checkedRows = 0

  for (let r = headerRow + 1; r < Math.min(headerRow + 4, cells.length); r++) {
    const row = cells[r] ?? []
    let filled = 0
    for (let c = 0; c < effective; c++) {
      const v = row[c]
      if (v !== null && v !== undefined && v !== '') filled++
    }
    totalFill += filled / effective
    checkedRows++
  }

  return checkedRows > 0 && totalFill / checkedRows >= 0.25
}
