/**
 * scripts/lib/cell-enum.mts — CE2's OWN lightweight ExcelJS cell enumerator.
 *
 * Deliberately independent of CE1's census module (built in parallel): the shared
 * contract is the golden2 schema + the EnumSheet shape below, NOT a code import. If
 * CE1's census and this enumerator ever disagree on nonEmpty for a sheet, eval2's
 * reconcileCensus() (import-eval2-metrics) flags it — see hostile self-review Q4.
 *
 * Responsibilities:
 *   1. read-only enumeration of non-empty cells, merge-anchored, hidden sheets INCLUDED
 *   2. window builder: <=40 rows x <=40 cols, 2-row overlap, header carried into each window
 *   3. compact sheet digest (dims, header candidates by type-shift, sample rows)
 *   4. deterministic sheet disposition (noise/schema/log sheets) — no model needed
 *   5. distinct refId / form-token LOWER BOUNDS — the counting-invariant floor (no model)
 *
 * The pure functions (2-5) operate on the in-memory EnumSheet so vitest can lock them
 * without a binary fixture; readWorkbookCells (1) is exercised against a tiny authored
 * .xlsx fixture for merge-anchoring + hidden-inclusion.
 */
import { createRequire } from 'module'
import { rcToRef } from './golden2-schema.mts'
import type { Disposition, NoiseRule } from './golden2-schema.mts'

// ExcelJS is CJS; resolve it relative to this module so the script runs from any cwd.
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require('exceljs') as typeof import('exceljs')

export type EnumScalar = string | number | boolean | null

export interface EnumCell {
  ref: string           // "A1"
  row: number           // 0-based
  col: number           // 0-based
  value: EnumScalar     // flattened; never '' (empty cells are dropped)
  mergeRange: string | null  // "A1:B2" when this cell is a merge ANCHOR, else null
}

export interface EnumSheet {
  name: string
  hidden: boolean
  maxRow: number        // 0-based index of last non-empty row (−1 if empty)
  maxCol: number        // 0-based index of last non-empty col (−1 if empty)
  cells: EnumCell[]     // non-empty, merge-anchored, in row-major order
}

export interface EnumWorkbook {
  file: string
  sheets: EnumSheet[]
}

// ─── (1) read-only enumeration ────────────────────────────────────────────────

function flatten(v: unknown): EnumScalar {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as EnumScalar) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

/** A flattened value is "non-empty" iff it is not null and not a whitespace-only string. */
export function isNonEmpty(v: EnumScalar): boolean {
  if (v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  return true
}

const ROW_CAP = 200_000

export async function readWorkbookCells(filePath: string): Promise<EnumWorkbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheets: EnumSheet[] = []
  wb.eachSheet((ws) => {
    // Merge map: the anchor (top-left) of each range keeps the value; the covered
    // cells are skipped so a merged label is counted exactly once.
    const merges = ((ws.model?.merges as string[] | undefined) ?? [])
    const anchorRange = new Map<string, string>()   // "r,c" -> "A1:B2"
    const covered = new Set<string>()               // "r,c" of non-anchor merged cells
    for (const range of merges) {
      const [a, b] = range.split(':')
      const ra = a1ToRC(a!); const rb = a1ToRC(b!)
      if (!ra || !rb) continue
      anchorRange.set(`${ra.row},${ra.col}`, range)
      for (let r = ra.row; r <= rb.row; r++) {
        for (let c = ra.col; c <= rb.col; c++) {
          if (r === ra.row && c === ra.col) continue
          covered.add(`${r},${c}`)
        }
      }
    }
    const cells: EnumCell[] = []
    let maxRow = -1, maxCol = -1
    // SPARSE iteration (only populated cells) — dense getRow/getCell over inflated dims is
    // O(rowCount*columnCount) and hangs on the 129k-cell masters. eachCell visits data only.
    ws.eachRow({ includeEmpty: false }, (rowObj, rn) => {
      if (rn > ROW_CAP) return
      rowObj.eachCell({ includeEmpty: false }, (excelCell, cn) => {
        const r = rn - 1, c = cn - 1
        const key = `${r},${c}`
        if (covered.has(key)) return                     // non-anchor merged cell: skip
        const val = flatten(excelCell.value)
        if (!isNonEmpty(val)) return
        cells.push({ ref: rcToRef(r, c), row: r, col: c, value: val, mergeRange: anchorRange.get(key) ?? null })
        if (r > maxRow) maxRow = r
        if (c > maxCol) maxCol = c
      })
    })
    // Merge anchors can sit on a row/col beyond any populated data cell — extend bounds so
    // windows include them.
    for (const [key] of anchorRange) { const [r, c] = key.split(',').map(Number); if (r! > maxRow) maxRow = r!; if (c! > maxCol) maxCol = c! }
    cells.sort((a, b) => a.row - b.row || a.col - b.col)
    sheets.push({ name: ws.name, hidden: (ws.state ?? 'visible') !== 'visible', maxRow, maxCol, cells })
  })
  return { file: filePath, sheets }
}

