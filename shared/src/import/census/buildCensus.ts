// shared/src/import/census/buildCensus.ts — RawCensusSheet -> SheetCensus.
//
// Records EVERY substantive cell with a stable identity (ref, type, verbatim,
// fnv1a64 value hash, merge membership, formatting, sheet visibility). Hidden
// sheets are censused FULLY with hidden:true — census is observation; extraction
// policy stays elsewhere (CE3 owns any policy flip). Pure and deterministic.

import { normalizeCellValue } from '../structure/sentinels'
import type { NormalizedCell } from '../structure/types'
import { scoreHeaderCandidates, pickBestHeaderRow } from '../structure/headerScore'
import { fnv1a64 } from './hash'
import { segmentTableRegions } from './regions'
import type { CellRecord, CensusCellType, RawCensusCell, RawCensusSheet, SheetCensus, WorkbookCensus } from './types'

export const VERBATIM_CAP = 512

// Ceiling on the DENSE scratch grids (occupied / normalized) a single sheet may materialize.
// 2M entries x 2 grids is a few tens of MB worst case; beyond that a sparse sheet with a far-
// flung stray cell would spike RSS on the host. Never bounds `cells`, which is sparse.
export const DENSE_CELL_CEILING = 2_000_000
export const DENSE_MAX_COLS = 1024

/** 0-based column index -> spreadsheet letters (0 -> A, 26 -> AA). */
export function colLabel(col: number): string {
  let n = col + 1, out = ''
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26) }
  return out
}

export function cellRef(sheet: string, row: number, col: number): string {
  return `${sheet}!${colLabel(col)}${row + 1}`
}

// ── Raw value classification / verbatim ───────────────────────────────────────

function isFormulaShape(v: unknown): v is { formula?: unknown; sharedFormula?: unknown; result?: unknown } {
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v)
}

/** The raw, untrimmed string form of a cell value. Formula cells contribute
 *  their CACHED RESULT (same contract as the reader); rich text is concatenated;
 *  errors surface their error token — never silently ''. */
export function rawVerbatim(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (isFormulaShape(v)) return rawVerbatim(o['result'])
    if (Array.isArray(o['richText'])) return (o['richText'] as Array<{ text?: string }>).map(t => t.text ?? '').join('')
    if ('error' in o) return String(o['error'] ?? '')
    if ('text' in o && o['text'] !== undefined) return rawVerbatim(o['text'])
    if ('hyperlink' in o) return String(o['hyperlink'] ?? '')
  }
  return String(v)
}

export function classifyCellType(v: unknown): CensusCellType {
  if (isFormulaShape(v)) return 'formula'
  if (v instanceof Date) return 'date'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'bool'
  return 'string'
}

// ── Census build ──────────────────────────────────────────────────────────────

interface MergeInfo { anchorRow: number; anchorCol: number; span: [number, number] }

function mergeMap(raw: RawCensusSheet): Map<string, MergeInfo> {
  const m = new Map<string, MergeInfo>()
  for (const r of raw.merges ?? []) {
    const span: [number, number] = [r.bottom - r.top + 1, r.right - r.left + 1]
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        m.set(`${row}:${col}`, { anchorRow: r.top, anchorCol: r.left, span })
      }
    }
  }
  return m
}

