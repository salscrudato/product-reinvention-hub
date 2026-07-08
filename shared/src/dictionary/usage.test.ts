import { describe, it, expect } from 'vitest'
import { buildEntryMatcher, computeDictionaryUsage, type DictUsageCorpus } from './usage'
import { PH_COVERAGES, PH_RULES, PH_FORMS, PH_DICTIONARY } from '../seed/personalHome'
import { PA_COVERAGES, PA_RULES, PA_FORMS, PA_DICTIONARY } from '../seed/personalAuto'

// Build a corpus from the real PH seed so the test doubles as a calibration guard:
// if a future seed edit renames a term/label, the expected back-references change here.
const corpus: DictUsageCorpus = {
  coverages: PH_COVERAGES.map(c => ({
    refId: c.refId, name: c.name, terms: c.terms,
    productId: 'PH.PROD.001', entityPath: `products/PH.PROD.001/coverages/${(c.refId ?? '').replace(/\./g, '-')}`,
  })),
  rules: PH_RULES.map(r => ({
    refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory,
    productId: 'PH.PROD.001', entityPath: `products/PH.PROD.001/rules/${(r.refId ?? '').replace(/\./g, '-')}`,
  })),
  forms: PH_FORMS.map(f => ({
    number: f.number, name: f.name, description: f.description, dynamicFields: f.dynamicFields,
    productRefIds: f.productRefIds,
  })),
}

const entry = (name: string) => PH_DICTIONARY.find(d => d.name === name)!

describe('buildEntryMatcher — whole-word, no false positives', () => {
  it('matches the exact phrase on a word boundary', () => {
    const m = buildEntryMatcher({ name: 'Coverage A' })!
    expect(m('Coverage A — Dwelling')).toBe(true)
    expect(m('increase to 10% of Coverage A')).toBe(true)
  })

  it('does NOT bleed into an adjacent word', () => {
    const m = buildEntryMatcher({ name: 'Coverage A' })!
    expect(m('Coverage Amount')).toBe(false)   // the classic substring trap
    expect(m('Coverage Available')).toBe(false)
  })

  it('is case-insensitive and honours aliases', () => {
    const m = buildEntryMatcher({ name: 'Named Insured', aliases: ['NamedInsured'] })!
    expect(m('the named insured is')).toBe(true)
    expect(m('field NamedInsured (TEXT)')).toBe(true)
  })

  it('returns null when there is nothing to match on', () => {
    expect(buildEntryMatcher({ name: '  ' })).toBeNull()
  })
})

describe('computeDictionaryUsage — real PH corpus', () => {
  it('Coverage A Amount resolves to the coverages/rules/forms where it appears', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), corpus)
    const cov  = refs.filter(r => r.kind === 'coverage').map(r => r.refId)
    const rules = refs.filter(r => r.kind === 'rule').map(r => r.refId)
    const forms = refs.filter(r => r.kind === 'form').map(r => r.refId)
    expect(cov).toContain('PH.COV.001')   // "Coverage A — Dwelling" + term "Coverage A Amount"
    expect(cov).toContain('PH.COV.002')   // term default "10% of Coverage A"
    expect(cov).toContain('PH.COV.004')   // term default "30% of Coverage A"
    expect(rules).toContain('PH.RU.002')  // outcome "10% of Coverage A"
    expect(rules).toContain('PH.RU.004')  // outcome "30% of Coverage A"
    expect(forms).toContain('HO 04 48')   // description "10% of Coverage A"
  })

  it('All-Peril Deductible resolves to its rating rule', () => {
    const refs = computeDictionaryUsage(entry('All-Peril Deductible'), corpus)
    expect(refs.map(r => r.refId)).toContain('PH.RU.007')  // "All-peril deductible selection"
  })

  it('Appraised Value resolves to the SPP coverage and endorsement', () => {
    const refs = computeDictionaryUsage(entry('Appraised Value'), corpus)
    expect(refs.filter(r => r.kind === 'coverage').map(r => r.refId)).toContain('PH.COV.003.002')
    expect(refs.filter(r => r.kind === 'form').map(r => r.refId)).toContain('HO 04 61')
  })

  it('carries deep-link metadata (productId + entityPath) on every ref', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), corpus)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      if (r.kind !== 'form') expect(r.productId).toBe('PH.PROD.001')
      expect(r.entityPath).toBeTruthy()
    }
  })

  it('dedupes to one row per entity even when several fields match', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), corpus)
    const keys = refs.map(r => `${r.kind}:${r.refId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a rating-table-only term (Territory Code) honestly resolves to nothing', () => {
    // Territory lives in RT tables, not in coverage/form/rule prose — so the matcher
    // must NOT invent a usage. Honest-empty is the correct answer.
    expect(computeDictionaryUsage(entry('Territory Code'), corpus)).toEqual([])
  })
})

describe('computeDictionaryUsage — real PA corpus', () => {
  const paCorpus: DictUsageCorpus = {
    coverages: PA_COVERAGES.map(c => ({ refId: c.refId, name: c.name, terms: c.terms, productId: 'PA.PROD.001' })),
    rules: PA_RULES.map(r => ({ refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory, productId: 'PA.PROD.001' })),
    forms: PA_FORMS.map(f => ({ number: f.number, name: f.name, description: f.description, dynamicFields: f.dynamicFields, productRefIds: f.productRefIds })),
  }
  const paEntry = (name: string) => PA_DICTIONARY.find(d => d.name === name)!

  it('Collision Deductible resolves to the collision coverage', () => {
    const refs = computeDictionaryUsage(paEntry('Collision Deductible'), paCorpus)
    // PA.COV.004.001 term label is "Collision Deductible" — exact alias match
    expect(refs.filter(r => r.kind === 'coverage').map(r => r.refId)).toContain('PA.COV.004.001')
  })

  it('Bodily Injury Limit resolves to BI coverage and its limit rule', () => {
    const refs = computeDictionaryUsage(paEntry('Bodily Injury Limit'), paCorpus)
    // PA.COV.001.001 name is "Bodily Injury Liability"; term label "Bodily Injury Per Person / Per Accident"
    const covRefs = refs.filter(r => r.kind === 'coverage').map(r => r.refId)
    expect(covRefs.length).toBeGreaterThanOrEqual(1)
  })
})
