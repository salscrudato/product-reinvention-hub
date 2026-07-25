// Regressions for two defects found on the real Hagerty CORE/E+ import:
//
//   #20 every parent coverage imported named "<Intentionally Blank>". PCM framework sheets
//       fill the inapplicable level of the hierarchy with a literal sentinel, so a PARENT
//       coverage row's SUB-COVERAGE cell reads "<Intentionally Blank>" BY DESIGN (verified in
//       "Product Specifications _Core.xlsx", sheet "Core Framework": E8="Bodily Injury
//       Liability Coverage" / F8="<Intentionally Blank>"). stage 7 picked the most specific
//       name column first and the sentinel is a non-empty string, so it won every time.
//
//   #21 the Pricing tab white-screened on any brain-imported product. canonicalMap declares
//       the rate reference as the DOTTED key 'source.ref', so an extracted step is a flat bag
//       with no nested `source`; every consumer reads `step.source.type`.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { deriveGridInputSpec, repairPersistedProgram } from '@pf/shared'
import type { RatingProgram } from '@pf/shared'

const require_ = createRequire(import.meta.url)
const { buildImportPlan, normalizeRatingStep } = require_('../../server/lib/import-brain/stage7-plan.js')
const brainShared = require_('../../server/lib/import-brain-shared.cjs')

const cite = (cell: string) => ({ sheet: 'Core Framework', cell, verbatim: 'x' })
const field = (fieldName: string, value: unknown, cell = 'A1') =>
  ({ fieldName, value, citation: cite(cell), confidence: 0.95 })

function coverageEntity(refId: string, coverageName: string, subCoverageName: string) {
  return {
    kind: 'coverage',
    sourceSheet: 'Core Framework',
    sourceRowIndex: 8,
    overallConfidence: 0.95,
    fields: [
      field('refId', refId, 'B8'),
      field('coverageName', coverageName, 'E8'),
      field('subCoverageName', subCoverageName, 'F8'),
    ],
  }
}

describe('#20 the "<Intentionally Blank>" sentinel is not a name', () => {
  it('the shared predicate recognises the sentinel the workbook actually ships', () => {
    // Byte-exact strings taken from Core Framework F8 / G6.
    expect(brainShared.isPlaceholder('<Intentionally Blank>')).toBe(true)
    expect(brainShared.isPlaceholder('N/A')).toBe(true)
    expect(brainShared.isPlaceholder('Bodily Injury Liability Coverage')).toBe(false)
  })

  it('a PARENT row falls through the sentinel to its COVERAGE name', () => {
    const plan = buildImportPlan({
      entities: [coverageEntity('CORE.COV.001', 'Bodily Injury Liability Coverage', '<Intentionally Blank>')],
      review: [],
    })
    const cov = plan.plan.coverages[0]
    expect(cov.data.name).toBe('Bodily Injury Liability Coverage')
    expect(cov.label).toBe('Bodily Injury Liability Coverage')
    // The sentinel must not survive anywhere on the entity — a form's "Where used" panel
    // renders whatever landed here.
    expect(JSON.stringify(cov)).not.toContain('Intentionally Blank')
  })

  it('a SUB row still keeps its own, more specific name', () => {
    const plan = buildImportPlan({
      entities: [coverageEntity('CORE.COV.001.001', 'Bodily Injury Liability Coverage', 'Pre-Judgment Interest Coverage')],
      review: [],
    })
    expect(plan.plan.coverages[0].data.name).toBe('Pre-Judgment Interest Coverage')
  })
})

describe('#21 an imported rating step carries a canonical source', () => {
  it("builds an RT source from canonicalMap's dotted 'source.ref' key", () => {
    const step = normalizeRatingStep({ id: 'CORE.RAT.0005.19', label: 'Safety equipment discount', 'source.ref': 'RT.SAFETY', op: '*' }, 0, [])
    expect(step.source).toEqual({ type: 'RT', ref: 'RT.SAFETY' })
    expect(step.op).toBe('MUL')
    expect(step.order).toBe(1)
  })

  it('a step naming no table becomes an INPUT and is REPORTED, never given an invented rate', () => {
    const warnings: { kind: string; detail: string }[] = []
    const step = normalizeRatingStep({ label: 'Base rate' }, 4, warnings)
    expect(step.source.type).toBe('INPUT')
    expect(step.source.ref).toBe('Base rate')
    expect(warnings.map(w => w.kind)).toContain('rating-step-source-unstated')
  })

  it('an already-canonical nested source is left alone', () => {
    const step = normalizeRatingStep({ id: 's1', label: 'L', op: 'ADD', source: { type: 'CONST', value: 5 } }, 0, [])
    expect(step.source).toEqual({ type: 'CONST', value: 5 })
    expect(step.op).toBe('ADD')
  })
})

describe('#21 the Pricing tab survives a program persisted without sources', () => {
  // Exactly the shape that reached Cosmos and crashed the tab.
  const broken = {
    refId: 'CORE.PROG.001', name: 'Imported',
    steps: [{ id: 'a', order: 1, label: 'Base rate', op: 'MUL', 'source.ref': 'RT.TERR' }],
  } as unknown as RatingProgram

  it('deriveGridInputSpec no longer throws on a step with no source', () => {
    const raw = { ...broken, steps: [{ id: 'a', order: 1, label: 'L', op: 'MUL' }] } as unknown as RatingProgram
    expect(() => deriveGridInputSpec(raw, {})).not.toThrow()
    expect(deriveGridInputSpec(raw, {})).toBeNull()
  })

  it('repairPersistedProgram rebuilds the source from the flat bag', () => {
    const fixed = repairPersistedProgram(broken)!
    expect(fixed.steps[0]!.source).toEqual({ type: 'RT', ref: 'RT.TERR' })
  })

  it('a healthy program is returned by IDENTITY so memo deps stay stable', () => {
    const good = {
      refId: 'P', name: 'n',
      steps: [{ id: 'a', order: 1, label: 'L', op: 'MUL', source: { type: 'RT', ref: 'T' } }],
    } as unknown as RatingProgram
    expect(repairPersistedProgram(good)).toBe(good)
  })

  it('null in, null out', () => {
    expect(repairPersistedProgram(null)).toBeNull()
  })
})
