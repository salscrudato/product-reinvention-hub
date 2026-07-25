// rtGrid.ts — pure helpers for the Excel-like multi-dimension RT grid. Derives a grid
// model (1..3 dimensions × one value column) from an RTTable, serialises a grid model
// back to an RTTable, and provides the generic N-dimensional lookup the line getters use
// for grid-managed tables. Purely ADDITIVE: legacy/seeded tables carry no `dimensions`,
// so genericRtLookup returns null and the bespoke getter runs unchanged — the $1,528
// canary is untouched. Zero platform imports (runs in browser, Functions and Vitest).
import type { RTTable, RTTableDimension } from '../types'

// Column names that denote the looked-up VALUE (factor/rate/charge/…) rather than a
// lookup key. A table is grid-editable iff exactly one column matches — that keeps
// range tables (pcMin/pcMax) and multi-value tables out of the grid model.
const VALUE_COLUMN_NAMES = [
  'factor', 'rate', 'charge', 'value', 'flatpremium', 'rateperhundred',
  'premium', 'amount', 'ilf', 'lcm', 'minimumpremium',
]

// Real-world value headers carry units and punctuation the exact list above cannot enumerate
// ("Rate per $100", "Loss Cost", "Rate/1000", "Base Premium"). Matching only exact names left
// those grid-shaped tables non-editable with no UI path to fix them. Squishing to alphanumerics
// then testing a small set of value-noun patterns keeps the match conservative — a KEY column
// ("Territory", "Class Code", "covMin") matches none of these.
const VALUE_COLUMN_PATTERNS = [
  // rate | baseRate | Rate per $100 | Rate/1000 | rate per hundred
  /^(base)?rate((per)?\$?\d+|per[a-z]+)?$/,
  /^losscost(multiplier)?$/,
  /^(base|flat|min(imum)?|max(imum)?)?premium$/,
  /^(rating|rate|dev|mod)?factor$/,
  /^(ilf|lcm|elf)$/,
]

/** Squish a column name for matching: lowercase, drop everything but letters and digits.
 *  "Rate per $100" → "rateper100"; "Loss Cost" → "losscost". */
