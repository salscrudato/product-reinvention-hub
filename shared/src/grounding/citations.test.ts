// Guards the chat/prose citation verifier: refId- and form-number-shaped citations are
// checked against the catalogue; descriptive brackets are left alone; fabricated ids are
// caught. This is the gate-side mirror of functions/src/ai.ts's server post-check.
import { describe, it, expect } from 'vitest'
import {
  findUnverifiedCitations, extractBracketCitations,
  collectDeterminationCitationTokens, findUnverifiedDeterminationCitations,
} from './citations'
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

// ─── Determination citation verification (the Claims card's grounding guard) ────
describe('collectDeterminationCitationTokens', () => {
  it('gathers tokens from every citation-bearing field (not the base formNumber footer)', () => {
    const tokens = collectDeterminationCitationTokens({
      citations:  ['Section I – Exclusions', 'HO 00 03'],
      coverages:  [{ refId: 'HO.COV.001', formNumber: 'HO 04 95' }],
      exclusions: [{ formNumber: 'HO 00 03 §I.B.8' }],
      limits:     [{ source: 'HO.RU.006' }, { source: 'Declarations' }],
      reasoning:  ['Excluded per [HO.FORM.RU.003].'],
    })
    expect(tokens).toContain('HO.COV.001')
    expect(tokens).toContain('HO 04 95')
    expect(tokens).toContain('HO 00 03 §I.B.8')
    expect(tokens).toContain('HO.RU.006')
    expect(tokens).toContain('Declarations')       // gathered, but not refId/form-shaped → never flagged
    expect(tokens).toContain('HO.FORM.RU.003')
  })
})

describe('findUnverifiedDeterminationCitations', () => {
  it('passes a fully-grounded determination (real refIds, real + attached form, descriptive names)', () => {
    const d = {
      citations:  ['Coverage A — Dwelling', 'HO.COV.001', 'HO 00 03'],
      coverages:  [{ name: 'Coverage A', refId: 'HO.COV.001', formNumber: 'HO 00 03' }],
      exclusions: [{ name: 'Sewer backup', formNumber: 'HO 00 03 §I.B.8' }],
      limits:     [{ label: 'Deductible', value: '$1,000', source: 'Declarations' }],
      reasoning:  ['Open-peril loss under [HO.COV.001]; excluded item cited [Section I – Exclusions].'],
    }
    expect(findUnverifiedDeterminationCitations(d, knownRefIds, knownForms)).toEqual([])
  })

  it('flags a plausible-but-invented coverage refId (PH.COV.999 must never render as authoritative)', () => {
    const d = { coverages: [{ name: 'Phantom', refId: 'PH.COV.999', formNumber: 'HO 00 03' }] }
    expect(findUnverifiedDeterminationCitations(d, knownRefIds, knownForms)).toEqual(['PH.COV.999'])
  })

  it('flags an invented exclusion refId and an invented form number, keeping real ones', () => {
    const d = {
      exclusions: [{ name: 'x', refId: 'HO.RU.006' }, { name: 'y', refId: 'HO.RU.999' }],
      citations:  ['ZZ 88 77', 'HO 04 95'],
    }
    // first-seen order: citations[] are collected before exclusions
    expect(findUnverifiedDeterminationCitations(d, knownRefIds, knownForms)).toEqual(['ZZ 88 77', 'HO.RU.999'])
  })

  it('treats the ATTACHED form as resolvable even when it is not a seeded catalogue entity (GL CG 00 01)', () => {
    // No GL product is seeded, but the uploaded CG 00 01 is the authority; its own number is
    // added to the known set by the caller, so a GL determination citing it resolves.
    const gl = { coverages: [{ name: 'Coverage A — BI', formNumber: 'CG 00 01' }], reasoning: ['Occurrence-based [CG 00 01].'] }
    expect(findUnverifiedDeterminationCitations(gl, knownRefIds, knownForms)).toEqual([])
    // …but an invented GL coverage refId is still caught (no GL product to ground it).
    const glBad = { coverages: [{ name: 'x', refId: 'GL.COV.999', formNumber: 'CG 00 01' }] }
    expect(findUnverifiedDeterminationCitations(glBad, knownRefIds, knownForms)).toEqual(['GL.COV.999'])
  })
})
