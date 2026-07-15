/**
 * reconcile-targetform.test.ts — regression lock for ledger F22 (full fix).
 *
 * Pre-fix, reconcileFiling defaulted targetForm to the literal 'HO3' and
 * FILTERED every rate-order variable that matched no 'HO3' form column ABOVE
 * the conservation ledger: a Personal Auto filing with real PP 00 01
 * variables produced a correctly-labeled product with a silently empty
 * rating program (proposed 0 / unresolved [] — invisible to conservation).
 *
 * Full fix: the target form is the FILING'S OWN base form (cross-notation
 * matched by numeric form code, the same bridge pickFormScalar always used:
 * "HO3" ↔ "LEM 03" both resolve to code 3), and a variable that matches no
 * target-form column is CONSERVED — it enters the ledger as an unresolved
 * item with its citation, never a silent drop.
 *
 * Two structurally different fixtures: a WA Personal Auto filing (single-form
 * rate order, PP 00 01) and the NJ homeowners golden (multi-form rate order,
 * base form LEM 03 vs HO3/HO4 columns).
 */
import { describe, it, expect } from 'vitest'
import { reconcileFiling } from './reconcile'
import { NJ_LEMONADE_EXTRACTION } from './njLemonadeFiling'
import type { FilingExtraction, RateOrderVariable } from './types'
import type { RatingProgram } from '../../types'

function paExtraction(): FilingExtraction {
  return {
    filingState: 'WA',
    baseFormNumber: 'PP 00 01',
    baseFormEdition: '06 98',
    productName: 'Washington Personal Auto',
    classifications: [
      { name: 'wa-rate-order.pdf', role: 'rateOrder', cue: 'rate order heading', confidence: 0.95 },
      { name: 'wa-manual.pdf', role: 'manual', cue: 'numbered rules', confidence: 0.95 },
      { name: 'wa-policy-form.pdf', role: 'policyForm', cue: 'insuring agreement', confidence: 0.9 },
    ],
    rateOrder: {
      variables: [
        { name: 'Base Loss Cost', op: 'ADD', stage: 'BASE_LOSS_COST', forms: ['PP 00 01'], citation: 'Rate Order, PP 00 01 column', confidence: 0.95 },
        { name: 'Loss Cost Multiplier', op: 'MUL', stage: 'BASE_LOSS_COST', forms: ['PP 00 01'], citation: 'Rate Order, PP 00 01 column', confidence: 0.95 },
      ],
    },
    manual: {
      rules: [
        {
          ruleNumber: '—', title: 'Base Loss Costs', kind: 'BASE_LOSS_COST', concept: 'baseLossCost',
          citation: 'WA Auto Manual, "BASE LOSS COSTS" by territory', confidence: 0.95,
          table: {
            layout: 'pairs', keyColumns: ['territory'], valueColumn: 'lossCost',
            rowRegion: ['1  250.00', '2  310.50'].join('\n'),
          },
        },
        {
          ruleNumber: '1', title: 'Loss Cost Multiplier', kind: 'SCALAR', concept: 'lossCostMult',
          citation: 'WA Auto Manual, Rule 1 (1.500)', confidence: 0.95,
          scalars: [{ label: 'Loss Cost Multiplier', value: 1.5 }],
        },
      ],
    },
    policyForm: {
      coverages: {
        items: [
          { name: 'Liability To Others', requirement: 'UNKNOWN', premiumGenerating: null, formNumbers: ['PP 00 01'], confidence: 0.9, citation: 'Part A' },
        ],
      },
      forms: { items: [] },
      rules: { items: [] },
      rating: { items: [] },
    },
  } as unknown as FilingExtraction
}

describe('F22: targetForm threads from the filing\'s own base form', () => {
  it('a PA filing\'s PP 00 01 variables produce a POPULATED rating program', () => {
    const bundle = reconcileFiling(paExtraction(), { lobRefIdHint: 'PA.LOB.001' })
    expect(bundle.plan.ratingProgram).not.toBeNull()
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    expect(prog.steps.length).toBe(2)
    expect(prog.steps[0]!.op).toBe('SET')      // base loss cost seeds the chain
    expect(prog.steps[1]!.op).toBe('MUL')      // LCM scalar
    expect(prog.steps[1]!.source).toEqual({ type: 'CONST', value: 1.5 })
    // Conservation: 2 variables + 1 coverage all accepted, nothing unresolved.
    expect(bundle.counts.proposed).toBe(3)
    expect(bundle.counts.accepted).toBe(3)
    expect(bundle.counts.unresolved).toBe(0)
  })

  it('an explicit opts.targetForm still wins over the base form', () => {
    const bundle = reconcileFiling(paExtraction(), { lobRefIdHint: 'PA.LOB.001', targetForm: 'HO3' })
    // No PP 00 01 variable matches an HO3 target → both conserved as unresolved.
    expect(bundle.plan.ratingProgram).toBeNull()
    expect(bundle.counts.proposed).toBe(3)
    expect(bundle.counts.unresolved).toBe(2)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })
})