function squishColumn(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** True when a column name denotes the looked-up VALUE rather than a lookup key. */
function isValueColumnName(c: string): boolean {
  const s = squishColumn(c)
  return VALUE_COLUMN_NAMES.includes(s) || VALUE_COLUMN_PATTERNS.some(re => re.test(s))
}

/** The value column of a table: explicit `valueColumn`, else the single column whose
 *  name denotes a value. Returns null when zero or many match (not grid-editable). */
export function inferValueColumn(t: RTTable): string | null {
  if (t.valueColumn && t.columns.includes(t.valueColumn)) return t.valueColumn
  const matches = t.columns.filter(isValueColumnName)
  return matches.length === 1 ? matches[0]! : null
}

// Interval/band columns: a table keyed by [covMin, covMax] describes RANGES, and a risk is
// priced by the band that CONTAINS its value — not by an exact coordinate match. Forcing it
// into the exact-match grid model makes every in-band risk unresolvable while the worked
// example still happens to land on a boundary row, so the UI reports the table as priceable.
// Detected structurally (a min/from column paired with a matching max/to column), so it fires
// on covMin/covMax, pcMin/pcMax, ageFrom/ageTo alike.
const BAND_LOW  = /^(.*?)(min|from|low(er)?|start|ge|gt)$/
const BAND_HIGH = /^(.*?)(max|to|high(er)?|end|le|lt)$/

/** The band column pairs in a set of key columns, as [lowColumn, highColumn] tuples. */
export function detectBandPairs(columns: readonly string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (const lo of columns) {
    const ml = BAND_LOW.exec(squishColumn(lo))
    if (!ml) continue
    const stem = ml[1]!
    for (const hi of columns) {
      if (hi === lo) continue
      const mh = BAND_HIGH.exec(squishColumn(hi))
      // Same stem ("cov" from covMin/covMax); a bare min/max pair (empty stem) counts too.
      if (mh && mh[1] === stem) { pairs.push([lo, hi]); break }
    }
  }
  return pairs
}

export interface GridDimension {
  key:     string
  label:   string
  values:  string[]   // display strings, in order
  numeric: boolean     // whether the underlying column stores numbers (coerce on save)
}

export interface GridModel {
  valueColumn: string
  dimensions:  GridDimension[]        // 1..3
  cells:       Record<string, number> // key = joinKey(coords); a missing key = empty cell
}

// Coordinate-tuple key separator: the ASCII NUL control character (U+0000), written as an
// explicit '\u0000' escape — deliberately NOT a space. No RT display value contains NUL, so
// it is a collision-proof delimiter for grid cell-map keys. Do NOT "clean this up" into a
// real space: keys such as ['10','1'] vs ['1','01'] would then collide and corrupt grid
// lookups. See docs/review/OBSERVATIONS.md B12.
const SEP = '\u0000'
export function joinKey(values: string[]): string { return values.join(SEP) }
export function splitKey(key: string): string[] { return key.split(SEP) }

/** Coerce a raw row cell to its display string (stable, lossless for numbers). */
function toDisplay(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** Derive a grid model from a table. Returns null when the table can't be faithfully
 *  represented as (1..3 dims × one value column) — e.g. range tables (pcMin/pcMax) or
 *  tables with several value columns. Callers show a graceful "custom layout" notice. */
export function deriveGridModel(t: RTTable): GridModel | null {
  const valueColumn = inferValueColumn(t)
  if (!valueColumn) return null

  // Explicit dimensions (the order/labels a PM chose) win; else infer from key columns.
  const explicit = t.dimensions?.length ? t.dimensions : undefined
  const dimKeys = explicit ? explicit.map(d => d.key) : t.columns.filter(c => c !== valueColumn)
  if (dimKeys.length < 1 || dimKeys.length > 3) return null
  if (!dimKeys.every(k => t.columns.includes(k))) return null
  // REFUSE rather than mis-model: an interval table prices by CONTAINMENT, and the grid is
  // exact-match only. Returning null routes it to the caller's "custom layout" notice — the
  // behavior this function's contract has always claimed but never enforced.
  if (detectBandPairs(dimKeys).length > 0) return null

  const dimensions: GridDimension[] = dimKeys.map(key => {
    const seen: string[] = []
    let numeric = true
    for (const r of t.rows) {
      const raw = r[key]
      const disp = toDisplay(raw)
      if (disp !== '' && !seen.includes(disp)) seen.push(disp)
      if (raw !== null && raw !== undefined && typeof raw !== 'number') numeric = false
    }
    const meta = explicit?.find(d => d.key === key)
    // Metadata values take precedence (they hold the full, ordered value set even for
    // ragged tables); fall back to the distinct values discovered in the rows.
    const values = meta?.values?.length ? [...meta.values] : seen
    return { key, label: meta?.label ?? key, values, numeric }
  })

  const cells: Record<string, number> = {}
  for (const r of t.rows) {
    const coords = dimensions.map(d => toDisplay(r[d.key]))
    if (coords.some(c => c === '')) continue
    const v = r[valueColumn]
    // FIRST-WINS on a duplicate coordinate, matching genericRtLookup's `rows.find`. Assigning
    // unconditionally was last-wins, so a table with a repeated coordinate showed the reviewer
    // (and round-tripped through the serializer) a factor the rating engine never uses.
    if (typeof v === 'number' && cells[joinKey(coords)] === undefined) cells[joinKey(coords)] = v
  }
  return { valueColumn, dimensions, cells }
}

/** Coerce a display string back to the stored type for a dimension column. */
function coerce(value: string, numeric: boolean): string | number {
  if (!numeric) return value
  const n = Number(value)
  return Number.isFinite(n) && value.trim() !== '' ? n : value
}

/** Serialise a grid model back to an RTTable, preserving the name + value column and
 *  writing explicit `dimensions` metadata. Only FILLED cells emit rows (empty cells are
 *  omitted, which round-trips ragged tables). Rows carry dimension columns + the value. */
export function gridModelToTable(model: GridModel, base: Pick<RTTable, 'name'>): RTTable {
  const dims = model.dimensions
  const columns = [...dims.map(d => d.key), model.valueColumn]
  const rows: Record<string, unknown>[] = []

  // Emit rows in dimension order for stable, diff-friendly output.
  const build = (idx: number, coords: string[]) => {
    if (idx === dims.length) {
      const v = model.cells[joinKey(coords)]
      if (v === undefined || v === null || Number.isNaN(v)) return
      const row: Record<string, unknown> = {}
      dims.forEach((d, i) => { row[d.key] = coerce(coords[i]!, d.numeric) })
      row[model.valueColumn] = v
      rows.push(row)
      return
    }
    for (const val of dims[idx]!.values) build(idx + 1, [...coords, val])
  }
  build(0, [])

  const dimensions: RTTableDimension[] = dims.map(d => ({
    key: d.key, label: d.label, values: [...d.values],
  }))
  return { name: base.name, columns, rows, dimensions, valueColumn: model.valueColumn }
}

/** Generic N-dimensional lookup for grid-managed tables. Returns null (defer to the
 *  bespoke getter) unless the table declares `dimensions`, every dimension key is present
 *  in the query, and a matching row with a numeric value exists. This keeps every legacy /
 *  seeded table on its original bespoke path — the $1,528 canary is untouched. */
export function genericRtLookup(t: RTTable, q: Record<string, unknown>): number | null {
  const dims = t.dimensions
  if (!dims || dims.length === 0) return null
  if (!dims.every(d => d.key in q)) return null
  const vc = t.valueColumn ?? inferValueColumn(t)
  if (!vc) return null
  const row = t.rows.find(r => dims.every(d => toDisplay(r[d.key]) === toDisplay(q[d.key])))
  if (!row) return null
  const v = row[vc]
  return typeof v === 'number' ? v : null
}

/** All coordinate tuples across the dimensions (row-major), for cell iteration. */
export function allCoords(dims: GridDimension[]): string[][] {
  let acc: string[][] = [[]]
  for (const d of dims) {
    const next: string[][] = []
    for (const prefix of acc) for (const v of d.values) next.push([...prefix, v])
    acc = next
  }
  return acc
}

/** Total cells (cross-product) and how many are filled — powers the header + warnings. */
export function gridCellStats(model: GridModel): { total: number; filled: number } {
  const total = model.dimensions.reduce((n, d) => n * Math.max(d.values.length, 0), 1)
  let filled = 0
  for (const coords of allCoords(model.dimensions)) {
    if (model.cells[joinKey(coords)] !== undefined) filled++
  }
  return { total, filled }
}
