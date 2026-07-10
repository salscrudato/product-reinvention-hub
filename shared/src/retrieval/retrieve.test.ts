// retrieve.test.ts — the RETRIEVAL-QUALITY gate (offline).
//
// Builds the real chunk corpus from BOTH seeded products, then asserts that for a set of
// natural-language queries the expected refId / form number is retrieved in the top-k by
// the lexical fallback. This is the offline analogue of the production dense retriever:
// if chunking or ranking regresses so a grounded answer can no longer FIND the clause it
// must cite, this test fails — the same "did we retrieve what the answer needs?" check the
// eval harness runs (functions/eval). Also pins the dense-vector math (cosine + int8).
import { describe, it, expect } from 'vitest'
import {
  PH_PRODUCT, PH_COVERAGES, PH_RULES, PH_FORMS, PH_DICTIONARY,
  PH_RATING_PROGRAM, PH_LD_TABLES, PH_RT_TABLES, PH_FORM_RULES,
} from '../seed/personalHome'
import {
  PA_PRODUCT, PA_COVERAGES, PA_RULES, PA_FORMS, PA_DICTIONARY,
  PA_RATING_PROGRAM, PA_LD_TABLES, PA_RT_TABLES, PA_FORM_RULES,
} from '../seed/personalAuto'
import type { Product, Coverage, Rule, Form, DictionaryEntry, RatingProgram, FormRule } from '../types'
import { buildBundleChunks, dedupeChunks, type CorpusBundle } from './chunk'
import { lexicalRetrieve, cosineSim, quantizeInt8, dequantizeInt8 } from './retrieve'

const bundle = (
  product: unknown, coverages: unknown, rules: unknown, formRules: unknown,
  forms: unknown, dictionary: unknown, ratingProgram: unknown,
  ldTables: CorpusBundle['ldTables'], rtTables: CorpusBundle['rtTables'],
): CorpusBundle => ({
  product: product as Product, coverages: coverages as Coverage[], rules: rules as Rule[],
  formRules: formRules as FormRule[], forms: forms as Form[], dictionary: dictionary as DictionaryEntry[],
  ratingProgram: ratingProgram as RatingProgram, ldTables, rtTables,
})

const CORPUS = dedupeChunks([
  ...buildBundleChunks(bundle(PH_PRODUCT, PH_COVERAGES, PH_RULES, PH_FORM_RULES, PH_FORMS, PH_DICTIONARY, PH_RATING_PROGRAM, PH_LD_TABLES, PH_RT_TABLES)),
  ...buildBundleChunks(bundle(PA_PRODUCT, PA_COVERAGES, PA_RULES, PA_FORM_RULES, PA_FORMS, PA_DICTIONARY, PA_RATING_PROGRAM, PA_LD_TABLES, PA_RT_TABLES)),
])

// Golden retrieval cases: a query and the anchor (refId or form number) that MUST appear
// in the top-k hit metadata. Mirrors the questions the AI surfaces actually field.
interface RetCase { q: string; expect: string; k?: number }
const CASES: RetCase[] = [
  { q: 'water backing up through a sewer or drain endorsement',          expect: 'HO 04 95' },
  { q: 'coverage F medical payments $5,000 requires coverage E limit',   expect: 'PH.RU.006' },
  { q: 'scheduled personal property jewelry appraised value',            expect: 'PH.COV.003.002' },
  { q: 'coverage A dwelling replacement value',                          expect: 'PH.COV.001' },
  { q: 'wind and hail percentage deductible in coastal states',          expect: 'PH.RU.008' },
  { q: 'personal auto bodily injury liability part A',                   expect: 'PA.COV.001.001' },
  { q: 'uninsured motorist coverage auto',                               expect: 'PA.COV.003' },
  { q: 'collision coverage damage to your auto deductible',              expect: 'PA.COV.004.001' },
]

describe('retrieval quality — expected anchor in top-k', () => {
  for (const c of CASES) {
    it(`"${c.q}" → ${c.expect}`, () => {
      const hits = lexicalRetrieve(c.q, CORPUS, { topK: c.k ?? 6 })
      const anchors = hits.flatMap(h => [h.chunk.metadata.refId, h.chunk.metadata.formNumber].filter(Boolean))
      expect(anchors, `top-${c.k ?? 6}: ${anchors.join(', ')}`).toContain(c.expect)
    })
  }

  it('type filter restricts the pool', () => {
    const hits = lexicalRetrieve('coverage A dwelling', CORPUS, { topK: 5, types: ['form'] })
    expect(hits.every(h => h.chunk.metadata.type === 'form')).toBe(true)
  })

  it('empty query returns a bounded slice, not the whole corpus', () => {
    const hits = lexicalRetrieve('', CORPUS, { topK: 5 })
    expect(hits.length).toBeLessThanOrEqual(5)
  })

  it('returns [] immediately for an empty corpus (no chunks at all)', () => {
    // The short-circuit at pool.length === 0 must fire — no crash, no BM25 division-by-zero.
    expect(lexicalRetrieve('dwelling coverage', [], { topK: 5 })).toEqual([])
    expect(lexicalRetrieve('', [], { topK: 10 })).toEqual([])
  })
})

describe('dense-vector math', () => {
  it('cosine is 1 for identical, 0 for orthogonal', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6)
    expect(cosineSim([0, 0], [1, 1])).toBe(0)
  })

  it('int8 round-trip preserves direction within quantization error', () => {
    const v = [0.12, -0.44, 0.9, 0.03, -0.71]
    const round = dequantizeInt8(quantizeInt8(v))
    expect(cosineSim(v, round)).toBeGreaterThan(0.999)
  })
})
