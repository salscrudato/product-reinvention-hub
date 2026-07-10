// rating/gridInputs.ts — derive a data-driven pricing worksheet from a RatingProgram whose RT
// steps read GRID tables (dimensions + valueColumn). This is what makes an IMPORTED product (or
// any product built entirely from grid tables, e.g. the filing importer's output) priceable in
// the UI without a bespoke per-line input panel: each distinct table dimension becomes a select
// field over the values that table actually contains, and the default scenario picks the first
// value of each — a guaranteed-resolvable worked example (every RT step finds a row), so a full
// trace renders and a premium computes the moment the pricing tab opens.
//
// Purely ADDITIVE: it inspects only the tables a program's steps reference, and returns null when
// none are grid tables — so the seeded PH/PA/GL programs (whose tables carry no `dimensions`) are
// untouched and keep their bespoke worksheets. Zero platform imports.
import type { RatingProgram, RTTable, RatingInputField, RatingInputMap } from '../types'

export interface GridInputWorksheet {
  inputSpec:     RatingInputField[]
  workedExample: RatingInputMap
}

/** Build a worksheet from the grid tables a program's RT steps reference, or null when the
 *  program uses no grid tables (defer to the line's bespoke panel). One field per distinct
 *  dimension key; the default scenario is the first value of each dimension. */
export function deriveGridInputSpec(
  program: RatingProgram | null | undefined,
  rtTables: Record<string, RTTable>,
): GridInputWorksheet | null {
  if (!program) return null
  // Collect the dimension of every grid table an RT step reads, de-duped by key (a dimension
  // key shared by two tables — rare once lookupKeys is set — becomes one field).
  const byKey = new Map<string, { label: string; values: string[] }>()
  let sawGrid = false
  for (const step of program.steps) {
    if (step.source.type !== 'RT' || !step.source.ref) continue
    const table = rtTables[step.source.ref]
    const dims = table?.dimensions
    if (!dims || dims.length === 0) continue
    sawGrid = true
    for (const d of dims) {
      if (!byKey.has(d.key)) byKey.set(d.key, { label: d.label ?? d.key, values: [...d.values] })
    }
  }
  if (!sawGrid || byKey.size === 0) return null

  const inputSpec: RatingInputField[] = []
  const workedExample: RatingInputMap = {}
  for (const [key, { label, values }] of byKey) {
    // A dimension whose every value ROUND-TRIPS through Number renders as a numeric-valued
    // select; otherwise the option values stay strings. The round-trip guard keeps a
    // leading-zero code (a zip like "07003") a string — coercing it to 7003 would break the
    // display-string lookup. genericRtLookup compares by display string either way.
    const allNumeric = values.length > 0 && values.every(v => v.trim() !== '' && String(Number(v)) === v.trim())
    inputSpec.push({
      key, label,
      kind: 'select',
      options: values.map(v => ({ label: v, value: allNumeric ? Number(v) : v })),
    })
    if (values.length) workedExample[key] = allNumeric ? Number(values[0]) : values[0]!
  }
  return { inputSpec, workedExample }
}
