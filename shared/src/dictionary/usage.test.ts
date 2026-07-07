import { describe, it, expect } from 'vitest'
import { buildEntryMatcher, computeDictionaryUsage, type DictUsageCorpus } from './usage'
import { HO3_COVERAGES, HO3_RULES, HO3_FORMS, HO3_DICTIONARY } from '../seed/ho3'
import { GL_COVERAGES, GL_RULES, GL_FORMS, GL_DICTIONARY } from '../seed/gl'

// Build a corpus from the real HO-3 seed so the test doubles as a calibration guard:
// if a future seed edit renames a term/label, the expected back-references change here.
const corpus: DictUsageCorpus = {
  coverages: HO3_COVERAGES.map(c => ({
    refId: c.refId, name: c.name, terms: c.terms,
    productId: 'HO.PROD.001', entityPath: `products/HO.PROD.001/coverages/${(c.refId ?? '').replace(/\./g, '-')}`,
  })),
  rules: HO3_RULES.map(r => ({
    refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory,
    productId: 'HO.PROD.001', entityPath: `products/HO.PROD.001/rules/${(r.refId ?? '').replace(/\./g, '-')}`,
  })),
  forms: HO3_FORMS.map(f => ({
    number: f.number, name: f.name, description: f.description, dynamicFields: f.dynamicFields,
    productRefIds: f.productRefIds,
  })),
}

const entry = (name: string) => HO3_DICTIONARY.find(d => d.name === name)!

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

describe('computeDictionaryUsage — real HO-3 corpus', () => {
  it('Coverage A Amount resolves to the coverages/rules/forms where it appears', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), corpus)
    const cov  = refs.filter(r => r.kind === 'coverage').map(r => r.refId)
    const rules = refs.filter(r => r.kind === 'rule').map(r => r.refId)
    const forms = refs.filter(r => r.kind === 'form').map(r => r.refId)
    expect(cov).toContain('HO.COV.001')   // "Coverage A — Dwelling" + term "Coverage A Amount"
    expect(cov).toContain('HO.COV.002')   // term default "10% of Coverage A"
    expect(cov).toContain('HO.COV.004')   // term default "30% of Coverage A"
    expect(rules).toContain('HO.RU.002')  // outcome "10% of Coverage A"
    expect(rules).toContain('HO.RU.004')  // outcome "30% of Coverage A"
    expect(forms).toContain('HO 04 48')   // description "10% of Coverage A"
  })

  it('All-Peril Deductible resolves to its rating rule', () => {
    const refs = computeDictionaryUsage(entry('All-Peril Deductible'), corpus)
    expect(refs.map(r => r.refId)).toContain('HO.RU.007')  // "All-peril deductible selection"
  })

  it('Appraised Value resolves to the SPP coverage and endorsement', () => {
    const refs = computeDictionaryUsage(entry('Appraised Value'), corpus)
    expect(refs.filter(r => r.kind === 'coverage').map(r => r.refId)).toContain('HO.COV.003.002')
    expect(refs.filter(r => r.kind === 'form').map(r => r.refId)).toContain('HO 04 61')
  })

  it('carries deep-link metadata (productId + entityPath) on every ref', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), corpus)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      if (r.kind !== 'form') expect(r.productId).toBe('HO.PROD.001')
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

describe('computeDictionaryUsage — real GL corpus', () => {
  const glCorpus: DictUsageCorpus = {
    coverages: GL_COVERAGES.map(c => ({ refId: c.refId, name: c.name, terms: c.terms, productId: 'GL.PROD.001' })),
    rules: GL_RULES.map(r => ({ refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory, productId: 'GL.PROD.001' })),
    forms: GL_FORMS.map(f => ({ number: f.number, name: f.name, description: f.description, dynamicFields: f.dynamicFields, productRefIds: f.productRefIds })),
  }
  const glEntry = (name: string) => GL_DICTIONARY.find(d => d.name === name)!

  it('Occurrence Limit resolves to the BI/PD coverages and its limit rule', () => {
    const refs = computeDictionaryUsage(glEntry('Occurrence Limit'), glCorpus)
    expect(refs.filter(r => r.kind === 'coverage').map(r => r.refId)).toContain('GL.COV.002')
    expect(refs.filter(r => r.kind === 'rule').map(r => r.refId)).toContain('GL.RU.004')
  })

  it('Loss Cost Multiplier resolves to its rating rule', () => {
    expect(computeDictionaryUsage(glEntry('Loss Cost Multiplier'), glCorpus).map(r => r.refId)).toContain('GL.RU.090')
  })
})
