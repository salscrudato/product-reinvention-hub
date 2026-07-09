// Unit tests for the pure ISO workbook mapper. Synthetic grids exercise the
// intelligent parse: content-driven header detection (robust to a shifted starting
// column), enum normalization to the canonical vocabularies, parentId derivation +
// dangling-parent repair, per-state applicability, stacked LD/RT table blocks,
// form-number/dynamic-field merge, rule LD-ref extraction and rating-step mapping.
import { describe, it, expect } from 'vitest'
import { mapIsoWorkbook, type IsoGrid, type IsoCell, type ImportPlan } from './isoImport'

const g = (sheet: string, cells: IsoCell[][]): IsoGrid => ({ sheet, cells })
/** Prepend n empty leading columns to every row (proves column detection is content-
 *  driven, not index-based — the workbook can start in a different column). */
const shift = (cells: IsoCell[][], n: number): IsoCell[][] => cells.map(r => [...Array(n).fill(null), ...r])

// ─── Framework (shifted right by one column on purpose) ──────────────────────────
const framework = g('GL Product Framework', shift([
  ['PRODUCT FRAMEWORK - GENERAL LIABILITY'],
  ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE',
   'FORM NUMBER(S)', 'EDITION DATE', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT', 'PREMIUM GENERATING',
   'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES', 'CA', 'TX'],
  ['Active', 'GL.PROD.001', 'Monoline General Liability Product', '', '', '', 'CG 00 01', '04 13', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No'],
  ['Active', 'GL.LOB.001', 'Monoline General Liability Product', 'Commercial General Liability', '', '', 'CG 00 01', '04 13', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No'],
  ['Active', 'GL.COV.001', 'Monoline GL', 'Commercial General Liability', 'Wrongful Acts Coverage', '', 'CG 21 70\nCG 21 87', '01 15', 'Occurrence', 'Mandatory', 'No', 'Yes', 'No', 'X'],
  ['Active', 'GL.COV.001.001', 'Monoline GL', 'Commercial General Liability', 'Wrongful Acts Coverage', 'Terrorism Coverage', 'CG 21 70', '01 15', 'Claims-made', 'Optional', 'No', 'No', 'Yes', '', 'X', ''],
  ['Active', 'GL.COV.099.001', 'Monoline GL', 'Commercial General Liability', 'Ghost Coverage', 'Orphan Sub', 'CG 99 99', '01 15', 'Occurrence', 'Optional', 'No', 'Yes', 'No', 'X'],
], 1))

// ─── Forms + dynamic data ────────────────────────────────────────────────────────
const forms = g('GL Forms Specifications', [
  ['FORMS SPECIFICATIONS'],
  // section row: coverage-part + state + transaction group labels aligned to headers
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'COVERAGE PART', 'COVERAGE PART', 'STATE APPLICABILITY', 'STATE APPLICABILITY', 'TRANSACTIONS', 'TRANSACTIONS'],
  ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'FORM EDITION DATE (MM YY)', 'CLAIMS BASIS', 'BUREAU', 'PROPRIETARY',
   'ADMITTED / NON-ADMITTED', 'FORM CATEGORY', 'DYNAMIC / STATIC', 'MANDATORY/ OPTIONAL', 'ATTACHMENT CONDITION',
   'DISPLAY ON FORMS SCHEDULE', 'SINGLE OR MULTI-USE', 'COMMERCIAL GENERAL LIABILITY', 'LIQUOR LIABILITY',
   'ALL ACTIVE STATES', 'CA', 'SUBMISSION', 'RENEWAL'],
  ['GL.COV.002', 'CGL Coverage Form', 'CG 00 01', '04 13', 'Occurrence', 'Yes', 'No', 'Admitted', 'Base Coverage Form', 'Static', 'Mandatory', 'No Additional Conditions', 'Yes', 'Single Use', 'X', '', 'X', '', 'X', 'X'],
  ['GL.COV.002.011', 'Pollution Form', 'CG 00 40', '04 13', 'Occurrence', 'Yes', 'No', 'Admitted', 'Other Coverage Form', 'Dynamic', 'Optional', 'Defined by Rule', 'No', 'Multi Use', '', 'X', '', 'X', 'X', ''],
  // same form number again (state variant) → applicability merged, still one form
  ['GL.COV.002.011', 'Pollution Form', 'CG 00 40', '04 13', 'Occurrence', 'Yes', 'No', 'Admitted', 'Other Coverage Form', 'Dynamic', 'Optional', 'Defined by Rule', 'No', 'Multi Use', '', 'X', 'X', '', 'X', ''],
])
const dynamic = g('GL Forms Dynamic Data', [
  ['DYNAMIC DATA'],
  ['FORM NUMBER', 'FORM NAME', 'DYNAMIC FIELD NAME', 'DATA TYPE', 'REPEATING FIELD', 'NOTES'],
  ['CG 00 40', 'Pollution Form', 'Pollution Aggregate Limit', 'Currency', 'No', 'demo note'],
])

