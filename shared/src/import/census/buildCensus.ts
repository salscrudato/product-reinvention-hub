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
  const cells: CellRecord[] = []
  const occupied: boolean[][] = []
  const normalized: NormalizedCell[][] = []

  for (let r = 0; r < rows; r++) {
    const occRow: boolean[] = new Array(cols).fill(false)
    const normRow: NormalizedCell[] = new Array(cols).fill(null)
    for (let c = 0; c < cols; c++) {
      const rawCell: RawCensusCell | null = raw.cells[r]?.[c] ?? null
      const verbatim = verbatims[r]?.[c] ?? null
      if (rawCell) normRow[c] = normalizeCellValue(rawCell.v)
      if (verbatim === null || rawCell === null) continue
      occRow[c] = true
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
    occupied.push(occRow)
    normalized.push(normRow)
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
  }
}

export function buildWorkbookCensus(sheets: RawCensusSheet[], sourceName: string): WorkbookCensus {
  return { sourceName, sheets: sheets.map(buildSheetCensus) }
}
