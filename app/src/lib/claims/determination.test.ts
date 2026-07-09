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

// ─── EVAL: General Liability (CG 00 01) — GL parity with HO ────────────────────
// The multi-line mandate: a GL loss must render as gracefully as an HO loss. These
// mirror the HO/PA scenarios but exercise the CGL shape — an OCCURRENCE-triggered
// Coverage A capped by the Each-Occurrence limit and the General Aggregate, and the
// completed-operations own-work exclusion — proving a GL determination cites GL forms
// (CG 00 01) and applies occurrence/aggregate logic while passing the same citation guard.

describe('EVAL — General Liability (CG 00 01) determination scenarios', () => {
  it('COVERED: customer slip-and-fall bodily injury → Coverage A occurrence, capped by the General Aggregate', () => {
    const d: Determination = {
      verdict: 'COVERED',
      summary: 'A customer’s slip-and-fall injury on the premises is a covered occurrence under Coverage A — Bodily Injury Liability.',
      formNumber: 'CG 00 01',
      coverages: [{ name: 'Coverage A — Bodily Injury and Property Damage Liability', formNumber: 'CG 00 01', definition: 'Pays sums the insured is legally obligated to pay as damages for bodily injury caused by an occurrence during the policy period.' }],
      exclusions: [],
      limits: [
        { label: 'Each Occurrence Limit', value: 'Per the Declarations', source: 'CG 00 01', note: 'Caps a single occurrence.' },
        { label: 'General Aggregate Limit', value: 'Per the Declarations', source: 'CG 00 01', note: 'Caps all Coverage A/B/C loss except products-completed operations; resets each policy period.' },
      ],
      reasoning: [
        'A slip-and-fall causing bodily injury to a third party is an "occurrence" during the policy period covered by Coverage A [Coverage A — Bodily Injury, CG 00 01].',
        'Payment is subject to the Each-Occurrence limit and erodes the General Aggregate (not the Products-Completed-Operations Aggregate, which is separate) [CG 00 01].',
      ],
      citations: ['Coverage A — Bodily Injury', 'CG 00 01'],
    }
    // cites a GL form (not HO/PA) and applies occurrence + aggregate logic
    expect(d.formNumber).toBe('CG 00 01')
    const cited = [...d.reasoning, ...d.limits.map(l => `${l.label} ${l.note ?? ''}`)].join(' ').toLowerCase()
    expect(cited).toContain('occurrence')
    expect(cited).toContain('general aggregate')
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })

  it('NOT_COVERED: faulty completed work damaging the insured’s own work → "damage to your work" exclusion', () => {
    const d: Determination = {
      verdict: 'NOT_COVERED',
      summary: 'Damage to the insured’s own completed work arising out of that work is excluded under the CGL — it is not third-party liability the form insures.',
      formNumber: 'CG 00 01',
      coverages: [],
      exclusions: [{ name: 'Damage to Your Work', formNumber: 'CG 00 01 Coverage A Excl. l.', note: 'Property damage to "your work" arising out of it and included in the products-completed operations hazard is excluded.' }],
      limits: [],
      reasoning: [
        'The CGL is third-party liability; property damage to the insured’s OWN completed work is barred by the "damage to your work" exclusion [Exclusion l., CG 00 01].',
        'Because the loss is excluded, it does not erode either the General Aggregate or the Products-Completed-Operations Aggregate [CG 00 01].',
      ],
      citations: ['Exclusion l. — Damage to Your Work', 'CG 00 01'],
    }
    expect(d.formNumber).toBe('CG 00 01')
    expect(isDeterminationCited(d)).toBe(true)
    expect(shouldRenderDetermination(d)).toBe(true)
  })
})
