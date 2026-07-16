// portfolio.test.ts — the P2 server-truth read models are PURE and DETERMINISTIC:
// draft identity derives only from persisted lineage/lob/contentHash, the pulse
// derives only from persisted product/task rows, and suggested queries are
// order-independent templates (same portfolio → same strings, always).
import { describe, it, expect } from 'vitest'
import {
  deriveDraftIdentity,
  computePortfolioPulse,
  buildSuggestedQueries,
  ALL_STATES_COUNT,
  type PulseProductRow,
} from './portfolio'

const importedDraft = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  name: 'Homeowners Special',
  lob: { refId: 'PH', name: 'Personal Home' },
  lifecycle: 'DRAFT',
  reviewStatus: 'NOT_STARTED',
  lineage: {
    kind: 'IMPORT',
    summary: 'Imported from 1 ISO workbook',
    sources: [{ type: 'file', ref: 'HO3_Countrywide_2026.xlsx' }],
    by: { uid: 'u1', name: 'Sal' },
    at: '2026-07-15T14:30:00.000Z',
  },
  ...over,
})

describe('deriveDraftIdentity', () => {
  it('builds "[artifactBase] - [LOB] - [Mon DD]" from persisted lineage + lob', () => {
    const idn = deriveDraftIdentity(importedDraft())
    expect(idn.displayName).toBe('HO3_Countrywide_2026 - PH - Jul 15')
    expect(idn.sourceFileName).toBe('HO3_Countrywide_2026.xlsx')
    expect(idn.importedAt).toBe('2026-07-15T14:30:00.000Z')
    expect(idn.contentHash).toBeNull() // no write path stamps contentHash yet (recorded gap)
  })

  it('uses UTC for the date part — deterministic across server timezones', () => {
    const idn = deriveDraftIdentity(importedDraft({
      lineage: { kind: 'IMPORT', sources: [{ type: 'file', ref: 'a.xlsx' }], at: '2026-01-01T00:30:00.000Z' },
    }))
    expect(idn.displayName).toBe('a - PH - Jan 1')
  })

  it('surfaces a persisted contentHash when present', () => {
    expect(deriveDraftIdentity(importedDraft({ contentHash: 'sha256:abc123' })).contentHash).toBe('sha256:abc123')
  })

  it('degrades gracefully: missing parts are omitted, non-import lineage → no importedAt', () => {
    // Clone lineage: no file source → no identity projection at all.
    const clone = deriveDraftIdentity({ lineage: { kind: 'CLONE', sources: [{ type: 'product', ref: 'PH.PROD.001' }], at: '2026-07-01T00:00:00Z' } })
    expect(clone).toEqual({ displayName: null, sourceFileName: null, importedAt: null, contentHash: null })
    // File source but no lob and no import stamp → base name only.
    const bare = deriveDraftIdentity({ lineage: { kind: 'CLONE', sources: [{ type: 'file', ref: 'dir/sub/file.name.pdf' }] } })
    expect(bare.displayName).toBe('file.name') // directory prefix + final extension stripped
    expect(bare.importedAt).toBeNull()
  })

  it('never throws on legacy/blank/malformed rows (read-time projection, no migration)', () => {
    for (const data of [null, undefined, {}, { lineage: 'garbage' }, { lineage: { sources: 'nope' } }, { lob: 42 }]) {
      expect(deriveDraftIdentity(data as never)).toEqual({ displayName: null, sourceFileName: null, importedAt: null, contentHash: null })
    }
  })

  it('accepts a string lob (legacy shape) as the LOB part', () => {
    expect(deriveDraftIdentity(importedDraft({ lob: 'GL' })).displayName).toBe('HO3_Countrywide_2026 - GL - Jul 15')
  })
})

