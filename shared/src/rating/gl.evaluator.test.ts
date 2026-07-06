// GL evaluator tests — the sibling canary to HO-3's $1,528. Asserts the GL worked
// example produces exactly $2,789 with the exact per-step trace, proving the shared
// evaluator is line-agnostic. The HO-3 $1,528 test (evaluator.test.ts) is unchanged.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import {
  GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES,
  GL_WORKED_EXAMPLE, makeGLRtGetter, makeGLLdGetter,
} from '../seed/gl'

const rtGetter = makeGLRtGetter(GL_RT_TABLES)
const ldGetter = makeGLLdGetter(GL_LD_TABLES)

describe('GL rating evaluator', () => {
  it('produces $2,789 for the GL worked example with exact per-step trace', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, rtGetter, ldGetter)

    expect(result.finalPremium).toBe(2789)

    // 4.20 → ×300 = 1,260 → ×1.50 LCM = 1,890 → ×1.40 ILF = 2,646 → ×0.90 = 2,381.40
    // → ×1.15 = 2,738.61 → +50 terrorism = 2,788.61 → MAX(·,125) round 0 = 2,789
    const by = (id: string) => result.trace.find(t => t.stepId === id)!

    expect(by('s1').runningTotal).toBe(4.20)              // base loss cost SET
    expect(by('s2').runningTotal).toBeCloseTo(1260, 2)    // ×300 exposure units
    expect(by('s3').runningTotal).toBeCloseTo(1890, 2)    // ×1.50 LCM (OH)
    expect(by('s4').runningTotal).toBe(2646)              // ×1.40 ILF, rounded to ¢
    expect(by('s5').runningTotal).toBeCloseTo(2381.40, 2) // ×0.90 schedule mod
    expect(by('s6').runningTotal).toBe(2738.61)           // ×1.15 tier, rounded to ¢
    expect(by('s7').runningTotal).toBeCloseTo(2788.61, 2) // +$50 terrorism (elected)
    expect(by('s8').runningTotal).toBe(2789)              // MAX(·,125) rounded to $
  })

  it('terrorism step is skipped when not elected', () => {
    const result = evaluate(
      GL_RATING_PROGRAM,
      { ...GL_WORKED_EXAMPLE, terrorismElected: false },
      rtGetter, ldGetter,
    )
    expect(result.trace.find(t => t.stepId === 's7')).toBeUndefined()
    expect(result.finalPremium).toBe(2739) // 2,738.61 without +50, rounded to $
  })

  it('applies the class minimum premium when the computed premium is lower', () => {
    // Tiny exposure → premium falls below the class-2 minimum of $125.
    const result = evaluate(
      GL_RATING_PROGRAM,
      { ...GL_WORKED_EXAMPLE, exposureUnits: 1, terrorismElected: false, scheduleMod: 1, tierFactor: 1 },
      rtGetter, ldGetter,
    )
    expect(result.finalPremium).toBe(125)
    expect(by(result, 's8').factorOrAmount).toBe(125)
  })

  it('ILF rises with higher occurrence/aggregate limits', () => {
    const low  = evaluate(GL_RATING_PROGRAM, { ...GL_WORKED_EXAMPLE, perOccurrenceLimit: 500000, aggregateLimit: 1000000 }, rtGetter, ldGetter)
    const high = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(high.finalPremium).toBeGreaterThan(low.finalPremium)
  })
})

function by(result: { trace: { stepId: string }[] }, id: string) {
  return result.trace.find(t => t.stepId === id)! as { stepId: string; factorOrAmount: number; runningTotal: number }
}
