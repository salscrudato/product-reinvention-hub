// Pricing must attach to a coverage because the SOURCE says so, not because a label
// happened to share a word.
//
// Core-format rating sheets name the coverage each step prices in their own column
// (canonicalMap `coverageRef` — e.g. "CORE.COV.018" beside "Income Loss Benefits"), and a
// cell may list several ("CORE.COV.005; CORE.COV.007"). The linker ignored it entirely and
// ran on heuristics, which both over-matches (any step mentioning "tools" attaches to
// Automotive Tools) and under-matches (a step labelled only "Base rate" attaches to nothing).
import { describe, it, expect } from 'vitest'
import { linkCoverageToPricing } from './pricingLinks'
import type { Coverage, RatingProgram, RatingStep } from '@pf/shared'

const step = (over: Partial<RatingStep> & { coverageRef?: string }): RatingStep =>
  ({ id: 'x', order: 1, label: 'Base rate', op: 'MUL', source: { type: 'INPUT', ref: 'base' }, ...over }) as RatingStep

const program = (steps: RatingStep[]) => ({ steps }) as Pick<RatingProgram, 'steps'>
const cov = (refId: string | null, name: string, terms: unknown[] = []) =>
  ({ refId, name, terms }) as unknown as Pick<Coverage, 'name' | 'terms'> & { refId?: string | null }

describe('a stated coverageRef is authoritative', () => {
  it('attaches the step the source names, even when the label shares no word', () => {
    const p = program([
      step({ id: 's1', label: 'Base rate', coverageRef: 'CORE.COV.018' }),
      step({ id: 's2', label: 'Insurance score factor', coverageRef: 'CORE.COV.099' }),
    ])
    const link = linkCoverageToPricing(cov('CORE.COV.018', 'Income Loss Benefits'), p, {}, {})
    expect(link.steps.map(s => s.id)).toEqual(['s1'])
  })

  it('honours a cell listing SEVERAL coverages', () => {
    const p = program([step({ id: 's1', label: 'Shared step', coverageRef: 'CORE.COV.005; CORE.COV.007' })])
    expect(linkCoverageToPricing(cov('CORE.COV.005', 'Collision'), p, {}, {}).steps.map(s => s.id)).toEqual(['s1'])
    expect(linkCoverageToPricing(cov('CORE.COV.007', 'Other Than Collision'), p, {}, {}).steps.map(s => s.id)).toEqual(['s1'])
    expect(linkCoverageToPricing(cov('CORE.COV.009', 'Unrelated'), p, {}, {}).steps).toEqual([])
  })

  it('a stated link SUPPRESSES the word heuristic — no spurious extras', () => {
    // "Automotive Tools" would word-match s2 ("tools"), but the source assigned s2 elsewhere.
    const p = program([
      step({ id: 's1', label: 'Flat charge', coverageRef: 'CORE.COV.012' }),
      step({ id: 's2', label: 'Automotive tools uplift', coverageRef: 'CORE.COV.099' }),
    ])
    const link = linkCoverageToPricing(cov('CORE.COV.012', 'Automotive Tools Coverage'), p, {}, {})
    expect(link.steps.map(s => s.id)).toEqual(['s1'])
  })

  it('collects the distinct tables the stated steps read', () => {
    const p = program([
      step({ id: 's1', coverageRef: 'C.1', source: { type: 'RT', ref: 'RT.A' } }),
      step({ id: 's2', coverageRef: 'C.1', source: { type: 'RT', ref: 'RT.A' } }),
      step({ id: 's3', coverageRef: 'C.1', source: { type: 'RT', ref: 'RT.B' } }),
    ])
    const link = linkCoverageToPricing(cov('C.1', 'Anything'), p, { 'RT.A': { name: 'Territory' } } as never, {})
    expect(link.tables.map(t => t.ref)).toEqual(['RT.A', 'RT.B'])
    expect(link.tables[0]!.name).toBe('Territory')
  })
})

describe('the heuristics still apply when nothing is stated (no regression)', () => {
  it('falls back to the shared-table match', () => {
    const p = program([step({ id: 's1', label: 'Opaque', source: { type: 'LD', ref: 'LD.7' } })])
    const c = cov('C.1', 'Whatever', [{ ldTableRef: 'LD.7' }])
    expect(linkCoverageToPricing(c, p, {}, {}).steps.map(s => s.id)).toEqual(['s1'])
  })

  it('falls back to the distinctive-word match', () => {
    const p = program([step({ id: 's1', label: 'Collision deductible factor' })])
    expect(linkCoverageToPricing(cov('C.1', 'Collision Coverage'), p, {}, {}).steps.map(s => s.id)).toEqual(['s1'])
  })

  it('a coverage with no refId still uses the heuristics', () => {
    const p = program([step({ id: 's1', label: 'Collision deductible factor', coverageRef: 'C.9' })])
    expect(linkCoverageToPricing(cov(null, 'Collision Coverage'), p, {}, {}).steps.map(s => s.id)).toEqual(['s1'])
  })

  it('a step with no source does not crash the linker', () => {
    const p = program([{ id: 's1', order: 1, label: 'Collision', op: 'MUL' } as unknown as RatingStep])
    expect(() => linkCoverageToPricing(cov('C.1', 'Collision Coverage'), p, {}, {})).not.toThrow()
  })
})
