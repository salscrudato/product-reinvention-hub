// Pure rating engine: executes a RatingProgram step-by-step and returns a full trace.
// No platform imports; injected table getters keep this testable without Firestore.
//
// MAXIMUM-CREDIT CAP EXTENSION (additive, opt-in). A real rate filing usually carries a
// "maximum credits" rule (e.g. Lemonade NJ HO Rule 92: "a maximum total credit of 50%")
// that caps the CUMULATIVE product of a named set of credit factors — something a chain of
// independent MUL steps cannot express on its own. Rather than add a bespoke op, the engine
// honours two OPTIONAL fields: `RatingStep.isCredit` flags a step as a credit, and
// `RatingProgram.creditFloor` sets the floor for the product of those flagged steps. When
// (and only when) a program sets `creditFloor`, the evaluator multiplies once by a corrective
// factor right after the last credit step so the cumulative credit product never dips below
// the floor, emitting a distinct, auditable trace entry for the adjustment. Programs that set
// neither field — every legacy/seeded program — run byte-identically, so the $1,528 (HO-3),
// $1,002 (Personal Auto) and $2,635 (GL) canaries are untouched. Introduced by the filing
// importer (docs/reviews/GROUND_TRUTH.md V16); unit-tested in evaluator.creditFloor.test.ts.
import type { RatingProgram, RatingInputMap, EvaluatorResult, TraceEntry } from '../types'

/** Look up a value from an RT table given a set of resolved input keys. */
export type RtGetter = (tableRef: string, queryInputs: Record<string, unknown>) => number

/** Look up a value from an LD table by the selected option value (or label). */
export type LdGetter = (tableRef: string, selectedValue: number | string) => number

// Single canonical rounding-discipline helper: every RatingStep that sets `roundTo`
// routes through here so no intermediate step accumulates uncapped float drift.
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Evaluate a RatingProgram against the provided inputs.
 * Steps execute in `order` sequence; the `condition` field is an input key
 * that gates execution (falsy → step is skipped, running total unchanged).
 */
export function evaluate(
  program: RatingProgram,
  inputs: RatingInputMap,
  rtGetter: RtGetter,
  ldGetter: LdGetter,
): EvaluatorResult {
  const sortedSteps = [...program.steps].sort((a, b) => a.order - b.order)
  let running = 0
  const trace: TraceEntry[] = []

  // Maximum-credit cap bookkeeping (no-op unless `creditFloor` is set). We track the running
  // product of executed credit factors and the index of the LAST credit step actually run, so
  // the single corrective adjustment lands immediately after credits are complete — before any
  // downstream flat premium or MIN_FLOOR. `capApplied` guards against double-application.
  const capEnabled = typeof program.creditFloor === 'number' && program.creditFloor > 0
  const lastCreditIdx = capEnabled
    ? sortedSteps.reduce((last, s, i) => (s.op === 'MUL' && isCreditStep(s, inputs) ? i : last), -1)
    : -1
  let creditProduct = 1
  let capApplied = false

  sortedSteps.forEach((step, idx) => {
    // Gate: skip if condition input is falsy
    if (step.condition !== undefined && !inputs[step.condition]) return

    const { factor, sourceRef } = resolveSource(step, inputs, rtGetter, ldGetter)

    let nextRunning: number
    switch (step.op) {
      case 'SET':      nextRunning = factor;                break
      case 'MUL':      nextRunning = running * factor;      break
      case 'ADD':      nextRunning = running + factor;      break
      case 'MIN_FLOOR': nextRunning = Math.max(running, factor); break
    }

    const didRound = step.roundTo !== undefined
    if (didRound) nextRunning = round(nextRunning, step.roundTo!)

    running = nextRunning

    trace.push({
      stepId:         step.id,
      label:          step.label,
      op:             step.op,
      sourceRef,
      factorOrAmount: factor,
      rounded:        didRound,
      runningTotal:   running,
    })

    // Accumulate the credit product; once the last credit step has run, apply the cap.
    if (capEnabled && step.op === 'MUL' && isCreditStep(step, inputs)) creditProduct *= factor
    if (capEnabled && !capApplied && idx === lastCreditIdx) {
      capApplied = true
      const floor = program.creditFloor!
      // Only correct when credits actually pierced the floor. `creditProduct > 0` guards the
      // degenerate zero-factor case (a 0 credit would make the ratio non-finite).
      if (creditProduct > 0 && creditProduct < floor) {
        const adjust = floor / creditProduct
        running *= adjust
        trace.push({
          stepId:         '__credit_cap__',
          label:          `Maximum credit cap (floor ${floor})`,
          op:             'MUL',
          sourceRef:      `CREDIT_CAP(floor=${floor}, credits=${round(creditProduct, 4)})`,
          factorOrAmount: adjust,
          rounded:        false,
          runningTotal:   running,
        })
      }
    }
  })

  return { finalPremium: running, trace }
}

/** Would this step contribute to the maximum-credit product on this run? A credit step is one
 *  explicitly flagged `isCredit` whose gate (if any) is satisfied — the caller has already
 *  filtered gated-out steps, so this only re-checks the flag + op at accumulation time. */
function isCreditStep(step: RatingProgram['steps'][number], inputs: RatingInputMap): boolean {
  if (!step.isCredit) return false
  if (step.condition !== undefined && !inputs[step.condition]) return false
  return true
}

function resolveSource(
  step: RatingProgram['steps'][number],
  inputs: RatingInputMap,
  rtGetter: RtGetter,
  ldGetter: LdGetter,
): { factor: number; sourceRef: string } {
  const src = step.source

  switch (src.type) {
    case 'CONST':
      return { factor: src.value!, sourceRef: `CONST(${src.value})` }

    case 'INPUT': {
      const v = inputs[src.ref!]
      if (typeof v !== 'number') throw new Error(`INPUT '${src.ref}' must be a number, got ${typeof v}`)
      return { factor: v, sourceRef: `INPUT(${src.ref})` }
    }

    case 'LD': {
      const selectedValue = inputs[src.keys![0]]
      if (selectedValue === undefined) throw new Error(`LD key '${src.keys![0]}' not found in inputs`)
      const factor = ldGetter(src.ref!, selectedValue as number | string)
      return { factor, sourceRef: `${src.ref}[${selectedValue}]` }
    }

    case 'RT': {
      const queryInputs: Record<string, unknown> = {}
      for (const k of src.keys ?? []) queryInputs[k] = inputs[k]
      const factor = rtGetter(src.ref!, queryInputs)
      const keyStr = (src.keys ?? []).map(k => `${k}=${inputs[k]}`).join(',')
      return { factor, sourceRef: `${src.ref}[${keyStr}]` }
    }

    case 'SPP': {
      // Σ(appraisedValue / 100 × classRate) across all SPP items
      const items = inputs.sppItems ?? []
      let total = 0
      for (const item of items) {
        const ratePerHundred = rtGetter(src.ref!, { itemClass: item.itemClass })
        total += (item.appraisedValue / 100) * ratePerHundred
      }
      return { factor: total, sourceRef: `SPP(${src.ref})` }
    }

    default:
      throw new Error(`Unknown source type: ${(src as { type: string }).type}`)
  }
}
