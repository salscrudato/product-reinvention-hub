// Proves the load-bearing invariant of the Claims copilot: a substantive coverage
// determination can never be rendered without citing a source, while the honest
// NOT_ADDRESSED answer is always allowed through. Mirrors the server guard in
// functions/src/claims.ts.
import { describe, it, expect } from 'vitest'
import { isDeterminationCited, shouldRenderDetermination, type Determination } from './determination'

const base: Determination = {
  verdict: 'COVERED', summary: 'x', coverages: [], limits: [], reasoning: [],
}

describe('isDeterminationCited', () => {
  it('is false when nothing cites a source — the base formNumber alone does not count', () => {
    expect(isDeterminationCited({ ...base, formNumber: 'HO 00 03' })).toBe(false)
  })

  it('is true via an explicit citation', () => {
    expect(isDeterminationCited({ ...base, citations: ['HO.COV.001'] })).toBe(true)
  })

  it('is true via a coverage refId', () => {
    expect(isDeterminationCited({ ...base, coverages: [{ name: 'A', refId: 'GL.COV.002', definition: 'd' }] })).toBe(true)
  })

  it('is true via a coverage form number (endorsement)', () => {
    expect(isDeterminationCited({ ...base, coverages: [{ name: 'Water back-up', formNumber: 'HO 04 95', definition: 'd' }] })).toBe(true)
  })

  it('is true via a limit source', () => {
    expect(isDeterminationCited({ ...base, limits: [{ label: 'Deductible', value: '$1,000', source: 'HO.LD.003' }] })).toBe(true)
  })

  it('is true via an exclusion form section (what is NOT covered, cited)', () => {
    expect(isDeterminationCited({
      ...base, verdict: 'NOT_COVERED',
      exclusions: [{ name: 'The failed pipe itself', formNumber: 'HO 00 03 §I.B.12.b(1)', note: 'The system that leaked is not covered.' }],
    })).toBe(true)
  })

  it('is true via a [bracketed] reasoning cite (a form section)', () => {
    expect(isDeterminationCited({ ...base, reasoning: ['Excluded by [Section I – Exclusions].'] })).toBe(true)
  })

  it('ignores blank / whitespace-only citations', () => {
    expect(isDeterminationCited({
      ...base,
      citations: ['', '   '],
      coverages: [{ name: 'A', refId: '  ', formNumber: '', definition: 'd' }],
      limits:    [{ label: 'x', value: 'y', source: '' }],
      reasoning: ['no brackets here'],
    })).toBe(false)
  })
})

describe('shouldRenderDetermination', () => {
  it('blocks an uncited substantive verdict of every kind', () => {
    expect(shouldRenderDetermination({ ...base, verdict: 'COVERED' })).toBe(false)
    expect(shouldRenderDetermination({ ...base, verdict: 'NOT_COVERED' })).toBe(false)
    expect(shouldRenderDetermination({ ...base, verdict: 'PARTIAL' })).toBe(false)
  })

  it('allows a cited substantive verdict', () => {
    expect(shouldRenderDetermination({
      ...base, verdict: 'NOT_COVERED', reasoning: ['Excluded by [Section I – Exclusions].'],
    })).toBe(true)
  })

  it('always allows NOT_ADDRESSED — the honest "form is silent" answer — even uncited', () => {
    expect(shouldRenderDetermination({ ...base, verdict: 'NOT_ADDRESSED' })).toBe(true)
  })
})
