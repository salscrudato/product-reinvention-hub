// extraction.test.ts — proves the grounded-extraction guards, deterministically and
// without a live model, for both the HO and GL lines. These are the guarantees the
// task's hostile self-review asks about: no proposal may lack a citation, and the
// model may not fabricate a form number (verified against the document's own text).
import { describe, it, expect } from 'vitest'
import {
  cleanCoverages, cleanForms, cleanRules, cleanRating,
  formAppearsInText, normalizeFormNumber,
} from './extraction'

// A trimmed stand-in for an HO-3 base coverage form's text. Only the form numbers
// that appear HERE may survive the verification guard.
const HO_TEXT = `
HOMEOWNERS 3 – SPECIAL FORM  HO 00 03 05 11
SECTION I — PROPERTY COVERAGES
A. Coverage A – Dwelling
C. Coverage C – Personal Property
Water Back-Up and Sump Discharge or Overflow is available by endorsement HO 04 95.
Personal Property Replacement Cost Loss Settlement — endorsement HO 04 90.
SECTION I — CONDITIONS
This policy covers only an owner-occupied one- to four-family dwelling.
`

// A trimmed stand-in for a GL (CGL) base form.
const GL_TEXT = `
COMMERCIAL GENERAL LIABILITY COVERAGE FORM  CG 00 01 04 13
SECTION I – COVERAGES
COVERAGE A BODILY INJURY AND PROPERTY DAMAGE LIABILITY
COVERAGE B PERSONAL AND ADVERTISING INJURY LIABILITY
COVERAGE C MEDICAL PAYMENTS
The Amendment of Liquor Liability Exclusion is provided by endorsement CG 21 50.
`

describe('formAppearsInText / normalizeFormNumber', () => {
  it('matches regardless of spacing and case', () => {
    expect(normalizeFormNumber('HO 00 03')).toBe('HO0003')
    expect(formAppearsInText('ho 00 03', HO_TEXT)).toBe(true)
    expect(formAppearsInText('HO-04-95', HO_TEXT)).toBe(true)
  })
  it('rejects a form number that is not in the document', () => {
    expect(formAppearsInText('HO 99 99', HO_TEXT)).toBe(false)
    expect(formAppearsInText('CG 00 01', HO_TEXT)).toBe(false)
  })
  it('cannot verify against a PDF (null text) so does not drop', () => {
    expect(formAppearsInText('HO 00 03', null)).toBe(true)
  })
  it('guards against trivially short tokens', () => {
    expect(formAppearsInText('A', HO_TEXT)).toBe(false)
  })
})

describe('cleanCoverages', () => {
  it('keeps cited coverages, drops uncited ones, strips invented form refs (HO)', () => {
    const raw = {
      coverages: [
        { name: 'Coverage A — Dwelling', requirement: 'MANDATORY', premiumGenerating: true, confidence: 0.95, citation: 'Section I, Coverage A' },
        { name: 'Coverage C — Personal Property', requirement: 'optional', premiumGenerating: true, formNumbers: ['HO 04 90', 'HO 99 99'], confidence: 1.4, citation: 'Section I, Coverage C' },
        { name: 'Fabricated Coverage', requirement: 'MANDATORY', premiumGenerating: false, confidence: 0.9 }, // no citation → dropped
      ],
    }
    const out = cleanCoverages(raw, HO_TEXT)
    expect(out.items).toHaveLength(2)
    expect(out.items.every(c => c.citation.length > 0)).toBe(true)   // citation guaranteed
    // Optional coerced from "optional"; confidence clamped to 1.
    const covC = out.items[1]!
    expect(covC.requirement).toBe('OPTIONAL')
    expect(covC.confidence).toBe(1)
    // The invented HO 99 99 is stripped; the real HO 04 90 survives.
    expect(covC.formNumbers).toEqual(['HO 04 90'])
    expect(out.note).toContain('1 ungrounded coverage proposal dropped')
  })

  it('works for a GL coverage set', () => {
    const out = cleanCoverages({
      coverages: [
        { name: 'Coverage A — Bodily Injury and Property Damage', requirement: 'MANDATORY', premiumGenerating: true, confidence: 0.9, citation: 'Section I' },
      ],
    }, GL_TEXT)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.name).toContain('Bodily Injury')
  })
})

