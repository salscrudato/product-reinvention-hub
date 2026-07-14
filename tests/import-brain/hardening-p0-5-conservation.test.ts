/**
 * hardening-p0-5-conservation.test.ts — regression lock for ledger F06 (P0-5).
 *
 * Conservation: stage 7 plans exactly one product and one rating program — every
 * EXTRA accepted entity of those kinds must land in bundle.unresolved as a BLOCKING
 * item with its citation evidence, and the count identity
 * proposed = accepted + unresolved must hold. Pre-fix (2b1f893) the extras
 * (productEntities[1..], programs[1..]) simply vanished from the bundle.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

function entity(kind: string, refId: string, name: string, row: number) {
  return {
    kind, sourceRowIndex: row, sourceSheet: 'FW', reviewFlag: false, needsRefIdSynthesis: false,
    overallConfidence: 0.95,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.95, citation: { sheet: 'FW', cell: `A${row + 2}`, verbatim: refId } },
      { fieldName: 'name', value: name, confidence: 0.95, citation: { sheet: 'FW', cell: `B${row + 2}`, verbatim: name } },
    ],
  }
}

describe('P0-5: multiplicity conservation (ledger F06)', () => {
  const brainOutput = {
    entities: [
      entity('product', 'GL.PROD.001', 'CGL Product', 0),
      entity('product', 'GL.PROD.002', 'Second Product', 1),
      entity('ratingProgram', 'GL.PROG.001', 'Program One', 2),
      entity('ratingProgram', 'GL.PROG.002', 'Program Two', 3),
      entity('coverage', 'GL.COV.001', 'Premises Liability', 4),
    ],
    importWarnings: [], classifiedSheets: [], columnMaps: [],
  }
  const bundle = buildImportPlan(brainOutput, { lobRefIdHint: 'GL.LOB.001', sourceName: 'fixture.xlsx' })

  it('extra products become BLOCKING unresolved items with evidence, never dropped', () => {
    const extras = bundle.unresolved.filter((u: { section: string }) => u.section === 'product')
    expect(extras).toHaveLength(1)
    expect(extras[0].refId).toBe('GL.PROD.002')
    expect(extras[0].severity).toBe('BLOCKING')
    expect(extras[0].citation).toContain('FW!')
    expect(bundle.plan.products).toHaveLength(1)
    expect(bundle.plan.products[0].refId).toBe('GL.PROD.001')
    expect(bundle.importWarnings.some((w: { kind: string }) => w.kind === 'multiple-products')).toBe(true)
  })

  it('extra rating programs become BLOCKING unresolved items, never dropped', () => {
    const extras = bundle.unresolved.filter((u: { section: string }) => u.section === 'rating')
    expect(extras).toHaveLength(1)
    expect(extras[0].refId).toBe('GL.PROG.002')
    expect(extras[0].severity).toBe('BLOCKING')
    expect(bundle.plan.ratingProgram.refId).toBe('GL.PROG.001')
    expect(bundle.importWarnings.some((w: { kind: string }) => w.kind === 'multiple-rating-programs')).toBe(true)
  })

  it('conservation identity holds: proposed = accepted + unresolved', () => {
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
    // 5 entities in → 3 planned (product + program + coverage) + 2 unresolved extras.
    expect(bundle.counts.accepted).toBe(3)
    expect(bundle.counts.unresolved).toBe(2)
  })

  it('a single-product plan stays clean (no spurious unresolved)', () => {
    const clean = buildImportPlan({
      entities: [
        entity('product', 'GL.PROD.001', 'CGL Product', 0),
        entity('coverage', 'GL.COV.001', 'Premises Liability', 1),
      ],
      importWarnings: [], classifiedSheets: [], columnMaps: [],
    }, { lobRefIdHint: 'GL.LOB.001' })
    expect(clean.unresolved).toHaveLength(0)
    expect(clean.counts.proposed).toBe(clean.counts.accepted)
  })
})
