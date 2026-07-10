// reconcile.test.ts — the GOLDEN test + the imported-product CANARY. Feeds the reference
// filing's canned extraction through the pure reconcile and asserts:
//   • the expected product SKELETON (coverage count, a MIN_FLOOR step, a deductible factor
//     table, state applicability == the filing state);
//   • ZERO silent drops: proposed === accepted + unresolved, and unresolved items are all cited;
//   • the imported RatingProgram, priced through the SHARED evaluator with the manual-default
//     worked example, produces a FROZEN premium (the imported product's canary candidate).
import { describe, it, expect } from 'vitest'
import { reconcileFiling } from './reconcile'
import { NJ_LEMONADE_EXTRACTION, FILING_WORKED_EXAMPLE } from './njLemonadeFiling'
import { evaluate } from '../../rating/evaluator'
import { makePHRtGetter, makePHLdGetter } from '../../seed/personalHome'
import type { RTTable, LDTable, RatingProgram } from '../../types'

const bundle = reconcileFiling(NJ_LEMONADE_EXTRACTION)

// Rebuild the table maps the way ProductContext feeds them to the evaluator (keyed by refId).
function tablesOf() {
  const rt: Record<string, RTTable> = {}
  for (const t of bundle.plan.rtTables) rt[t.refId!] = t.data as unknown as RTTable
  const ld: Record<string, LDTable> = {}
  for (const t of bundle.plan.ldTables) ld[t.refId!] = t.data as unknown as LDTable
  return { rt, ld }
}

describe('filing reconcile — product skeleton', () => {
  it('produces a product shell with the filing state (NJ), not all-states', () => {
    const p = bundle.plan.product!.data
    expect(p['name']).toBe('Lemonade Homeowners (NJ)')
    expect(p['allStates']).toBe(false)
    expect(p['states']).toEqual(['NJ'])
    expect((p['lob'] as { refId: string }).refId).toBe('PH.LOB.001')  // prices via the PH kit
    expect(bundle.baseFormNumber).toBe('LEM 03')
  })

  it('produces the policy form Coverage A–F (count in the expected range)', () => {
    expect(bundle.plan.coverages.length).toBe(6)
    expect(bundle.plan.coverages.length).toBeGreaterThanOrEqual(4)
    expect(bundle.plan.coverages.length).toBeLessThanOrEqual(12)
    expect(bundle.plan.coverages.some(c => /coverage a/i.test(c.data['name'] as string))).toBe(true)
  })

  it('builds a deductible factor RT table AND a deductible LD option table', () => {
    const dedRt = bundle.plan.rtTables.find(t => /ded/i.test(t.refId!) || /Deductibles/i.test(t.label))
    expect(dedRt).toBeDefined()
    const rt = dedRt!.data as unknown as RTTable
    expect(rt.dimensions?.length).toBe(2)                      // covA band × deductible
    expect(rt.rows.every(r => typeof r[rt.valueColumn!] === 'number')).toBe(true)   // factors
    const dedLd = bundle.plan.ldTables.find(t => /ded/i.test(t.refId!))
    expect(dedLd).toBeDefined()
    expect((dedLd!.data as unknown as LDTable).rows.length).toBeGreaterThan(0)
  })

  it('emits a MIN_FLOOR step from the minimum-premium rule ($420 for LEM 03)', () => {
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    const floor = prog.steps.find(s => s.op === 'MIN_FLOOR')
    expect(floor).toBeDefined()
    expect(floor!.source.value).toBe(420)
    expect(prog.minimumPremium).toBe(420)
  })

  it('sets creditFloor 0.50 (Rule 92) and flags the credit steps', () => {
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    expect(prog.creditFloor).toBe(0.5)
    const credits = prog.steps.filter(s => s.isCredit)
    expect(credits.length).toBeGreaterThanOrEqual(2)          // loyalty + renovation + gated
  })

  it('maps ops correctly: SET base loss cost, MUL factors, ADD flats', () => {
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    expect(prog.steps[0]!.op).toBe('SET')                     // base loss cost seeds the chain
    expect(prog.steps.filter(s => s.op === 'MUL').length).toBeGreaterThanOrEqual(5)
  })
})

describe('filing reconcile — zero silent drops (the conservation law)', () => {
  it('proposed === accepted + unresolved', () => {
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })

  it('surfaces UNRESOLVED items, each with a reason and a citation — never a silent drop', () => {
    expect(bundle.unresolved.length).toBeGreaterThan(0)
    for (const u of bundle.unresolved) {
      expect(u.reason.length).toBeGreaterThan(0)
      expect(u.citation.length).toBeGreaterThan(0)
    }
    // The base-premium chain factors the manual states no table for are the honest unresolved.
    expect(bundle.unresolved.some(u => /Protection - Construction/i.test(u.name))).toBe(true)
    expect(bundle.unresolved.some(u => /Key Factor/i.test(u.name))).toBe(true)
  })

  it('never invents a rating step: every RT step resolves to a real, parsed table', () => {
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    const tableRefs = new Set(bundle.plan.rtTables.map(t => t.refId))
    for (const s of prog.steps) if (s.source.type === 'RT') expect(tableRefs.has(s.source.ref!)).toBe(true)
  })
})

describe('filing reconcile — imported product CANARY', () => {
  // Derivation of the frozen $1,281 (rounded at the MIN_FLOOR step to whole dollars):
  //   s1 SET  baseLossCost[territory=30]                 = 456.93
  //   s2 MUL  Loss Cost Multiplier (Rule 1)              × 1.727  → 789.12
  //   s3 MUL  LCMF[zip=07004,territory=30] (Rule 2)      × 1.606  → 1,267.32
  //   s4 MUL  Tier[tier=5] (Rule 13)                     × 1.022  → 1,295.20
  //   s5 MUL  All-perils deductible[$300k+,$2,500] (406) × 0.83   → 1,075.02
  //   s6 MUL  Loss settlement PP replacement cost (14)   × 1.35   → 1,451.28
  //   s7 MUL  Renovation credit (Rule 26)                × 0.91   → 1,320.66   ┐ credits 0.91×0.97×1.00
  //   s8 MUL  Loyalty credit (Rule 24)                   × 0.97   → 1,281.04   │ = 0.8827 ≥ 0.50 floor
  //   s9 MUL  Gated community credit (Rule 23)           × 1.000  → 1,281.04   ┘ → no cap correction
  //   s10 MIN_FLOOR $420 (Rule 205), round 0             → max(1,281.04, 420)  = $1,281
  it('prices the imported program to the frozen premium through the shared evaluator', () => {
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    const { rt, ld } = tablesOf()
    const result = evaluate(prog, FILING_WORKED_EXAMPLE, makePHRtGetter(rt), makePHLdGetter(ld))
    expect(result.finalPremium).toBe(1281)
    // The base-loss-cost SET and the LCM/LCMF/tier/deductible/loss-settlement factors resolve.
    expect(result.trace[0]!.op).toBe('SET')
    expect(result.trace[0]!.factorOrAmount).toBe(456.93)
    // No cap correction fired (credits didn't pierce the 0.50 floor).
    expect(result.trace.some(t => t.stepId === '__credit_cap__')).toBe(false)
    // A full trace renders (one row per executed step).
    expect(result.trace.length).toBe(prog.steps.length)
  })
})
