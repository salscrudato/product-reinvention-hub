// termConstraints tests — lock the premium-editor validation both the app editor and
// the mutate() seam depend on: the intrinsic typed-model invariants, the Homeowners
// demonstrative cross-coverage constraints, and (critically) that the real HO-3 seed
// validates clean once its terms are resolved into option matrices — no false alarms.
import { describe, it, expect } from 'vitest'
import {
  validateTerm, validateCoverageTerms, assertCoverageTermsValid,
} from './termConstraints'
import { resolveTermOptions } from './terms'
import { HO3_COVERAGES, HO3_FOOTPRINT_STATES } from '../seed/ho3'
import { HO3_LD_TABLES } from '../seed/ho3'
import type { Coverage, CoverageTerm, StandardOption } from '../types'

const HO = { lob: { refId: 'HO.LOB.001' } }

function opt(o: Partial<StandardOption> & { id: string }): StandardOption {
  return { type: 'FLAT', value: 0, allStates: true, states: [], isDefault: false, enabled: true, ...o }
}
function limitTerm(id: string, optionSet: StandardOption[], extra: Partial<CoverageTerm> = {}): CoverageTerm {
  return { id, kind: 'LIMIT', label: id, basis: 'per occurrence', default: 0, optionSet, ...extra }
}
function coverage(name: string, terms: CoverageTerm[], extra: Partial<Coverage> = {}): Coverage {
  return {
    refId: null, name, parentId: null, order: 1, requirement: 'OPTIONAL', claimsBasis: 'Occurrence',
    premiumGenerating: true, source: 'BUREAU', formNumbers: [], terms,
    allStates: true, states: [],
    status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
    createdAt: null, updatedAt: null, updatedBy: '', rev: 1, ...extra,
  }
}

describe('intrinsic invariants', () => {
  it('accepts exactly one enabled default with in-scope states', () => {
    const t = limitTerm('t', [
      opt({ id: 'a', value: 100000, isDefault: true }),
      opt({ id: 'b', value: 300000 }),
    ])
    expect(validateTerm(t, ['OH'])).toEqual([])
  })

  it('flags two defaults', () => {
    const t = limitTerm('t', [
      opt({ id: 'a', value: 100000, isDefault: true }),
      opt({ id: 'b', value: 300000, isDefault: true }),
    ])
    const codes = validateTerm(t, null).map(i => i.code)
    expect(codes).toContain('multi-default')
  })

  it('flags no default among enabled options', () => {
    const t = limitTerm('t', [opt({ id: 'a', value: 100000 }), opt({ id: 'b', value: 300000 })])
    expect(validateTerm(t, null).map(i => i.code)).toContain('no-default')
  })

  it('flags an option whose states escape the coverage scope', () => {
    const t = limitTerm('t', [opt({ id: 'a', value: 1000, isDefault: true, allStates: false, states: ['OH', 'ZZ'] })])
    const issue = validateTerm(t, ['OH', 'CA']).find(i => i.code === 'states-scope')
    expect(issue).toBeTruthy()
    expect(issue!.message).toContain('ZZ')
  })

  it('flags an empty per-option state selection', () => {
    const t = limitTerm('t', [opt({ id: 'a', value: 1000, isDefault: true, allStates: false, states: [] })])
    expect(validateTerm(t, ['OH']).map(i => i.code)).toContain('no-states')
  })

  it('flags a percentage outside 1–100', () => {
    const t = limitTerm('t', [opt({ id: 'a', type: 'PERCENT', value: 140, isDefault: true })])
    expect(validateTerm(t, null).map(i => i.code)).toContain('pct-range')
  })

  it('flags a value outside [min,max]', () => {
    const t = limitTerm('t', [opt({ id: 'a', value: 9_000_000, isDefault: true })], { min: 100000, max: 1_000_000 })
    expect(validateTerm(t, null).map(i => i.code)).toContain('range-max')
  })

  it('ignores a term with no options (e.g. a yes/no OPTION flag)', () => {
    const flag: CoverageTerm = { id: 'rc', kind: 'OPTION', label: 'Replacement Cost', basis: 'flag', default: false, optionSet: [] }
    expect(validateTerm(flag, null)).toEqual([])
  })
})

