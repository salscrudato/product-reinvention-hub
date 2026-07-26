// The Pricing figure on a coverage card must reflect the steps that actually price it.
//
// Observed on the live Core product: every card read "Pricing —" although 90 of its 2024
// rating steps name a coverage outright. The count was gated on `cov.premiumGenerating`
// being truthy, but that field is `boolean | null` and a blank source cell is DROPPED (a
// blank states nothing), so an imported coverage carries undefined and every card blanked.
import { describe, it, expect } from 'vitest'
import { pricingStepCount } from './coverageAspects'
import type { Coverage, RatingProgram, RatingStep } from '@pf/shared'

const step = (over: Partial<RatingStep> & { coverageRef?: string }): RatingStep =>
  ({ id: 's', order: 1, label: 'Base rate', op: 'MUL', source: { type: 'INPUT', ref: 'b' }, ...over }) as RatingStep
const program = (steps: RatingStep[]) => ({ steps }) as Pick<RatingProgram, 'steps'>
const cov = (premiumGenerating: boolean | null | undefined) =>
  ({ refId: 'CORE.COV.018', name: 'Income Loss Benefits', terms: [], premiumGenerating }) as unknown as
    Pick<Coverage, 'name' | 'terms' | 'premiumGenerating'> & { refId?: string | null }

const p = program([
  step({ id: 's1', coverageRef: 'CORE.COV.018' }),
  step({ id: 's2', coverageRef: 'CORE.COV.018' }),
  step({ id: 's3', coverageRef: 'CORE.COV.999' }),
])

describe('pricingStepCount — unstated premium treatment is not a denial', () => {
  it('counts linked steps when premiumGenerating is UNDEFINED (the imported norm)', () => {
    expect(pricingStepCount(cov(undefined), p, {}, {})).toBe(2)
  })

  it('counts linked steps when premiumGenerating is NULL (source did not state it)', () => {
    expect(pricingStepCount(cov(null), p, {}, {})).toBe(2)
  })

  it('counts linked steps when premiumGenerating is TRUE', () => {
    expect(pricingStepCount(cov(true), p, {}, {})).toBe(2)
  })

  it('an EXPLICIT false still suppresses the count — the one denial we honour', () => {
    expect(pricingStepCount(cov(false), p, {}, {})).toBe(0)
  })

  it('counts nothing when no step references the coverage', () => {
    const other = program([step({ id: 'x', label: 'Opaque', coverageRef: 'CORE.COV.777' })])
    expect(pricingStepCount(cov(undefined), other, {}, {})).toBe(0)
  })

  it('a null program is not an error', () => {
    expect(pricingStepCount(cov(undefined), null, {}, {})).toBe(0)
  })
})
