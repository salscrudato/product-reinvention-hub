import { describe, it, expect } from 'vitest'
import { niceLadder, suggestRange } from './ranges'

describe('niceLadder', () => {
  it('reproduces the classic limit ladder for $25k → $1M', () => {
    expect(niceLadder(25_000, 1_000_000, 'standard')).toEqual([
      25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
    ])
  })

  it('always includes both endpoints', () => {
    const l = niceLadder(1_000, 10_000, 'standard')
    expect(l[0]).toBe(1_000)
    expect(l[l.length - 1]).toBe(10_000)
  })

  it('thins with coarse and densifies with fine', () => {
    const coarse = niceLadder(25_000, 1_000_000, 'coarse')
    const fine   = niceLadder(25_000, 1_000_000, 'fine')
    expect(coarse.length).toBeLessThan(niceLadder(25_000, 1_000_000, 'standard').length)
    expect(fine.length).toBeGreaterThanOrEqual(niceLadder(25_000, 1_000_000, 'standard').length)
  })

  it('keeps fractional percent rungs (2.5%)', () => {
    const l = niceLadder(1, 10, 'standard', true)
    expect(l).toContain(2.5)
    expect(l[0]).toBe(1)
    expect(l[l.length - 1]).toBe(10)
  })

  it('returns a clean pair for a degenerate range', () => {
    expect(niceLadder(1_000, 1_000)).toEqual([1_000])
    expect(niceLadder(5_000, 1_000)).toEqual([1_000, 5_000])
  })

  it('is strictly ascending and de-duplicated', () => {
    const l = niceLadder(500, 250_000, 'fine')
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1])
  })
})

describe('suggestRange', () => {
  it('reuses the coverage\'s own values when it already offers two or more', () => {
    expect(suggestRange('LIMIT', false, [100_000, 500_000, 250_000])).toEqual({ min: 100_000, max: 500_000 })
  })

  it('falls back to line-typical bounds by kind', () => {
    expect(suggestRange('LIMIT', false, [])).toEqual({ min: 25_000, max: 1_000_000 })
    expect(suggestRange('DEDUCTIBLE', false, [])).toEqual({ min: 250, max: 10_000 })
    expect(suggestRange('DEDUCTIBLE', true, [])).toEqual({ min: 1, max: 10 })
  })
})
