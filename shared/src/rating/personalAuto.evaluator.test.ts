// Personal Auto evaluator tests — the sibling canary to Personal Home's $1,528.
// Asserts the PA worked example produces exactly $1,002 with the exact per-step trace,
// proving the shared evaluator is line-agnostic. The PH $1,528 test (evaluator.test.ts) is unchanged.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import {
  PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES,
  PA_WORKED_EXAMPLE, makePARtGetter, makePALdGetter,
} from '../seed/personalAuto'

const rtGetter = makePARtGetter(PA_RT_TABLES)
const ldGetter = makePALdGetter(PA_LD_TABLES)

describe('Personal Auto rating evaluator', () => {
  it('produces $1,002 for the PA worked example with exact per-step trace', () => {
    const result = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, rtGetter, ldGetter)

    expect(result.finalPremium).toBe(1002)

    // s1: SET  PA.RT.001[T002]              = 400    → 400.00
    // s2: MUL  PA.RT.002[DC2]              = 1.00   → 400.00
    // s3: MUL  PA.RT.003[100/300/100]      = 1.00   → 400.00
    // s4: MUL  PA.RT.004[Standard], r2     = 1.00   → 400.00
    // s5: ADD  PA.RT.005[T002] (medPay)    = 42     → 442.00
    // s6: ADD  PA.RT.006[T002] (um)        = 62     → 504.00
    // s7: ADD  PA.RT.007[sym12,$500] (col) = 306    → 810.00
    // s8: ADD  PA.RT.008[sym12,$250] (comp)= 154    → 964.00
    // s9: MUL  PA.RT.009[Standard]         = 1.00   → 964.00
    // s10a ADD PA.RT.010[$30_900] (rental) = 38     → 1002.00
    // s10b SKIPPED (towingElected=false)
    // s11: MIN_FLOOR 250, r0               → max(1002,250) = 1002
    const by = (id: string) => result.trace.find(t => t.stepId === id)!

    expect(by('s1').runningTotal).toBe(400)               // territory T002 base rate
    expect(by('s2').runningTotal).toBe(400)               // ×1.00 DC2 (standard)
    expect(by('s3').runningTotal).toBe(400)               // ×1.00 100/300/100 limit factor
    expect(by('s4').runningTotal).toBe(400.00)            // ×1.00 Standard vehicle age, rounded to ¢
    expect(by('s5').runningTotal).toBe(442)               // +42 Med Pay (T002)
    expect(by('s6').runningTotal).toBe(504)               // +62 UM/UIM (T002)
    expect(by('s7').runningTotal).toBe(810)               // +306 Collision (sym12/$500)
    expect(by('s8').runningTotal).toBe(964)               // +154 Comprehensive (sym12/$250)
    expect(by('s9').runningTotal).toBe(964)               // ×1.00 Standard tier
    expect(by('s10a').runningTotal).toBe(1002)            // +38 Rental ($30/$900)
    expect(result.trace.find(t => t.stepId === 's10b')).toBeUndefined() // towing skipped
    expect(by('s11').runningTotal).toBe(1002)             // MAX(1002,250) rounded to $
  })

  it('is deterministic — identical inputs yield an identical premium and trace', () => {
    const a = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, rtGetter, ldGetter)
    const b = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(b.finalPremium).toBe(a.finalPremium)
    expect(b.trace.map(t => [t.stepId, t.runningTotal])).toEqual(a.trace.map(t => [t.stepId, t.runningTotal]))
    expect(a.finalPremium).toBe(a.trace[a.trace.length - 1]!.runningTotal)
  })

  it('applies minimum premium $250 when calculated premium is lower', () => {
    // Minimal inputs: only liability, no optional coverages, economy class, preferred tier
    const result = evaluate(
      PA_RATING_PROGRAM,
      {
        ...PA_WORKED_EXAMPLE,
        driverClass: 'DC1',
        biPdLimitCode: '25/50/25',
        vehicleAgeClass: 'Economy',
        tier: 'Preferred',
        medPayElected: false,
        umElected: false,
        collisionElected: false,
        compElected: false,
        rentalElected: false,
        towingElected: false,
      },
      rtGetter, ldGetter,
    )
    expect(result.finalPremium).toBeGreaterThanOrEqual(250)
  })

  it('towing step is skipped when not elected', () => {
    const result = evaluate(
      PA_RATING_PROGRAM,
      { ...PA_WORKED_EXAMPLE, towingElected: false },
      rtGetter, ldGetter,
    )
    expect(result.trace.find(t => t.stepId === 's10b')).toBeUndefined()
  })

  it('towing step executes when elected', () => {
    const result = evaluate(
      PA_RATING_PROGRAM,
      { ...PA_WORKED_EXAMPLE, towingElected: true, towingLimit: 100 },
      rtGetter, ldGetter,
    )
    const s10b = result.trace.find(t => t.stepId === 's10b')
    expect(s10b).toBeDefined()
    expect(s10b!.factorOrAmount).toBe(15)
    expect(result.finalPremium).toBe(1017)
  })
})
