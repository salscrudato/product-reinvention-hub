/**
 * reconcile-lob.test.ts — regression lock for ledger F18.
 *
 * Filing reconciliation hard-coded lob 'PH' (Personal Home) regardless of the
 * stage-0 router's LOB hint — a Personal Auto filing came out as a Personal
 * Home product. The router already derives the line from content; downstream
 * paths that ignore it re-introduce the assumption the router was built to
 * remove. The no-hint default stays PH (the platform's documented DEFAULT_LOB)
 * but must be a WARNED default, never a silent one.
 */
import { describe, it, expect } from 'vitest'
import { reconcileFiling } from './reconcile'
import type { FilingExtraction } from './types'

function minimalExtraction(): FilingExtraction {
  return {
    filingState: 'WA',
    baseFormNumber: 'PP 00 01',
    classifications: [{ name: 'wa-auto.pdf', role: 'policyForm', cue: 'insuring agreement', confidence: 0.9 }],
    rateOrder: { variables: [] },
    manual: { rules: [] },
    policyForm: {
      productName: 'Personal Auto Policy',
      coverages: { items: [{ name: 'Liability To Others', requirement: 'UNKNOWN', premiumGenerating: null, formNumbers: ['PP 00 01'], confidence: 0.9, citation: 'Part A' }], note: '' },
      forms: { items: [], note: '' },
      rules: { items: [], note: '' },
      ratingHints: { items: [], note: '' },
    },
  } as unknown as FilingExtraction
}

describe('F18: filing reconciliation follows the LOB hint', () => {
  it('a Personal Auto hint yields a Personal Auto product — never Personal Home', () => {
    const plan = reconcileFiling(minimalExtraction(), { lobRefIdHint: 'PA.LOB.001' })
    const product = plan.plan.product!.data as Record<string, unknown>
    expect((product.lob as { refId: string }).refId).toBe('PA.LOB.001')
    expect((product.lob as { name: string }).name).toBe('Personal Auto')
    expect(String(product.marketSegment)).toMatch(/Personal Lines/)
    expect(plan.plan.summary.lobName).toBe('Personal Auto')
    // Coverage identity keys on the line's registry prefix.
    for (const c of plan.plan.coverages) expect(String(c.refId)).toMatch(/^PA\./)
  })

  it('an unresolvable hint falls back to the platform default WITH a warning', () => {
    const plan = reconcileFiling(minimalExtraction(), { lobRefIdHint: 'ZZ.LOB.999' })
    const product = plan.plan.product!.data as Record<string, unknown>
    expect((product.lob as { refId: string }).refId).toBe('PH.LOB.001')
    expect(plan.plan.summary.warnings.some(w => /LOB/i.test(w) && /default/i.test(w))).toBe(true)
  })

  it('no hint keeps the PH default (golden parity) but says so in warnings', () => {
    const plan = reconcileFiling(minimalExtraction())
    const product = plan.plan.product!.data as Record<string, unknown>
    expect((product.lob as { refId: string }).refId).toBe('PH.LOB.001')
    expect(plan.plan.summary.warnings.some(w => /LOB/i.test(w) && /default/i.test(w))).toBe(true)
  })

  it('conservation is untouched by lob threading: proposed = accepted + unresolved', () => {
    const plan = reconcileFiling(minimalExtraction(), { lobRefIdHint: 'PA.LOB.001' })
    expect(plan.counts.proposed).toBe(plan.counts.accepted + plan.counts.unresolved)
  })

  it('PP 00 01 rate-order variables ENTER the ledger under a PP 00 01 base form (ledger F22 full fix)', () => {
    const ex = minimalExtraction()
    ;(ex.rateOrder as { variables: unknown[] }).variables = [
      { name: 'Base Rate', op: 'ADD', stage: 'BASE_LOSS_COST', forms: ['PP 00 01'], confidence: 0.9, citation: 'p.3' },
      { name: 'Territory Factor', op: 'MUL', stage: 'FACTOR', forms: ['PP 00 01'], confidence: 0.9, citation: 'p.4' },
    ]
    const plan = reconcileFiling(ex, { lobRefIdHint: 'PA.LOB.001' })
    // Full fix (supersedes the interim aggregate warning): the target form is the
    // filing's own base form, so both variables MATCH and enter the conservation
    // ledger. With no manual tables to resolve against they land UNRESOLVED with
    // table-resolution reasons — visible and counted, never form-filtered above
    // the ledger.
    expect(plan.counts.proposed).toBe(3)          // 2 variables + 1 coverage
    expect(plan.counts.proposed).toBe(plan.counts.accepted + plan.counts.unresolved)
    const names = plan.unresolved.map(u => u.name)
    expect(names).toContain('Base Rate')
    expect(names).toContain('Territory Factor')
    for (const u of plan.unresolved) expect(u.reason).not.toMatch(/target form/i)
  })
})
