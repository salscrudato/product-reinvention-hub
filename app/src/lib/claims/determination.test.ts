// Proves the load-bearing invariant of the Claims copilot: a substantive coverage
// determination can never be rendered without citing a source, while the honest
// NOT_ADDRESSED answer is always allowed through. Mirrors the server guard in
// functions/src/claims.ts.
import { describe, it, expect } from 'vitest'
import { isDeterminationCited, shouldRenderDetermination, type Determination } from './determination'

const base: Determination = {
  verdict: 'COVERED', summary: 'x', coverages: [], limits: [], reasoning: [],
}

describe('isDeterminationCited', () => {
  it('is false when nothing cites a source — the base formNumber alone does not count', () => {
    expect(isDeterminationCited({ ...base, formNumber: 'HO 00 03' })).toBe(false)
  })

  it('is true via an explicit citation', () => {
    expect(isDeterminationCited({ ...base, citations: ['HO.COV.001'] })).toBe(true)
  })

  it('is true via a coverage refId', () => {
    expect(isDeterminationCited({ ...base, coverages: [{ name: 'A', refId: 'GL.COV.002', definition: 'd' }] })).toBe(true)
  })

  it('is true via a coverage form number (endorsement)', () => {
    expect(isDeterminationCited({ ...base, coverages: [{ name: 'Water back-up', formNumber: 'HO 04 95', definition: 'd' }] })).toBe(true)
  })

  it('is true via a limit source', () => {
    expect(isDeterminationCited({ ...base, limits: [{ label: 'Deductible', value: '$1,000', source: 'HO.LD.003' }] })).toBe(true)
  })

  it('is true via an exclusion form section (what is NOT covered, cited)', () => {
    expect(isDeterminationCited({
      ...base, verdict: 'NOT_COVERED',
      exclusions: [{ name: 'The failed pipe itself', formNumber: 'HO 00 03 §I.B.12.b(1)', note: 'The system that leaked is not covered.' }],
    })).toBe(true)
  })

  it('is true via a [bracketed] reasoning cite (a form section)', () => {
    expect(isDeterminationCited({ ...base, reasoning: ['Excluded by [Section I – Exclusions].'] })).toBe(true)
  })

  it('ignores blank / whitespace-only citations', () => {
    expect(isDeterminationCited({
      ...base,
      citations: ['', '   '],
      coverages: [{ name: 'A', refId: '  ', formNumber: '', definition: 'd' }],
      limits:    [{ label: 'x', value: 'y', source: '' }],
      reasoning: ['no brackets here'],
    })).toBe(false)
  })
})

describe('shouldRenderDetermination', () => {
  it('blocks an uncited substantive verdict of every kind', () => {
    expect(shouldRenderDetermination({ ...base, verdict: 'COVERED' })).toBe(false)
    expect(shouldRenderDetermination({ ...base, verdict: 'NOT_COVERED' })).toBe(false)
    expect(shouldRenderDetermination({ ...base, verdict: 'PARTIAL' })).toBe(false)
  })

  it('allows a cited substantive verdict', () => {
    expect(shouldRenderDetermination({
      ...base, verdict: 'NOT_COVERED', reasoning: ['Excluded by [Section I – Exclusions].'],
    })).toBe(true)
  })

  it('always allows NOT_ADDRESSED — the honest "form is silent" answer — even uncited', () => {
    expect(shouldRenderDetermination({ ...base, verdict: 'NOT_ADDRESSED' })).toBe(true)
  })
})

// ─── EVAL: real PH + PA determinations (COVERED / NOT_COVERED) ────────────────
// Each scenario mirrors what the grounded claims copilot emits when run against the
// seeded base forms. Tests here exercise the citation guard with realistic payloads
// so a regression in determinationIsCited is caught before it can reach the UI.

