// Cross-entity join tests — the global command bar's deterministic differentiator.
import { describe, it, expect } from 'vitest'
import type { Coverage, Form, Rule } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import { runGlobalQuery } from './crossEntity'

const gov = { status: 'ACTIVE' as const, lifecycle: 'DRAFT' as const, reviewStatus: 'NOT_STARTED' as const, createdAt: null, updatedAt: null, updatedBy: '', rev: 0 }
const scope = { allStates: true, states: [] as string[] }

function mkCov(p: Partial<Coverage> & { id: string; refId: string }): WithId<Coverage> {
  return { name: p.refId, parentId: null, order: 0, requirement: 'OPTIONAL', claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU', formNumbers: [], terms: [], ...gov, ...scope, ...p }
}
function mkForm(p: Partial<Form> & { id: string; number: string }): WithId<Form> {
  return {
    name: p.number, edition: '05 11', category: 'ENDORSEMENT', claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true, displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [], productRefIds: [], description: '', dynamicFields: [], ...gov, ...scope, ...p,
  }
}

const coverages: WithId<Coverage>[] = [
  mkCov({ id: 'c1', refId: 'PH.COV.001', requirement: 'MANDATORY', formNumbers: ['HO 00 03'] }),
  mkCov({ id: 'c2', refId: 'PH.COV.003.001', requirement: 'OPTIONAL', formNumbers: ['HO 04 90'] }), // optional WITH a form
  mkCov({ id: 'c3', refId: 'PH.COV.007', requirement: 'OPTIONAL', formNumbers: [] }),                // optional, NO form
]
const forms: WithId<Form>[] = [
  mkForm({ id: 'f1', number: 'HO 00 03', category: 'BASE_COVERAGE', mandatoryDefault: true }),
  mkForm({ id: 'f2', number: 'HO 04 90' }),
  mkForm({ id: 'f3', number: 'HO 99 99' }), // referenced by nobody
]
const rules: WithId<Rule>[] = [
  { id: 'ru1', refId: 'PH.RU.001', category: 'PRODUCT', subCategory: 'Eligibility', condition: '', outcome: '', coverageRefIds: ['PH.COV.001'], formNumbers: ['HO 00 03'], ...gov, ...scope },
]

const data = { rules, coverages, forms }

describe('deterministic cross-entity joins (no AI)', () => {
  it('optional coverages with no attached form', () => {
    const res = runGlobalQuery('optional coverages with no attached form', data)
    expect(res.kind).toBe('join')
    const hits = res.groups.flatMap((g) => g.hits)
    expect(hits.map((h) => h.refId)).toEqual(['PH.COV.007'])
    expect(hits[0]!.note).toBe('no attached form')
  })

  it('unused forms (attached by no coverage or rule)', () => {
    const res = runGlobalQuery('unused forms', data)
    expect(res.kind).toBe('join')
    expect(res.groups.flatMap((g) => g.hits).map((h) => h.refId)).toEqual(['HO 99 99'])
  })

  it('broken links (rule referencing a missing form)', () => {
    const withBroken = { ...data, rules: [...rules, { id: 'ru2', refId: 'PH.RU.099', category: 'FORMS' as const, subCategory: 'Forms Attachment Conditions', condition: '', outcome: '', coverageRefIds: [], formNumbers: ['HO 00 00'], ...gov, ...scope }] }
    const res = runGlobalQuery('broken link', withBroken)
    expect(res.kind).toBe('join')
    const hit = res.groups.flatMap((g) => g.hits).find((h) => h.refId === 'PH.RU.099')
    expect(hit?.note).toContain('HO 00 00')
  })
})

describe('grouped free-text + universal-token search', () => {
  it('groups results by entity type and honors status: tokens', () => {
    const res = runGlobalQuery('HO', data)  // matches form numbers/names
    expect(res.kind).toBe('search')
    expect(res.groups.find((g) => g.entityType === 'form')!.hits.length).toBe(3)
  })

  it('reports empty with an AI-fallback offer for an unresolved query', () => {
    const res = runGlobalQuery('xyzzy nonexistent', data)
    expect(res.kind).toBe('empty')
    expect(res.canInterpret).toBe(true)
  })
})
