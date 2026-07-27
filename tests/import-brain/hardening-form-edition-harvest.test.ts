/**
 * hardening-form-edition-harvest.test.ts — the EDITION DATE column that was mapped
 * and then read by nobody.
 *
 * isoImport's FW_FIELDS DECLARES an `edition` alias group (isoImport.ts:604), so
 * mapColumns claims the framework sheet's EDITION DATE column and it never even
 * surfaces in the unmapped list — but grepping the whole 2,730-line mapper for
 * `at(cells,'edition')` returns exactly ONE consumer, inside parseForms, which
 * reads FORM_FIELDS off the Forms Specifications sheet. On the framework sheet the
 * column is claimed and read by nothing.
 *
 * Measured scale (docs/review/2026-07-26-NUMERIC-FIDELITY-VERDICT.md §3.1): 296 of
 * the eval2 corpus's 1218 numeric claims — 24.3%, the single largest class — are
 * this column, and `GL Product Framework!I` is populated on 110 of 110 data rows.
 * Form identity IS (number, edition) per canonicalMap.ts:267, so "CG 00 01" and
 * "CG 00 01 04 13" are legally distinct filings.
 *
 * Locked here:
 *   (a) the edition column is located by the SAME alias vocabulary isoImport declares;
 *   (b) a harvested form carries the edition its own row states, cited to that cell;
 *   (c) a row that states NO edition gets none — flag-not-invent, never a default;
 *   (d) the edition cell is claimed as consumed, so the sweeper does not re-classify
 *       a cell the harvest just read;
 *   (e) the named flag OFF restores the pre-fix shape byte for byte.
 */
import { describe, it, expect } from 'vitest'
import { runConservationPass, editionColumnOf } from '../../shared/src/import/mapper/conserve'
import type { IsoGrid, PlannedEntity } from '../../shared/src/insurance/isoImport'

const grid = (sheet: string, cells: (string | number | null)[][]): IsoGrid =>
  ({ sheet, file: 'wb.xlsx', cells } as unknown as IsoGrid)

/** A framework sheet shaped like the real ones: banner rows, then a header row with
 *  FORM NUMBER and EDITION DATE adjacent, then data. */
const FRAMEWORK = grid('GL Product Framework', [
  ['Acme Insurance', null, null, null],
  ['Product Component Model', null, null, null],
  ['PRODUCT FRAMEWORK ID', 'COVERAGE', 'FORM NUMBER', 'EDITION DATE'],
  ['GL.COV.001', 'Premises Liability', 'CG 00 01', '04 13'],
  ['GL.COV.002', 'Products Liability', 'CG 21 70', '01 15'],
  ['GL.COV.003', 'Personal Injury', 'CG 21 87', null],       // states no edition
])

const baseInput = {
  consumedSheets: new Set<string>(),
  existingRefIds: new Set<string>(),
  existingProductNames: new Set<string>(),
  existingCoverageNames: new Set<string>(),
  frameworkCoverageCount: 0,
  frameworkSheet: 'GL Product Framework',
  refPrefix: 'GL',
}

const run = (harvest: boolean, grids: IsoGrid[] = [FRAMEWORK]) =>
  runConservationPass({ ...baseInput, grids, harvestFormEditions: harvest })

const formNamed = (forms: PlannedEntity[], n: string) =>
  forms.find(f => f.data['formNumber'] === n)

describe('the edition column is located by the mapper\'s own alias vocabulary', () => {
  it('finds EDITION DATE below banner rows', () => {
    expect(editionColumnOf(FRAMEWORK)).toBe(3)
  })

  it('accepts every spelling isoImport declares, punctuation-insensitively', () => {
    for (const label of ['EDITION DATE', 'Edition Date', 'FORM EDITION DATE (MM YY)', 'FORM EDITION', 'EDITION', 'EFFECTIVE DATE', 'VERSION DATE']) {
      expect(editionColumnOf(grid('S', [['FORM NUMBER', label], ['CG 00 01', '04 13']]))).toBe(1)
    }
  })

  it('returns -1 when the sheet has no edition column — never a guessed index', () => {
    expect(editionColumnOf(grid('S', [['FORM NUMBER', 'COVERAGE'], ['CG 00 01', 'Premises']]))).toBe(-1)
    // A column merely CONTAINING the word is not an edition column.
    expect(editionColumnOf(grid('S', [['FORM NUMBER', 'EDITION NOTES'], ['CG 00 01', 'x']]))).toBe(-1)
  })
})

describe('a harvested form carries the edition its own row states', () => {
  it('attaches the edition byte-for-byte, cited to its own cell', () => {
    const res = run(true)
    const f1 = formNamed(res.forms, 'CG 00 01')
    expect(f1).toBeTruthy()
    expect(f1!.data['edition']).toBe('04 13')                        // byte-for-byte, space kept
    expect(f1!.data['editionCitation']).toBe('GL Product Framework!D4')
    expect(f1!.data['citation']).toBe('GL Product Framework!C4')     // the form token's own cell

    const f2 = formNamed(res.forms, 'CG 21 70')
    expect(f2!.data['edition']).toBe('01 15')
    expect(f2!.data['editionCitation']).toBe('GL Product Framework!D5')
  })

  it('a row that states NO edition gets none — flag-not-invent', () => {
    const f3 = formNamed(run(true).forms, 'CG 21 87')
    expect(f3).toBeTruthy()
    expect(f3!.data['edition']).toBeUndefined()
    expect(f3!.data['editionCitation']).toBeUndefined()
  })

  it('claims the edition cell as consumed so the sweeper does not re-read it', () => {
    const res = run(true)
    const spans = res.consumed.filter(s => s.reason === 'conserve:form-edition')
    expect(spans).toHaveLength(2)                                    // the two rows that state one
    expect(spans[0]).toMatchObject({ sheet: 'GL Product Framework', rowStart: 3, colStart: 3, colEnd: 3 })
  })

  it('counts the harvest so the effect is measurable, not assumed', () => {
    expect(run(true).stats['form.token.edition']).toBe(2)
    expect(run(false).stats['form.token.edition']).toBeUndefined()
  })
})

describe('the named flag OFF restores the pre-fix shape', () => {
  it('no edition, no editionCitation, no extra consumed span', () => {
    const res = run(false)
    for (const f of res.forms) {
      expect(f.data['edition']).toBeUndefined()
      expect(f.data['editionCitation']).toBeUndefined()
    }
    expect(res.consumed.some(s => s.reason === 'conserve:form-edition')).toBe(false)
    // Everything else is identical: same forms, same citations, same order.
    const on = run(true)
    expect(res.forms.map(f => f.refId)).toEqual(on.forms.map(f => f.refId))
    expect(res.forms.map(f => f.data['citation'])).toEqual(on.forms.map(f => f.data['citation']))
  })
})

describe('the harvest never invents an identity', () => {
  it('a sheet with no edition column harvests forms exactly as before', () => {
    const noEd = grid('Forms', [['FORM NUMBER', 'NAME'], ['CG 00 01', 'Premises']])
    const on = run(true, [noEd])
    const off = run(false, [noEd])
    expect(on.forms.map(f => JSON.stringify(f.data))).toEqual(off.forms.map(f => JSON.stringify(f.data)))
  })

  it('the edition is never folded into the refId — identity stays the form number', () => {
    const f = formNamed(run(true).forms, 'CG 00 01')
    expect(f!.refId).toBe('CG 00 01')
    expect(f!.data['refId']).toBe('CG 00 01')
    expect(String(f!.refId)).not.toContain('04 13')
  })
})
