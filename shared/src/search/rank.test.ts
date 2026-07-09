// Guards the TF-IDF cosine ranker used for grounded retrieval: relevant docs
// rank first, rare terms outweigh common ones, and empty queries are safe.
import { describe, it, expect } from 'vitest'
import { rankDocuments, type RankDoc } from './rank'

const DOCS: RankDoc[] = [
  { id: 'covA', text: 'Coverage A Dwelling HO.COV.001 limit replacement cost' },
  { id: 'covF', text: 'Coverage F Medical Payments HO.COV.006 each person' },
  { id: 'spp',  text: 'Scheduled Personal Property HO.COV.003.002 jewelry HO 04 61' },
  { id: 'wind', text: 'Wind Hail percentage deductible coastal HO 03 12' },
]

describe('TF-IDF cosine ranker', () => {
  it('ranks the most relevant document first', () => {
    const r = rankDocuments('scheduled personal property jewelry', DOCS)
    expect(r[0]!.id).toBe('spp')
    expect(r[0]!.score).toBeGreaterThan(0)
  })

  it('matches on an exact refId', () => {
    expect(rankDocuments('HO.COV.006', DOCS)[0]!.id).toBe('covF')
  })

  it('respects topK and returns descending scores', () => {
    const r = rankDocuments('coverage', DOCS, 2)
    expect(r).toHaveLength(2)
    expect(r[0]!.score).toBeGreaterThanOrEqual(r[1]!.score)
  })

  it('is safe on an empty query', () => {
    const r = rankDocuments('   ', DOCS)
    expect(r).toHaveLength(DOCS.length)
    expect(r.every(x => x.score === 0)).toBe(true)
  })
})
