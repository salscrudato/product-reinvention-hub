// Guards the chat/prose citation verifier: refId- and form-number-shaped citations are
// checked against the catalogue; descriptive brackets are left alone; fabricated ids are
// caught. This is the gate-side mirror of functions/src/ai.ts's server post-check.
import { describe, it, expect } from 'vitest'
import { findUnverifiedCitations, extractBracketCitations } from './citations'
import { normalizeFormNumber } from '../insurance/extraction'

const knownRefIds = new Set(['HO.COV.001', 'HO.RU.006', 'HO.FORM.RU.003', 'GL.RAT.1', 'RTTABLE.001'])
const knownForms  = new Set(['HO 04 95', 'HO 00 03', 'CG 00 01'].map(normalizeFormNumber))

describe('findUnverifiedCitations', () => {
  it('accepts refIds and form numbers that resolve', () => {
    const text = 'Open-peril [HO.COV.001], attach [HO 04 95] per rule [HO.RU.006] and [HO.FORM.RU.003].'
    expect(findUnverifiedCitations(text, knownRefIds, knownForms)).toEqual([])
  })

  it('flags a fabricated refId while keeping a real one in the same answer', () => {
    const text = 'Coverage A is open-peril [HO.COV.001]; the phantom rule [HO.RU.999] also applies.'
    expect(findUnverifiedCitations(text, knownRefIds, knownForms)).toEqual(['HO.RU.999'])
  })

  it('flags a fabricated form number', () => {
    expect(findUnverifiedCitations('See [ZZ 11 22].', knownRefIds, knownForms)).toEqual(['ZZ 11 22'])
  })

  it('does not flag descriptive citations (clauses, sections, coverage names)', () => {
    const text = 'Excluded under [Section I – Exclusions] as it affects [Coverage A — Dwelling].'
    expect(findUnverifiedCitations(text, knownRefIds, knownForms)).toEqual([])
  })

  it('verifies the form number even when a section suffix trails it', () => {
    expect(findUnverifiedCitations('[HO 00 03 §I.B.12.b(1)]', knownRefIds, knownForms)).toEqual([])
    expect(findUnverifiedCitations('[ZZ 99 99 §I.A]', knownRefIds, knownForms)).toEqual(['ZZ 99 99 §I.A'])
  })

  it('is case-insensitive on refIds and collapses duplicates', () => {
    expect(findUnverifiedCitations('[rttable.001] and again [RTTable.001]', knownRefIds, knownForms)).toEqual([])
    expect(findUnverifiedCitations('[HO.RU.999] then [HO.RU.999]', knownRefIds, knownForms)).toEqual(['HO.RU.999'])
  })
})

describe('extractBracketCitations', () => {
  it('pulls every bracketed token, trimmed', () => {
    expect(extractBracketCitations('a [HO.COV.001] b [ HO 04 95 ] c')).toEqual(['HO.COV.001', 'HO 04 95'])
  })
})
