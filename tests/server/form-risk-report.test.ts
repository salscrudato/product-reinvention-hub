// form-risk-report.test.ts — E6: the insured-centric risk report v2's deterministic
// core (no model call): the cite-or-dropped gate, the version-gated cache (v1 blobs
// regenerate for everyone — the client never renders a stale shape), the schema
// contract, and version parity with the client module.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { RISK_REPORT_VERSION } from '../../app/src/lib/claims/riskReport'

process.env.AUTH_JWT_SECRET ??= 'test-secret-form-risk-report-min32chars'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const mod = _require('../../server/lib/ai/form-risk-report') as {
  REPORT_VERSION: number
  _clean: (arr: unknown) => string[]
  _isCacheCurrent: (row: unknown) => boolean
  _REPORT_TOOL: { input_schema: { properties: Record<string, unknown>; required: string[] } }
}

describe('_clean — the grounded+cited invariant (uncited points are dropped)', () => {
  it('keeps cited items, drops uncited, caps at 5, tolerates junk', () => {
    expect(mod._clean([
      'Covered for water damage [Section I – Perils]',
      'Uncited claim that must vanish',
      42, null,
      'A [II.b]', 'B [II.c]', 'C [II.d]', 'D [II.e]', 'E [II.f]',
    ])).toEqual([
      'Covered for water damage [Section I – Perils]',
      'A [II.b]', 'B [II.c]', 'C [II.d]', 'D [II.e]',
    ])
    expect(mod._clean('not-an-array')).toEqual([])
  })
})

describe('_isCacheCurrent — the reportVersion gate (v1 never renders again)', () => {
  it('rejects the OLD v1 shape so it regenerates for everyone', () => {
    expect(mod._isCacheCurrent({ riskReport: {
      overview: 'old shape', riskHighlights: ['x [a]'], watchFor: ['y [b]'], insurerLens: ['z [c]'],
    } })).toBe(false)
  })
  it('rejects missing/mismatched versions and empty rows', () => {
    expect(mod._isCacheCurrent({ riskReport: { reportVersion: 1, plainSummary: 's' } })).toBe(false)
    expect(mod._isCacheCurrent({ riskReport: { reportVersion: 999, plainSummary: 's' } })).toBe(false)
    expect(mod._isCacheCurrent({})).toBe(false)
    expect(mod._isCacheCurrent(null)).toBe(false)
  })
  it('accepts a current, stamped report', () => {
    expect(mod._isCacheCurrent({ riskReport: {
      reportVersion: mod.REPORT_VERSION, plainSummary: 'You are covered for…',
      protections: ['p [a]'], watchouts: ['w [b]'], actions: ['q [c]'],
    } })).toBe(true)
  })
})

describe('the v2 schema contract (insured-centric sections)', () => {
  it('requires plainSummary + protections + watchouts + actions; insurerLens is GONE', () => {
    const props = mod._REPORT_TOOL.input_schema.properties
    expect(Object.keys(props).sort()).toEqual(['actions', 'plainSummary', 'protections', 'watchouts'])
    expect(mod._REPORT_TOOL.input_schema.required.sort()).toEqual(['actions', 'plainSummary', 'protections', 'watchouts'])
  })
  it('keeps the per-section bounds (3-5 findings, 2-4 actions)', () => {
    const p = mod._REPORT_TOOL.input_schema.properties as Record<string, { minItems?: number; maxItems?: number }>
    expect([p.protections!.minItems, p.protections!.maxItems]).toEqual([3, 5])
    expect([p.watchouts!.minItems, p.watchouts!.maxItems]).toEqual([3, 5])
    expect([p.actions!.minItems, p.actions!.maxItems]).toEqual([2, 4])
  })
})

describe('version parity — server and client agree on the current shape', () => {
  it('REPORT_VERSION === RISK_REPORT_VERSION', () => {
    expect(mod.REPORT_VERSION).toBe(RISK_REPORT_VERSION)
  })
})
