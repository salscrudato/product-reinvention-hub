// evaluator.creditFloor.test.ts — the maximum-credit-cap extension (Rule 92 archetype).
// Proves the cap fires when credits pierce the floor, stays quiet when they don't, is a
// no-op for programs that don't opt in, and — critically — leaves every existing canary
// ($1,528 / $1,002 / $2,635) byte-identical. See rating/evaluator.ts for the semantics.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import type { RatingProgram, RatingInputMap } from '../types'
import {
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES, PH_WORKED_EXAMPLE,
  makePHRtGetter, makePHLdGetter,
} from '../seed/personalHome'
import { PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES, PA_WORKED_EXAMPLE, makePARtGetter, makePALdGetter } from '../seed/personalAuto'
import { GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES, GL_WORKED_EXAMPLE, makeGLRtGetter, makeGLLdGetter } from '../seed/generalLiability'

// A tiny, self-contained program: SET a $1,000 base, then three credit factors, then a
// $100 flat add, then a $500 minimum. Credits multiply to 0.90×0.90×0.80 = 0.648.
const gov = { status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', createdAt: null, updatedAt: null, updatedBy: '', rev: 0 } as const
function makeCreditProgram(creditFloor?: number): RatingProgram {
  return {
    ...gov, allStates: true, states: [],
    refId: 'TEST.RAT.1', name: 'credit cap test', minimumPremium: 500, creditFloor,
    steps: [
      { id: 's1', order: 1, label: 'Base',        op: 'SET', source: { type: 'CONST', value: 1000 } },
      { id: 's2', order: 2, label: 'Loyalty',     op: 'MUL', source: { type: 'CONST', value: 0.90 }, isCredit: true },
      { id: 's3', order: 3, label: 'Bundle',      op: 'MUL', source: { type: 'CONST', value: 0.90 }, isCredit: true },
      { id: 's4', order: 4, label: 'Renovation',  op: 'MUL', source: { type: 'CONST', value: 0.80 }, isCredit: true },
      { id: 's5', order: 5, label: 'Flat add',    op: 'ADD', source: { type: 'CONST', value: 100 } },
      { id: 's6', order: 6, label: 'Min premium', op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  }
}

const noTables = () => 0 as never

describe('maximum-credit cap', () => {
  it('is a no-op when the program does not set creditFloor', () => {
    const r = evaluate(makeCreditProgram(undefined), {}, noTables, noTables)
    // 1000 × 0.648 = 648, + 100 = 748, floor 500 → 748. No cap trace entry.
    expect(r.finalPremium).toBe(748)
    expect(r.trace.find(t => t.stepId === '__credit_cap__')).toBeUndefined()
  })

  it('fires when the cumulative credit product pierces the floor', () => {
    // creditFloor 0.70: credits 0.648 < 0.70 → correct by 0.70/0.648.
    const r = evaluate(makeCreditProgram(0.70), {}, noTables, noTables)
    const cap = r.trace.find(t => t.stepId === '__credit_cap__')
    expect(cap).toBeDefined()
    expect(cap!.factorOrAmount).toBeCloseTo(0.70 / 0.648, 6)
    // Effective credit is now exactly the floor: 1000 × 0.70 = 700, +100 = 800.
    expect(r.finalPremium).toBeCloseTo(800, 6)
  })

  it('stays quiet when credits do NOT pierce the floor', () => {
    // creditFloor 0.50: credits 0.648 ≥ 0.50 → no correction.
    const r = evaluate(makeCreditProgram(0.50), {}, noTables, noTables)
    expect(r.trace.find(t => t.stepId === '__credit_cap__')).toBeUndefined()
    expect(r.finalPremium).toBe(748)
  })

  it('applies the cap AFTER the last credit and BEFORE downstream add / floor', () => {
    const r = evaluate(makeCreditProgram(0.70), {}, noTables, noTables)
    const order = r.trace.map(t => t.stepId)
    expect(order.indexOf('__credit_cap__')).toBeGreaterThan(order.indexOf('s4')) // after last credit
    expect(order.indexOf('__credit_cap__')).toBeLessThan(order.indexOf('s5'))    // before flat add
  })

  it('honours gated-out credit steps (cap lands after the last EXECUTED credit)', () => {
    // Gate s4 off → credits = 0.90×0.90 = 0.81; floor 0.70 → no correction (0.81 ≥ 0.70).
    const prog = makeCreditProgram(0.70)
    prog.steps[3]!.condition = 'renovationElected'    // s4 gated
    const inputs: RatingInputMap = { renovationElected: false }
    const r = evaluate(prog, inputs, noTables, noTables)
    expect(r.trace.find(t => t.stepId === 's4')).toBeUndefined()
    expect(r.trace.find(t => t.stepId === '__credit_cap__')).toBeUndefined()
    expect(r.finalPremium).toBe(910)   // 1000×0.81=810 +100
  })

  it('does not correct on a degenerate zero credit factor', () => {
    const prog = makeCreditProgram(0.70)
    prog.steps[2]!.source.value = 0    // a 0 credit — ratio would be non-finite
    const r = evaluate(prog, {}, noTables, noTables)
    expect(r.trace.find(t => t.stepId === '__credit_cap__')).toBeUndefined()
    expect(r.finalPremium).toBe(500)   // 1000×0.9×0×0.8 = 0, +100 = 100, MIN_FLOOR 500 → 500
  })
})

describe('existing canaries are byte-identical under the extension', () => {
  it('HO-3 still produces exactly $1,528', () => {
    const r = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
    expect(r.finalPremium).toBe(1528)
    expect(r.trace.some(t => t.stepId === '__credit_cap__')).toBe(false)
  })
  it('Personal Auto still produces exactly $1,002', () => {
    const r = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, makePARtGetter(PA_RT_TABLES), makePALdGetter(PA_LD_TABLES))
    expect(r.finalPremium).toBe(1002)
  })
  it('General Liability still produces exactly $2,635', () => {
    const r = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
    expect(r.finalPremium).toBe(2635)
  })
})
