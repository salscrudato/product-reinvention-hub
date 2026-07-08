// Evaluator tests — must assert the $1,528 worked example with exact per-step values.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import {
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES,
  PH_WORKED_EXAMPLE, makePHRtGetter, makePHLdGetter,
} from '../seed/personalHome'

const rtGetter = makePHRtGetter(PH_RT_TABLES)
const ldGetter = makePHLdGetter(PH_LD_TABLES)

describe('HO-3 rating evaluator', () => {
  it('produces $1,528 for the DOMAIN_HO worked example with exact per-step trace', () => {
    const result = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, rtGetter, ldGetter)

    expect(result.finalPremium).toBe(1528)

    // Per-step assertions from DOMAIN_HO.md worked example trace
    // 700.00 → ×1.05 = 735.00 → ×1.30 = 955.50 → 956 → ×1.00 = 956.00 →
    // ×1.06 = 1,013.36 → +24 = 1,037.36 → +6 = 1,043.36 →
    // ×(1.10×1.00) = 1,147.70 → ×1.10 = 1,262.47 → +75 +190.50 = 1,527.97 → 1,528
    const by = (id: string) => result.trace.find(t => t.stepId === id)!

    expect(by('s1').runningTotal).toBe(700)          // territory T002 base rate
    expect(by('s2').runningTotal).toBe(735)           // ×1.05 PC5/Masonry
    expect(by('s3').runningTotal).toBe(956)           // ×1.30 covA400k, rounded to $
    expect(by('s4a').runningTotal).toBe(956)          // ×1.00 ded1000 (no change)
    // s4b skipped (windHailElected=false)
    expect(result.trace.find(t => t.stepId === 's4b')).toBeUndefined()
    expect(by('s5').runningTotal).toBeCloseTo(1013.36, 2)   // ×1.06 covC70%
    expect(by('s6').runningTotal).toBeCloseTo(1037.36, 2)   // +24 covE300k
    expect(by('s7').runningTotal).toBeCloseTo(1043.36, 2)   // +6 covF2k
    expect(by('s8a').runningTotal).toBeCloseTo(1147.696, 2) // ×1.10 RC
    expect(by('s8b').runningTotal).toBe(1147.70)            // ×1.00 device=none, rounded to ¢
    expect(by('s9').runningTotal).toBeCloseTo(1262.47, 2)   // ×1.10 tierB
    expect(by('s10a').runningTotal).toBeCloseTo(1337.47, 2) // +75 water backup
    expect(by('s10b').runningTotal).toBeCloseTo(1527.97, 2) // +190.50 SPP jewelry
    expect(by('s11').runningTotal).toBe(1528)               // MAX(1527.97,500) rounded
  })

  it('is deterministic — identical inputs yield an identical premium and trace', () => {
    const a = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, rtGetter, ldGetter)
    const b = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(b.finalPremium).toBe(a.finalPremium)
    expect(b.trace.map(t => [t.stepId, t.runningTotal])).toEqual(a.trace.map(t => [t.stepId, t.runningTotal]))
    // The reported premium is exactly the final trace step's running total — no drift.
    expect(a.finalPremium).toBe(a.trace[a.trace.length - 1]!.runningTotal)
  })

  it('produces minimum premium $500 when calculated premium is lower', () => {
    const lowInputs = {
      ...PH_WORKED_EXAMPLE,
      territory: 'T001',
      covA: 200000,
      covCPct: 50,
      covELimit: 100000,
      covFLimit: 1000,
      allPerilDed: 5000,
      rcElected: false,
      tier: 'A',
      waterBackupElected: false,
      sppElected: false,
      sppItems: [],
    }
    const result = evaluate(PH_RATING_PROGRAM, lowInputs, rtGetter, ldGetter)
    expect(result.finalPremium).toBeGreaterThanOrEqual(500)
  })

  it('wind/hail step is skipped when not elected', () => {
    const result = evaluate(
      PH_RATING_PROGRAM,
      { ...PH_WORKED_EXAMPLE, windHailElected: false },
      rtGetter, ldGetter,
    )
    expect(result.trace.find(t => t.stepId === 's4b')).toBeUndefined()
  })

  it('wind/hail step executes and reduces premium when elected for coastal input', () => {
    // FL risk, CovA 400k, all-peril ded 1000; 2% WH = 0.94 factor
    const coastalInputs: typeof PH_WORKED_EXAMPLE = {
      ...PH_WORKED_EXAMPLE,
      windHailElected: true,
      windHailPct: 2,
    }
    const withWH    = evaluate(PH_RATING_PROGRAM, coastalInputs, rtGetter, ldGetter)
    const withoutWH = evaluate(PH_RATING_PROGRAM, { ...coastalInputs, windHailElected: false }, rtGetter, ldGetter)
    expect(withWH.finalPremium).toBeLessThan(withoutWH.finalPremium)
    const s4b = withWH.trace.find(t => t.stepId === 's4b')
    expect(s4b).toBeDefined()
    expect(s4b!.factorOrAmount).toBe(0.94)
  })
})
