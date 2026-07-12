// Scorer tests — prove the offline judge computes the full metric set correctly: a
// PERFECT producer scores 1.0 across the board, and a DELIBERATELY DEGRADED producer is
// caught on every axis (recall, precision, refId-exactness, parentId orphans, enum
// conformance, silent drops). If the scorer can't tell perfect from degraded it is useless
// as the loop's judge, so both directions are asserted.
import { describe, it, expect } from 'vitest'
import {
  validateAgainstExpected, type HarnessEntity, type ExpectedSnapshot,
} from './validateAgainstExpected'

// A small but structurally complete expected snapshot: a parent + child coverage, a form,
// and a rule — enough to exercise alignment, refId-exactness, parentId links and enums.
const EXPECTED: ExpectedSnapshot = {
  line: 'GL',
  entities: [
    { entityType: 'coverage', key: 'cov:premises', refId: 'GL.COV.001', parentRefId: null,
      fields: { requirement: 'MANDATORY', status: 'ACTIVE' } },
    { entityType: 'coverage', key: 'cov:terrorism', refId: 'GL.COV.001.001', parentRefId: 'GL.COV.001',
      fields: { requirement: 'OPTIONAL', status: 'ACTIVE' } },
    { entityType: 'form', key: 'form:CG 00 01', refId: null,
      fields: { category: 'BASE_COVERAGE', source: 'BUREAU' } },
    { entityType: 'rule', key: 'rule:GL.RU.001', refId: 'GL.RU.001',
      fields: { category: 'PRODUCT' } },
  ],
}

/** A faithful producer: emits exactly the expected entities. */
function perfectProducer(): HarnessEntity[] {
  return EXPECTED.entities.map(e => ({ ...e, fields: { ...e.fields } }))
}

describe('validateAgainstExpected — perfect producer', () => {
  const r = validateAgainstExpected(perfectProducer(), EXPECTED)

  it('scores precision/recall/F1 = 1.0 overall and per entity', () => {
    expect(r.overall).toMatchObject({ precision: 1, recall: 1, f1: 1, fp: 0, fn: 0 })
    for (const e of r.perEntity) expect(e.f1).toBe(1)
  })

  it('refId-exactness is 100% (over the entities that carry a refId)', () => {
    expect(r.refIdChecked).toBe(3) // 2 coverages + 1 rule (the form's refId is null)
    expect(r.refIdExactnessPct).toBe(100)
  })

  it('no parentId orphans, no enum violations, no silent drops', () => {
    expect(r.parentIdOrphans).toBe(0)
    expect(r.enumConformancePct).toBe(100)
    expect(r.enumViolations).toEqual([])
    expect(r.silentDrops).toBe(0)
  })
})

describe('validateAgainstExpected — degraded producer is caught on every axis', () => {
  // Degradations: mangle the parent coverage's refId; orphan the child (parent not produced
  // under that refId); drop the form entirely; add a ghost rule not in expected; emit a bad
  // enum value on the parent coverage.
  const degraded: HarnessEntity[] = [
    { entityType: 'coverage', key: 'cov:premises', refId: 'GL.COV.999', parentRefId: null,
      fields: { requirement: 'SORTA_MANDATORY', status: 'ACTIVE' } },
    { entityType: 'coverage', key: 'cov:terrorism', refId: 'GL.COV.001.001', parentRefId: 'GL.COV.404',
      fields: { requirement: 'OPTIONAL', status: 'ACTIVE' } },
    // form dropped
    { entityType: 'rule', key: 'rule:GL.RU.001', refId: 'GL.RU.001', fields: { category: 'PRODUCT' } },
    { entityType: 'rule', key: 'rule:GHOST', refId: 'GL.RU.999', fields: { category: 'PRODUCT' } },
  ]
  const r = validateAgainstExpected(degraded, EXPECTED)

  it('recall < 1 (dropped form) and precision < 1 (ghost rule)', () => {
    expect(r.overall.recall).toBeLessThan(1)
    expect(r.overall.precision).toBeLessThan(1)
    const forms = r.perEntity.find(e => e.entityType === 'form')!
    expect(forms.fn).toBe(1)
    const rules = r.perEntity.find(e => e.entityType === 'rule')!
    expect(rules.fp).toBe(1)
  })

  it('refId-exactness drops below 100% (parent coverage refId mangled)', () => {
    expect(r.refIdExactnessPct).toBeLessThan(100)
    expect(r.refIdExact).toBe(2)   // child coverage + rule still exact
    expect(r.refIdChecked).toBe(3)
  })

  it('flags the orphaned child coverage', () => {
    expect(r.parentIdOrphans).toBe(1)
    expect(r.orphanKeys).toEqual(['cov:terrorism'])
  })

  it('flags the invalid enum value', () => {
    expect(r.enumViolations).toHaveLength(1)
    expect(r.enumViolations[0]).toMatchObject({ field: 'requirement', value: 'SORTA_MANDATORY' })
    expect(r.enumConformancePct).toBeLessThan(100)
  })

  it('counts the dropped form as a silent drop', () => {
    expect(r.silentDrops).toBe(1)
    expect(r.silentDropKeys).toEqual(['form::form:CG 00 01'])
  })
})

describe('validateAgainstExpected — empty producer', () => {
  const r = validateAgainstExpected([], EXPECTED)
  it('recall 0, everything dropped, but no false positives or orphans', () => {
    expect(r.overall.recall).toBe(0)
    expect(r.overall.fp).toBe(0)
    expect(r.parentIdOrphans).toBe(0)
    expect(r.silentDrops).toBe(EXPECTED.entities.length)
    expect(r.refIdExactnessPct).toBe(100) // nothing aligned → nothing to check
  })
})
