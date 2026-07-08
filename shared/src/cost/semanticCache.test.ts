import { describe, it, expect } from 'vitest'
import {
  verifiedCitedAnchors, staleCitedAnchors, decideSemanticCache, SEMANTIC_CACHE_THRESHOLD,
} from './semanticCache'

const refIds = new Set(['PH.COV.001', 'PH.RU.006'])
const forms  = new Set(['HO0003', 'HO0495'])

describe('verifiedCitedAnchors', () => {
  it('keeps only refId/form anchors that resolve, normalized; drops descriptive + fabricated', () => {
    const text =
      'Coverage A is open-peril [PH.COV.001] under [Section I – Exclusions]; ' +
      'water back-up needs [HO 04 95]; the phantom rule [PH.RU.999] does not apply.'
    expect(verifiedCitedAnchors(text, refIds, forms).sort()).toEqual(['HO0495', 'PH.COV.001'])
  })

  it('returns nothing when the answer cites only descriptive brackets', () => {
    expect(verifiedCitedAnchors('See [Coverage A — Dwelling] and [the Declarations].', refIds, forms)).toEqual([])
  })
})

describe('staleCitedAnchors', () => {
  it('flags a cited refId that no longer resolves (entity edited/deleted)', () => {
    expect(staleCitedAnchors(['PH.COV.001', 'PH.COV.999'], refIds, forms)).toEqual(['PH.COV.999'])
  })
  it('flags a cited form number that no longer resolves', () => {
    expect(staleCitedAnchors(['HO0003', 'HO9999'], refIds, forms)).toEqual(['HO9999'])
  })
  it('is empty when every anchor still resolves', () => {
    expect(staleCitedAnchors(['PH.COV.001', 'HO0003'], refIds, forms)).toEqual([])
  })
})

describe('decideSemanticCache', () => {
  it('serves a fresh, near-identical query', () => {
    expect(decideSemanticCache({ similarity: 0.97, staleAnchors: [] })).toBe('hit')
  })

  it('never serves when a cited anchor is stale — even at similarity 1.0', () => {
    expect(decideSemanticCache({ similarity: 1.0, staleAnchors: ['PH.COV.999'] })).toBe('stale-citation')
  })

  it('misses when similarity is below the conservative threshold', () => {
    expect(decideSemanticCache({ similarity: SEMANTIC_CACHE_THRESHOLD - 0.01, staleAnchors: [] })).toBe('below-threshold')
  })

  it('respects a caller-supplied stricter threshold', () => {
    expect(decideSemanticCache({ similarity: 0.94, staleAnchors: [], threshold: 0.98 })).toBe('below-threshold')
  })

  it('conservative default threshold is high (near-duplicate only)', () => {
    expect(SEMANTIC_CACHE_THRESHOLD).toBeGreaterThanOrEqual(0.9)
  })
})
