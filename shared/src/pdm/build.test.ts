// build.test.ts — PDM projection completeness. Proves the builder losslessly represents
// both seeded products: every coverage / sub-coverage / term / form / rule / rating step /
// factor table is present, each carrying its refId (and forms their form number), the
// sub-coverage tree is nested by parent, and optional effective-dating flows through.
import { describe, it, expect } from 'vitest'
import { buildPdm } from './build'
import { PERSONAL_HOME_BUNDLE, PERSONAL_AUTO_BUNDLE } from './source'
import { flattenCoverages, allTerms } from './types'
import type { DomainProductBundle } from './build'

const BUNDLES: Array<[string, DomainProductBundle]> = [
  ['Personal Home', PERSONAL_HOME_BUNDLE],
  ['Personal Auto', PERSONAL_AUTO_BUNDLE],
]

describe.each(BUNDLES)('PDM projection completeness — %s', (_name, bundle) => {
  const pdm = buildPdm(bundle)

  it('projects the product identity + refId', () => {
    expect(pdm.refId).toBe(bundle.product.refId)
    expect(pdm.name).toBe(bundle.product.name)
    expect(pdm.line.code).toBe(bundle.lob.prefix)
  })

  it('includes every coverage + sub-coverage, each with a refId', () => {
    const flat = flattenCoverages(pdm.coverages)
    expect(flat.length).toBe(bundle.coverages.length)
    const emitted = new Set(flat.map(c => c.refId))
    for (const c of bundle.coverages) {
      expect(c.refId).toBeTruthy()
      expect(emitted.has(c.refId!)).toBe(true)
    }
    // No refId is blank.
    for (const c of flat) expect(c.refId).not.toBe('')
  })

  it('nests sub-coverages under their parent (not at the root)', () => {
    const subs = bundle.coverages.filter(c => c.parentId)
    const rootRefs = new Set(pdm.coverages.map(c => c.refId))
    for (const sub of subs) {
      // A sub-coverage must not be a root…
      expect(rootRefs.has(sub.refId!)).toBe(false)
      // …and must appear among its parent's descendants.
      const parent = flattenCoverages(pdm.coverages).find(c => c.refId === sub.parentId)!
      const descendants = new Set(flattenCoverages(parent.children).map(c => c.refId))
      expect(descendants.has(sub.refId!)).toBe(true)
    }
  })

  it('includes every term with a derived refId + termKey', () => {
    const terms = allTerms(pdm)
    const domainTermCount = bundle.coverages.reduce((n, c) => n + c.terms.length, 0)
    expect(terms.length).toBe(domainTermCount)
    for (const t of terms) {
      expect(t.refId).toContain('#')
      expect(t.termKey.length).toBeGreaterThan(0)
    }
  })

  it('includes every form, preserving its form number', () => {
    expect(pdm.forms.length).toBe(bundle.forms.length)
    const numbers = new Set(pdm.forms.map(f => f.formNumber))
    for (const f of bundle.forms) {
      expect(numbers.has(f.number)).toBe(true)
      const projected = pdm.forms.find(pf => pf.formNumber === f.number)!
      expect(projected.refId).toBe(f.number)   // the form number IS the ref
      expect(projected.editions.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('unifies product rules + form-attach rules, preserving refIds', () => {
    expect(pdm.rules.length).toBe(bundle.rules.length + bundle.formRules.length)
    const refs = new Set(pdm.rules.map(r => r.refId))
    for (const r of [...bundle.rules, ...bundle.formRules]) expect(refs.has(r.refId!)).toBe(true)
    // Every rule is IF/THEN with at least one action.
    for (const r of pdm.rules) {
      expect(r.condition.length).toBeGreaterThan(0)
      expect(r.actions.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('projects the rating program with every ordered step', () => {
    expect(pdm.ratingPrograms.length).toBe(1)
    const prog = pdm.ratingPrograms[0]!
    expect(prog.refId).toBe(bundle.ratingProgram.refId)
    expect(prog.steps.length).toBe(bundle.ratingProgram.steps.length)
    // Steps stay in ascending order and carry a derived refId.
    for (let i = 1; i < prog.steps.length; i++) {
      expect(prog.steps[i]!.order).toBeGreaterThanOrEqual(prog.steps[i - 1]!.order)
    }
    for (const s of prog.steps) expect(s.refId.startsWith(`${prog.refId}#`)).toBe(true)
  })

  it('includes every RT + LD factor table', () => {
    const rtCount = Object.keys(bundle.rtTables).length
    const ldCount = Object.keys(bundle.ldTables).length
    expect(pdm.ratingTables.length).toBe(rtCount + ldCount)
    const refs = new Set(pdm.ratingTables.map(t => t.refId))
    for (const ref of [...Object.keys(bundle.rtTables), ...Object.keys(bundle.ldTables)]) {
      expect(refs.has(ref)).toBe(true)
    }
    // LD tables preserve their default value.
    for (const [ref, ld] of Object.entries(bundle.ldTables)) {
      const t = pdm.ratingTables.find(x => x.refId === ref)!
      expect(t.kind).toBe('LD')
      if (ld.defaultValue !== undefined) expect(t.defaultValue).toBe(ld.defaultValue)
    }
  })
})

describe('PDM eligible-value lists resolve the real option matrix', () => {
  it('Personal Home Coverage E offers its three LD.001 limits with one default', () => {
    const pdm = buildPdm(PERSONAL_HOME_BUNDLE)
    const covE = flattenCoverages(pdm.coverages).find(c => c.refId === 'PH.COV.005')!
    const limit = covE.terms.find(t => t.kind === 'LIMIT')!
    expect(limit.eligibleValues.map(v => v.value)).toEqual([100000, 300000, 500000])
    expect(limit.eligibleValues.filter(v => v.isDefault).length).toBe(1)
    expect(limit.eligibleValues.find(v => v.isDefault)!.value).toBe(300000)
  })

  it('Personal Auto Collision offers its four LD.005 deductibles', () => {
    const pdm = buildPdm(PERSONAL_AUTO_BUNDLE)
    const collision = flattenCoverages(pdm.coverages).find(c => c.refId === 'PA.COV.004.001')!
    const ded = collision.terms.find(t => t.kind === 'DEDUCTIBLE')!
    expect(ded.eligibleValues.map(v => v.value)).toEqual([100, 250, 500, 1000])
  })
})

describe('per-state variation + optional effective dating', () => {
  it('carries state scope faithfully (footprint, coastal, single-state)', () => {
    const pdm = buildPdm(PERSONAL_HOME_BUNDLE)
    expect(pdm.applicability.allStates).toBe(false)
    expect(pdm.applicability.states).toEqual([...PERSONAL_HOME_BUNDLE.lob.footprintStates])

    const caForm = pdm.forms.find(f => f.formNumber === 'HO 01 04')!
    expect(caForm.applicability.allStates).toBe(false)
    expect(caForm.applicability.states).toEqual(['CA'])

    const windForm = pdm.forms.find(f => f.formNumber === 'HO 03 12')!
    expect(windForm.applicability.states).toEqual([...PERSONAL_HOME_BUNDLE.lob.peril.eligibleStates])
  })

  it('injects an effective date only when supplied — never fabricated', () => {
    const withoutDate = buildPdm(PERSONAL_HOME_BUNDLE)
    expect(withoutDate.applicability.effectiveDate).toBeUndefined()

    const withDate = buildPdm(PERSONAL_HOME_BUNDLE, { effectiveDate: '2026-01-01' })
    expect(withDate.applicability.effectiveDate).toBe('2026-01-01')
    const cov = flattenCoverages(withDate.coverages)[0]!
    expect(cov.applicability.effectiveDate).toBe('2026-01-01')
  })
})
