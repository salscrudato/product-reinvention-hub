// portfolioDigest.test.ts — locks the deterministic seams of the chat portfolio digest:
// budget-boundedness, stable ordering, empty/one/two-product handling, and the
// non-fabrication guarantee (every emitted [refId]/[form] resolves against the input).
// These are the parts that must never regress; the LIVE build + model behaviour are exercised
// elsewhere (functions/) and are deliberately NOT asserted here (no flaky model calls).
import { describe, it, expect } from 'vitest'
import {
  assemblePortfolioDigest, estimateDigestTokens, DIGEST_TOKEN_BUDGET,
  type PortfolioDigestInput, type PortfolioDigestProduct,
} from './portfolioDigest'
import { findUnverifiedCitations } from './citations'
import { normalizeFormNumber } from '../insurance/extraction'

// A small, realistic two-product input (Personal Home + Personal Auto), with ISO-shaped forms
// so the citation verifier actually exercises the form-number path.
const HOME: PortfolioDigestProduct = {
  refId: 'PH.PROD.001', name: 'Personal Home', lob: 'Homeowners',
  coverages: [
    { refId: 'PH.COV.001', name: 'Coverage A – Dwelling' },
    { refId: 'PH.COV.002', name: 'Coverage B – Other Structures' },
    { refId: 'PH.COV.003', name: 'Coverage C – Personal Property' },
  ],
  formNumbers: ['HO 00 03', 'HO 04 61', 'HO 04 90'],
  ruleRefIds: ['PH.RU.001', 'PH.RU.002'],
  rating: [{ programRef: 'HO.RAT.1', premium: 1528 }],
}
const AUTO: PortfolioDigestProduct = {
  refId: 'PA.PROD.001', name: 'Personal Auto', lob: 'Personal Auto',
  coverages: [
    { refId: 'PA.COV.001', name: 'Part A – Liability' },
    { refId: 'PA.COV.002', name: 'Part D – Damage to Your Auto' },
  ],
  formNumbers: ['PP 00 01', 'PP 03 06'],
  ruleRefIds: ['PA.RU.001', 'PA.RU.007'],
  rating: [{ programRef: 'PA.RAT.1', premium: 1002 }],
}

/** The known refId / form sets the input authorises — the mirror of ai.ts's live catalogue. */
function knownFrom(input: PortfolioDigestInput): { refIds: Set<string>; forms: Set<string> } {
  const refIds = new Set<string>()
  const forms = new Set<string>()
  for (const p of input.products) {
    if (p.refId) refIds.add(p.refId.toUpperCase())
    for (const c of p.coverages) if (c.refId) refIds.add(c.refId.toUpperCase())
    for (const r of p.ruleRefIds) if (r) refIds.add(r.toUpperCase())
    for (const f of p.formNumbers) forms.add(normalizeFormNumber(f))
    for (const rt of p.rating ?? []) refIds.add(rt.programRef.toUpperCase())
  }
  return { refIds, forms }
}

describe('assemblePortfolioDigest — budget', () => {
  it('stays within the default token budget even for a large catalogue', () => {
    const products: PortfolioDigestProduct[] = Array.from({ length: 60 }, (_, i) => ({
      refId: `L${i}.PROD.001`, name: `Product ${i}`, lob: `Line ${i}`,
      coverages: Array.from({ length: 30 }, (_, j) => ({ refId: `L${i}.COV.${j}`, name: `Coverage ${j}` })),
      formNumbers: Array.from({ length: 30 }, (_, j) => `L${i} 0${j} 03`),
      ruleRefIds: Array.from({ length: 30 }, (_, j) => `L${i}.RU.${j}`),
      rating: [{ programRef: `L${i}.RAT.1`, premium: 1000 + i }],
    }))
    const digest = assemblePortfolioDigest({ products })
    expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(DIGEST_TOKEN_BUDGET)
    // Over-budget input must drop products with an honest, visible note.
    expect(digest).toMatch(/more products? not shown/i)
  })

  it('honours a custom, smaller budget', () => {
    const digest = assemblePortfolioDigest({ products: [HOME, AUTO] }, { tokenBudget: 200 })
    expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(200)
  })

  it('per-product caps surface an overflow note rather than dumping everything', () => {
    const big: PortfolioDigestProduct = {
      refId: 'PH.PROD.001', name: 'Personal Home',
      coverages: Array.from({ length: 100 }, (_, j) => ({ refId: `PH.COV.${j}`, name: `Coverage ${j}` })),
      formNumbers: [], ruleRefIds: [], rating: [],
    }
    const digest = assemblePortfolioDigest({ products: [big] })
    expect(digest).toMatch(/\+\d+ more \(tools\)/)
  })
})

