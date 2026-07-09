// scaffold.test.ts — the "never invents" guard for AI product scaffolding. Proves
// that the pure sanitizer drops every ungrounded proposal (product, coverage, form
// or rule that carries no citation) before it can reach the review card, and keeps
// the well-cited ones. No live model: the guard is exercised deterministically.
import { describe, it, expect } from 'vitest'
import { cleanScaffold } from './scaffold'

describe('cleanScaffold — grounding guard', () => {
  it('drops an uncited product shell (nothing ungrounded reaches the card)', () => {
    const plan = cleanScaffold({
      product: { name: 'Coastal Homeowners', lobPrefix: 'HO', marketSegment: 'Personal Lines', description: 'x' },
      coverages: [], forms: [], rules: [],
    })
    expect(plan.product).toBeNull()
    expect(plan.warnings.join(' ')).toMatch(/cited no existing product/i)
  })

  it('keeps a well-cited product shell and normalises the LOB prefix', () => {
    const plan = cleanScaffold({
      product: { name: 'Coastal HO-3', lobPrefix: 'ho', marketSegment: 'Personal Lines', description: 'Coastal special form', citation: 'HO.PROD.001' },
      coverages: [], forms: [], rules: [],
    })
    expect(plan.product).not.toBeNull()
    expect(plan.product!.name).toBe('Coastal HO-3')
    expect(plan.product!.lobPrefix).toBe('HO')
    expect(plan.product!.citation).toBe('HO.PROD.001')
  })

  it('keeps cited coverages/rules and drops uncited ones', () => {
    const plan = cleanScaffold({
      product: { name: 'P', lobPrefix: 'HO', marketSegment: 'x', description: 'y', citation: 'HO.PROD.001' },
      coverages: [
        { name: 'Coverage A — Dwelling', requirement: 'MANDATORY', premiumGenerating: true, citation: 'HO.COV.001' },
        { name: 'Invented Coverage', requirement: 'OPTIONAL', premiumGenerating: false }, // no citation → dropped
      ],
      rules: [
        { category: 'PRODUCT', subCategory: 'Eligibility', condition: 'X', outcome: 'Y', citation: 'HO.RU.001' },
        { category: 'PRODUCT', subCategory: 'Eligibility', condition: 'A', outcome: 'B' }, // no citation → dropped
      ],
      forms: [],
    })
    expect(plan.coverages.items).toHaveLength(1)
    expect(plan.coverages.items[0]!.name).toBe('Coverage A — Dwelling')
    expect(plan.rules.items).toHaveLength(1)
    expect(plan.rules.items[0]!.condition).toBe('X')
    // The dropped items are disclosed, not silently swallowed.
    expect(plan.coverages.note).toMatch(/dropped/i)
    expect(plan.rules.note).toMatch(/dropped/i)
  })
})
