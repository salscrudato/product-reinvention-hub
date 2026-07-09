// Pure unit tests for the task→lens resolver, the enrichment gate, and the deep-link
// builder. No mocks, no DOM — this is the single source of truth for which artifact a
// task surfaces, so every branch is pinned here.
import { describe, it, expect } from 'vitest'
import { resolveTaskLens, resolveTaskEnrichment, productDeepLink } from './taskLens'

describe('resolveTaskLens — one case per branch', () => {
  it('rating: "Product Pricing" → rating lens (pricing tab)', () => {
    const l = resolveTaskLens('Product Pricing')
    expect(l.kind).toBe('rating')
    expect(l.tab).toBe('pricing')
  })

  it('forms/filing: "Regulatory Filings & State Approvals" → forms lens (forms tab)', () => {
    const l = resolveTaskLens('Regulatory Filings & State Approvals')
    expect(l.kind).toBe('forms')
    expect(l.tab).toBe('forms')
  })

  it('coverage: "Product Features" → coverage lens (coverages tab)', () => {
    const l = resolveTaskLens('Product Features')
    expect(l.kind).toBe('coverage')
    expect(l.tab).toBe('coverages')
  })

  it('rules: "Underwriting Rules" → rules lens (rules tab)', () => {
    const l = resolveTaskLens('Underwriting Rules')
    expect(l.kind).toBe('rules')
    expect(l.tab).toBe('rules')
  })

  it('unmapped: "Stakeholder Training & Enablement" → generic overview lens', () => {
    const l = resolveTaskLens('Stakeholder Training & Enablement')
    expect(l.kind).toBe('generic')
    expect(l.tab).toBe('overview')
  })

  it('empty / null group → generic (never throws, never blank)', () => {
    expect(resolveTaskLens('').kind).toBe('generic')
    expect(resolveTaskLens(null).kind).toBe('generic')
    expect(resolveTaskLens(undefined).kind).toBe('generic')
  })

  it('every lens carries a human title + blurb (never a blank panel)', () => {
    for (const g of ['Product Pricing', 'Regulatory Filings', 'Product Features', 'Rules', '']) {
      const l = resolveTaskLens(g)
      expect(l.title.length).toBeGreaterThan(0)
      expect(l.blurb.length).toBeGreaterThan(0)
    }
  })
})

describe('resolveTaskEnrichment — the render gate', () => {
  it('project without productId → no lens renders, empty state (hasProduct false)', () => {
    const e = resolveTaskEnrichment({ productId: null }, { groupL3: 'Product Pricing' })
    expect(e.hasProduct).toBe(false)
    expect(e.productId).toBeNull()
  })

  it('missing project entirely → hasProduct false', () => {
    expect(resolveTaskEnrichment(null, { groupL3: 'Product Pricing' }).hasProduct).toBe(false)
    expect(resolveTaskEnrichment(undefined, { groupL3: 'Product Pricing' }).hasProduct).toBe(false)
  })

  it('project WITH productId → hasProduct true and the correct lens for the group', () => {
    const e = resolveTaskEnrichment({ productId: 'PH.PROD.001' }, { groupL3: 'Product Pricing' })
    expect(e.hasProduct).toBe(true)
    expect(e.productId).toBe('PH.PROD.001')
    expect(e.lens.kind).toBe('rating')
  })

  it('productId with a forms group resolves the forms lens', () => {
    const e = resolveTaskEnrichment({ productId: 'PH.PROD.001' }, { groupL3: 'Regulatory Filings & State Approvals' })
    expect(e.hasProduct).toBe(true)
    expect(e.lens.kind).toBe('forms')
  })
})

describe('productDeepLink — honours the tabs existing query params', () => {
  it('coverage deep link uses ?cov=', () => {
    expect(productDeepLink('PH.PROD.001', { tab: 'coverages', ref: 'HO.COV.003.002' }))
      .toBe('/app/products/PH.PROD.001/coverages?cov=HO.COV.003.002')
  })
  it('form deep link uses ?form= and encodes the space', () => {
    expect(productDeepLink('PH.PROD.001', { tab: 'forms', formNumber: 'HO 04 90' }))
      .toBe('/app/products/PH.PROD.001/forms?form=HO%2004%2090')
  })
  it('bare tabs (rules / pricing / overview / no-ref) link to the tab root', () => {
    expect(productDeepLink('P', { tab: 'rules' })).toBe('/app/products/P/rules')
    expect(productDeepLink('P', { tab: 'pricing' })).toBe('/app/products/P/pricing')
    expect(productDeepLink('P', { tab: 'overview' })).toBe('/app/products/P/overview')
    expect(productDeepLink('P', { tab: 'coverages' })).toBe('/app/products/P/coverages')
  })
})