export function buildSheetCensus(raw: RawCensusSheet): SheetCensus {
  const merges = mergeMap(raw)

  // True extent: trailing all-empty rows/cols trimmed on RAW verbatim.
  let lastRow = -1, lastCol = -1
  const verbatims: (string | null)[][] = raw.cells.map(row =>
    (row ?? []).map(c => {
      if (!c) return null
      const s = rawVerbatim(c.v)
      return s === '' ? null : s
    }))
  for (let r = 0; r < verbatims.length; r++) {
    const row = verbatims[r]!
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== null) { if (r > lastRow) lastRow = r; if (c > lastCol) lastCol = c }
    }
  }

  const rows = lastRow + 1
  const cols = lastCol + 1

  // One stray value far from the data (a leftover at BZ20000) makes the TRUE extent enormous,
  // and the two scratch grids below are allocated rows x cols — tens of millions of entries for
  // a sheet holding a few hundred values. Bound them: `cells` is sparse and stays COMPLETE, so
  // no observation is lost; only header scoring and region segmentation are windowed, and the
  // clamp is reported so a bounded sheet never reads as a fully-segmented one.
  const denseRows = rows * cols > DENSE_CELL_CEILING ? Math.max(1, Math.min(rows, Math.floor(DENSE_CELL_CEILING / Math.min(cols, DENSE_MAX_COLS)))) : rows
  const denseCols = rows * cols > DENSE_CELL_CEILING ? Math.min(cols, DENSE_MAX_COLS) : cols
  const denseClamped = denseRows !== rows || denseCols !== cols
    ? { rows: denseRows, cols: denseCols, reason: `sheet extent ${rows}x${cols} (${rows * cols} cells) exceeds the ${DENSE_CELL_CEILING}-cell dense ceiling; header scoring and region segmentation ran over the top-left ${denseRows}x${denseCols} window. All non-empty cells are still recorded.` }
    : undefined

  const cells: CellRecord[] = []
  const occupied: boolean[][] = []
  const normalized: NormalizedCell[][] = []

  for (let r = 0; r < rows; r++) {
    const inDenseRow = r < denseRows
    const occRow: boolean[] = new Array(inDenseRow ? denseCols : 0).fill(false)
    const normRow: NormalizedCell[] = new Array(inDenseRow ? denseCols : 0).fill(null)
    for (let c = 0; c < cols; c++) {
      const rawCell: RawCensusCell | null = raw.cells[r]?.[c] ?? null
      const verbatim = verbatims[r]?.[c] ?? null
      const inDenseCell = inDenseRow && c < denseCols
      if (rawCell && inDenseCell) normRow[c] = normalizeCellValue(rawCell.v)
      if (verbatim === null || rawCell === null) continue
      if (inDenseCell) occRow[c] = true
      const merge = merges.get(`${r}:${c}`)
      cells.push({
        ref: cellRef(raw.name, r, c),
        sheet: raw.name,
        row: r,
        col: c,
        type: classifyCellType(rawCell.v),
        valueHash: fnv1a64(verbatim),
        verbatim: verbatim.length > VERBATIM_CAP ? verbatim.slice(0, VERBATIM_CAP) : verbatim,
        verbatimTruncated: verbatim.length > VERBATIM_CAP,
        merged: merge
          ? { anchor: cellRef(raw.name, merge.anchorRow, merge.anchorCol), span: merge.span }
          : null,
        format: {
          bold: rawCell.bold === true,
          filled: rawCell.filled === true,
          indent: typeof rawCell.indent === 'number' ? rawCell.indent : 0,
          topBorder: rawCell.topBorder === true,
        },
        hidden: raw.hidden,
      })
    }
    if (inDenseRow) { occupied.push(occRow); normalized.push(normRow) }
  }

  // Fingerprint: best header row's squished labels + a deterministic value sample.
  const candidates = scoreHeaderCandidates(normalized)
  const best = pickBestHeaderRow(candidates)
  const headerSig = best >= 0
    ? fnv1a64((candidates.find(c => c.rowIndex === best)?.labels ?? [])
        .map(l => l.toUpperCase().replace(/[^A-Z0-9]/g, '')).join('|'))
    : ''
  const step = Math.max(1, Math.floor(cells.length / 64))
  const sampled: string[] = [`${rows}x${cols}`]
  for (let i = 0; i < cells.length; i += step) sampled.push(cells[i]!.valueHash)
  const sampleHash = fnv1a64(sampled.join('|'))

  return {
    name: raw.name,
    hidden: raw.hidden,
    dims: { rows, cols },
    nonEmpty: cells.length,
    fingerprint: { headerSig, sampleHash },
    tables: segmentTableRegions(occupied, normalized),
    cells,
    ...(denseClamped ? { denseClamped } : {}),
  }
}

export function buildWorkbookCensus(sheets: RawCensusSheet[], sourceName: string): WorkbookCensus {
  return { sourceName, sheets: sheets.map(buildSheetCensus) }
}