describe('computePortfolioPulse', () => {
  const products: PulseProductRow[] = [
    { id: 'p1', name: 'Live A', lifecycle: 'LAUNCHED', states: ['TX', 'OH'], allStates: false },
    { id: 'p2', name: 'Live B', lifecycle: 'LAUNCHED', states: ['tx', 'CA'], allStates: false },
    { id: 'p3', name: 'Draft 1', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', ...importedDraft() },
    { id: 'p4', name: 'Starter', lifecycleState: 'draft' }, // legacy starter-seed field name
    { id: 'p5', name: 'Approved draft', lifecycle: 'DRAFT', reviewStatus: 'APPROVED' },
  ]
  const tasks = [{ done: true }, { done: false }, {}, { done: false }]

  it('is field-complete and computed only from persisted rows', () => {
    const pulse = computePortfolioPulse(products, tasks)
    expect(pulse).toEqual({
      liveProducts: 2,
      statesCovered: 3, // TX, OH, CA — case-insensitive union across LIVE products only
      draftsAwaitingReview: 2, // DRAFT + legacy lifecycleState:'draft'; APPROVED excluded
      lastImport: { status: 'applied', at: '2026-07-15T14:30:00.000Z', artifact: 'HO3_Countrywide_2026.xlsx' },
      openTasks: 3, // done !== true (missing done counts as open)
    })
  })

  it('allStates on any live product covers the full footprint (50 states + DC)', () => {
    const pulse = computePortfolioPulse([{ id: 'p', lifecycle: 'LAUNCHED', allStates: true }], [])
    expect(pulse.statesCovered).toBe(ALL_STATES_COUNT)
  })

  it('empty portfolio → zeros and null lastImport (never throws)', () => {
    expect(computePortfolioPulse([], [])).toEqual({
      liveProducts: 0, statesCovered: 0, draftsAwaitingReview: 0, lastImport: null, openTasks: 0,
    })
  })

  it('lastImport picks the LATEST lineage.at across imported products', () => {
    const older = importedDraft({ lineage: { kind: 'IMPORT', sources: [{ type: 'file', ref: 'old.xlsx' }], at: '2026-06-01T00:00:00Z' } })
    const pulse = computePortfolioPulse([{ id: 'a', ...older }, { id: 'b', ...importedDraft() }] as PulseProductRow[], [])
    expect(pulse.lastImport?.artifact).toBe('HO3_Countrywide_2026.xlsx')
  })
})

describe('buildSuggestedQueries — deterministic templates from real facts', () => {
  const products: PulseProductRow[] = [
    { id: 'p1', name: 'Zeta Auto', lifecycle: 'LAUNCHED', states: ['TX', 'OH'] },
    { id: 'p2', name: 'Alpha Home', lifecycle: 'LAUNCHED', states: ['WA', 'CA'] },
    { id: 'p3', name: 'Draft 1', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED' },
  ]
  const coverages = [
    { name: 'Water Backup', productName: 'Alpha Home', formNumbers: [] },
    { name: 'Dwelling', productName: 'Alpha Home', formNumbers: ['HO 00 03'] },
  ]

  it('templates the three facts: multi-state compare, forms gap, drafts awaiting review', () => {
    const qs = buildSuggestedQueries(products, coverages)
    expect(qs).toEqual([
      'How does Alpha Home differ between CA and WA?', // first live multi-state product by name; states sorted
      'Which forms should attach to Water Backup in Alpha Home?',
      'What should I review first across my 1 draft product awaiting review?',
    ])
  })

  it('same input → same output; input ORDER never changes the result', () => {
    const qs1 = buildSuggestedQueries(products, coverages)
    const qs2 = buildSuggestedQueries([...products].reverse(), [...coverages].reverse())
    expect(qs2).toEqual(qs1)
    expect(buildSuggestedQueries(products, coverages)).toEqual(qs1)
  })

  it('always returns 3–4 strings — fallbacks fill when facts are absent', () => {
    const qs = buildSuggestedQueries([], [])
    expect(qs.length).toBeGreaterThanOrEqual(3)
    expect(qs.length).toBeLessThanOrEqual(4)
    expect(new Set(qs).size).toBe(qs.length) // no duplicates
  })
})
