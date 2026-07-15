/**
 * reconcile-synth-ids.test.ts — regression lock for ledger F15.
 *
 * The filing path mints ids for entities the source documents never assign ids
 * to (a rate filing has no refId column). Pre-fix these minted ids
 * (FIL.<token>.PROD, <prefix>.<token>.COV.###) were indistinguishable from
 * byte-for-byte source identifiers AND unparseable by refIdSegmentKind (the
 * shared identifier parser expects the kind token in segment 2). The platform
 * already has ONE synthesis convention — stage-4/stage-7's SYNTH marker with
 * the registry prefix — and every id-minting path must use it: a minted id
 * must (a) carry the SYNTH marker so no reader can mistake it for a source
 * identifier, and (b) parse to the right entity kind.
 *
 * Two structurally different fixtures (generalization amendment): the full
 * NJ homeowners filing (PH default line — product/coverages/rules/RT/LD/
 * rating program) and a minimal WA Personal Auto filing (PA hint, PP 00 01,
 * deductible table only — no rate order, no rating program).
 */
import { describe, it, expect } from 'vitest'
import { reconcileFiling } from './reconcile'
import { NJ_LEMONADE_EXTRACTION } from './njLemonadeFiling'
import { refIdSegmentKind } from '../lobRegistry'
import type { FilingExtraction } from './types'
import type { ImportPlan } from '../isoImport'

/** Every id the reconcile MINTS (forms carry refId:null — identity is (number, edition)). */
function mintedIds(plan: ImportPlan): { id: string; expectKind: string }[] {
  return [
    { id: plan.product!.refId!, expectKind: 'product' },
    ...plan.coverages.map(c => ({ id: c.refId!, expectKind: 'coverage' })),
    ...plan.rules.map(r => ({ id: r.refId!, expectKind: 'rule' })),
    ...plan.rtTables.map(t => ({ id: t.refId!, expectKind: 'rating' })),
    ...plan.ldTables.map(t => ({ id: t.refId!, expectKind: 'rating' })),
    ...(plan.ratingProgram ? [{ id: plan.ratingProgram.refId!, expectKind: 'rating' }] : []),
  ]
}

function assertSynthConvention(plan: ImportPlan) {
  const minted = mintedIds(plan)
  expect(minted.length).toBeGreaterThan(0)
  for (const { id, expectKind } of minted) {
    // (a) the SYNTH marker: a minted id must never masquerade as a source identifier.
    expect(id, `minted id "${id}" must carry the SYNTH marker`).toMatch(/\.SYNTH/)
    // (b) parseable: the shared identifier parser must classify the id correctly.
    expect(refIdSegmentKind(id), `refIdSegmentKind("${id}")`).toBe(expectKind)
    // The retired conventions must not resurface.
    expect(id).not.toMatch(/^FIL\./)
    expect(id).not.toMatch(/^[A-Z]{2}-COV-\d{3}$/)
  }
}

describe('F15: filing-minted ids follow the platform SYNTH convention', () => {
  it('NJ homeowners golden: every minted id carries SYNTH and parses to its kind', () => {
    const bundle = reconcileFiling(NJ_LEMONADE_EXTRACTION)
    assertSynthConvention(bundle.plan)
  })

  it('rating steps stay internally consistent: every RT/LD step ref resolves to a minted table', () => {
    const bundle = reconcileFiling(NJ_LEMONADE_EXTRACTION)
    const tableRefs = new Set([
      ...bundle.plan.rtTables.map(t => t.refId),
      ...bundle.plan.ldTables.map(t => t.refId),
    ])
    const prog = bundle.plan.ratingProgram!.data as { steps: { source: { type: string; ref?: string } }[] }
    for (const s of prog.steps) {
      if (s.source.type === 'RT' || s.source.type === 'LD') {
        expect(tableRefs.has(s.source.ref!), `step ref "${s.source.ref}"`).toBe(true)
      }
    }
    // The coverage deductible term references the minted LD table byte-for-byte.
    const covA = bundle.plan.coverages.find(c => /coverage a/i.test(String(c.data['name'])))!
    const terms = covA.data['terms'] as { ldTableRef?: string }[]
    const dedTerm = terms.find(t => t.ldTableRef)
    expect(dedTerm).toBeDefined()
    expect(tableRefs.has(dedTerm!.ldTableRef!)).toBe(true)
  })

  it('WA Personal Auto minimal filing (different line, form, and shape): same convention', () => {
    const ex: FilingExtraction = {
      filingState: 'WA',
      baseFormNumber: 'PP 00 01',
      baseFormEdition: '',
      productName: 'Personal Auto Policy',
      classifications: [
        { name: 'wa-auto-form.pdf', role: 'policyForm', cue: 'insuring agreement', confidence: 0.9 },
        { name: 'wa-auto-manual.pdf', role: 'manual', cue: 'numbered rules', confidence: 0.9 },
      ],
      rateOrder: { variables: [] },
      manual: {
        rules: [
          {
            ruleNumber: '3', title: 'Deductibles', kind: 'DEDUCTIBLE', concept: 'allPerilDed',
            citation: 'WA Auto Manual, Rule 3', confidence: 0.9,
            table: {
              layout: 'matrix', keyColumns: ['covBand', 'deductible'],
              columnKeys: ['250', '500', '1000'], valueColumn: 'factor',
              rowRegion: ['All   1.10  1.00  0.90'].join('\n'),
            },
          },
          {
            ruleNumber: '7', title: 'Driver Eligibility', kind: 'ELIGIBILITY', concept: '',
            citation: 'WA Auto Manual, Rule 7', confidence: 0.85,
            ruleDraft: { condition: 'Driver has a valid WA license', outcome: 'Eligible for coverage' },
          },
        ],
      },
      policyForm: {
        coverages: {
          items: [
            { name: 'Liability To Others', requirement: 'UNKNOWN', premiumGenerating: null, formNumbers: ['PP 00 01'], confidence: 0.9, citation: 'Part A' },
            { name: 'Collision', requirement: 'OPTIONAL', premiumGenerating: true, formNumbers: ['PP 00 01'], confidence: 0.9, citation: 'Part D' },
          ],
        },
        forms: { items: [] },
        rules: { items: [] },
        rating: { items: [] },
      },
    } as unknown as FilingExtraction
    const bundle = reconcileFiling(ex, { lobRefIdHint: 'PA.LOB.001' })
    assertSynthConvention(bundle.plan)
    // The line's registry prefix keys the minted ids (F18 threading holds under F15).
    for (const { id } of mintedIds(bundle.plan)) expect(id).toMatch(/^PA\./)
    // Conservation is untouched by the id scheme.
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })
})
