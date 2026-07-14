/**
 * hardening-f11-join-punctuation.test.ts — regression lock for ledger F11.
 *
 * The stage-7 Pass-2 name join keys on nameKey(), which pre-fix normalized case
 * and whitespace but NOT punctuation — 'HO-3 Special Form' (brain) failed to join
 * 'HO 3 Special Form' (deterministic ISO mapper), so ONE real entity came out as
 * TWO plan entries (a mapper-only append + a flagged brain leftover). Join keys
 * need the same canonicalization discipline as value comparison.
 *
 * Also locks the adjacent hazard: names that canonicalize to '' (e.g. '---')
 * must never join each other on the empty key.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

function entity(kind: string, refId: string | null, name: string, row: number) {
  const fields = [
    { fieldName: 'name', value: name, confidence: 0.95, citation: { sheet: 'FW', cell: `B${row + 2}`, verbatim: name } },
  ]
  if (refId) fields.unshift({ fieldName: 'refId', value: refId, confidence: 0.95, citation: { sheet: 'FW', cell: `A${row + 2}`, verbatim: refId } })
  return {
    kind, sourceRowIndex: row, sourceSheet: 'FW', reviewFlag: false, needsRefIdSynthesis: !refId,
    overallConfidence: 0.95, fields,
  }
}

function isoCov(refId: string, name: string) {
  return { refId, label: name, data: { refId, name, parentId: null } }
}

function plan(brainEntities: unknown[], isoCoverages: unknown[]) {
  return buildImportPlan(
    { entities: brainEntities, importWarnings: [], classifiedSheets: [], columnMaps: [] },
    { lobRefIdHint: 'PH.LOB.001', sourceName: 'fixture.xlsx', isoPlan: { coverages: isoCoverages } },
  )
}

describe('F11: Pass-2 ISO name join canonicalizes punctuation', () => {
  it("joins 'HO-3 Special Form' (brain) with 'HO 3 Special Form' (mapper) as ONE entity", () => {
    const bundle = plan(
      [entity('product', 'PH.PROD.001', 'Homeowners', 0), entity('coverage', 'PH.COV.SYNTH001', 'HO-3 Special Form', 1)],
      [isoCov('PH.COV.001', 'HO 3 Special Form')],
    )
    expect(bundle.plan.coverages).toHaveLength(1)
    expect(bundle.plan.coverages[0].refId).toBe('PH.COV.001')
    expect(bundle.plan.coverages[0].data.consensus).toBe('iso-join')
    // The brain's cited extraction survives the join (provenance addressable under the adopted id).
    expect(bundle.provenance.some((r: { refId: string; field: string }) => r.refId === 'PH.COV.001' && r.field === 'name')).toBe(true)
    expect(bundle.importWarnings.some((w: { kind: string }) => w.kind === 'not-in-deterministic-map')).toBe(false)
  })

  it('joins across dash variants and stray punctuation (en dash / slash / comma)', () => {
    const bundle = plan(
      [
        entity('coverage', null, 'Coverage A – Dwelling', 0),
        entity('coverage', null, 'Debris Removal, Additional', 1),
        entity('coverage', null, 'Water / Sewer Backup', 2),
      ],
      [
        isoCov('PH.COV.001', 'Coverage A - Dwelling'),
        isoCov('PH.COV.002', 'Debris Removal Additional'),
        isoCov('PH.COV.003', 'Water Sewer Backup'),
      ],
    )
    expect(bundle.plan.coverages).toHaveLength(3)
    expect(new Set(bundle.plan.coverages.map((c: { refId: string }) => c.refId))).toEqual(new Set(['PH.COV.001', 'PH.COV.002', 'PH.COV.003']))
    expect(bundle.plan.coverages.every((c: { data: { consensus?: string } }) => c.data.consensus === 'iso-join')).toBe(true)
  })

  it('genuinely different names still do NOT join', () => {
    const bundle = plan(
      [entity('coverage', null, 'Coverage B - Other Structures', 0)],
      [isoCov('PH.COV.001', 'Coverage A - Dwelling')],
    )
    // One mapper-only + one flagged brain leftover — conservation, not a false merge.
    expect(bundle.plan.coverages).toHaveLength(2)
    const brainOnly = bundle.plan.coverages.find((c: { data: { needsReview?: boolean } }) => c.data.needsReview)
    expect(brainOnly?.label).toBe('Coverage B - Other Structures')
  })

  it("names that canonicalize to '' never join on the empty key", () => {
    const bundle = plan(
      [entity('coverage', null, '---', 0)],
      [isoCov('PH.COV.001', '###')],
    )
    expect(bundle.plan.coverages).toHaveLength(2)
    expect(bundle.plan.coverages.find((c: { refId: string }) => c.refId === 'PH.COV.001')?.data.consensus).not.toBe('iso-join')
  })
})
