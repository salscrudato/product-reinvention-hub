/**
 * dynamic-fields-forwardfill.test.ts — regression lock for the Forms Dynamic Data
 * section-header forward-fill (stage4 deterministicExtract).
 *
 * A "Forms Dynamic Data" sheet states the FORM NUMBER once per form and leaves it blank
 * on each continuation field-row. Pre-fix, a blank formNumber cell was skipped, so every
 * continuation field lost its parent-form link and orphaned at the stage7 join (the live
 * E+ run surfaced 198 of 1,830 rows as "no form number"). The extractor now carries the
 * last non-blank formNumber down, keeping the ORIGINAL header cell's citation so the value
 * stays grounded (faithful extraction of a section header — never invented).
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deterministicExtract } = require('../../server/lib/import-brain/stage4-extract.js')

type Field = { fieldName: string; value: unknown; citation: { sheet: string; cell: string; verbatim: string } }
type Entity = { kind: string; fields: Field[] }

const colMap = {
  mappings: [
    { canonicalField: 'formNumber', colIndex: 0, confidence: 0.95, entityKind: 'dynamicField' },
    { canonicalField: 'name',       colIndex: 1, confidence: 0.95, entityKind: 'dynamicField' },
    { canonicalField: 'dataType',   colIndex: 2, confidence: 0.95, entityKind: 'dynamicField' },
  ],
  stateColumns: [],
}

// Two forms, each stated once then continued on blank-formNumber rows (null AND '').
const rows = [
  ['EP 201 AZ', 'Name of Excluded Person', 'Text'],     // form stated
  [null,        'Effective Date',          'Date'],      // blank (null) → carry EP 201 AZ
  ['',          'Policy Number',           'Text'],      // blank ('')  → carry EP 201 AZ
  ['EP 305 CA', 'Limit of Insurance',      'Currency'],  // new form
  [null,        'Deductible',              'Currency'],   // blank → carry EP 305 CA
]

const entities: Entity[] = deterministicExtract(
  { sheetName: 'E+ Forms Dynamic Data' }, colMap, 1, rows, 'E+ Forms Dynamic Data', null,
)
const formNumberOf = (e: Entity) => e.fields.find(f => f.fieldName === 'formNumber')
const nameOf = (e: Entity) => e.fields.find(f => f.fieldName === 'name')?.value

describe('Forms Dynamic Data — form-number forward-fill (stage4)', () => {
  it('extracts one dynamicField entity per row', () => {
    expect(entities).toHaveLength(5)
    expect(entities.every(e => e.kind === 'dynamicField')).toBe(true)
  })

  it('carries the form number down blank continuation rows (null and empty string)', () => {
    expect(formNumberOf(entities.find(e => nameOf(e) === 'Effective Date')!)!.value).toBe('EP 201 AZ')
    expect(formNumberOf(entities.find(e => nameOf(e) === 'Policy Number')!)!.value).toBe('EP 201 AZ')
    expect(formNumberOf(entities.find(e => nameOf(e) === 'Deductible')!)!.value).toBe('EP 305 CA')
  })

  it('a new form number resets the carry (no bleed across forms)', () => {
    expect(formNumberOf(entities.find(e => nameOf(e) === 'Limit of Insurance')!)!.value).toBe('EP 305 CA')
  })

  it('a forward-filled value keeps the ORIGINAL header cell citation (grounded, not the blank row)', () => {
    // Row 0 ("EP 201 AZ") sits at excel row 3 (col A); the carried value on later rows must
    // cite A3, not the blank continuation cell — the value is grounded to where it was stated.
    const carried = formNumberOf(entities.find(e => nameOf(e) === 'Effective Date')!)!
    expect(carried.citation.cell).toBe('A3')
    expect(carried.citation.verbatim).toBe('EP 201 AZ')
  })
})