describe('EVAL — Personal Home (HO 00 03) determination scenarios', () => {
  it('COVERED: sudden pipe burst → Coverage A Dwelling — passes guard via coverage refId', () => {
    const d: Determination = {
      verdict: 'COVERED',
      summary: 'Sudden and accidental discharge from a burst supply pipe is covered under Coverage A — Dwelling.',
      formNumber: 'HO 00 03',
      coverages: [{ name: 'Coverage A — Dwelling', refId: 'PH.COV.001', definition: 'Open-peril coverage for the dwelling against direct physical loss.' }],
      exclusions: [{ name: 'The failed pipe itself', formNumber: 'HO 00 03 §I.B.12.b(1)', note: 'The pipe that burst is not covered — only resulting damage to the structure.' }],
      limits: [{ label: 'All-peril deductible', value: 'Per the Declarations', source: 'PH.LD.003' }],
      reasoning: [
        'Sudden and accidental discharge of water from a plumbing system is an open-peril event not excluded by Section I Exclusions [PH.COV.001].',
        'The damage to the dwelling structure (walls, floors) is covered; the failed pipe itself is excluded [HO 00 03 §I.B.12.b(1)].',
      ],
      citations: ['Section I – Property Coverages', 'PH.COV.001', 'HO 00 03'],
    }
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })

  it('NOT_COVERED: sewer backup without endorsement — passes guard via exclusion form section', () => {
    const d: Determination = {
      verdict: 'NOT_COVERED',
      summary: 'Water backing up through a sewer or drain is excluded under the base HO 00 03 form without the Water Back-Up endorsement.',
      formNumber: 'HO 00 03',
      coverages: [],
      exclusions: [{ name: 'Water Back-Up / Sump Overflow', formNumber: 'HO 00 03 §I.B.8', note: 'Water backup through sewers/drains is excluded under the base form.' }],
      limits: [],
      reasoning: [
        'The base HO 00 03 form excludes water that backs up through sewers or drains [HO 00 03 §I.B.8].',
        'Coverage is available only if the Water Back-Up endorsement (HO 04 95) is attached to the policy [PH.RU.006].',
      ],
      citations: ['Section I – Exclusions', 'HO 00 03 §I.B.8', 'PH.RU.006'],
    }
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })
})

describe('EVAL — Personal Auto (PP 00 01) determination scenarios', () => {
  it('COVERED: third-party BI from at-fault collision — passes guard via coverage refId', () => {
    const d: Determination = {
      verdict: 'COVERED',
      summary: 'Bodily injury to a third party from an at-fault collision is covered under Part A — Liability.',
      formNumber: 'PP 00 01',
      coverages: [{ name: 'Part A — Bodily Injury Liability', refId: 'PA.COV.001.001', definition: 'Pays damages for bodily injury to others for which the insured is legally responsible.' }],
      exclusions: [],
      limits: [{ label: 'Bodily Injury per person / per accident', value: 'Per the Declarations', source: 'PA.LD.001' }],
      reasoning: [
        'An at-fault auto collision causing bodily injury to another driver is a classic Part A occurrence [PA.COV.001.001].',
        'The per-person and per-accident limits are set on the Declarations page [PA.LD.001].',
      ],
      citations: ['Part A – Liability', 'PA.COV.001.001', 'PP 00 01'],
    }
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })

  it('NOT_COVERED: mechanical breakdown — passes guard via bracketed reasoning cite', () => {
    const d: Determination = {
      verdict: 'NOT_COVERED',
      summary: 'Mechanical breakdown is a standard exclusion under Part D of the Personal Auto Policy.',
      formNumber: 'PP 00 01',
      coverages: [],
      exclusions: [{ name: 'Mechanical Breakdown', refId: 'PA.RU.005', note: 'Wear, tear and mechanical breakdown are excluded from Part D coverage.' }],
      limits: [],
      reasoning: [
        'Part D (Coverage for Damage to Your Auto) excludes loss due to wear, tear, freezing, mechanical or electrical breakdown [PA.RU.005].',
        'The exclusion applies regardless of whether Collision or OTC coverage is elected [PP 00 01 Part D Exclusions].',
      ],
      citations: [],
    }
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })
})