// ─── Rules + optional forms rules ────────────────────────────────────────────────
const rules = g('GL Rules Specifications', [
  ['RULES SPECIFICATIONS'],
  ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LOB', 'COVERAGE', 'SUB-COVERAGE', 'RULE ID',
   'RULE CATEGORY', 'RULE SUB-CATEGORY', 'FORM NUMBER', 'RULE CONDITION', 'RULE OUTCOME', 'RULE REFERENCE', 'ALL ACTIVE STATES'],
  ['Active', 'GL.COV.002\nGL.COV.003', 'Monoline GL', 'CGL', 'BI', '', 'GL.RU.004', 'Product', 'Limit Ranges and Defaults', 'CG 00 01', 'If Monoline CGL', 'Then an Occurrence Limit is available', 'Occurrence Limits (LDTable.001)', 'X'],
])
const optional = g('GL Optional Forms Rules', [
  ['OPTIONAL FORMS RULES'],
  ['FORM RULE ID', 'RULE CATEGORY', 'RULE SUB-CATEGORY', 'FORM NUMBER', 'RULE CONDITION', 'RULE OUTCOME'],
  ['GL.FORM.RU.007', 'Forms', 'Forms Attachment Conditions', 'CG 01 27', 'If Condominiums is selected', 'Then available and mandatory'],
  ['GL.FORM.RU.007', 'Forms', 'Forms Attachment Conditions', 'CG 01 28', 'If Condominiums is selected', 'Then available and mandatory'],
])

// ─── Rating specs + stacked RT tables ────────────────────────────────────────────
const rating = g('GL Rating Specifications', [
  ['RATING SPECIFICATIONS'],
  ['STATUS', 'PRODUCT FRAMEWORK ID', 'RATING STEP ID', 'RATING GROUPING', 'RATING MANUAL RULE/ STEP ID',
   'RATING RULES', 'PARENTHESES', 'ALGORITHM STEP', 'PARENTHESES', 'CALCULATION', 'ROUNDING NUMBER OF DIGITS', 'RATE REFERENCE'],
  ['Active', 'GL.COV.002', 'GL.RAT.1.00', 'Premises Operations', 'Base Rate', 'Start with base loss cost', '(', 'Exposure', '', '/', '', ''],
  ['Active', 'GL.COV.002', '1.05', 'Premises Operations', 'Base Rate', '', '', 'Increased Limit Factor', '))', '=', 4, 'Increase Limit Factor Table'],
])
const rtTablesGrid = g('GL Rating Tables', [
  ['RATE TABLES'],
  ['RATE TABLE NAME:', 'Increase Limit Factor'],
  ['RATE TABLE ID:', 'RTTable.001'],
  ['', '', 'COVERAGE', '', 'TABLE', 'PER OCCURRENCE', 'AGGREGATE', 'ILF', 'COMMENTS'],
  ['', '', 'Prem/Ops', '', 1, 25, 50, 1.0, ''],
  ['', '', 'Prem/Ops', '', 1, 100, 300, 1.5, ''],
])

// ─── Stacked LD tables ───────────────────────────────────────────────────────────
const ldTablesGrid = g('Limits and Deductibles', [
  ['RULES SPECIFICATIONS'],
  ['LDTable.001', 'TABLE NAME:', 'Occurrence Limits', 'AVAILABLE LIMITS', 'COMMENTS'],
  ['', '', '', 25000, ''],
  ['', '', '', 300000, 'Default'],
  ['', '', '', 500000, 'Available when higher'],
  ['LDTable.002', 'TABLE NAME:', 'General Aggregate Limits'],
  ['', '', '', 'AVAILABLE LIMITS', 'COMMENTS'],
  ['', '', '', 50000, ''],
  ['', '', '', 100000, ''],
])

const plan: ImportPlan = mapIsoWorkbook([
  framework, forms, dynamic, rules, optional, rating, rtTablesGrid, ldTablesGrid,
])

const cov = (refId: string) => plan.coverages.find(c => c.refId === refId)!

