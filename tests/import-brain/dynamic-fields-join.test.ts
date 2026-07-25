/**
 * dynamic-fields-join.test.ts — regression lock for the Forms Dynamic Data
 * 1:many join (stage7 buildImportPlan).
 *
 * "Dynamic data" is the data PRINTED ON a form (fillable fields) rather than a
 * standalone entity. The canonical model carries it as Form.dynamicFields[]: one
 * form → many fields. Each extracted dynamicField row cites its parent via a
 * formNumber (canonicalMap: role source, mapsTo form.number). Before the join
 * these rows floated as orphan entities ("not auto-attached to forms"); the join
 * folds them onto their parent form's dynamicFields[].
 *
 * Locks (two-fixture rule + robustness):
 *   - 1:many attach with correct canonical shape (dataType fold, repeating bool,
 *     options split, notes/effective/expiration dates carried);
 *   - case/punctuation-insensitive form-number match ("CG 01 13" ≡ "CG-01-13");
 *   - a form that gains fields becomes dynamic:true;
 *   - forms with no dynamic data still carry dynamicFields: [] (canonical shape);
 *   - an unmatched formNumber is surfaced (dynamic-fields-unmatched), never attached;
 *   - a nameless row is surfaced (dynamic-fields-unnamed), never attached;
 *   - nothing is invented: only cited rows attach, citations stay in provenance.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

type Field = { fieldName: string; value: unknown }

function entity(kind: string, row: number, fields: Field[]) {
  return {
    kind, sourceRowIndex: row, sourceSheet: kind === 'dynamicField' ? 'Forms Dynamic Data' : 'Forms Specs',
    reviewFlag: false, needsRefIdSynthesis: false, overallConfidence: 0.95,
    fields: fields.map((f, i) => ({
      ...f, confidence: 0.95,
      citation: { sheet: 'Forms Dynamic Data', cell: `A${row + 2 + i}`, verbatim: String(f.value) },
    })),
  }
}

const form = (number: string, name: string, row: number) =>
  entity('form', row, [{ fieldName: 'number', value: number }, { fieldName: 'name', value: name }])

const dyn = (formNumber: string, extra: Field[], row: number) =>
  entity('dynamicField', row, [{ fieldName: 'formNumber', value: formNumber }, ...extra])

describe('Forms Dynamic Data → Form.dynamicFields[] (1:many join)', () => {
  const brainOutput = {
    entities: [
      entity('product', 0, [{ fieldName: 'refId', value: 'GL.PROD.001' }, { fieldName: 'name', value: 'CGL' }]),
      // Two forms; the first will receive several fields, matched with cosmetic
      // form-number variation (dashes vs spaces).
      form('CG 00 01', 'Commercial General Liability Coverage Form', 1),
      form('CG-01-13', 'Amendment Endorsement', 2),
      // A form with no dynamic data — must still end with dynamicFields: [].
      form('CG 20 10', 'Additional Insured', 3),

      // 1:many on CG 00 01 — three fields of different types.
      dyn('CG 00 01', [
        { fieldName: 'name', value: 'Rating Date' },
        { fieldName: 'dataType', value: 'Date' },
        { fieldName: 'repeating', value: 'No' },
        { fieldName: 'effectiveDate', value: '10 25' },
        { fieldName: 'expirationDate', value: '12 99' },
      ], 4),
      dyn('CG 00 01', [
        { fieldName: 'name', value: 'Aggregate Limit' },
        { fieldName: 'dataType', value: 'Number' },        // folds → TEXT
        { fieldName: 'repeating', value: 'Yes' },
        { fieldName: 'notes', value: 'Bound to declarations.' },
      ], 5),
      dyn('CG 00 01', [
        { fieldName: 'name', value: 'Coverage Form' },
        { fieldName: 'dataType', value: 'List' },
        { fieldName: 'repeating', value: 'No' },
        { fieldName: 'options', value: 'Named Perils; Special Form' },
      ], 6),

      // One field on CG-01-13, matched via space-form number "CG 01 13".
      dyn('CG 01 13', [
        { fieldName: 'name', value: 'Premium Amount' },
        { fieldName: 'dataType', value: 'Currency' },
        { fieldName: 'repeating', value: 'No' },
      ], 7),

      // Unmatched: references a form not in this plan.
      dyn('CG 99 99', [{ fieldName: 'name', value: 'Ghost Field' }, { fieldName: 'dataType', value: 'Text' }], 8),
      // Nameless: no field name → cannot form a valid DynamicField.
      dyn('CG 00 01', [{ fieldName: 'dataType', value: 'Text' }], 9),
    ],
    importWarnings: [], classifiedSheets: [], columnMaps: [],
  }

  const bundle = buildImportPlan(brainOutput, { lobRefIdHint: 'GL.LOB.001', sourceName: 'fixture.xlsx' })
  const forms = bundle.plan.forms as Array<{ data: Record<string, unknown> }>
  const byNumber = (n: string) => forms.find(f => f.data.number === n)!
  const warnKinds = bundle.importWarnings.map((w: { kind: string }) => w.kind)

  it('attaches all matching rows 1:many to the correct parent form', () => {
    const df = byNumber('CG 00 01').data.dynamicFields as Array<{ name: string }>
    expect(df).toHaveLength(3)                                   // three named rows, not the nameless one
    expect(df.map(f => f.name).sort()).toEqual(['Aggregate Limit', 'Coverage Form', 'Rating Date'])
  })

  it('carries the canonical shape: dataType fold, repeating boolean, options, dates, notes', () => {
    const df = byNumber('CG 00 01').data.dynamicFields as Array<Record<string, unknown>>
    const rating = df.find(f => f.name === 'Rating Date')!
    expect(rating).toMatchObject({ dataType: 'DATE', repeating: false, effectiveDate: '10 25', expirationDate: '12 99' })
    const agg = df.find(f => f.name === 'Aggregate Limit')!
    expect(agg).toMatchObject({ dataType: 'TEXT', repeating: true, notes: 'Bound to declarations.' })  // Number → TEXT
    const cf = df.find(f => f.name === 'Coverage Form')!
    expect(cf).toMatchObject({ dataType: 'LIST', options: ['Named Perils', 'Special Form'] })
  })

  it('matches form numbers case/punctuation-insensitively (CG 01 13 ≡ CG-01-13)', () => {
    const df = byNumber('CG-01-13').data.dynamicFields as Array<Record<string, unknown>>
    expect(df).toHaveLength(1)
    expect(df[0]).toMatchObject({ name: 'Premium Amount', dataType: 'CURRENCY' })
  })

  it('marks a form that gained fields as dynamic', () => {
    expect(byNumber('CG 00 01').data.dynamic).toBe(true)
    expect(byNumber('CG-01-13').data.dynamic).toBe(true)
  })

  it('gives every form a dynamicFields[] array, empty when it has no dynamic data', () => {
    for (const f of forms) expect(Array.isArray(f.data.dynamicFields)).toBe(true)
    expect(byNumber('CG 20 10').data.dynamicFields).toEqual([])
  })

  it('surfaces an unmatched form number instead of attaching or inventing', () => {
    expect(warnKinds).toContain('dynamic-fields-unmatched')
    // The ghost row never lands on any form.
    const allNames = forms.flatMap(f => (f.data.dynamicFields as Array<{ name: string }>).map(d => d.name))
    expect(allNames).not.toContain('Ghost Field')
  })

  it('surfaces a nameless row instead of attaching it', () => {
    expect(warnKinds).toContain('dynamic-fields-unnamed')
    expect(warnKinds).toContain('dynamic-fields-attached')
    // The nameless CG 00 01 row did not inflate the parent beyond its 3 named fields.
    expect((byNumber('CG 00 01').data.dynamicFields as unknown[]).length).toBe(3)
  })

  it('keeps every dynamic-field citation in provenance (grounded, nothing dropped)', () => {
    const prov = bundle.provenance as Array<{ kind: string; field: string; sheet: string }>
    const dfProv = prov.filter(p => p.kind === 'dynamicField')
    // Every extracted dynamicField field retains its citing sheet.
    expect(dfProv.length).toBeGreaterThan(0)
    expect(dfProv.every(p => p.sheet === 'Forms Dynamic Data')).toBe(true)
  })
})
