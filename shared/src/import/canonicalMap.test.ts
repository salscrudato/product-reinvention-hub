// Canonical map tests — lock the dictionary's completeness + alias coverage against the
// observed cross-source variance. This is grounding data, so the test guards that every
// entity/field is documented (type + ≥2 examples) and that the real header synonyms the
// pipeline must survive are all present.
import { describe, it, expect } from 'vitest'
import {
  CANONICAL_MAP, CANONICAL_ENTITY_KINDS, fieldsOf, aliasesFor, candidateFields,
  SURFACED_COLUMNS, type CanonicalEntityKind,
} from './canonicalMap'

const ALL: CanonicalEntityKind[] = [
  'product', 'coverage', 'form', 'dynamicField',
  'ratingProgram', 'ratingStep', 'rtTable', 'ldTable', 'rule', 'formRule',
]

describe('canonicalMap — completeness', () => {
  it('covers every canonical entity kind', () => {
    expect([...CANONICAL_ENTITY_KINDS].sort()).toEqual([...ALL].sort())
    for (const e of ALL) expect(CANONICAL_MAP[e].entity).toBe(e)
  })

  it('every field carries a type, a description and ≥2 examples', () => {
    for (const e of ALL) {
      const fields = fieldsOf(e)
      expect(fields.length).toBeGreaterThan(0)
      for (const f of fields) {
        expect(f.type, `${e}.${f.field} type`).toBeTruthy()
        expect(f.description.length, `${e}.${f.field} description`).toBeGreaterThan(0)
        expect(f.examples.length, `${e}.${f.field} examples`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('every stored/source field records ≥1 source alias (derived/system may be alias-free)', () => {
    for (const e of ALL) {
      for (const f of fieldsOf(e)) {
        if (f.role === 'stored' || f.role === 'source') {
          expect(f.aliases.length, `${e}.${f.field} aliases`).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('every source field maps to a stored field, or is ambiguous, or is explicitly surfaced', () => {
    // A 'source' column normally feeds one stored field (mapsTo). Two exceptions: a
    // genuinely ambiguous column (e.g. "COVERAGE FORM(S)" — titles here, numbers there),
    // and a SURFACED column kept for provenance but not persisted (its description says so).
    for (const e of ALL) {
      for (const f of fieldsOf(e)) {
        if (f.role === 'source') {
          const ok = Boolean(f.mapsTo) || f.ambiguous === true || /surfaced/i.test(f.description)
          expect(ok, `${e}.${f.field} must map/ambiguous/surfaced`).toBe(true)
        }
      }
    }
  })

  it('enum fields declare their closed value set', () => {
    // Spot-check the load-bearing enums exist with the right canonical values.
    expect(fieldsOf('coverage').find(f => f.field === 'requirement')!.enumValues)
      .toEqual(['MANDATORY', 'OPTIONAL'])
    expect(fieldsOf('rule').find(f => f.field === 'category')!.enumValues)
      .toEqual(['PRODUCT', 'RATING', 'FORMS'])
    expect(fieldsOf('ratingStep').find(f => f.field === 'op')!.enumValues)
      .toEqual(['SET', 'MUL', 'ADD', 'MIN_FLOOR'])
  })
})

describe('canonicalMap — alias coverage vs observed variance', () => {
  it('coverage.refId <- ["PRODUCT FRAMEWORK ID","ID", …]', () => {
    const a = aliasesFor('coverage', 'refId')
    expect(a).toEqual(expect.arrayContaining(['PRODUCT FRAMEWORK ID', 'ID']))
  })

  it('coverage.subCoverageName <- all three punctuation variants', () => {
    const a = aliasesFor('coverage', 'subCoverageName')
    expect(a).toEqual(expect.arrayContaining(['SUB-COVERAGE', 'SUB COVERAGE', 'SUB- COVERAGE']))
  })

  it('form.source <- ["BUREAU","RATING BUREAU", …]', () => {
    const a = aliasesFor('form', 'source')
    expect(a).toEqual(expect.arrayContaining(['BUREAU', 'RATING BUREAU']))
  })

  it('premiumGenerating tolerates the trailing "?" header variant', () => {
    expect(aliasesFor('coverage', 'premiumGenerating')).toEqual(
      expect.arrayContaining(['PREMIUM GENERATING', 'PREMIUM GENERATING?']),
    )
  })

  it('form number + coverage form both alias the form-number family', () => {
    expect(aliasesFor('form', 'number')).toEqual(expect.arrayContaining(['FORM NUMBER', 'FORM NUMBER(S)']))
    expect(aliasesFor('coverage', 'formNumbers')).toEqual(
      expect.arrayContaining(['FORM NUMBER(S)', 'FORM NUMBER', 'COVERAGE FORM', 'COVERAGE FORM(S)']),
    )
  })

  it('marks the COVERAGE FORM(S) title/number collision as ambiguous', () => {
    expect(fieldsOf('coverage').find(f => f.field === 'formNumbers')!.ambiguous).toBe(true)
    expect(fieldsOf('coverage').find(f => f.field === 'coverageFormTitles')!.ambiguous).toBe(true)
  })
})

describe('canonicalMap — candidateFields (grounding lookup, punctuation-insensitive)', () => {
  it('resolves a header to its canonical field(s) ignoring punctuation/case', () => {
    expect(candidateFields('coverage', 'Product Framework ID').map(f => f.field)).toContain('refId')
    expect(candidateFields('coverage', 'Sub-Coverage').map(f => f.field)).toContain('subCoverageName')
    expect(candidateFields('coverage', 'SUB- COVERAGE').map(f => f.field)).toContain('subCoverageName')
    expect(candidateFields('form', 'FORM NUMBER').map(f => f.field)).toContain('number')
    expect(candidateFields('rule', 'RULE ID').map(f => f.field)).toContain('refId')
  })

  it('returns MULTIPLE candidates for a genuinely ambiguous header (content must disambiguate)', () => {
    const cands = candidateFields('coverage', 'COVERAGE FORM').map(f => f.field)
    expect(cands).toEqual(expect.arrayContaining(['formNumbers', 'coverageFormTitles']))
    expect(cands.length).toBeGreaterThanOrEqual(2)
  })

  it('returns nothing for an unknown header', () => {
    expect(candidateFields('coverage', 'TOTALLY UNKNOWN COLUMN')).toEqual([])
  })
})

describe('canonicalMap — surfaced (never dropped) columns', () => {
  it('lists the extra columns real sources add', () => {
    expect(SURFACED_COLUMNS.length).toBeGreaterThan(0)
    const cols = SURFACED_COLUMNS.map(c => c.column)
    expect(cols).toEqual(expect.arrayContaining([
      'COVERAGE SCOPE', 'COVERAGE EFFECT', 'SOURCE',
      'RULE EFFECTIVE DATE', 'RULE EXPIRATION DATE',
    ]))
    for (const c of SURFACED_COLUMNS) expect(c.note.length).toBeGreaterThan(0)
  })
})
