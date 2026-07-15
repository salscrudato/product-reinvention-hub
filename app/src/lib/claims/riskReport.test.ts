// riskReport.test.ts — E6: the version-gate predicate (a stale cached shape must
// NEVER render) and the pure copilot question composer.
import { describe, it, expect } from 'vitest'
import { RISK_REPORT_VERSION, isRenderableRiskReport, buildReportAsk } from './riskReport'

const v2 = {
  reportVersion: RISK_REPORT_VERSION,
  plainSummary: 'You are covered for sudden water damage.',
  protections: ['Water damage from burst pipes [Section I – Perils]'],
  watchouts: ['Flood is excluded [Section I – Exclusions]'],
  actions: ['Ask about flood coverage [Section I – Exclusions]'],
}

describe('isRenderableRiskReport — the stale-shape gate', () => {
  it('accepts a current v2 report', () => {
    expect(isRenderableRiskReport(v2)).toBe(true)
  })
  it('rejects the OLD v1 cached shape (hydrates via the live subscription)', () => {
    expect(isRenderableRiskReport({
      overview: 'old', riskHighlights: ['x [a]'], watchFor: ['y [b]'], insurerLens: ['z [c]'],
    })).toBe(false)
  })
  it('rejects version drift, partials and garbage', () => {
    expect(isRenderableRiskReport({ ...v2, reportVersion: RISK_REPORT_VERSION + 1 })).toBe(false)
    expect(isRenderableRiskReport({ ...v2, plainSummary: '' })).toBe(false)
    expect(isRenderableRiskReport({ ...v2, protections: [42] })).toBe(false)
    expect(isRenderableRiskReport(null)).toBe(false)
    expect(isRenderableRiskReport('junk')).toBe(false)
  })
})

describe('buildReportAsk — explanation only, citations intact', () => {
  it('carries the item verbatim and asks what it means (never for new facts)', () => {
    const q = buildReportAsk('Flood is excluded [Section I – Exclusions]')
    expect(q).toContain('Flood is excluded [Section I – Exclusions]')
    expect(q).toContain('what does this mean for me')
  })
})
