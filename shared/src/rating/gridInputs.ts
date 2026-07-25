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
    // A step whose `source` is missing is MALFORMED, not a grid step. Imports written before
    // the brain emitted canonical steps persist exactly that shape, and an unguarded
    // `step.source.type` threw here — inside a useMemo, so it white-screened the whole
    // Pricing tab instead of degrading. Skip it: a step that names no source contributes no
    // dimension, which is the same answer this loop already gives for a non-RT step.
    if (step?.source?.type !== 'RT' || !step.source.ref) continue
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

// ─── Persisted-program repair (defensive read of imported data) ───────────────
// A RatingStep persisted before the importer emitted canonical steps can carry a FLAT bag
// ({'source.ref': 'RT.001'}) with no nested `source` at all — canonicalMap declares the rate
// reference as the dotted key 'source.ref', and the brain wrote the bag through unchanged.
// Every consumer reads `step.source.type`, so such a row threw inside a useMemo and
// white-screened the whole Pricing tab. Repairing once at the load boundary keeps the ~19
// downstream readers (evaluator, RatingAlgorithm, the Excel export, pricingLinks) on the
// contract their types already promise, instead of each guarding independently.
//
// This REPAIRS SHAPE ONLY — it never invents a rate. A step naming no table becomes an INPUT
// keyed on its own label, exactly as the deterministic mapper and the server-side importer do.

/** True when a step already satisfies the RatingStep contract. */
function hasCanonicalSource(step: unknown): boolean {
  const s = (step as { source?: { type?: unknown } } | null)?.source
  return !!s && typeof s.type === 'string'
}

/** Coerce one persisted step into a well-formed RatingStep. */
function coerceStep(raw: Record<string, unknown>, index: number): RatingProgram['steps'][number] {
  const order = typeof raw['order'] === 'number' ? raw['order'] : index + 1
  const pick = (...ks: string[]): string | undefined =>
    ks.map(k => raw[k]).find(v => typeof v === 'string' && v.trim() !== '') as string | undefined
  const id    = pick('id', 'stepId', 'refId') ?? `step-${order}`
  const label = pick('label', 'description') ?? id
  const ref   = pick('source.ref', 'rateReference', 'reference')
  const op    = raw['op']
  const okOp  = op === 'SET' || op === 'MUL' || op === 'ADD' || op === 'MIN_FLOOR'
  return {
    ...(raw as object),
    id, order, label,
    op: okOp ? op : 'MUL',
    source: ref ? { type: 'RT', ref } : { type: 'INPUT', ref: label },
  } as RatingProgram['steps'][number]
}

/** Return the program with every step guaranteed to carry a canonical `source`. Returns the
 *  SAME object when nothing needed repair, so React memo dependencies stay stable. */
export function repairPersistedProgram<T extends RatingProgram>(program: T | null | undefined): T | null {
  if (!program) return null
  const steps = Array.isArray(program.steps) ? program.steps : []
  if (steps.every(hasCanonicalSource)) return program
  return { ...program, steps: steps.map((s, i) => coerceStep(s as unknown as Record<string, unknown>, i)) }
}
