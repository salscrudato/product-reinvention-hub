// gapFeedback tests — the deterministic core of the Claims coverage-gap → product-feedback loop.
import { describe, it, expect } from 'vitest'
import { buildGapFeedbackPrefill, matchedProductId } from './gapFeedback'
import type { Determination } from './determination'

const GAP: Determination = {
  verdict: 'NOT_ADDRESSED',
  summary: 'The policy is silent on this scenario.',
  coverages: [{ name: 'Coverage A — Dwelling', refId: 'PH.COV.001', definition: 'Dwelling structure.' }],
  limits: [],
  reasoning: ['The form does not name this peril.'],
  formNumber: 'HO 00 03',
  coverageGap: { note: 'No coverage grant addresses a power-surge loss to smart-home devices.', sources: ['PH.COV.003'] },
  citations: ['PH.COV.003'],
}

describe('matchedProductId', () => {
  it('resolves the product from the first cited internal refId prefix', () => {
    expect(matchedProductId(GAP)).toBe('PH.PROD.001')
  })
  it('ignores form numbers (spaces) and unknown prefixes; returns undefined when nothing resolves', () => {
    const d: Determination = { ...GAP, coverages: [], coverageGap: { note: 'x', sources: ['ZZ.COV.1'] }, citations: ['HO 00 03'] }
    expect(matchedProductId(d)).toBeUndefined()
  })
})

describe('buildGapFeedbackPrefill', () => {
  const prefill = buildGapFeedbackPrefill(GAP, { scenario: 'A power surge fried my smart thermostat.', baseFormNumber: 'HO 00 03' })

  it('is always an IDEA', () => {
    expect(prefill.type).toBe('IDEA')
  })

  it('takes the title (first line) from the gap note', () => {
    expect(prefill.note.split('\n')[0]).toBe('No coverage grant addresses a power-surge loss to smart-home devices.')
  })

  it('grounds the detail with scenario, verdict and cited clauses', () => {
    expect(prefill.note).toContain('Scenario: A power surge fried my smart thermostat.')
    expect(prefill.note).toContain('Verdict: not addressed.')
    expect(prefill.note).toContain('Cited clauses:')
    expect(prefill.note).toContain('PH.COV.003')
    expect(prefill.note).toContain('PH.COV.001')
  })

  it('carries the base form number + matched product in the context', () => {
    expect(prefill.context.baseFormNumber).toBe('HO 00 03')
    expect(prefill.context.matchedProductId).toBe('PH.PROD.001')
    expect(prefill.context.route).toBe('/app/claims')
  })

  it('truncates an overly long gap note for the title but keeps the full note in the detail', () => {
    const long = 'x'.repeat(140)
    const p = buildGapFeedbackPrefill({ ...GAP, coverageGap: { note: long } })
    expect(p.note.split('\n')[0]!.length).toBeLessThanOrEqual(100)
    expect(p.note).toContain(`Coverage gap: ${long}`)
  })
})
