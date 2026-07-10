// filing/tableParser.ts — the DETERMINISTIC factor-table parser. This is the structural heart
// of the importer's anti-fabrication guarantee: a rate manual's factor tables (a page of
// zip→territory→factor triples, a deductible matrix of Coverage-A band × deductible amount)
// are parsed from the source text by CODE, never transcribed by the model. The division of
// labour is deliberate:
//
//   • The model DISCOVERS the schema: the table's layout, its key/value columns, and the
//     boundaries of its source-text region (it reads the PDF and quotes the region verbatim).
//   • This CODE parses the rows: it tokenises the region and coerces the numbers.
//   • A sampled verification pass (sampleCells + cellValueAppearsInText) cross-checks a handful
//     of parsed cells back against the source text, so a mis-parse surfaces instead of hiding.
//
// Because the parser only ever emits numbers it literally read out of the region, the model can
// never inject a factor that isn't on the page — and lines it can't parse are COUNTED (skipped),
// never invented. Pure TypeScript; unit-tested against verbatim regions of the reference filing.
import type { ManualTableSchema } from './types'

export interface ParsedTable {
  /** Column names in row order: [...keyColumns, valueColumn]. */
  columns: string[]
  /** Parsed rows — dimension keys as strings (leading zeros preserved), value as a number. */
  rows:    Record<string, string | number>[]
  /** Lines in the region that did NOT yield a row — surfaced for transparency, never invented. */
  skipped: number
}

/** Strip currency/percent/thousands formatting and parse a numeric token. Returns null for a
 *  non-numeric token (e.g. a "-" placeholder cell), so the caller can skip it rather than guess. */
