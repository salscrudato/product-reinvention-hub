// GL canary — $2,635 regression lock (beside HO-3 $1,528 and PA $1,002).
// Class 41677 (Contractors — Residential Remodeling), payroll basis.
// Derivation:
//   s1 SET  GL.RT.001[classCode='41677']              = 2.50
//   s2 MUL  INPUT exposureThousands                   = 500       → 2.50 × 500 = 1,250.00
//   s3 MUL  GL.RT.002[occLimit=1000000]               = 1.82      → 1,250 × 1.82 = 2,275.00
//   s4 MUL  GL.RT.003[occDeductible=0]                = 1.00      → 2,275 × 1.00 = 2,275.00
//   s5 ADD  GL.RT.004[classCode='41677', pco=200]     = 200×1.80=360 → 2,275 + 360 = 2,635.00
//   s6 MUL  GL.RT.005[expMod='1.00']                  = 1.00      → 2,635 × 1.00 = 2,635.00
//   s7 MIN_FLOOR CONST 500 round 0                    → max(2,635, 500) = 2,635
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import {
  GL_RATING_PROGRAM,
  GL_RT_TABLES,
  GL_LD_TABLES,
  GL_WORKED_EXAMPLE,
  makeGLRtGetter,
  makeGLLdGetter,
} from '../seed/generalLiability'

describe('GL canary — $2,635', () => {
  it('produces exactly $2,635 for the worked example', () => {
    const rtGetter = makeGLRtGetter(GL_RT_TABLES)
    const ldGetter = makeGLLdGetter(GL_LD_TABLES)
    const result   = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(result.finalPremium).toBe(2635)
  })

  it('produces a 7-step trace', () => {
    const rtGetter = makeGLRtGetter(GL_RT_TABLES)
    const ldGetter = makeGLLdGetter(GL_LD_TABLES)
    const result   = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(result.trace).toHaveLength(7)
  })

  it('trace step s1: SET class rate 2.50', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s1 = result.trace.find(t => t.stepId === 's1')!
    expect(s1.op).toBe('SET')
    expect(s1.factorOrAmount).toBe(2.5)
    expect(s1.runningTotal).toBe(2.5)
  })

  it('trace step s2: MUL exposure 500 → running total 1250', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s2 = result.trace.find(t => t.stepId === 's2')!
    expect(s2.op).toBe('MUL')
    expect(s2.factorOrAmount).toBe(500)
    expect(s2.runningTotal).toBe(1250)
  })

  it('trace step s3: MUL ILF 1.82 → running total 2275', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s3 = result.trace.find(t => t.stepId === 's3')!
    expect(s3.op).toBe('MUL')
    expect(s3.factorOrAmount).toBe(1.82)
    expect(s3.runningTotal).toBe(2275)
  })

  it('trace step s4: MUL deductible credit 1.00 → running total 2275', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s4 = result.trace.find(t => t.stepId === 's4')!
    expect(s4.op).toBe('MUL')
    expect(s4.factorOrAmount).toBe(1.0)
    expect(s4.runningTotal).toBe(2275)
  })

  it('trace step s5: ADD PCO premium 360 → running total 2635', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s5 = result.trace.find(t => t.stepId === 's5')!
    expect(s5.op).toBe('ADD')
    expect(s5.factorOrAmount).toBe(360)
    expect(s5.runningTotal).toBe(2635)
  })

  it('trace step s6: MUL exp mod 1.00 → running total 2635', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s6 = result.trace.find(t => t.stepId === 's6')!
    expect(s6.op).toBe('MUL')
    expect(s6.factorOrAmount).toBe(1.0)
    expect(s6.runningTotal).toBe(2635)
  })

  it('trace step s7: MIN_FLOOR 500 leaves 2635 unchanged', () => {
    const result = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    const s7 = result.trace.find(t => t.stepId === 's7')!
    expect(s7.op).toBe('MIN_FLOOR')
    expect(s7.runningTotal).toBe(2635)
  })

  it('minimum premium floor applies when exposure is tiny', () => {
    const tinyInputs = { ...GL_WORKED_EXAMPLE, exposureThousands: 1 }
    const result = evaluate(GL_RATING_PROGRAM, tinyInputs, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    expect(result.finalPremium).toBeGreaterThanOrEqual(500)
  })

  it('PCO step skips when pcoElected is false', () => {
    const noPco = { ...GL_WORKED_EXAMPLE, pcoElected: false }
    const result = evaluate(GL_RATING_PROGRAM, noPco, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    // Without PCO: 1250 × 1.82 × 1.00 × 1.00 = 2275; MIN_FLOOR(500) → 2275
    expect(result.finalPremium).toBe(2275)
    // Conditional step is omitted from trace
    const s5 = result.trace.find(t => t.stepId === 's5')
    expect(s5).toBeUndefined()
  })
})
