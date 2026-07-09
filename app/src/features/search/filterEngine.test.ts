// Engine acceptance tests — proven on the Rules reference schema. Pure, no DOM.
import { describe, it, expect } from 'vitest'
import type { Rule } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import { emptyFilterState } from './facetTypes'
import { createSchemaIndex } from './schemaIndex'
import { buildChips, detectUnknownValues, reconcileState, runEngine } from './filterEngine'
import * as ops from './stateOps'
import { paramsToState, stateToParams } from './urlState'
import { rulesSchema, normalizeSubCategory } from './schemas/rulesSchema'

function mkRule(p: Partial<Rule> & { id: string }): WithId<Rule> {
  return {
    id: p.id,
    refId: p.refId ?? p.id,
    category: p.category ?? 'PRODUCT',
    subCategory: p.subCategory ?? 'Eligibility',
    condition: p.condition ?? '',
    outcome: p.outcome ?? '',
    coverageRefIds: p.coverageRefIds ?? [],
    formNumbers: p.formNumbers ?? [],
    allStates: p.allStates ?? true,
    states: p.states ?? [],
    status: p.status ?? 'ACTIVE',
    lifecycle: p.lifecycle ?? 'DRAFT',
    reviewStatus: p.reviewStatus ?? 'NOT_STARTED',
    createdAt: null, updatedAt: null, updatedBy: '', rev: 0,
  }
}

const index = createSchemaIndex(rulesSchema)

const RULES: WithId<Rule>[] = [
  mkRule({ id: 'r1', category: 'PRODUCT', subCategory: 'Eligibility' }),                    // -> Product Eligibility
  mkRule({ id: 'r2', category: 'PRODUCT', subCategory: 'Coverage Limits' }),                // -> Limit Ranges and Defaults
  mkRule({ id: 'r3', category: 'PRODUCT', subCategory: 'Base Coverage (Default)' }),
  mkRule({ id: 'r4', category: 'RATING',  subCategory: 'Premium Floor' }),                  // -> Minimum / Additional / Return Premium
  mkRule({ id: 'r5', category: 'PRODUCT', subCategory: 'Base Coverage (Default)', status: 'INACTIVE' }),
]

describe('alias normalization', () => {
  it('folds seed sub-categories onto the canonical vocabulary', () => {
    expect(normalizeSubCategory('Eligibility')).toBe('Product Eligibility')
    expect(normalizeSubCategory('Coverage Limits')).toBe('Limit Ranges and Defaults')
    expect(normalizeSubCategory('Premium Floor')).toBe('Minimum / Additional / Return Premium')
  })
  it('collapses casing + trailing-whitespace drift', () => {
    expect(normalizeSubCategory('Packaging / Line of Business  ')).toBe('Packaging / Line of Business')
  })
  it('resolves the "opt cov" typeahead shorthand with no network call', () => {
    expect(index.hierarchies.get('category')!.childValueOfToken.get('opt cov')).toBe('Optional Coverage Eligibility')
  })
  it('passes an unmapped value through untouched (to be surfaced, not hidden)', () => {
    expect(normalizeSubCategory('Totally Novel Category')).toBe('Totally Novel Category')
  })
})