export function parseNumericToken(tok: string): number | null {
  const s = tok.replace(/[$,%\s]/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Does a token look like a number (after formatting is stripped)? */
function isNumericToken(tok: string): boolean { return parseNumericToken(tok) !== null }

/** Split a source region into non-empty logical lines. */
function lines(region: string): string[] {
  return region.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}
/** Whitespace-split a line into tokens (2+ spaces or tabs are the natural column gaps, but we
 *  fall back to single spaces so single-spaced regions still tokenise). */
function tokens(line: string): string[] {
  return line.split(/\s{2,}|\t+/).map(t => t.trim()).filter(Boolean)
    .flatMap(t => t.split(/\s+/))   // then split any remaining single-spaced groups
}

/** Split a line into COLUMN CELLS on 2+ spaces / tabs only, so a multi-word cell (a range
 *  label like "$100,000 to $199,999") stays intact and is distinguishable from single-token
 *  value cells. This is what lets the matrix parser separate a numeric-looking label from the
 *  data columns even when they are adjacent. */
function cells(line: string): string[] {
  return line.split(/\s{2,}|\t+/).map(t => t.trim()).filter(Boolean)
}

/**
 * Parse a factor table from its verbatim source region per the model-discovered schema.
 * Three layouts cover the standard manual tables:
 *
 *  • 'pairs'   — a 1-D table: <label> … <value>. Value = the last numeric token on the line;
 *                key = the tokens before it (joined), so "Architectural Shingles  0.96" works.
 *  • 'triples' — an N-key table (keyColumns) then a value: the FIRST keyColumns.length numeric
 *                tokens are the keys, the LAST numeric token is the value (zip → territory → LCMF).
 *  • 'matrix'  — a 2-D grid: a row-label dimension × a column dimension. Each data line is a
 *                row label followed by one value per `columnKeys` entry, emitted as one row per
 *                (rowLabel, columnKey) cell. Cells that are "-"/blank are skipped, not zeroed.
 */
export function parseFactorTable(schema: ManualTableSchema): ParsedTable {
  switch (schema.layout) {
    case 'pairs':   return parsePairs(schema)
    case 'triples': return parseTriples(schema)
    case 'matrix':  return parseMatrix(schema)
  }
}

function parsePairs(schema: ManualTableSchema): ParsedTable {
  const keyCol = schema.keyColumns[0] ?? 'key'
  const rows: Record<string, string | number>[] = []
  let skipped = 0
  for (const line of lines(schema.rowRegion)) {
    const toks = tokens(line)
    // Find the last numeric token — that's the value; everything before is the label.
    let vi = -1
    for (let i = toks.length - 1; i >= 0; i--) if (isNumericToken(toks[i]!)) { vi = i; break }
    if (vi <= 0) { skipped++; continue }                 // need at least one label token + a value
    const label = toks.slice(0, vi).join(' ').trim()
    const value = parseNumericToken(toks[vi]!)
    if (!label || value === null) { skipped++; continue }
    rows.push({ [keyCol]: label, [schema.valueColumn]: value })
  }
  return { columns: [keyCol, schema.valueColumn], rows, skipped }
}

function parseTriples(schema: ManualTableSchema): ParsedTable {
  const keyCols = schema.keyColumns.length ? schema.keyColumns : ['key']
  const arity = keyCols.length + 1                        // keys + one value
  const rows: Record<string, string | number>[] = []
  let skipped = 0
  for (const line of lines(schema.rowRegion)) {
    const toks = tokens(line).filter(isNumericToken)      // all-numeric row (zip/territory/factor)
    // A line can carry multiple side-by-side records (manuals print 2 columns of triples per
    // row). Consume the numeric tokens in fixed-arity groups so both records are captured.
    if (toks.length < arity) { skipped++; continue }
    let consumed = 0
    for (let i = 0; i + arity <= toks.length; i += arity) {
      const rec: Record<string, string | number> = {}
      for (let k = 0; k < keyCols.length; k++) rec[keyCols[k]!] = toks[i + k]!  // keys kept as strings
      const value = parseNumericToken(toks[i + keyCols.length]!)
      if (value === null) continue
      rec[schema.valueColumn] = value
      rows.push(rec)
      consumed++
    }
    if (consumed === 0) skipped++
  }
  return { columns: [...keyCols, schema.valueColumn], rows, skipped }
}

function parseMatrix(schema: ManualTableSchema): ParsedTable {
  const rowDim = schema.keyColumns[0] ?? 'row'
  const colDim = schema.keyColumns[1] ?? 'col'
  const colKeys = schema.columnKeys ?? []
  const nCols = colKeys.length
  const rows: Record<string, string | number>[] = []
  let skipped = 0
  for (const line of lines(schema.rowRegion)) {
    // Split on COLUMN GAPS (2+ spaces): the row label is one (possibly multi-word) cell and each
    // value is its own single-token cell. The row's values are the trailing SINGLE-TOKEN numeric
    // cells, bounded to nCols so a numeric-looking label cell ("$100,000 to $199,999") can never
    // be mistaken for a value. Only exact-width rows emit — a ragged row is SKIPPED (counted),
    // never partially / mis-aligned into invented cells.
    const cs = cells(line)
    const vals: number[] = []
    let i = cs.length - 1
    while (i >= 0 && vals.length < nCols) {
      const c = cs[i]!
      if (/\s/.test(c)) break                 // a multi-word cell is the label, not a value
      const n = parseNumericToken(c)
      if (n === null) break
      vals.unshift(n); i--
    }
    const label = cs.slice(0, i + 1).join(' ').trim()
    if (!label || vals.length !== nCols || nCols === 0) { skipped++; continue }
    colKeys.forEach((key, k) => rows.push({ [rowDim]: label, [colDim]: key, [schema.valueColumn]: vals[k]! }))
  }
  return { columns: [rowDim, colDim, schema.valueColumn], rows, skipped }
}

// ─── Sampled verification ───────────────────────────────────────────────────────────
// The reconcile / pipeline picks a handful of parsed cells and confirms their value strings
// still appear in the source region — a cheap structural check that the parse aligned to the
// real numbers. (The pipeline additionally asks the model to confirm the same sampled cells
// against the document; this pure helper is what the gate asserts.)

export interface SampledCell { coords: Record<string, string | number>; value: number }

/** Deterministically sample up to `n` parsed cells, spread across the table (first, last, and
 *  evenly-spaced interior rows) so the check isn't biased to one region of the page. */
export function sampleCells(parsed: ParsedTable, valueColumn: string, n = 5): SampledCell[] {
  const rows = parsed.rows
  if (rows.length === 0) return []
  const take = Math.min(n, rows.length)
  const idxs = take === 1 ? [0] : Array.from({ length: take }, (_, i) => Math.round((i * (rows.length - 1)) / (take - 1)))
  const seen = new Set<number>()
  const out: SampledCell[] = []
  for (const i of idxs) {
    if (seen.has(i)) continue
    seen.add(i)
    const row = rows[i]!
    const value = row[valueColumn]
    if (typeof value !== 'number') continue
    const coords: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(row)) if (k !== valueColumn) coords[k] = v
    out.push({ coords, value })
  }
  return out
}

/** Does a parsed cell's value string appear literally in the source region? Guards against a
 *  parse that drifted onto the wrong numbers. Compares the raw decimal AND a comma-grouped form
 *  so "$1,250.00" style values still match. */
export function cellValueAppearsInText(value: number, region: string): boolean {
  const plain = String(value)
  if (region.includes(plain)) return true
  const grouped = value.toLocaleString('en-US')
  return region.includes(grouped)
}
