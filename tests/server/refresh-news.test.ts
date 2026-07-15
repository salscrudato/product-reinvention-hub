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
interface TenantProfileLike {
  carrierName: string; aliases?: string[]; lobs?: string[]; market?: string | null
  states?: string[]; watchTopics?: string[]; competitors?: string[]
}
const news = _require('../../server/lib/ai/refresh-news') as {
  _internals: {
    extractJsonArray: (text: string) => unknown[]
    matchToProductIds: (
      item: { title: string; summary: string; tags: string[] },
      products: Array<{ id: string; name: string; lobName: string; lobPrefix: string; allStates: boolean; states: string[] }>,
    ) => string[]
    buildScope: (
      when: { day: string | null; todayStr: string },
      profile: TenantProfileLike | null,
      products: Array<{ name: string }>,
    ) => string
    matchesCarrier: (
      item: { title: string; summary?: string; tags?: string[] },
      profile: TenantProfileLike | null,
    ) => boolean
  }
}
const { extractJsonArray, matchToProductIds, buildScope, matchesCarrier } = news._internals

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

// ─── BR-04: tenant-profile-first scope (NEWS_TENANT_SPEC §2–3) ────────────────────

describe('buildScope — profile-first composition with byte-parity fallback', () => {
  // The FROZEN historical literals (refresh-news.js scope, pre-profile). The absent-profile
  // contract is byte-parity with these exact strings — a profile may only ADD signal.
  const NO_DAY =
    'Today is 2026-07-15. Find REAL P&C insurance market news from the past 7 days.'
  const DAY =
    'Find REAL P&C insurance market news PUBLISHED ON 2026-07-10 (U.S. market). Today is 2026-07-15. Only include items you can verify were published on or about that date; include publishedAt when the source states it.'

  const profile: TenantProfileLike = {
    carrierName: 'Accenture Test Mutual',
    aliases: ['ATM Insurance'],
    lobs: ['PH', 'PA'],
    market: 'personal',
    states: ['OH', 'NJ'],
    watchTopics: ['telematics', 'wildfire'],
  }

  it('absent profile → byte-parity with today’s scope (past-7-days form)', () => {
    expect(buildScope({ day: null, todayStr: '2026-07-15' }, null, [])).toBe(NO_DAY)
  })
  it('absent profile → byte-parity with today’s scope (day-targeted form)', () => {
    expect(buildScope({ day: '2026-07-10', todayStr: '2026-07-15' }, null, [])).toBe(DAY)
  })
  it('a profile APPENDS a tenant focus after the unchanged base — it never narrows', () => {
    const s = buildScope({ day: null, todayStr: '2026-07-15' }, profile, [{ name: 'HomeShield HO-3' }])
    expect(s.startsWith(NO_DAY)).toBe(true)
    expect(s).toContain('Accenture Test Mutual')
    expect(s).toContain('ATM Insurance')
    expect(s).toContain('Personal Home')          // "PH" resolved to its registry caption
    expect(s).toContain('Personal Auto')
    expect(s).toContain('personal')                // market
    expect(s).toContain('OH')
    expect(s).toContain('telematics')
    expect(s).toContain('HomeShield HO-3')
    // The exact anti-narrowing instruction, frozen (a paraphrase is a contract change).
    expect(s).toContain('This tenant focus ADDS signal on top of the general scope; do not narrow the general P&C market coverage below it.')
  })
  it('a thin profile (carrierName only) composes carrier + base, nothing invented', () => {
    const s = buildScope({ day: null, todayStr: '2026-07-15' }, { carrierName: 'Solo Mutual' }, [])
    expect(s.startsWith(NO_DAY)).toBe(true)
    expect(s).toContain('Solo Mutual')
    expect(s).not.toContain('also known as')
    expect(s).not.toContain('Lines of business')
  })
  it('caps the enrichment product list at 12 names', () => {
    const products = Array.from({ length: 15 }, (_, i) => ({ name: `Product ${i + 1}` }))
    const s = buildScope({ day: null, todayStr: '2026-07-15' }, profile, products)
    expect(s).toContain('Product 12')
    expect(s).not.toContain('Product 13')
  })
  it('an unknown LOB key falls back to the raw key rather than being dropped', () => {
    const s = buildScope({ day: null, todayStr: '2026-07-15' }, { carrierName: 'X Mutual', lobs: ['ZZ'] }, [])
    expect(s).toContain('ZZ')
  })
})

describe('matchesCarrier — "about you" tagging (matchedCarrier)', () => {
  const profile: TenantProfileLike = { carrierName: 'Accenture Test Mutual', aliases: ['ATM Insurance'] }
  it('matches the carrier name in the title (case-insensitive)', () => {
    expect(matchesCarrier({ title: 'ACCENTURE TEST MUTUAL files new HO-3 rates' }, profile)).toBe(true)
  })
  it('matches an alias in the summary', () => {
    expect(matchesCarrier({ title: 'Rate filing', summary: 'atm insurance expands telematics' }, profile)).toBe(true)
  })
  it('does not match unrelated items', () => {
    expect(matchesCarrier({ title: 'Progressive launches usage-based auto product' }, profile)).toBe(false)
  })
  it('is false without a profile', () => {
    expect(matchesCarrier({ title: 'Accenture Test Mutual news' }, null)).toBe(false)
  })
  it('ignores degenerate short aliases (no single-letter substring hits)', () => {
    expect(matchesCarrier({ title: 'A storm hits Ohio' }, { carrierName: 'Real Carrier', aliases: ['A'] })).toBe(false)
  })
  it('never matches a name INSIDE a word — alias "ATM" must not tag "atmosphere"', () => {
    expect(matchesCarrier({ title: 'Storm atmosphere over the Gulf raises cat-loss fears' },
      { carrierName: 'Real Carrier', aliases: ['ATM'] })).toBe(false)
    // …while a word-bounded hit still tags:
    expect(matchesCarrier({ title: 'ATM expands its telematics program' },
      { carrierName: 'Real Carrier', aliases: ['ATM'] })).toBe(true)
  })
})
