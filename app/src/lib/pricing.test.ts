// pricing.test.ts — locks the public ROI math to the published bands. If a band
// or the value model drifts, this fails before the /pricing page can mislead.
import { describe, it, expect } from 'vitest'
import {
  ROI_BANDS,
  ROI_DEFAULTS,
  ROI_SLIDERS,
  computeRoi,
  normalizeRoiInputs,
  formatUsd,
  formatUsdBand,
  formatWeekBand,
  PLATFORM_TIERS,
  COMMERCIAL_LAYERS,
} from './pricing'

describe('ROI bands', () => {
  it('are exactly the published bands', () => {
    expect(ROI_BANDS.speedToMarket).toEqual({ low: 0.25, high: 0.35 })
    expect(ROI_BANDS.opex).toEqual({ low: 0.1, high: 0.15 })
    expect(ROI_BANDS.onboarding).toEqual({ low: 0.15, high: 0.2 })
  })
})

describe('computeRoi', () => {
  const r = computeRoi(ROI_DEFAULTS)

  it('derives speed-to-market weeks saved straight from the band', () => {
    // 32 weeks × 25–35%
    expect(r.weeksSavedPerLaunch.low).toBeCloseTo(32 * 0.25)
    expect(r.weeksSavedPerLaunch.high).toBeCloseTo(32 * 0.35)
  })

  it('annualizes reclaimed launch-weeks by products/year', () => {
    expect(r.productWeeksReclaimed.low).toBeCloseTo(32 * 0.25 * 6)
    expect(r.productWeeksReclaimed.high).toBeCloseTo(32 * 0.35 * 6)
  })

  it('derives OpEx savings straight from the band', () => {
    // $4.0M × 10–15%
    expect(r.opexSavingsUsd.low).toBeCloseTo(4_000_000 * 0.1)
    expect(r.opexSavingsUsd.high).toBeCloseTo(4_000_000 * 0.15)
  })

  it('derives onboarding weeks saved straight from the band', () => {
    expect(r.onboardingWeeksSaved.low).toBeCloseTo(12 * 0.15)
    expect(r.onboardingWeeksSaved.high).toBeCloseTo(12 * 0.2)
  })

  it('headline annual value equals OpEx savings only (never double-counts)', () => {
    expect(r.annualValueUsd).toEqual(r.opexSavingsUsd)
  })

  it('scales linearly with the inputs', () => {
    const doubled = computeRoi({ ...ROI_DEFAULTS, annualOpexUsd: 8_000_000 })
    expect(doubled.opexSavingsUsd.low).toBeCloseTo(r.opexSavingsUsd.low * 2)
  })
})

describe('normalizeRoiInputs', () => {
  it('clamps out-of-range and non-finite inputs to the slider bounds', () => {
    const n = normalizeRoiInputs({
      productsPerYear: 9999,
      speedToMarketWeeks: 0,
      annualOpexUsd: Number.NaN,
      onboardingWeeks: -5,
    })
    const by = (k: string) => ROI_SLIDERS.find((s) => s.key === k)!
    expect(n.productsPerYear).toBe(by('productsPerYear').max)
    expect(n.speedToMarketWeeks).toBe(by('speedToMarketWeeks').min)
    expect(n.annualOpexUsd).toBe(by('annualOpexUsd').min)
    expect(n.onboardingWeeks).toBe(by('onboardingWeeks').min)
  })
})

describe('formatting', () => {
  it('formats compact USD', () => {
    expect(formatUsd(4_000_000)).toBe('$4.0M')
    expect(formatUsd(180_000)).toBe('$180k')
    expect(formatUsd(12_000_000)).toBe('$12M')
  })
  it('formats bands', () => {
    expect(formatUsdBand({ low: 400_000, high: 600_000 })).toBe('$400k–$600k')
    expect(formatWeekBand({ low: 8, high: 11.2 })).toBe('8–11 wks')
  })
})

describe('public-safety invariants', () => {
  it('exposes exactly four commercial layers', () => {
    expect(COMMERCIAL_LAYERS).toHaveLength(4)
  })
  it('marks exactly one platform tier as featured', () => {
    expect(PLATFORM_TIERS.filter((t) => t.featured)).toHaveLength(1)
  })
})
