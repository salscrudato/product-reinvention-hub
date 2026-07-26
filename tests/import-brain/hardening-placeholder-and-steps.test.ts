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

// D9 — the coverage a rating step prices is ORACLE-owned.
//
// The brain reads the sheet's COVERAGE NAME column, which real ROCs state once per block and
// leave blank on every continuation row beneath it (90 of 2,024 CORE rows carry it, 17 of 303
// E+ rows). The deterministic mapper reads the coverage-ID column the same sheets fill on
// nearly every row, forward-fills the ditto continuations, splits multi-coverage cells and
// resolves each token onto the hierarchy. That is an established structural fact, so
// `coverageRef` is in ISO_ORACLE_FIELDS and the mapper's value wins outright — without that
// declaration the field's stage-7 behaviour is undefined and the fix lands non-deterministically.
describe('D9 the mapper is the ORACLE for the coverage a rating step prices', () => {
  const cite = (sheet: string, cell: string, verbatim: string) => ({ sheet, cell, verbatim })
  const stepEntity = (refId: string, label: string, row: number, extra: Array<{ fieldName: string; value: unknown }>) => ({
    kind: 'ratingStep', sourceSheet: 'Core Rating Specifications', sourceRowIndex: row,
    overallConfidence: 0.9,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.95, citation: cite('Core Rating Specifications', `C${row}`, refId) },
      { fieldName: 'label', value: label, confidence: 0.95, citation: cite('Core Rating Specifications', `I${row}`, label) },
      ...extra.map(f => ({ ...f, confidence: 0.9, citation: cite('Core Rating Specifications', `D${row}`, String(f.value)) })),
    ],
  })

  const bundle = buildImportPlan({
    entities: [
      {
        kind: 'ratingProgram', sourceSheet: 'Core Rating Specifications', sourceRowIndex: 5, overallConfidence: 0.9,
        fields: [{ fieldName: 'refId', value: 'CORE.RAT.1', confidence: 0.95, citation: cite('Core Rating Specifications', 'C6', 'CORE.RAT.1') }],
      },
      // The brain read the sparse COVERAGE NAME column and produced a coverage NAME.
      stepEntity('CORE.RAT.1.01', 'Base rate', 6, [
        { fieldName: 'coverageRef', value: 'Bodily Injury' },
        { fieldName: 'source.ref', value: 'RT.BASE' },
      ]),
      // A continuation row: the brain read nothing at all for the coverage.
      stepEntity('CORE.RAT.1.02', 'Driver age factor', 7, [{ fieldName: 'source.ref', value: 'RT.AGE' }]),
    ],
    importWarnings: [], classifiedSheets: [], columnMaps: [],
  }, {
    lobRefIdHint: 'PH.LOB.001', sourceName: 'fixture.xlsx',
    isoPlan: {
      ratingProgram: {
        docId: 'CORE-RAT-1', refId: 'CORE.RAT.1', label: 'CORE.RAT.1 — rating program',
        data: {
          refId: 'CORE.RAT.1', name: 'Imported Rating Program',
          steps: [
            { id: 'CORE.RAT.1.01', order: 1, label: 'Base rate', op: 'MUL', source: { type: 'RT', ref: 'RT.BASE' },
              coverageRef: 'CORE.COV.018', coverageRefCitation: 'Core Rating Specifications!B6' },
            { id: 'CORE.RAT.1.02', order: 2, label: 'Driver age factor', op: 'MUL', source: { type: 'RT', ref: 'RT.AGE' },
              coverageRef: 'CORE.COV.018', coverageRefCitation: 'Core Rating Specifications!B6' },
          ],
        },
      },
    },
  })
  const steps = bundle.plan.ratingProgram.data.steps as Array<Record<string, unknown>>
  const step = (id: string) => steps.find(s => s['id'] === id)!

  it('a brain-supplied value never overwrites the mapper-established one', () => {
    // The brain cited "Bodily Injury"; the mapper established CORE.COV.018 from the id column.
    expect(step('CORE.RAT.1.01')['coverageRef']).toBe('CORE.COV.018')
  })

  it('gap-fills the steps the brain read no coverage for at all', () => {
    expect(step('CORE.RAT.1.02')['coverageRef']).toBe('CORE.COV.018')
  })

  it('carries the citation of the cell that stated it', () => {
    expect(step('CORE.RAT.1.01')['coverageRefCitation']).toBe('Core Rating Specifications!B6')
  })

  it('keeps the brain step set — the plan is not silently replaced by the mapper array', () => {
    expect(steps).toHaveLength(2)
    expect((step('CORE.RAT.1.01')['source'] as { type: string; ref: string })).toEqual({ type: 'RT', ref: 'RT.BASE' })
  })
})
