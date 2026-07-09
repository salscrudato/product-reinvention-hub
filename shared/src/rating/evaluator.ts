// Pure rating engine: executes a RatingProgram step-by-step and returns a full trace.
// No platform imports; injected table getters keep this testable without Firestore.
import type { RatingProgram, RatingInputMap, EvaluatorResult, TraceEntry } from '../types'

/** Look up a value from an RT table given a set of resolved input keys. */
export type RtGetter = (tableRef: string, queryInputs: Record<string, unknown>) => number

/** Look up a value from an LD table by the selected option value (or label). */
export type LdGetter = (tableRef: string, selectedValue: number | string) => number

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

  for (const step of sortedSteps) {
    // Gate: skip if condition input is falsy
    if (step.condition !== undefined && !inputs[step.condition]) continue

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
  }

  return { finalPremium: running, trace }
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