function a1ToRC(a1: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(a1.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

// ─── (2) window builder ───────────────────────────────────────────────────────

export interface CellWindow {
  sheet: string
  hidden: boolean
  index: number
  total: number
  rowStart: number; rowEnd: number   // 0-based inclusive
  colStart: number; colEnd: number
  cells: EnumCell[]                   // non-empty cells within [rowStart..rowEnd] x [colStart..colEnd]
  headerRefs: EnumCell[]             // detected header row cells within the col band (carried in)
}

export interface WindowOpts { maxRows?: number; maxCols?: number; rowOverlap?: number }

/** Build <=maxRows x <=maxCols windows with a rowOverlap-row vertical overlap. Column
 *  bands are non-overlapping (the spec's overlap is 2-ROW). Empty windows are dropped.
 *  The detected header row is carried into every window in the same column band. */
export function buildWindows(sheet: EnumSheet, opts: WindowOpts = {}): CellWindow[] {
  const maxRows = opts.maxRows ?? 40
  const maxCols = opts.maxCols ?? 40
  const rowOverlap = opts.rowOverlap ?? 2
  if (sheet.maxRow < 0 || sheet.maxCol < 0) return []
  const step = Math.max(1, maxRows - rowOverlap)
  const byRC = sheet.cells
  const digest = sheetDigest(sheet)
  const headerRow = digest.headerRow

  const windows: CellWindow[] = []
  for (let cs = 0; cs <= sheet.maxCol; cs += maxCols) {
    const ce = Math.min(cs + maxCols - 1, sheet.maxCol)
    const headerRefs = headerRow == null ? [] : byRC.filter(c => c.row === headerRow && c.col >= cs && c.col <= ce)
    for (let rs = 0; rs <= sheet.maxRow; rs += step) {
      const re = Math.min(rs + maxRows - 1, sheet.maxRow)
      const cells = byRC.filter(c => c.row >= rs && c.row <= re && c.col >= cs && c.col <= ce)
      if (cells.length === 0) continue
      windows.push({
        sheet: sheet.name, hidden: sheet.hidden, index: 0, total: 0,
        rowStart: rs, rowEnd: re, colStart: cs, colEnd: ce, cells,
        headerRefs: headerRefs.filter(h => h.row < rs || h.row > re), // don't duplicate if header is inside
      })
      if (re >= sheet.maxRow) break
    }
  }
  windows.forEach((w, i) => { w.index = i; w.total = windows.length })
  return windows
}

// ─── (3) sheet digest ─────────────────────────────────────────────────────────

export interface SheetDigest {
  name: string
  hidden: boolean
  maxRow: number
  maxCol: number
  nonEmpty: number
  headerRow: number | null
  headerCandidates: { row: number; strings: number; total: number }[]
  sampleRows: { row: number; values: (EnumScalar)[] }[]
}

function isStringish(v: EnumScalar): boolean {
  if (typeof v === 'string') return !/^-?[\d.,$%\s]+$/.test(v.trim())  // a pure-number string is not "stringish"
  return false
}

/** Header row by simple type-shift: the last mostly-string row (in the first 30) that
 *  is immediately followed by a row with a materially higher non-string fraction. */
export function sheetDigest(sheet: EnumSheet): SheetDigest {
  const nonEmpty = sheet.cells.length
  const rows = new Map<number, EnumCell[]>()
  for (const c of sheet.cells) { const l = rows.get(c.row) ?? []; l.push(c); rows.set(c.row, l) }
  const scan = Math.min(sheet.maxRow, 30)
  const cand: SheetDigest['headerCandidates'] = []
  for (let r = 0; r <= scan; r++) {
    const rc = rows.get(r) ?? []
    if (rc.length === 0) continue
    const strings = rc.filter(c => isStringish(c.value)).length
    cand.push({ row: r, strings, total: rc.length })
  }
  // Pick the header: a mostly-string row (>=2 cells, frac >= 0.6) that is IMMEDIATELY
  // FOLLOWED by a row with a lower string-fraction (the data begins). A header must have
  // data under it, so a trailing row can never be the header. Fall back to the first
  // populated row when no downward type-shift exists (e.g. an all-text sheet).
  let headerRow: number | null = null
  let best = 0
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i]!
    if (c.total < 2) continue
    const frac = c.strings / c.total
    if (frac < 0.6) continue
    const next = cand[i + 1]
    if (!next) continue                          // no data row beneath -> not a header
    const shift = frac - next.strings / next.total
    if (shift <= 0) continue                      // no downward type shift -> not a boundary
    const score = shift + frac * 0.01
    if (score > best) { best = score; headerRow = c.row }
  }
  if (headerRow == null && cand.length) headerRow = cand[0]!.row
  // Sample a few data rows just after the header.
  const sampleRows: SheetDigest['sampleRows'] = []
  const start = (headerRow ?? -1) + 1
  const dataRows = [...rows.keys()].filter(r => r >= start).sort((a, b) => a - b).slice(0, 4)
  for (const r of dataRows) {
    const rc = (rows.get(r) ?? []).sort((a, b) => a.col - b.col)
    sampleRows.push({ row: r, values: rc.slice(0, 12).map(c => c.value) })
  }
  return { name: sheet.name, hidden: sheet.hidden, maxRow: sheet.maxRow, maxCol: sheet.maxCol, nonEmpty, headerRow, headerCandidates: cand, sampleRows }
}

