// P3 task 1/3 — pure presentation truth: title resolution (the anti-"Core" rules),
// relative timestamps, and labeled counts with thousands separators.
import { describe, it, expect } from 'vitest'
import { draftTitle, timeAgo, countLabel } from './draftPresentation'

const IDN = {
  displayName: 'HO3_Countrywide_2026 - PH - Jul 15',
  sourceFileName: 'HO3_Countrywide_2026.xlsx',
  importedAt: '2026-07-15T14:30:00.000Z',
  contentHash: null,
}

describe('draftTitle', () => {
  it('uses the server displayName whenever a source file exists — "Core" is unreachable', () => {
    expect(draftTitle({ name: 'Core', identity: IDN })).toBe('HO3_Countrywide_2026 - PH - Jul 15')
  })

  it('keeps a real hand-given name', () => {
    expect(draftTitle({ name: 'Homeowners Special' })).toBe('Homeowners Special')
  })

  it('placeholder names fall back to "Untitled draft – Mon DD" (lineage date first, then updatedAt)', () => {
    expect(draftTitle({ name: 'Core', lineage: { at: '2026-07-15T14:30:00Z' } })).toBe('Untitled draft – Jul 15')
    expect(draftTitle({ name: 'Core', updatedAt: '2026-03-02T00:00:00Z' })).toBe('Untitled draft – Mar 2')
    expect(draftTitle({ name: '' })).toBe('Untitled draft')
    expect(draftTitle({})).toBe('Untitled draft')
  })

  it('placeholder detection is case-insensitive', () => {
    expect(draftTitle({ name: 'CORE' })).toBe('Untitled draft')
    expect(draftTitle({ name: 'untitled' })).toBe('Untitled draft')
  })
})

describe('timeAgo', () => {
  const NOW = new Date('2026-07-16T12:00:00Z').getTime()
  it('scales through minutes, hours, days, then a date', () => {
    expect(timeAgo('2026-07-16T11:59:40Z', NOW)).toBe('just now')
    expect(timeAgo('2026-07-16T11:48:00Z', NOW)).toBe('12m ago')
    expect(timeAgo('2026-07-16T09:00:00Z', NOW)).toBe('3h ago')
    expect(timeAgo('2026-07-11T12:00:00Z', NOW)).toBe('5d ago')
    expect(timeAgo('2026-05-01T00:00:00Z', NOW)).toBe('May 1')
  })
  it('returns null for absent or malformed input', () => {
    expect(timeAgo(null, NOW)).toBeNull()
    expect(timeAgo('garbage', NOW)).toBeNull()
  })
})

describe('countLabel', () => {
  it('formats with thousands separators and pluralizes', () => {
    expect(countLabel(1359, 'form', 'forms')).toBe('1,359 forms')
    expect(countLabel(1, 'coverage', 'coverages')).toBe('1 coverage')
    expect(countLabel(0, 'form', 'forms')).toBe('0 forms')
  })
  it('an unknown count is an em-dash, never a fake zero', () => {
    expect(countLabel(undefined, 'form', 'forms')).toBe('— forms')
  })
})