describe('HO demonstrative — Coverage F $5,000 requires Coverage E ≥ $300,000', () => {
  const covF = coverage('Coverage F — Medical Payments', [
    limitTerm('cov-f', [
      opt({ id: 'f1', value: 1000, isDefault: true }),
      opt({ id: 'f5', value: 5000 }),
    ], { ldTableRef: 'HO.LD.002' }),
  ])

  it('errors when Coverage E tops out below $300,000', () => {
    const covE = coverage('Coverage E — Personal Liability', [
      limitTerm('cov-e', [opt({ id: 'e1', value: 100000, isDefault: true })], { ldTableRef: 'HO.LD.001' }),
    ])
    const issues = validateCoverageTerms(covF, [covF, covE], HO, HO3_LD_TABLES, null)
    const hit = issues.find(i => i.code === 'covF-requires-covE')
    expect(hit).toBeTruthy()
    expect(hit!.optionId).toBe('f5')
  })

  it('passes when Coverage E offers ≥ $300,000', () => {
    const covE = coverage('Coverage E — Personal Liability', [
      limitTerm('cov-e', [
        opt({ id: 'e1', value: 100000 }),
        opt({ id: 'e3', value: 300000, isDefault: true }),
      ], { ldTableRef: 'HO.LD.001' }),
    ])
    const issues = validateCoverageTerms(covF, [covF, covE], HO, HO3_LD_TABLES, null)
    expect(issues.find(i => i.code === 'covF-requires-covE')).toBeFalsy()
  })

  it('does not fire for a non-HO product', () => {
    const covE = coverage('Coverage E', [limitTerm('cov-e', [opt({ id: 'e1', value: 100000, isDefault: true })], { ldTableRef: 'HO.LD.001' })])
    const GL = { lob: { refId: 'GL.LOB.001' } }
    expect(validateCoverageTerms(covF, [covF, covE], GL, HO3_LD_TABLES, null).find(i => i.code === 'covF-requires-covE')).toBeFalsy()
  })
})

describe('HO demonstrative — wind/hail % deductible ≥ all-peril deductible', () => {
  const covA = coverage('Coverage A — Dwelling', [
    limitTerm('cov-a', [opt({ id: 'a', value: 100000, isDefault: true })]),
  ], { refId: 'HO.COV.001' })

  function windHailCoverage(pct: number, allPerilMax: number): Coverage {
    return coverage('Deductibles', [
      { id: 'aop', kind: 'DEDUCTIBLE', label: 'All-Peril Deductible', basis: 'flat', default: allPerilMax,
        optionSet: [opt({ id: 'aop1', value: allPerilMax, isDefault: true })], ldTableRef: 'HO.LD.003' },
      { id: 'wh', kind: 'DEDUCTIBLE', label: 'Wind/Hail % Deductible', basis: 'percent', default: pct, unit: '%',
        optionSet: [opt({ id: 'wh1', type: 'PERCENT', value: pct, isDefault: true })], ldTableRef: 'HO.LD.004' },
    ])
  }

  it('errors when the % of the smallest dwelling is below the all-peril deductible', () => {
    // 1% of $100,000 = $1,000 < $2,500 all-peril → violation
    const cov = windHailCoverage(1, 2500)
    const issues = validateCoverageTerms(cov, [cov, covA], HO, HO3_LD_TABLES, null)
    expect(issues.find(i => i.code === 'windHail-lt-allPeril')).toBeTruthy()
  })

  it('passes when the % clears the all-peril deductible', () => {
    // 5% of $100,000 = $5,000 ≥ $2,500 all-peril → ok
    const cov = windHailCoverage(5, 2500)
    const issues = validateCoverageTerms(cov, [cov, covA], HO, HO3_LD_TABLES, null)
    expect(issues.find(i => i.code === 'windHail-lt-allPeril')).toBeFalsy()
  })
})

describe('mutate() seam assert', () => {
  it('throws on two defaults', () => {
    const cov = { allStates: true, states: [], terms: [limitTerm('t', [
      opt({ id: 'a', value: 1, isDefault: true }), opt({ id: 'b', value: 2, isDefault: true }),
    ])] }
    expect(() => assertCoverageTermsValid(cov)).toThrow(/one option/i)
  })

  it('throws when an option escapes a fixed coverage scope', () => {
    const cov = { allStates: false, states: ['OH'], terms: [limitTerm('t', [
      opt({ id: 'a', value: 1, isDefault: true, allStates: false, states: ['CA'] }),
    ])] }
    expect(() => assertCoverageTermsValid(cov)).toThrow(/outside/i)
  })

  it('passes a valid coverage', () => {
    const cov = { allStates: false, states: ['OH', 'CA'], terms: [limitTerm('t', [
      opt({ id: 'a', value: 1, isDefault: true, allStates: false, states: ['OH'] }),
    ])] }
    expect(() => assertCoverageTermsValid(cov)).not.toThrow()
  })
})

describe('no false positives on the real HO-3 seed', () => {
  it('every seeded coverage validates clean once its terms resolve into option matrices', () => {
    const resolved: Coverage[] = HO3_COVERAGES.map(c => ({
      ...(c as unknown as Coverage),
      terms: (c.terms ?? []).map(t => ({ ...t, optionSet: resolveTermOptions(t, t.ldTableRef ? HO3_LD_TABLES[t.ldTableRef] : undefined) })),
    }))
    for (const cov of resolved) {
      const issues = validateCoverageTerms(cov, resolved, HO, HO3_LD_TABLES, [...HO3_FOOTPRINT_STATES])
      const errors = issues.filter(i => i.severity === 'error')
      expect(errors, `${cov.name}: ${errors.map(e => e.message).join(' | ')}`).toEqual([])
    }
  })
})