// ─── (4) deterministic sheet disposition ──────────────────────────────────────

export interface SheetClass { disposition: Disposition; noiseRule: NoiseRule | null; reason: string }

/** Classify a sheet by NAME alone into a deterministic disposition, or null if it is a
 *  SUBSTANCE sheet that needs cell-level annotation. Definitions / Data Validation are
 *  SCHEMA (never NOISE) per the contract. Logs are LOG (a disposition), not NOISE. */
export function classifySheet(name: string): SheetClass | null {
  const n = name.trim().toLowerCase()
  if (/(^|\b)(table of contents|toc)(\b|$)/.test(n)) return { disposition: 'NOISE', noiseRule: 'NOISE.TOC', reason: 'table of contents' }
  if (/(revision|version)\s*history/.test(n)) return { disposition: 'LOG', noiseRule: null, reason: 'revision/version history' }
  if (/(observation|question).*log|log.*(observation|question)|question\s*&\s*observation/.test(n)) return { disposition: 'LOG', noiseRule: null, reason: 'observation/question log' }
  if (/product\s*contacts?|contacts?$/.test(n)) return { disposition: 'NOISE', noiseRule: 'NOISE.CONTACTS', reason: 'contacts' }
  if (/^definitions|definitions$|definitions-/.test(n)) return { disposition: 'SCHEMA', noiseRule: null, reason: 'definitions (schema)' }
  if (/data\s*validation/.test(n)) return { disposition: 'SCHEMA', noiseRule: null, reason: 'data validation (schema)' }
  if (/dropdown|\(hide\)/.test(n)) return { disposition: 'NOISE', noiseRule: 'NOISE.DROPDOWN_SRC', reason: 'dropdown source' }
  if (/archive|\bold\b|- archive/.test(n)) return { disposition: 'NOISE', noiseRule: 'NOISE.ARCHIVE_SHEET', reason: 'archive/old copy' }
  return null
}

// ─── (5) distinct refId / form-token LOWER BOUNDS (the counting-invariant floor) ──

// A "real" platform refId: carrier.token.digits (GL.COV.001, PH.PROD.001) OR token.digits
// (LDTable.122, RTTable.7). The leading token runs up to 12 letters so multi-word type
// prefixes (LDTable, RTTable) match. Conservative on purpose — a LOWER bound must not overcount.
const REFID_RE = /\b[A-Za-z]{2,12}(?:[.\-_][A-Za-z]{1,8})?[.\-_]\d{1,6}\b/g
// ISO-style form numbers: "CG 00 01", "CP1030", "HO 00 03 04 91", "IL 09 35". 2-4 letters
// then >=2 two-digit groups (optionally space/hyphen separated).
const FORM_RE = /\b[A-Z]{2,4}[ \-]?\d{2}(?:[ \-]?\d{2}){1,4}\b/g

export function distinctRefIds(sheet: EnumSheet): Set<string> {
  const out = new Set<string>()
  for (const c of sheet.cells) {
    if (typeof c.value !== 'string' && typeof c.value !== 'number') continue
    const s = String(c.value)
    const m = s.match(REFID_RE)
    if (m) for (const x of m) out.add(x)
  }
  return out
}

export function distinctFormTokens(sheet: EnumSheet): Set<string> {
  const out = new Set<string>()
  for (const c of sheet.cells) {
    if (typeof c.value !== 'string') continue
    const m = c.value.match(FORM_RE)
    if (m) for (const x of m) out.add(x.replace(/[ \-]+/g, ' ').trim())
  }
  return out
}

/** Union distinct refIds/forms across all sheets of a workbook (the file-level floor). */
export function distinctTotals(wb: EnumWorkbook): { refIds: Set<string>; forms: Set<string> } {
  const refIds = new Set<string>(); const forms = new Set<string>()
  for (const sh of wb.sheets) {
    for (const x of distinctRefIds(sh)) refIds.add(x)
    for (const x of distinctFormTokens(sh)) forms.add(x)
  }
  return { refIds, forms }
}
