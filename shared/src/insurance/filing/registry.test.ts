// registry.test.ts — the concept registry: rule-number archetypes + concept identity. These
// are the stable semantics that let one filing's anatomy generalise to the next.
import { describe, it, expect } from 'vitest'
import { classifyRuleNumber, matchConcept, normalizeConcept } from './registry'

describe('classifyRuleNumber — ISO-style numbering plan', () => {
  it('maps the load-bearing rules exactly', () => {
    expect(classifyRuleNumber('92')).toBe('CREDIT_CAP')
    expect(classifyRuleNumber('94')).toBe('PREMIUM_CAP')
    expect(classifyRuleNumber('205')).toBe('MIN_PREMIUM')
    expect(classifyRuleNumber('406')).toBe('DEDUCTIBLE')
  })
  it('maps the number bands', () => {
    expect(classifyRuleNumber('1')).toBe('BASE_LOSS_COST')
    expect(classifyRuleNumber('2')).toBe('BASE_LOSS_COST')
    expect(classifyRuleNumber('13')).toBe('FACTOR_TABLE')
    expect(classifyRuleNumber('303')).toBe('SCHEDULED_PROPERTY')
    expect(classifyRuleNumber('404')).toBe('PROTECTIVE_DEVICE')
    expect(classifyRuleNumber('521')).toBe('ENDORSEMENT_SCHEDULE')
  })
  it('falls back to OTHER on an unknown number', () => {
    expect(classifyRuleNumber('999')).toBe('OTHER')
    expect(classifyRuleNumber('n/a')).toBe('OTHER')
  })
})

describe('matchConcept — normalized-name + alias join', () => {
  it('resolves rate-order labels and manual titles to the same concept', () => {
    expect(matchConcept('All Perils Deductible')!.key).toBe('allPerilDed')
    expect(matchConcept('406. DEDUCTIBLES')!.key).toBe('allPerilDed')
    expect(matchConcept('Loss Cost Modification Factor')!.key).toBe('lossCostMod')
    expect(matchConcept('Tier')!.key).toBe('tier')
  })
  it('prefers a specific alias over a broad one', () => {
    // "loss cost modification factor" must NOT collapse to the broad "loss cost" (base loss cost).
    expect(matchConcept('Loss Cost Modification Factor')!.key).toBe('lossCostMod')
    expect(matchConcept('ISO Base Loss Cost')!.key).toBe('baseLossCost')
  })
  it('flags credits (subject to the maximum-credit rule)', () => {
    expect(matchConcept('Loyalty Credit')!.isCredit).toBe(true)
    expect(matchConcept('Renovation Credit')!.isCredit).toBe(true)
    expect(matchConcept('Tier')!.isCredit).toBe(false)
  })
  it('returns null for an unknown concept — never a wrong guess', () => {
    expect(matchConcept('Flux Capacitor Surcharge')).toBeNull()
  })
  it('normalizeConcept is punctuation/case/space insensitive', () => {
    expect(normalizeConcept('All-Perils  Deductible')).toBe(normalizeConcept('ALL PERILS DEDUCTIBLE'))
  })
})
