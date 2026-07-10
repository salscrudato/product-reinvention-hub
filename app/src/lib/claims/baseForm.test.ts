// Proves the "honest identification" invariant of the Claims library: a form we could not
// identify becomes NEEDS_REVIEW (never a silent empty-metadata READY), and only a genuinely
// READY form with a stored document is analyzable — so an unidentified form is surfaced but
// held back from analysis.
import { describe, it, expect } from 'vitest'
import { statusAfterIdentify, isFormAnalyzable, isUnverified } from './baseForm'

describe('statusAfterIdentify', () => {
  it('is READY when a form number was read', () => {
    expect(statusAfterIdentify({ formNumber: 'HO 00 03', lob: '' })).toBe('READY')
  })

  it('is READY when a line was recognised (even without a printed number)', () => {
    expect(statusAfterIdentify({ formNumber: '', lob: 'GL' })).toBe('READY')
  })

  it('is NEEDS_REVIEW when identify returned NEITHER a form number nor a line', () => {
    expect(statusAfterIdentify({ formNumber: '', lob: '' })).toBe('NEEDS_REVIEW')
    expect(statusAfterIdentify({ formNumber: '   ', lob: '  ' })).toBe('NEEDS_REVIEW')
    expect(statusAfterIdentify({})).toBe('NEEDS_REVIEW')
  })

  it('stays READY when an identified formNumber is unverified (attached doc is the authority)', () => {
    // verified:false (the number didn't resolve in the catalogue) no longer forces NEEDS_REVIEW:
    // analysis runs against the ATTACHED document, and the UI flags it with an Unverified chip.
    expect(statusAfterIdentify({ formNumber: 'XX 99 99', lob: 'HO', verified: false })).toBe('READY')
    expect(statusAfterIdentify({ formNumber: 'HO 00 03', lob: '',   verified: false })).toBe('READY')
  })

  it('is NEEDS_REVIEW when unverified AND nothing was identified (no number, no line)', () => {
    expect(statusAfterIdentify({ formNumber: '', lob: '', verified: false })).toBe('NEEDS_REVIEW')
  })

  it('is READY when verified is absent (backwards-compat: old responses have no verified field)', () => {
    expect(statusAfterIdentify({ formNumber: 'HO 00 03', lob: '' })).toBe('READY')
  })
})

describe('isUnverified', () => {
  it('is true only when the form carries verified:false', () => {
    expect(isUnverified({ verified: false })).toBe(true)
    expect(isUnverified({ verified: true })).toBe(false)
    expect(isUnverified({})).toBe(false)          // absent → treated as verified
    expect(isUnverified(null)).toBe(false)
    expect(isUnverified(undefined)).toBe(false)
  })
})

describe('isFormAnalyzable', () => {
  it('is true only for a READY form with a stored document', () => {
    expect(isFormAnalyzable({ status: 'READY', storagePath: 'baseforms/x/y.pdf' })).toBe(true)
  })

  it('is false for a NEEDS_REVIEW form — unselectable for analysis until resolved', () => {
    expect(isFormAnalyzable({ status: 'NEEDS_REVIEW', storagePath: 'baseforms/x/y.pdf' })).toBe(false)
  })

  it('is false while still PROCESSING', () => {
    expect(isFormAnalyzable({ status: 'PROCESSING', storagePath: 'baseforms/x/y.pdf' })).toBe(false)
  })

  it('is false for a READY form missing its stored document', () => {
    expect(isFormAnalyzable({ status: 'READY', storagePath: '' })).toBe(false)
    expect(isFormAnalyzable({ status: 'READY' })).toBe(false)
  })

  it('is false for a null/undefined selection', () => {
    expect(isFormAnalyzable(null)).toBe(false)
    expect(isFormAnalyzable(undefined)).toBe(false)
  })
})
