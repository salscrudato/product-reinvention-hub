// refresh-news.test.ts — R0 News wave: the deterministic core of the REAL news
// agent, tested without a model call: tolerant JSON-array extraction from scout
// text, and portfolio relevance matching (LOB keywords + state names/codes).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

// refresh-news requires ../data (→ cosmos.js) at module load; dummy env keeps
// the require graph importable without a live account (same as ops-copilot test).
process.env.AUTH_JWT_SECRET ??= 'test-secret-refresh-news-tests-minimum32c'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const news = _require('../../server/lib/ai/refresh-news') as {
  _internals: {
    extractJsonArray: (text: string) => unknown[]
    matchToProductIds: (
      item: { title: string; summary: string; tags: string[] },
      products: Array<{ id: string; name: string; lobName: string; lobPrefix: string; allStates: boolean; states: string[] }>,
    ) => string[]
  }
}
const { extractJsonArray, matchToProductIds } = news._internals

describe('extractJsonArray', () => {
  it('parses a bare JSON array', () => {
    expect(extractJsonArray('[{"url":"https://a.com","title":"t"}]')).toHaveLength(1)
  })
  it('parses a fenced array surrounded by prose and citations', () => {
    const text = 'Here is what I found [1]:\n```json\n[{"url":"https://a.com","title":"t"}]\n```\nHope this helps.'
    expect(extractJsonArray(text)).toHaveLength(1)
  })
  it('parses a balanced array embedded in prose (nested arrays inside)', () => {
    const text = 'Results: [{"url":"https://a.com","title":"t","bullets":["x","y"]}] — done.'
    const arr = extractJsonArray(text) as Array<{ bullets: string[] }>
    expect(arr).toHaveLength(1)
    expect(arr[0]!.bullets).toEqual(['x', 'y'])
  })
  it('returns [] for no-array text', () => {
    expect(extractJsonArray('I found nothing relevant.')).toEqual([])
  })
})

describe('matchToProductIds (Why-this-matched)', () => {
  const products = [
    { id: 'ho', name: 'HomeShield', lobName: 'Homeowners', lobPrefix: 'HO', allStates: false, states: ['NJ', 'PA'] },
    { id: 'gl', name: 'BizGuard', lobName: 'General Liability', lobPrefix: 'GL', allStates: true, states: [] },
  ]
  it('matches on LOB keyword expansion', () => {
    const ids = matchToProductIds({ title: 'HO-3 rate filing approved', summary: '', tags: [] }, products)
    expect(ids).toContain('ho')
  })
  it('matches on full state name', () => {
    const ids = matchToProductIds({ title: 'New Jersey DOI bulletin on cancellations', summary: '', tags: [] }, products)
    expect(ids).toContain('ho')
  })
  it('matches CGL keyword to the GL product', () => {
    const ids = matchToProductIds({ title: 'CGL exclusion upheld by appeals court', summary: '', tags: [] }, products)
    expect(ids).toContain('gl')
  })
  it('does not false-positive on lowercase state-code lookalikes', () => {
    const ids = matchToProductIds({ title: 'pa systems for stadiums', summary: '', tags: [] }, products)
    expect(ids).not.toContain('ho')
  })
})
