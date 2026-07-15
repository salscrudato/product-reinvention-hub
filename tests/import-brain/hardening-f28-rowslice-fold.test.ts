/**
 * hardening-f28-rowslice-fold.test.ts — regression lock for ledger F28.
 *
 * Sources encode one form rule as N rows (one row per attached form). The
 * deterministic mapper folds them into ONE formRule whose formNumbers is the
 * union — that is the golden's shape. The brain's row-level extraction emits
 * one entity per row (correct provenance), and the ISO join adopted the mapper
 * identity for the FIRST row only: every later row-slice fell through the join
 * as a "brain-only leftover" and was kept as a same-refId near-duplicate.
 *
 * Live GL (wave-3 Tier-1, 2026-07-15): 5 duplicate groups, all formRule,
 * 27 entities → 22 spurious single-form near-dups → formAttachmentRecall
 * 0.9603 < 0.98 gate. Worse than a metric: plan persists are refId-keyed
 * upserts, so LAST-WRITE-WINS could persist a 1-form slice over the 8-form
 * entity — silent attachment loss (F21's class, plan layer).
 *
 * The lock: a join leftover whose refId already exists in the joined plan is a
 * ROW-SLICE of that entity — fold it (array fields union, scalars gap-fill,
 * mapper identity wins), never append a duplicate. Genuine no-counterpart
 * leftovers are still kept + flagged + warned (never silently dropped).
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

function entity(kind: string, refId: string, name: string, row: number, extraFields: Array<{ fieldName: string; value: unknown }> = []) {
  return {
    kind, sourceRowIndex: row, sourceSheet: 'FR', reviewFlag: false, needsRefIdSynthesis: false,
    overallConfidence: 0.95,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.95, citation: { sheet: 'FR', cell: `A${row + 2}`, verbatim: refId } },
      { fieldName: 'name', value: name, confidence: 0.95, citation: { sheet: 'FR', cell: `B${row + 2}`, verbatim: name } },
      ...extraFields.map((f, i) => ({ ...f, confidence: 0.9, citation: { sheet: 'FR', cell: `C${row + 2 + i}`, verbatim: String(f.value) } })),
    ],
  }
}
const iso = (refId: string, name: string, data: Record<string, unknown> = {}) =>
  ({ refId, label: name, data: { refId, name, ...data } })

type Planned = { refId?: string; data: { formNumbers?: string[]; needsReview?: boolean; description?: string } }
const plannedFormRules = (bundle: unknown) => (bundle as { plan: { formRules: Planned[] } }).plan.formRules
const warnings = (bundle: unknown) => (bundle as { importWarnings: Array<{ kind: string; field?: string | null; detail: string }> }).importWarnings

describe('F28: same-refId join leftovers fold into their entity', () => {
  it('the GL live shape: 8 row-slices of one formRule become ONE plan entity with all 8 forms', () => {
    const FORMS = ['CG 01 27', 'CG 01 28', 'CG 01 41', 'CG 01 55', 'CG 01 65', 'CG 26 19', 'CG 26 26', 'CG 26 37']
    const brainOutput = {
      entities: [
        entity('product', 'GL.PROD.001', 'CGL Product', 0),
        ...FORMS.map((f, i) => entity('formRule', 'GL.FORM.RU.007', 'Amendment Of Declarations', i + 1, [
          { fieldName: 'formNumbers', value: [f] },
        ])),
      ],
      importWarnings: [], classifiedSheets: [], columnMaps: [],
    }
    const isoPlan = {
      product: iso('GL.PROD.001', 'CGL Product'),
      coverages: [], forms: [], rules: [], ldTables: [], rtTables: [],
      formRules: [iso('GL.FORM.RU.007', 'Amendment Of Declarations', { formNumbers: FORMS })],
    }
    const bundle = buildImportPlan(brainOutput, { lobRefIdHint: 'GL.LOB.001', sourceName: 'fixture.xlsx', isoPlan })
    const frs = plannedFormRules(bundle)

    expect(frs.length, 'row-slices must fold into ONE formRule').toBe(1)
    expect(new Set(frs[0].data.formNumbers)).toEqual(new Set(FORMS))
    // The fold means these slices DID have a counterpart — no leftover warning,
    // and no duplicate-refId integrity warning for formRules.
    expect(warnings(bundle).some(w => w.kind === 'not-in-deterministic-map' && w.field === 'formRule')).toBe(false)
    expect(warnings(bundle).some(w => w.kind === 'duplicate-refId' && w.field === 'formRule')).toBe(false)
  })

  it('interleaved groups + a cited extra form + a genuine brain-only leftover', () => {
    const brainOutput = {
      entities: [
        entity('product', 'GL.PROD.001', 'CGL Product', 0),
        // Two dup groups, interleaved rows; one slice carries a CITED form the
        // mapper missed (FX 99 99) — the union must keep it, never drop a cited value.
        entity('formRule', 'GL.FORM.RU.100', 'Rule Hundred', 1, [{ fieldName: 'formNumbers', value: ['CG 10 01'] }]),
        entity('formRule', 'GL.FORM.RU.200', 'Rule Two Hundred', 2, [{ fieldName: 'formNumbers', value: ['CG 20 01'] }]),
        entity('formRule', 'GL.FORM.RU.100', 'Rule Hundred', 3, [{ fieldName: 'formNumbers', value: ['CG 10 02', 'FX 99 99'] }]),
        entity('formRule', 'GL.FORM.RU.200', 'Rule Two Hundred', 4, [{ fieldName: 'formNumbers', value: ['CG 20 02'] }]),
        entity('formRule', 'GL.FORM.RU.100', 'Rule Hundred', 5, [{ fieldName: 'formNumbers', value: ['CG 10 03'] }]),
        // Genuine brain-only rule: no iso counterpart, distinct refId — must be
        // KEPT with a review flag and the leftover warning must count ONLY it.
        entity('formRule', 'GL.FORM.RU.999', 'Brain Only Rule', 6, [{ fieldName: 'formNumbers', value: ['CG 99 01'] }]),
      ],
      importWarnings: [], classifiedSheets: [], columnMaps: [],
    }
    const isoPlan = {
      product: iso('GL.PROD.001', 'CGL Product'),
      coverages: [], forms: [], rules: [], ldTables: [], rtTables: [],
      formRules: [
        iso('GL.FORM.RU.100', 'Rule Hundred', { formNumbers: ['CG 10 01', 'CG 10 02', 'CG 10 03'], description: 'mapper description' }),
        iso('GL.FORM.RU.200', 'Rule Two Hundred', { formNumbers: ['CG 20 01', 'CG 20 02'] }),
      ],
    }
    const bundle = buildImportPlan(brainOutput, { lobRefIdHint: 'GL.LOB.001', sourceName: 'fixture.xlsx', isoPlan })
    const frs = plannedFormRules(bundle)

    const ids = frs.map(p => p.refId)
    expect(new Set(ids).size, 'no duplicate refIds in the plan').toBe(ids.length)
    expect(ids.sort()).toEqual(['GL.FORM.RU.100', 'GL.FORM.RU.200', 'GL.FORM.RU.999'])

    const ru100 = frs.find(p => p.refId === 'GL.FORM.RU.100')!
    // Union: mapper identity + the cited extraction extra.
    expect(new Set(ru100.data.formNumbers)).toEqual(new Set(['CG 10 01', 'CG 10 02', 'CG 10 03', 'FX 99 99']))
    // Scalar gap-fill untouched by the fold: mapper description survives.
    expect(ru100.data.description).toBe('mapper description')

    const ru200 = frs.find(p => p.refId === 'GL.FORM.RU.200')!
    expect(new Set(ru200.data.formNumbers)).toEqual(new Set(['CG 20 01', 'CG 20 02']))

    const ru999 = frs.find(p => p.refId === 'GL.FORM.RU.999')!
    expect(ru999.data.needsReview, 'genuine leftover is kept + flagged').toBe(true)

    const leftoverWarn = warnings(bundle).find(w => w.kind === 'not-in-deterministic-map' && w.field === 'formRule')
    expect(leftoverWarn, 'the genuine leftover is still warned').toBeTruthy()
    expect(leftoverWarn!.detail).toMatch(/^1 /)
  })
})
