// gridInputs.test.ts — deriveGridInputSpec makes an imported (grid-table) product priceable in
// the UI, and leaves the seeded bespoke-panel lines (PH/PA/GL) untouched.
import { describe, it, expect } from 'vitest'
import { deriveGridInputSpec } from './gridInputs'
import { evaluate } from './evaluator'
import { makePHRtGetter, makePHLdGetter, PH_RATING_PROGRAM, PH_RT_TABLES } from '../seed/personalHome'
import { reconcileFiling, NJ_LEMONADE_EXTRACTION } from '../insurance/filing'
import type { RTTable, LDTable, RatingProgram } from '../types'

describe('deriveGridInputSpec', () => {
  it('returns null for a seeded program whose tables have no grid dimensions (PH untouched)', () => {
    expect(deriveGridInputSpec(PH_RATING_PROGRAM, PH_RT_TABLES)).toBeNull()
  })

  it('builds a worksheet from an imported program and prices it (full trace + premium)', () => {
    const bundle = reconcileFiling(NJ_LEMONADE_EXTRACTION)
    const rt: Record<string, RTTable> = {}
    for (const t of bundle.plan.rtTables) rt[t.refId!] = t.data as unknown as RTTable
    const ld: Record<string, LDTable> = {}
    for (const t of bundle.plan.ldTables) ld[t.refId!] = t.data as unknown as LDTable
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram

    const worksheet = deriveGridInputSpec(prog, rt)
    expect(worksheet).not.toBeNull()
    // One field per distinct lookup dimension (territory, zip, tier, covABand, deductible, ppReplacementCost).
    const keys = worksheet!.inputSpec.map(f => f.key).sort()
    expect(keys).toContain('territory')
    expect(keys).toContain('zip')
    expect(keys).toContain('tier')
    expect(keys).toContain('deductible')

    // The auto-seeded worked example (first value of each dimension) is guaranteed-resolvable:
    // every RT step finds a row, so the evaluator runs a full trace and computes a premium.
    const result = evaluate(prog, worksheet!.workedExample, makePHRtGetter(rt), makePHLdGetter(ld))
    expect(result.finalPremium).toBeGreaterThanOrEqual(prog.minimumPremium)
    expect(result.trace.length).toBe(prog.steps.length)
    // zip kept its leading zero (string), never coerced to a number that would miss the row.
    expect(typeof worksheet!.workedExample.zip).toBe('string')
  })
})
