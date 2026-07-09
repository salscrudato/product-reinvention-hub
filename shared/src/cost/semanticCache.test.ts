import { describe, it, expect } from 'vitest'
import {
  verifiedCitedAnchors, staleCitedAnchors, decideSemanticCache, SEMANTIC_CACHE_THRESHOLD,
  localQueryEmbedding,
} from './semanticCache'
import { cosineSim } from '../retrieval/retrieve'

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

describe('localQueryEmbedding (provider-agnostic cache key)', () => {
  it('is deterministic + unit-length', () => {
    const a = localQueryEmbedding('What is Coverage A?')
    const b = localQueryEmbedding('What is Coverage A?')
    expect(a).toEqual(b)
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('scores near-identical wording ABOVE the threshold and unrelated questions below it', () => {
    const q       = localQueryEmbedding('What is the water back-up endorsement on the home product?')
    const nearDup = localQueryEmbedding('What is the water back-up endorsement on the home product')  // trailing punctuation only
    const other   = localQueryEmbedding('Trace the personal auto collision premium by territory.')
    expect(cosineSim(q, nearDup)).toBeGreaterThan(SEMANTIC_CACHE_THRESHOLD)
    expect(cosineSim(q, other)).toBeLessThan(SEMANTIC_CACHE_THRESHOLD)
  })

  it('an empty query yields a zero vector (never a spurious match)', () => {
    expect(localQueryEmbedding('').every(x => x === 0)).toBe(true)
  })
})
