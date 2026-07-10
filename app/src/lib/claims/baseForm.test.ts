// Proves the "honest identification" invariant of the Claims library: a form we could not
// identify becomes NEEDS_REVIEW (never a silent empty-metadata READY), and only a genuinely
// READY form with a stored document is analyzable — so an unidentified form is surfaced but
// held back from analysis.
import { describe, it, expect } from 'vitest'
import { statusAfterIdentify, isFormAnalyzable } from './baseForm'

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

  it('is NEEDS_REVIEW when formNumber was identified but not found in the forms catalogue (E: verified:false)', () => {
    // Server flags verified:false when the form number the model read does not resolve to a
    // real form document. The UI must hold this form as NEEDS_REVIEW, not READY — an
    // unverified number should never ground analysis.
    expect(statusAfterIdentify({ formNumber: 'XX 99 99', lob: 'HO', verified: false })).toBe('NEEDS_REVIEW')
    expect(statusAfterIdentify({ formNumber: 'HO 00 03', lob: '',   verified: false })).toBe('NEEDS_REVIEW')
  })

  it('is READY when verified is absent (backwards-compat: old responses have no verified field)', () => {
    expect(statusAfterIdentify({ formNumber: 'HO 00 03', lob: '' })).toBe('READY')
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
