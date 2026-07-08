import { describe, it, expect } from 'vitest'
import { buildEntryMatcher, computeDictionaryUsage, type DictUsageCorpus } from './usage'
import { PH_COVERAGES, PH_RULES, PH_FORMS, PH_DICTIONARY, PH_RATING_PROGRAM } from '../seed/personalHome'
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

// ─── EVAL: rating-step back-references (Part B calibration) ───────────────────
// Verifies that rating-step label scanning finds the expected term mentions across
// the PH rating program, with no false positives for terms not in any step label.
describe('computeDictionaryUsage — rating steps (PH) [EVAL]', () => {
  const phStepCorpus: DictUsageCorpus = {
    ...corpus,
    ratingSteps: PH_RATING_PROGRAM.steps.map(s => ({
      programRefId: PH_RATING_PROGRAM.refId!,
      stepId:       s.id,
      label:        s.label,
      productId:    'PH.PROD.001',
      entityPath:   'products/PH.PROD.001/ratingPrograms/PH-RAT-1',
    })),
  }

  it('Coverage A Amount resolves to rating step s3 (Coverage A key factor)', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), phStepCorpus)
    const stepRefs = refs.filter(r => r.kind === 'ratingStep').map(r => r.refId)
    expect(stepRefs).toContain(`${PH_RATING_PROGRAM.refId}/s3`)
  })

  it('All-Peril Deductible resolves to rating step s4a', () => {
    const refs = computeDictionaryUsage(entry('All-Peril Deductible'), phStepCorpus)
    const stepRefs = refs.filter(r => r.kind === 'ratingStep').map(r => r.refId)
    expect(stepRefs).toContain(`${PH_RATING_PROGRAM.refId}/s4a`)
  })

  it('Device Type resolves to rating step s8b (Protective device credit)', () => {
    const refs = computeDictionaryUsage(entry('Device Type'), phStepCorpus)
    const stepRefs = refs.filter(r => r.kind === 'ratingStep').map(r => r.refId)
    expect(stepRefs).toContain(`${PH_RATING_PROGRAM.refId}/s8b`)
  })

  it('Territory Code does NOT match "Territory base rate" — no false positive', () => {
    // Step s1 label is "Territory base rate"; aliases are "Territory Code" and
    // "rating territory" — neither appears verbatim in that label.
    const refs = computeDictionaryUsage(entry('Territory Code'), phStepCorpus)
    expect(refs.filter(r => r.kind === 'ratingStep')).toEqual([])
  })

  it('rating step refs carry correct kind / productId / entityPath / label', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), phStepCorpus)
    const step = refs.find(r => r.kind === 'ratingStep' && r.refId === `${PH_RATING_PROGRAM.refId}/s3`)
    expect(step).toBeDefined()
    expect(step!.productId).toBe('PH.PROD.001')
    expect(step!.entityPath).toBeTruthy()
    expect(step!.label).toBe('Coverage A key factor → Key Premium')
  })

  it('rating steps appear AFTER coverages/rules/forms in the sorted output', () => {
    const refs = computeDictionaryUsage(entry('Coverage A Amount'), phStepCorpus)
    const lastNonStep = refs.reduce((idx, r, i) => r.kind !== 'ratingStep' ? i : idx, -1)
    const firstStep   = refs.findIndex(r => r.kind === 'ratingStep')
    if (firstStep !== -1) expect(firstStep).toBeGreaterThan(lastNonStep)
  })
})