describe('faceted counts (not naive)', () => {
  it('counts every value with an empty filter', () => {
    const { results, counts } = runEngine(index, RULES, emptyFilterState())
    expect(results).toHaveLength(5)
    expect(counts.hierarchies.category!.parents.PRODUCT).toBe(4)
    expect(counts.hierarchies.category!.parents.RATING).toBe(1)
    expect(counts.hierarchies.category!.children['Base Coverage (Default)']).toBe(2)
    expect(counts.enums.status!.ACTIVE).toBe(4)
    expect(counts.enums.status!.INACTIVE).toBe(1)
  })

  it('selecting Product narrows results but keeps the OTHER-dimension counts faceted', () => {
    const s = ops.toggleParent(index, emptyFilterState(), 'category', 'PRODUCT')
    const { results, counts } = runEngine(index, RULES, s)
    expect(results.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3', 'r5'])
    // status counts reflect the Product filter (its own dimension excluded is category, not status)
    expect(counts.enums.status!.ACTIVE).toBe(3)
    expect(counts.enums.status!.INACTIVE).toBe(1)
    // category counts are computed with the category dimension excluded, so RATING still shows
    expect(counts.hierarchies.category!.parents.RATING).toBe(1)
  })

  it('Product then Base Coverage (Default) narrows to the matching rules', () => {
    let s = ops.toggleParent(index, emptyFilterState(), 'category', 'PRODUCT')
    s = ops.toggleChild(index, s, 'category', 'Base Coverage (Default)')
    const { results, counts } = runEngine(index, RULES, s)
    expect(results.map((r) => r.id).sort()).toEqual(['r3', 'r5'])
    expect(counts.hierarchies.category!.children['Base Coverage (Default)']).toBe(2)
  })
})

describe('OR within a dimension, AND across dimensions', () => {
  it('ORs sibling children and ANDs a second dimension', () => {
    let s = ops.toggleChild(index, emptyFilterState(), 'category', 'Product Eligibility')
    s = ops.toggleChild(index, s, 'category', 'Base Coverage (Default)')
    expect(runEngine(index, RULES, s).results.map((r) => r.id).sort()).toEqual(['r1', 'r3', 'r5'])  // OR
    s = ops.toggleEnum(s, 'status', 'ACTIVE')
    expect(runEngine(index, RULES, s).results.map((r) => r.id).sort()).toEqual(['r1', 'r3'])          // AND status
  })
})

describe('state applicability', () => {
  it('an all-states entity matches any state filter; a scoped one does not', () => {
    const rules = [mkRule({ id: 'all', allStates: true }), mkRule({ id: 'tx', allStates: false, states: ['TX'] })]
    const s = ops.toggleEnum(emptyFilterState(), 'state', 'CA')
    expect(runEngine(index, rules, s).results.map((r) => r.id)).toEqual(['all'])
  })
})

describe('reconciliation', () => {
  it('deselecting a parent drops its orphaned children', () => {
    let s = ops.toggleChild(index, emptyFilterState(), 'category', 'Base Coverage (Default)')
    expect(s.hierarchies.category!.parents).toContain('PRODUCT')
    s = ops.toggleParent(index, s, 'category', 'PRODUCT')  // deselect the branch
    expect(s.hierarchies.category).toBeUndefined()
  })
  it('reconcileState drops a child whose parent is not selected and reports it', () => {
    const s = { ...emptyFilterState(), hierarchies: { category: { parents: [], children: ['Base Coverage (Default)'] } } }
    const { state, report } = reconcileState(index, s)
    expect(state.hierarchies.category).toBeUndefined()
    expect(report.dropped).toHaveLength(1)
    expect(report.dropped[0]!.reason).toBe('category deselected')
  })
})

describe('unknown-value surfacing', () => {
  it('surfaces a sub-category present in data but absent from the taxonomy', () => {
    const rules = [mkRule({ id: 'x', subCategory: 'Totally Novel Category' })]
    const unknowns = detectUnknownValues(index, rules)
    expect(unknowns).toContainEqual({ facetId: 'category', axis: 'child', value: 'Totally Novel Category', count: 1 })
  })
})

describe('active chips', () => {
  it('produces a removable chip per active selection', () => {
    let s = ops.toggleParent(index, emptyFilterState(), 'category', 'RATING')
    s = ops.toggleEnum(s, 'status', 'ACTIVE')
    const chips = buildChips(index, s)
    expect(chips.map((c) => c.label).sort()).toEqual(['Rating', 'Status: Active'])
  })
})

describe('URL round-trip', () => {
  it('serializes tokens (Active, Product) and rehydrates the exact state', () => {
    let s = ops.toggleChild(index, emptyFilterState(), 'category', 'Optional Coverage Eligibility')
    s = ops.toggleEnum(s, 'status', 'ACTIVE')
    s = ops.toggleEnum(s, 'state', 'CA')
    s = ops.setText(s, 'flood')
    const params = stateToParams(index, s)
    expect(params.get('status')).toBe('Active')
    expect(params.get('cat')).toBe('Product')
    expect(params.get('sub')).toBe('Optional Coverage Eligibility')
    expect(params.get('q')).toBe('flood')
    const round = paramsToState(index, params)
    expect(round).toEqual(s)
  })
})

describe('performance', () => {
  it('re-filters 5,000 rules well under the 16ms budget', () => {
    const many: WithId<Rule>[] = []
    const subs = ['Eligibility', 'Coverage Limits', 'Base Coverage (Default)', 'Premium Floor', 'Deductibles']
    for (let i = 0; i < 5000; i++) {
      many.push(mkRule({ id: `m${i}`, category: i % 4 === 0 ? 'RATING' : 'PRODUCT', subCategory: subs[i % subs.length], status: i % 3 === 0 ? 'INACTIVE' : 'ACTIVE', allStates: i % 2 === 0, states: ['TX'] }))
    }
    const s = ops.toggleParent(index, emptyFilterState(), 'category', 'PRODUCT')
    const first = runEngine(index, many, s)
    expect(first.results.length).toBeGreaterThan(0)
    expect(first.counts.enums.status!.ACTIVE).toBeGreaterThan(0)
    // Median of several steady-state runs, to stay honest about the 16ms interactive
    // budget without flaking on a one-off cold run / GC spike.
    const timings: number[] = []
    for (let i = 0; i < 7; i++) { const t = performance.now(); runEngine(index, many, s); timings.push(performance.now() - t) }
    timings.sort((a, b) => a - b)
    expect(timings[3]).toBeLessThan(16)
  })
})