describe('assemblePortfolioDigest — determinism + stable order', () => {
  it('produces identical output for the same input', () => {
    const input = { products: [HOME, AUTO] }
    expect(assemblePortfolioDigest(input)).toBe(assemblePortfolioDigest(input))
  })

  it('is order-independent: a shuffled input yields identical output', () => {
    const ordered = assemblePortfolioDigest({ products: [HOME, AUTO] })
    // Reverse product order AND the inner lists — canonical sorting must absorb all of it.
    const shuffled = assemblePortfolioDigest({
      products: [
        { ...AUTO, coverages: [...AUTO.coverages].reverse(), formNumbers: [...AUTO.formNumbers].reverse(), ruleRefIds: [...AUTO.ruleRefIds].reverse() },
        { ...HOME, coverages: [...HOME.coverages].reverse(), formNumbers: [...HOME.formNumbers].reverse(), ruleRefIds: [...HOME.ruleRefIds].reverse() },
      ],
    })
    expect(shuffled).toBe(ordered)
  })

  it('dedupes repeated coverages / forms / rules', () => {
    const dupHome: PortfolioDigestProduct = {
      ...HOME,
      coverages: [...HOME.coverages, HOME.coverages[0]!],
      formNumbers: [...HOME.formNumbers, 'ho 00 03', HOME.formNumbers[1]!],
      ruleRefIds: [...HOME.ruleRefIds, HOME.ruleRefIds[0]],
    }
    const digest = assemblePortfolioDigest({ products: [dupHome] })
    expect(digest.match(/\[PH\.COV\.001\]/g)).toHaveLength(1)
    expect(digest.match(/\[HO 00 03\]/g)).toHaveLength(1)   // "ho 00 03" collapses to the same key
    expect(digest.match(/\[PH\.RU\.001\]/g)).toHaveLength(1)
  })
})

describe('assemblePortfolioDigest — empty / one / two products', () => {
  it('returns empty string for an empty portfolio', () => {
    expect(assemblePortfolioDigest({ products: [] })).toBe('')
    expect(assemblePortfolioDigest({ products: undefined as unknown as [] })).toBe('')
  })

  it('renders a single product with its coverages, forms, rules and rating headline', () => {
    const digest = assemblePortfolioDigest({ products: [HOME] })
    expect(digest).toContain('Personal Home')
    expect(digest).toContain('[PH.PROD.001]')
    expect(digest).toContain('[PH.COV.001]')
    expect(digest).toContain('[HO 04 61]')
    expect(digest).toContain('[PH.RU.001]')
    expect(digest).toContain('[HO.RAT.1] worked example → $1,528')   // the HO-3 canary headline
    expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(DIGEST_TOKEN_BUDGET)
  })

  it('renders two products, both present and in canonical (refId) order', () => {
    const digest = assemblePortfolioDigest({ products: [AUTO, HOME] })
    expect(digest).toContain('[PA.RAT.1] worked example → $1,002')
    expect(digest).toContain('[HO.RAT.1] worked example → $1,528')
    // PA.PROD sorts before PH.PROD, regardless of input order.
    expect(digest.indexOf('[PA.PROD.001]')).toBeLessThan(digest.indexOf('[PH.PROD.001]'))
  })

  it('emits a coverage without a refId as plain text (no bracket to fabricate)', () => {
    const digest = assemblePortfolioDigest({
      products: [{ refId: 'PH.PROD.001', name: 'Home', coverages: [{ name: 'Unlisted Coverage' }], formNumbers: [], ruleRefIds: [] }],
    })
    expect(digest).toContain('Unlisted Coverage')
    expect(digest).not.toContain('[Unlisted Coverage]')
  })
})

describe('assemblePortfolioDigest — grounded (nothing fabricated) + rules present', () => {
  it('emits only [refId]/[form] tokens that exist in the input', () => {
    const input = { products: [HOME, AUTO] }
    const digest = assemblePortfolioDigest(input)
    const { refIds, forms } = knownFrom(input)
    // The repo's own grounding guard: every refId/form-shaped bracket must resolve to a real one.
    expect(findUnverifiedCitations(digest, refIds, forms)).toEqual([])
  })

  it('restates the non-invention + cite-everything house rules inside the digest block', () => {
    const digest = assemblePortfolioDigest({ products: [HOME] })
    expect(digest).toMatch(/cite every specific claim/i)
    expect(digest).toMatch(/never invent/i)
    expect(digest).toMatch(/the tool wins/i)   // tools are the source of truth
  })
})