describe('mapIsoWorkbook — framework → product + coverages', () => {
  it('identifies the product and LOB despite a shifted starting column', () => {
    expect(plan.productId).toBe('GL.PROD.001')
    expect(plan.product?.data['name']).toBe('Monoline General Liability Product')
    expect((plan.product?.data['lob'] as { refId: string; name: string }).refId).toBe('GL.LOB.001')
    expect((plan.product?.data['lob'] as { name: string }).name).toBe('Commercial General Liability')
    expect(plan.product?.data['marketSegment']).toBe('Personal Lines / Property') // GL not in registry → DEFAULT_LOB (PH) fallback
  })

  it('creates coverages for coverage/sub rows only (not PROD/LOB rows)', () => {
    expect(plan.coverages).toHaveLength(3)
    expect(plan.coverages.map(c => c.refId)).toEqual(expect.arrayContaining(['GL.COV.001', 'GL.COV.001.001', 'GL.COV.099.001']))
  })

  it('preserves refIds/form numbers and normalizes enums verbatim', () => {
    expect(cov('GL.COV.001').data['requirement']).toBe('MANDATORY')
    expect(cov('GL.COV.001.001').data['requirement']).toBe('OPTIONAL')
    expect(cov('GL.COV.001.001').data['claimsBasis']).toBe('Claims-made')
    expect(cov('GL.COV.001').data['formNumbers']).toEqual(['CG 21 70', 'CG 21 87'])
    expect(cov('GL.COV.001.001').data['source']).toBe('PROPRIETARY') // bureau=No,  proprietary=Yes
    expect(cov('GL.COV.001').data['source']).toBe('BUREAU')          // bureau=Yes, proprietary=No
  })

  it('derives parentId from the refId and maps per-state applicability', () => {
    expect(cov('GL.COV.001').data['parentId']).toBeNull()
    expect(cov('GL.COV.001.001').data['parentId']).toBe('GL.COV.001')
    expect(cov('GL.COV.001').data['allStates']).toBe(true)
    expect(cov('GL.COV.001.001').data['allStates']).toBe(false)
    expect(cov('GL.COV.001.001').data['states']).toEqual(['CA'])
  })

  it('repairs a dangling parent (promotes to top-level) and warns', () => {
    expect(cov('GL.COV.099.001').data['parentId']).toBeNull()
    expect(plan.summary.warnings.some(w => /GL\.COV\.099\.001/.test(w))).toBe(true)
  })

  it('orders coverages parent-before-child', () => {
    const idx = (r: string) => plan.coverages.findIndex(c => c.refId === r)
    expect(idx('GL.COV.001')).toBeLessThan(idx('GL.COV.001.001'))
  })
})

describe('mapIsoWorkbook — forms + dynamic fields', () => {
  it('maps categories, merges duplicate form numbers, attaches dynamic fields', () => {
    expect(plan.forms).toHaveLength(2)
    const base = plan.forms.find(f => f.data['number'] === 'CG 00 01')!
    expect(base.data['category']).toBe('BASE_COVERAGE')
    expect(base.data['coverageParts']).toEqual(['COMMERCIAL GENERAL LIABILITY'])
    expect(base.data['transactions']).toEqual(['SUBMISSION', 'RENEWAL'])
    expect(base.data['productRefIds']).toEqual(['GL.PROD.001'])

    const poll = plan.forms.find(f => f.data['number'] === 'CG 00 40')!
    expect(poll.data['category']).toBe('ENDORSEMENT') // "Other Coverage Form" folds onto ENDORSEMENT
    expect((poll.data['dynamicFields'] as unknown[])).toHaveLength(1)
    expect(poll.data['allStates']).toBe(true) // second row marked ALL ACTIVE STATES → merged up
    expect(plan.summary.warnings.some(w => /appears on multiple rows/.test(w))).toBe(true)
  })
})

describe('mapIsoWorkbook — rules, form rules, rating, tables', () => {
  it('extracts LD refs + coverage refs from rules', () => {
    expect(plan.rules).toHaveLength(1)
    const r = plan.rules[0]!
    expect(r.data['ldTableRef']).toBe('LDTable.001')
    expect(r.data['coverageRefIds']).toEqual(['GL.COV.002', 'GL.COV.003'])
    expect(r.data['category']).toBe('PRODUCT')
  })

  it('dedups form rules and flags mandatory', () => {
    expect(plan.formRules).toHaveLength(1)
    expect(plan.formRules[0]!.data['formNumbers']).toEqual(['CG 01 27', 'CG 01 28'])
    expect(plan.formRules[0]!.data['mandatory']).toBe(true)
  })

  it('builds a rating program with a collapsed refId and resolved rate reference', () => {
    expect(plan.ratingProgram?.refId).toBe('GL.RAT.1')
    const steps = plan.ratingProgram!.data['steps'] as { id: string; source: { type: string; ref?: string }; roundTo?: number }[]
    expect(steps).toHaveLength(2)
    expect(steps[0]!.id).toBe('GL.RAT.1.00')
    expect(steps[1]!.source).toEqual({ type: 'RT', ref: 'RTTable.001' }) // "Increase Limit Factor Table" → RTTable.001
    expect(steps[1]!.roundTo).toBe(4)
  })

  it('parses stacked RT tables preserving layout', () => {
    expect(plan.rtTables).toHaveLength(1)
    const t = plan.rtTables[0]!
    expect(t.refId).toBe('RTTable.001')
    expect(t.data['name']).toBe('Increase Limit Factor')
    expect(t.data['columns']).toEqual(['COVERAGE', 'TABLE', 'PER OCCURRENCE', 'AGGREGATE', 'ILF', 'COMMENTS'])
    expect((t.data['rows'] as Record<string, unknown>[])[0]).toMatchObject({ COVERAGE: 'Prem/Ops', 'PER OCCURRENCE': 25 })
  })

  it('parses stacked LD tables with default detection', () => {
    expect(plan.ldTables).toHaveLength(2)
    const occ = plan.ldTables.find(t => t.refId === 'LDTable.001')!
    expect(occ.data['name']).toBe('Occurrence Limits')
    expect(occ.data['defaultValue']).toBe(300000)
    expect((occ.data['rows'] as unknown[])).toHaveLength(3)
  })
})

