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
import {
  lexicalRetrieve, cosineSim, quantizeInt8, dequantizeInt8,
  retrievalTerms, keywordOverlapScore, hybridScore,
} from './retrieve'

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

  it('cosine is scale-invariant: float query vs int8-quantized chunk ranks identically', () => {
    // The production retriever compares a float query vector against int8-stored chunk vectors;
    // because cosine normalizes magnitude, the int8 scale cancels and ranking is preserved.
    const chunkA = [0.9, 0.1, -0.2, 0.4]
    const chunkB = [-0.3, 0.8, 0.5, -0.1]
    const query  = [0.85, 0.15, -0.1, 0.35] // closest to A
    const int8A = quantizeInt8(chunkA).values
    const int8B = quantizeInt8(chunkB).values
    expect(cosineSim(query, int8A)).toBeGreaterThan(cosineSim(query, int8B))
    expect(cosineSim(query, int8A)).toBeCloseTo(cosineSim(query, chunkA), 3)
  })
})

// ─── Hybrid dense + lexical scoring (the server RAG ranker primitives) ──────────
describe('retrievalTerms', () => {
  it('lowercases, splits on non-alphanumerics, and drops sub-2-char tokens', () => {
    expect(retrievalTerms('Wind & Hail, deductible!')).toEqual(['wind', 'hail', 'deductible'])
    expect(retrievalTerms('CG 00 01 a I')).toEqual(['cg', '00', '01']) // "a"/"I" dropped (len<2)
    expect(retrievalTerms('')).toEqual([])
    expect(retrievalTerms(null as unknown as string)).toEqual([])
  })
})

describe('keywordOverlapScore', () => {
  it('is 0 for an empty query (dense score then stands alone)', () => {
    expect(keywordOverlapScore('', 'anything here')).toBe(0)
  })
  it('is 0 when no query term appears', () => {
    expect(keywordOverlapScore('marine cargo', 'homeowners dwelling coverage')).toBe(0)
  })
  it('rewards more distinct query-term matches (coverage dominates)', () => {
    const one = keywordOverlapScore('wind hail deductible', 'a wind endorsement')            // 1/3 terms
    const all = keywordOverlapScore('wind hail deductible', 'wind and hail percentage deductible')
    expect(all).toBeGreaterThan(one)
    expect(all).toBeGreaterThan(0.8) // all 3 terms present
    expect(all).toBeLessThanOrEqual(1)
  })
  it('is scored purely on distinct coverage, not unbounded by repetition', () => {
    const once  = keywordOverlapScore('flood', 'flood risk')
    const spam  = keywordOverlapScore('flood', 'flood flood flood flood flood flood')
    expect(spam).toBeGreaterThanOrEqual(once) // repetition helps a little (density)…
    expect(spam).toBeLessThanOrEqual(1)        // …but never exceeds 1 (capped)
  })
})

describe('hybridScore', () => {
  it('returns the lexical score unchanged when no dense score is available', () => {
    expect(hybridScore(null, 0.42)).toBe(0.42)
    expect(hybridScore(Number.NaN, 0.42)).toBe(0.42)
  })
  it('blends dense and lexical by alpha (dense-weighted by default)', () => {
    // alpha=0.7 default: 0.7*0.9 + 0.3*0.5 = 0.78
    expect(hybridScore(0.9, 0.5)).toBeCloseTo(0.78, 6)
    // explicit alpha
    expect(hybridScore(0.9, 0.5, 0.72)).toBeCloseTo(0.72 * 0.9 + 0.28 * 0.5, 6)
  })
  it('clamps a negative or >1 cosine into [0,1] before blending', () => {
    expect(hybridScore(-0.5, 0)).toBe(0)          // negative dense → 0 contribution
    expect(hybridScore(2, 1, 1)).toBe(1)          // >1 dense clamped, pure-dense alpha
  })
  it('ranks a strong dense match above a strong lexical-only match', () => {
    const denseWin = hybridScore(0.85, 0.1) // semantic match, weak keywords
    const lexWin   = hybridScore(0.15, 0.9) // keyword match, weak semantics
    expect(denseWin).toBeGreaterThan(lexWin)
  })
})