describe('cleanForms', () => {
  it('keeps only forms whose number is in the document and de-dupes', () => {
    const out = cleanForms({
      forms: [
        { number: 'HO 00 03', name: 'Homeowners 3 — Special Form', edition: '05 11', category: 'BASE_COVERAGE', mandatoryDefault: true, attachmentCondition: 'NONE', confidence: 1, citation: 'Header' },
        { number: 'HO 04 95', name: 'Water Back-Up', category: 'ENDORSEMENT', attachmentCondition: 'RULE', confidence: 0.8, citation: 'Section I' },
        { number: 'HO 00 03', name: 'dupe', category: 'BASE_COVERAGE', confidence: 0.5, citation: 'Header' }, // duplicate → dropped
        { number: 'HO 88 88', name: 'Invented Endorsement', category: 'ENDORSEMENT', confidence: 0.7, citation: 'Section I' }, // not in text → dropped
        { number: 'HO 04 90', name: 'RC', category: 'BOGUS_CATEGORY', confidence: 0.6, citation: 'Section I' }, // bad category → coerced
      ],
    }, HO_TEXT)
    expect(out.items.map(f => f.number)).toEqual(['HO 00 03', 'HO 04 95', 'HO 04 90'])
    expect(out.items[2]!.category).toBe('ENDORSEMENT')  // BOGUS_CATEGORY coerced to a valid enum
    expect(out.note).toContain('2 ungrounded form proposals dropped')
  })

  it('verifies a GL form number', () => {
    const out = cleanForms({
      forms: [{ number: 'CG 00 01', name: 'CGL Coverage Form', category: 'BASE_COVERAGE', confidence: 1, citation: 'Header' }],
    }, GL_TEXT)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.number).toBe('CG 00 01')
  })
})

describe('cleanRules', () => {
  it('keeps cited IF→THEN rules and strips invented form refs', () => {
    const out = cleanRules({
      rules: [
        { category: 'PRODUCT', subCategory: 'Eligibility', condition: 'Owner-occupied 1–4 family dwelling', outcome: 'Eligible for HO-3', confidence: 0.9, citation: 'Section I — Conditions' },
        { category: 'FORMS', subCategory: 'Attachment', condition: 'Water Back-Up elected', outcome: 'Attach HO 04 95', formNumbers: ['HO 04 95', 'HO 77 77'], confidence: 0.85, citation: 'Section I' },
        { category: 'PRODUCT', condition: 'no outcome here', outcome: '', confidence: 0.5, citation: 'x' }, // missing outcome → dropped
      ],
    }, HO_TEXT)
    expect(out.items).toHaveLength(2)
    expect(out.items[1]!.formNumbers).toEqual(['HO 04 95'])  // invented HO 77 77 stripped
    expect(out.items[1]!.category).toBe('FORMS')
  })
})

describe('cleanRating', () => {
  it('reports an empty section explicitly when the form has no rating content', () => {
    const out = cleanRating({ hints: [], note: 'This base coverage form does not contain rating information.' }, HO_TEXT)
    expect(out.items).toHaveLength(0)
    expect(out.note).toContain('does not contain rating information')
  })

  it('keeps a cited rating hint with a positive minimum premium', () => {
    const out = cleanRating({
      hints: [
        { subCategory: 'Premium Floor', condition: 'Calculated premium', outcome: 'Minimum policy premium applies', minimumPremium: 500, confidence: 0.7, citation: 'Rating note' },
        { subCategory: 'Bad', condition: 'x', outcome: 'y', minimumPremium: -5, confidence: 2, citation: '' }, // no citation → dropped
      ],
    }, HO_TEXT)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.minimumPremium).toBe(500)
    expect(out.items[0]!.confidence).toBe(0.7)
  })
})