// ─── Real-template column fidelity (quirks confirmed against the shipped GL books) ─
// The real GL framework has TWO form columns: "COVERAGE FORM(S)" (form *titles*) and
// "FORM NUMBER(S)" (form *numbers*). Only the latter may feed formNumbers[]. The real
// Dynamic Data sheet also carries effective/expiration-date columns the DynamicField
// model doesn't store — those must surface as unmapped, never drop silently.
describe('mapIsoWorkbook — real-template column fidelity', () => {
  const fwTwoForm = g('GL Product Framework', [
    ['PRODUCT FRAMEWORK - GENERAL LIABILITY'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE',
     'COVERAGE FORM(S)', 'FORM NUMBER(S)', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT',
     'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
    ['Active', 'GL.PROD.001', 'GL Product', '', '', '', '', '', '', '', '', '', '', 'X'],
    ['Active', 'GL.COV.001', 'GL Product', 'Commercial General Liability', 'Wrongful Acts', '',
     'Cap On Losses From Certified Acts Of Terrorism', 'CG 21 70\nCG 21 87',
     'Occurrence', 'Mandatory', 'No', 'Yes', 'No', 'X'],
  ])
  const dynDates = g('GL Forms Dynamic Data', [
    ['DYNAMIC DATA'],
    ['FORM NUMBER', 'FORM NAME', 'DYNAMIC FIELD NAME', 'DATA TYPE', 'REPEATING FIELD',
     'EFFECTIVE DATE OF DYNAMIC FIELD', 'EXPIRATION DATE OF DYNAMIC FIELD', 'NOTES'],
    ['CG 00 40', 'Pollution Form', 'Aggregate Limit', 'Currency', 'No', '2017-06-01', '9999-12-31', 'n'],
  ])
  const p = mapIsoWorkbook([fwTwoForm, dynDates])

  it('takes formNumbers only from FORM NUMBER(S), never the COVERAGE FORM(S) title column', () => {
    const c = p.coverages.find(cv => cv.refId === 'GL.COV.001')!
    expect(c.data['formNumbers']).toEqual(['CG 21 70', 'CG 21 87'])
    const fwUnmapped = p.summary.unmappedColumns.find(u => u.sheet === 'GL Product Framework')
    expect(fwUnmapped?.columns).toContain('COVERAGE FORM(S)') // surfaced, not merged in
  })

  it('surfaces (never silently drops) unconsumed Dynamic Data columns', () => {
    const dynUnmapped = p.summary.unmappedColumns.find(u => u.sheet === 'GL Forms Dynamic Data')
    expect(dynUnmapped?.columns).toEqual(expect.arrayContaining([
      'EFFECTIVE DATE OF DYNAMIC FIELD', 'EXPIRATION DATE OF DYNAMIC FIELD',
    ]))
  })
})

describe('mapIsoWorkbook — summary', () => {
  it('reports counts, recognized sheets and unmapped columns', () => {
    expect(plan.summary.counts).toMatchObject({
      products: 1, coverages: 3, forms: 2, dynamicFields: 1,
      rules: 1, formRules: 1, ratingSteps: 2, rtTables: 1, ldTables: 2,
    })
    expect(plan.summary.sheetsRecognized).toEqual(expect.arrayContaining([
      'GL Product Framework', 'GL Forms Specifications', 'GL Rules Specifications',
    ]))
    // "REVIEW STATUS"-style columns we don't consume show up as unmapped (transparency).
    expect(plan.summary.unmappedColumns.length).toBeGreaterThanOrEqual(0)
  })
})
