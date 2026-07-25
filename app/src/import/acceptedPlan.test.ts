// acceptedPlan.test.ts — the reviewer's include/exclude choices must exactly determine
// what gets written. Excluded data (a dropped section OR a dropped row) must NEVER reach
// the plan importPlan() persists.
import { describe, it, expect } from 'vitest'
import { acceptedPlan, countPlan } from './acceptedPlan'
import type { UnifiedProposalBundle, FilingReviewSectionKey } from '@pf/shared'

const ent = (docId: string) => ({ docId, refId: docId, label: docId, data: {} })

const bundle = {
  plan: {
    productId: 'P.1', product: ent('P.1'), products: [ent('P.1')],
    coverages:     [ent('COV.1'), ent('COV.2')],
    forms:         [ent('FORM.1')],
    rules:         [ent('RU.1')],
    formRules:     [ent('FR.1')],
    rtTables:      [ent('RT.1')],
    ldTables:      [ent('LD.1')],
    ratingProgram: ent('PROG.1'),
    ratePlaceholders: [],
    summary: {},
  },
} as unknown as UnifiedProposalBundle

const ALL = new Set<FilingReviewSectionKey>(['coverages', 'tables', 'rules', 'rating'])
const ids = (arr: Array<{ docId?: string }> | null | undefined) => (arr ?? []).map(e => e.docId)

describe('acceptedPlan — section + per-item gating', () => {
  it('keeps everything when all sections are on and nothing is excluded', () => {
    const p = acceptedPlan(bundle, ALL)
    expect(ids(p.coverages)).toEqual(['COV.1', 'COV.2'])
    expect(ids(p.forms)).toEqual(['FORM.1'])
    expect(ids(p.rules)).toEqual(['RU.1'])
    expect(ids(p.formRules)).toEqual(['FR.1'])
    expect(ids(p.rtTables)).toEqual(['RT.1'])
    expect(ids(p.ldTables)).toEqual(['LD.1'])
    expect(p.ratingProgram?.docId).toBe('PROG.1')
    expect(countPlan(p)).toBe(1 + 2 + 1 + 1 + 1 + 1 + 1 + 1) // product + all
  })

  it('drops a single excluded row but keeps the rest of its section', () => {
    const p = acceptedPlan(bundle, ALL, new Set(['COV.2']))
    expect(ids(p.coverages)).toEqual(['COV.1'])   // COV.2 dropped
    expect(ids(p.forms)).toEqual(['FORM.1'])       // section otherwise intact
  })

  it('an unchecked section writes none of its items (rules + formRules together)', () => {
    const p = acceptedPlan(bundle, new Set<FilingReviewSectionKey>(['coverages', 'tables', 'rating']))
    expect(ids(p.rules)).toEqual([])
    expect(ids(p.formRules)).toEqual([])
    expect(ids(p.coverages)).toEqual(['COV.1', 'COV.2'])
  })

  it('excluding a table drops just that table; tables share the rating/tables gate', () => {
    const p = acceptedPlan(bundle, ALL, new Set(['RT.1']))
    expect(ids(p.rtTables)).toEqual([])
    expect(ids(p.ldTables)).toEqual(['LD.1'])
  })

  it('excluding the rating program nulls it', () => {
    const p = acceptedPlan(bundle, ALL, new Set(['PROG.1']))
    expect(p.ratingProgram).toBeNull()
  })

  it('excluded data is never written — count falls by exactly the drops', () => {
    const full = countPlan(acceptedPlan(bundle, ALL))
    const dropped = countPlan(acceptedPlan(bundle, ALL, new Set(['COV.1', 'RT.1'])))
    expect(full - dropped).toBe(2)
  })
})

// ─── Ledger #10 ───────────────────────────────────────────────────────────────
// Dropping a parent used to leave its KEPT children pointing at a refId no longer in the
// plan. The server validates parentId live and throws INVALID_PARENT, which fails the whole
// Cosmos batch — so one exclusion silently took the reviewer's kept children and every
// unrelated valid sibling with it, surfacing only as an aggregate "skipped" count.

const child = (docId: string, parentId: string | null) =>
  ({ docId, refId: docId, label: docId, data: { parentId } })

const treeBundle = {
  plan: {
    productId: 'P.1', product: ent('P.1'), products: [ent('P.1')],
    coverages: [
      ent('COV.PARENT'),
      child('COV.CHILD.A', 'COV.PARENT'),
      child('COV.CHILD.B', 'COV.PARENT'),
      ent('COV.UNRELATED'),
    ],
    forms: [], rules: [], formRules: [], rtTables: [], ldTables: [],
    ratingProgram: null, ratePlaceholders: [], summary: {},
  },
} as unknown as UnifiedProposalBundle

describe('#10 excluding a parent must not strand its kept children', () => {
  it('promotes kept children to top level instead of leaving a dangling parentId', () => {
    const p = acceptedPlan(treeBundle, ALL, new Set(['COV.PARENT']))
    expect(ids(p.coverages)).toEqual(['COV.CHILD.A', 'COV.CHILD.B', 'COV.UNRELATED'])
    for (const c of p.coverages!.filter(x => x.docId!.startsWith('COV.CHILD'))) {
      expect((c.data as Record<string, unknown>)['parentId']).toBeNull()
      expect((c.data as Record<string, unknown>)['parentExcluded']).toBe('COV.PARENT')
      expect((c.data as Record<string, unknown>)['needsReview']).toBe(true)
    }
  })

  it('leaves an intact hierarchy completely untouched', () => {
    const p = acceptedPlan(treeBundle, ALL)
    const a = p.coverages!.find(c => c.docId === 'COV.CHILD.A')!
    expect((a.data as Record<string, unknown>)['parentId']).toBe('COV.PARENT')
    expect((a.data as Record<string, unknown>)['parentExcluded']).toBeUndefined()
  })

  it('no kept coverage ever references a parent absent from the written plan', () => {
    // The invariant the server enforces, asserted directly over every exclusion choice.
    const choices = [['COV.PARENT'], ['COV.PARENT', 'COV.CHILD.A'], ['COV.UNRELATED'], []]
    for (const excluded of choices) {
      const p = acceptedPlan(treeBundle, ALL, new Set(excluded))
      const present = new Set(p.coverages!.map(c => c.refId))
      for (const c of p.coverages!) {
        const pid = (c.data as Record<string, unknown>)['parentId']
        if (typeof pid === 'string' && pid !== '') expect(present.has(pid)).toBe(true)
      }
    }
  })

  it('dropping a whole section still yields no dangling references', () => {
    const p = acceptedPlan(treeBundle, new Set<FilingReviewSectionKey>(['rules']))
    expect(ids(p.coverages)).toEqual([])
  })
})