describe('F22: form-filtered variables are CONSERVED, never silently dropped', () => {
  it('a variable for a DIFFERENT form enters the unresolved ledger with its citation', () => {
    const ex = paExtraction()
    const other: RateOrderVariable = {
      name: 'Motorcycle Class Factor', op: 'MUL', stage: 'ADJUSTED_BASE',
      forms: ['PP 00 02'], citation: 'Rate Order, PP 00 02 column', confidence: 0.9,
    }
    ex.rateOrder.variables.push(other)
    const bundle = reconcileFiling(ex, { lobRefIdHint: 'PA.LOB.001' })
    // The PP 00 01 chain still rates; the PP 00 02 variable is visible, cited, unresolved.
    const u = bundle.unresolved.find(x => x.name === 'Motorcycle Class Factor')
    expect(u).toBeDefined()
    expect(u!.reason).toMatch(/PP 00 02/)
    expect(u!.reason).toMatch(/target form/i)
    expect(u!.citation).toBe('Rate Order, PP 00 02 column')
    // Conservation counts ALL rate-order variables, including the filtered one.
    expect(bundle.counts.proposed).toBe(4)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
    // And it surfaces in the summary warnings like every unresolved item.
    expect(bundle.plan.summary.warnings.some(w => /Motorcycle Class Factor/.test(w))).toBe(true)
  })

  it('a base form carrying edition digits ("LEM 03 05 23", the policy-form footer shape) still matches the HO3 columns', () => {
    // The four-section extractor reports the form number as self-identified in the
    // footer — number + edition glued. The form code is the first NON-ZERO digit
    // run (3), never the edition tail (05 23).
    const ex = structuredClone(NJ_LEMONADE_EXTRACTION) as FilingExtraction
    ex.baseFormNumber = 'LEM 03 05 23'
    const bundle = reconcileFiling(ex)
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    expect(prog.steps.length).toBe(10)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })

  it('program-level manual rules live INSIDE the ledger: an unresolvable credit-cap keeps conservation', () => {
    // An explicit HO4 target against the golden: every HO3 variable is conserved as
    // unresolved; the min-premium rule RESOLVES (the manual states a LEM 04 floor,
    // $60) while the credit-cap rule does NOT (Rule 92 covers LEM 03/LEM 06 only) —
    // and the ledger still balances: proposed === accepted + unresolved.
    const bundle = reconcileFiling(structuredClone(NJ_LEMONADE_EXTRACTION) as FilingExtraction, { targetForm: 'HO4' })
    expect(bundle.unresolved.some(u => u.kind === 'credit-cap')).toBe(true)
    expect(bundle.unresolved.some(u => u.kind === 'min-premium')).toBe(false)
    const prog = bundle.plan.ratingProgram?.data as unknown as RatingProgram | undefined
    expect(prog?.minimumPremium ?? 60).toBe(60)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })

  it('NJ golden (multi-form notation): base form LEM 03 matches the HO3 columns by form code, and an HO4-only variable is conserved', () => {
    const ex = structuredClone(NJ_LEMONADE_EXTRACTION) as FilingExtraction
    ex.rateOrder.variables.push({
      name: 'Contents Replacement Factor', op: 'MUL', stage: 'ADJUSTED_BASE',
      forms: ['HO4'], citation: 'Rate Order of Calculations, HO4 column', confidence: 0.9,
    })
    const bundle = reconcileFiling(ex)
    // The HO3 chain is untouched: same steps the frozen $1,281 canary walks
    // (9 rate-order steps + MIN_FLOOR), proving the LEM 03 ↔ HO3 code bridge.
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    expect(prog.steps.length).toBe(10)
    expect(prog.steps.filter(s => s.op === 'MIN_FLOOR').length).toBe(1)
    // The HO4-only variable landed in the ledger, cited — never dropped.
    const u = bundle.unresolved.find(x => x.name === 'Contents Replacement Factor')
    expect(u).toBeDefined()
    expect(u!.reason).toMatch(/HO4/)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })
})
