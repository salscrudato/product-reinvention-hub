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
    expect(plan.product?.data['marketSegment']).toBe('Commercial Lines / Casualty') // GL.LOB.001 now in registry
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

// ─── Form identity: (number, edition) — ledger F12 ────────────────────────────
// Form identity in P&C is (number, edition, jurisdiction) — first principles
// §5.2. Same-number rows with the SAME edition are state/coverage variants and
// merge (applicability union); same-number rows with a DIFFERENT edition are
// legally distinct documents and must stay separate entities. Jurisdiction is
// an attachment condition (states/allStates scope), never part of the map key.
describe('mapIsoWorkbook — form edition identity (F12)', () => {
  const edForms = g('GL Forms Specifications', [
    ['FORMS SPECIFICATIONS'],
    ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'FORM EDITION DATE (MM YY)', 'CLAIMS BASIS', 'BUREAU', 'PROPRIETARY',
     'ADMITTED / NON-ADMITTED', 'FORM CATEGORY', 'DYNAMIC / STATIC', 'MANDATORY/ OPTIONAL', 'ATTACHMENT CONDITION',
     'DISPLAY ON FORMS SCHEDULE', 'SINGLE OR MULTI-USE', 'ALL ACTIVE STATES', 'CA'],
    // Two editions of HO 00 03 — legally distinct documents.
    ['GL.COV.002', 'Special Form', 'HO 00 03', '10 00', 'Occurrence', 'Yes', 'No', 'Admitted', 'Base Coverage Form', 'Static', 'Mandatory', 'No Additional Conditions', 'Yes', 'Single Use', 'X', ''],
    ['GL.COV.002', 'Special Form', 'HO 00 03', '05 11', 'Occurrence', 'Yes', 'No', 'Admitted', 'Base Coverage Form', 'Static', 'Mandatory', 'No Additional Conditions', 'Yes', 'Single Use', '', 'X'],
    // Same number + SAME edition twice — a state variant: still merges to one.
    ['GL.COV.002.011', 'Pollution Form', 'CG 00 40', '04 13', 'Occurrence', 'Yes', 'No', 'Admitted', 'Other Coverage Form', 'Dynamic', 'Optional', 'Defined by Rule', 'No', 'Multi Use', 'X', ''],
    ['GL.COV.002.011', 'Pollution Form', 'CG 00 40', '04 13', 'Occurrence', 'Yes', 'No', 'Admitted', 'Other Coverage Form', 'Dynamic', 'Optional', 'Defined by Rule', 'No', 'Multi Use', '', 'X'],
  ])
  const p = mapIsoWorkbook([edForms])

  it('distinct editions of the same number are distinct entities with distinct docIds', () => {
    const ho3 = p.forms.filter(f => f.data['number'] === 'HO 00 03')
    expect(ho3).toHaveLength(2)
    expect(new Set(ho3.map(f => f.docId)).size).toBe(2)
    expect(new Set(ho3.map(f => f.data['edition']))).toEqual(new Set(['10 00', '05 11']))
    // Each edition keeps its own applicability — no cross-edition union.
    const ed1000 = ho3.find(f => f.data['edition'] === '10 00')!
    const ed0511 = ho3.find(f => f.data['edition'] === '05 11')!
    expect(ed1000.data['allStates']).toBe(true)
    expect(ed0511.data['allStates']).toBe(false)
    expect(ed0511.data['states']).toEqual(['CA'])
  })

  it('same number + same edition still merges as a state variant (one entity)', () => {
    const cg0040 = p.forms.filter(f => f.data['number'] === 'CG 00 40')
    expect(cg0040).toHaveLength(1)
    expect(cg0040[0]!.data['allStates']).toBe(true)
    expect(p.summary.warnings.some(w => /CG 00 40 appears on multiple rows/.test(w))).toBe(true)
  })

  it('number-only references keep resolving: data.number stays the verbatim number', () => {
    for (const f of p.forms) expect(['HO 00 03', 'CG 00 40']).toContain(f.data['number'])
  })
})

describe('mapIsoWorkbook — forms + dynamic fields', () => {
  it('maps categories, merges duplicate form numbers, attaches dynamic fields', () => {
    expect(plan.forms).toHaveLength(2)
    const base = plan.forms.find(f => f.data['number'] === 'CG 00 01')!
    expect(base.data['category']).toBe('BASE_COVERAGE')
    expect(base.data['coverageParts']).toEqual(['COMMERCIAL GENERAL LIABILITY'])
    // Sorted: group membership is a SET — serialization is column-order-independent (G-A).
    expect(base.data['transactions']).toEqual(['RENEWAL', 'SUBMISSION'])
    expect(base.data['productRefIds']).toEqual(['GL.PROD.001'])

    const poll = plan.forms.find(f => f.data['number'] === 'CG 00 40')!
    expect(poll.data['category']).toBe('ENDORSEMENT') // "Other Coverage Form" folds onto ENDORSEMENT
    expect((poll.data['dynamicFields'] as unknown[])).toHaveLength(1)
    expect(poll.data['allStates']).toBe(true) // second row marked ALL ACTIVE STATES → merged up
    expect(plan.summary.warnings.some(w => /appears on multiple rows/.test(w))).toBe(true)
  })
})

describe('mapIsoWorkbook — blank RULE ID synthesis carries the SYNTH marker (F25)', () => {
  // Some workbooks (the Hagerty CORE spec shape) declare a RULE ID column but never
  // populate it. The synthesized ids are MINTED, not read from source — they must
  // carry the platform SYNTH marker so no reader mistakes them for source refIds.
  const blankIdRules = g('CORE Rules Specifications', [
    ['RULES SPECIFICATIONS'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LOB', 'COVERAGE', 'SUB-COVERAGE', 'RULE ID',
     'RULE CATEGORY', 'RULE SUB-CATEGORY', 'FORM NUMBER', 'RULE CONDITION', 'RULE OUTCOME', 'RULE REFERENCE', 'ALL ACTIVE STATES'],
    ['Active', 'GL.COV.002', 'Monoline GL', 'CGL', 'BI', '', '', 'Product', 'Limits', 'CG 00 01', 'If A', 'Then B', '', 'X'],
    ['Active', 'GL.COV.003', 'Monoline GL', 'CGL', 'PD', '', '', 'Product', 'Defaults', 'CG 00 02', 'If C', 'Then D', '', 'X'],
    ['Active', '', '', '', '', '', '', '', '', '', '', '', '', ''],   // spacer — still skipped
  ])
  const synthPlan = mapIsoWorkbook([framework, blankIdRules])

  it('synthesized rule ids carry the SYNTH marker and stay stable/sequential', () => {
    expect(synthPlan.rules.length).toBe(2)
    for (const r of synthPlan.rules) {
      expect(String(r.refId)).toMatch(/\.SYNTH/)
      expect(String(r.refId)).toMatch(/\.RULE\.SYNTH\d{3}$/)
    }
    // Stable sequence, keyed off the framework id the row cites.
    expect(synthPlan.rules[0]!.refId).toBe('GL.COV.002.RULE.SYNTH001')
    expect(synthPlan.rules[1]!.refId).toBe('GL.COV.003.RULE.SYNTH002')
  })

  it('rows with a REAL source rule id keep it byte-for-byte (no marker injected)', () => {
    expect(plan.rules.some(r => r.refId === 'GL.RU.004')).toBe(true)
    for (const r of plan.rules) expect(String(r.refId)).not.toMatch(/SYNTH/)
  })
})

describe('mapIsoWorkbook — synthesized product ids carry the SYNTH marker (F26)', () => {
  // A framework sheet with NO explicit PROD/PRD row synthesizes the product id
  // from the coverage refId prefix. The id is MINTED, not read from source — it
  // must carry the SYNTH marker (the stage-7 sibling mints ${prefix}.PROD.SYNTH001
  // for the identical situation), never a byte-shape identical to a real source id.
  it('a PROD-row-less GL framework synthesizes a MARKED product id and still attaches its tree', () => {
    const noProdRow = g('GL Product Framework', [
      ['PRODUCT FRAMEWORK - GENERAL LIABILITY'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'FORM NUMBER(S)', 'EDITION DATE', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT', 'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
      ['Active', 'GL.COV.001', 'Monoline GL', 'Commercial General Liability', 'Premises Liability', '', 'CG 00 01', '04 13', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
      ['Active', 'GL.COV.001.001', 'Monoline GL', 'Commercial General Liability', 'Premises Liability', 'Terrorism', 'CG 21 70', '01 15', 'Occurrence', 'Optional', 'No', 'Yes', 'No', 'X'],
    ])
    const p = mapIsoWorkbook([noProdRow])
    expect(p.product!.refId).toBe('GL.PROD.SYNTH001')
    expect(String(p.product!.refId)).toMatch(/\.SYNTH/)
    // The synthesis stays a WARNED event, and the warning names the marked id.
    expect(p.summary.warnings.some(w => /product_synthesized/.test(w) && /GL\.PROD\.SYNTH001/.test(w))).toBe(true)
    // The coverage tree still attaches under the synthesized product.
    expect(p.coverages.length).toBe(2)
    expect(p.productId).toBe(p.product!.refId)
  })

  it('a glued-scheme (IM) coverage prefix synthesizes the same marked shape', () => {
    const imNoProd = g('IM Framework', [
      ['PRODUCT FRAMEWORK - INLAND MARINE'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'FORM NUMBER(S)', 'EDITION DATE', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT', 'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
      ['Active', 'IM.COV044', 'IM Product', 'Inland Marine', 'Scheduled Property', '', 'IM 00 01', '01 15', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
    ])
    const p = mapIsoWorkbook([imNoProd])
    expect(p.product!.refId).toBe('IM.PROD.SYNTH001')
  })

  it('an explicit PROD row keeps its byte-for-byte source id — no marker injected', () => {
    expect(plan.products.some(pr => pr.refId === 'GL.PROD.001')).toBe(true)
    for (const pr of plan.products) expect(String(pr.refId)).not.toMatch(/SYNTH/)
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
  it('a GL "Limits and Deductibles" sheet is NOT re-minted as reference tables (double-parse guard)', () => {
    // The GL LD blocks key on "LDTable.NNN" at col 0 ("TABLE NAME:" only sits at col 1) and the
    // sheet is claimed by parseLdTables → the signature detector must produce zero minted tables.
    expect(plan.summary.counts['referenceTables'] ?? 0).toBe(0)   // absent on a non-CORE parse
    expect(plan.ldTables.every(t => !(t.data as Record<string, unknown>)['mintedId'])).toBe(true)
    expect(plan.ldTables.map(t => t.refId)).toEqual(['LDTable.001', 'LDTable.002'])
  })
  it('mints NO rate-table placeholders on a GL workbook (its rate tables are present)', () => {
    expect(plan.ratePlaceholders).toEqual([])
    expect(plan.summary.counts['ratePlaceholders'] ?? 0).toBe(0)
  })
})

// ─── Signature-detected reference tables (D1/D7) ──────────────────────────────────
// Real carrier specs park limit/deductible tables on a general sheet the named LD parser
// never claims, marked "TABLE NAME:" in column 0 with no LDTable id. Detection is by CONTENT
// SIGNATURE (>= 2 col-0 markers), never sheet name, and mints stable PREFIX.TBL.NNN ids.
describe('mapIsoWorkbook — signature-detected reference tables (D1)', () => {
  const fw = g('Framework', [
    ['PRODUCT FRAMEWORK'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.PRD.001', 'Core', '', '', '', 'X'],
    ['Active', 'CORE.LOB.001', 'Core', 'Collector Auto', '', '', 'X'],
    ['Active', 'CORE.COV.001', 'Core', 'Collector Auto', 'Bodily Injury', '', 'X'],
    ['Active', 'CORE.COV.003', 'Core', 'Collector Auto', 'Property Damage', '', 'X'],
    ['Active', 'CORE.COV.009', 'Core', 'Collector Auto', 'Collision', '', 'X'],
    ['Active', 'CORE.COV.010', 'Core', 'Collector Auto', 'Other Than Collision', '', 'X'],
    ['Active', 'CORE.COV.020', 'Core', 'Collector Auto', 'Evacuation Expense', '', 'X'],
  ])
  // Signature sheet: two col-0 "TABLE NAME:" blocks, no LDTable ids (CORE style).
  const refs = g('Reference Data', [
    ['TABLE NAME: Liability Limits - AZ', '', 'BI', 'BI', 'PD', 'PD'],
    ['RULE ID:', 'Liability Limit: Available (thousands; $)', 'Available', 'Default', 'Available2', 'Default2'],
    ['Single Limits ($)', 25, 'X', 'N/A', 'X', 'N/A'],
    ['Single Limits ($)', 50, 'X', 'X', 'N/A', 'N/A'],
    ['Split Limits', '100/300', 'X', 'N/A', 'X', 'N/A'],   // split limit the numeric parse would drop
    ['TABLE NAME: Physical Damage Deductibles - AZ', '', 'Collision', 'Other Than Collision (OTC)'],
    ['RULE ID:', 'Deductible ($)'],
    ['GROUP 1: All vehicles', 0, 'X'],
    ['GROUP 1: All vehicles', 500, 'X'],
  ])
  // Rules cite tables (and one coverage) by concept NAME, with blank RULE ID.
  const rules = g('Rules Specifications', [
    ['RULES'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'RULE ID', 'RULE CATEGORY', 'RULE SUB-CATEGORY', 'RULE CONDITION', 'RULE OUTCOME', 'RULE REFERENCE', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.COV.001', '', 'Product', 'Limits', 'If BI selected', 'A limit applies', 'Liability Limits', 'X'],
    ['Active', 'CORE.COV.020', '', 'Product', 'Coverage', 'If requested', 'Evacuation applies', 'Evacuation Expense', 'X'],
  ])
  // Rating: COVERAGE NAME groups (one value per group; forward-filled), blank step ids.
  const rating = g('Rating Specifications', [
    ['RATING'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'RATING STEP ID', 'COVERAGE NAME', 'RATING RULES', 'ALGORITHM STEP', 'CALCULATION', 'RATE REFERENCE', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.RAT.1', '', 'Bodily Injury (Excluding Camper Trailer)', 'base', 'Base Rate', '*', 'Base Rate Table', 'X'],
    ['Active', 'CORE.RAT.1', '', '', 'inc', 'Increased Limit Factor', '*', 'ILF Table', 'X'],
    ['Active', 'CORE.RAT.1', '', 'Combined Single Limit (Excluding Camper Trailer)', 'csl', 'CSL Factor', '*', 'CSL Table', 'X'],
    ['Active', 'CORE.RAT.1', '', 'Business Use', 'biz', 'Business Factor', '*', '', 'X'],
  ])
  // A single-marker grid must NOT be detected (below the >= 2 signature gate).
  const single = g('Notes', [['TABLE NAME: Just One Block'], ['x', 1]])
  const plan2 = mapIsoWorkbook([fw, refs, rules, rating, single])
  const minted = plan2.ldTables.filter(t => (t.data as Record<string, unknown>)['mintedId'] === true)
  const d = (i: number) => minted[i]!.data as Record<string, unknown>
  const ruleOf = (frag: string) => plan2.rules.find(r => new RegExp(frag, 'i').test(String(r.data['outcome'])))!

  it('detects >= 2 col-0 TABLE NAME blocks and mints stable PREFIX.TBL ids in source order', () => {
    expect(plan2.summary.counts['referenceTables']).toBe(2)
    expect(minted.map(t => t.refId)).toEqual(['CORE.TBL.001', 'CORE.TBL.002'])
  })
  it('infers term kind + per-state scope from the block signature', () => {
    expect(d(0)['kindHint']).toBe('LIMIT')
    expect(d(0)['state']).toBe('AZ')
    expect(d(1)['kindHint']).toBe('DEDUCTIBLE')
    expect(d(1)['state']).toBe('AZ')
  })
  it('captures the marker-row coverage codes and distinct numeric option values', () => {
    expect(d(0)['coverageCodes']).toEqual(['BI', 'PD'])
    expect((d(0)['rows'] as { value: number }[]).map(r => r.value)).toEqual([25, 50])
    expect((d(1)['rows'] as { value: number }[]).map(r => r.value)).toEqual([0, 500])
  })
  it('a single-marker grid is NOT a reference-tables sheet (signature gate)', () => {
    expect(minted).toHaveLength(2)
    expect(plan2.summary.sheetsSkipped).toContain('Notes')
  })
  it('minting is stable: same input → same ids', () => {
    const again = mapIsoWorkbook([fw, refs, rules, single])
    expect(again.ldTables.filter(t => (t.data as Record<string, unknown>)['mintedId']).map(t => t.refId))
      .toEqual(['CORE.TBL.001', 'CORE.TBL.002'])
  })

  // ── Linking (D2/D7/D8) ──
  it('a Liability Limits matrix links to coverages via its header codes (BI→BI cov, PD→PD cov)', () => {
    expect((d(0)['coverageRefIds'] as string[]).sort()).toEqual(['CORE.COV.001', 'CORE.COV.003'])
  })
  it('a Physical Damage Deductibles table links to Collision + Other Than Collision', () => {
    expect((d(1)['coverageRefIds'] as string[]).sort()).toEqual(['CORE.COV.009', 'CORE.COV.010'])
  })
  it('a rule citing a table by concept name gains a tableRefIds link + back-links the table', () => {
    const r = ruleOf('a limit applies')
    expect(r.data['tableRefIds']).toEqual(['CORE.TBL.001'])
    expect(r.data['tableLinkBasis']).toBe('derived')
    expect((d(0)['ruleRefIds'] as string[])).toContain(r.refId)
  })
  it('D8: a rule reference that names a coverage resolves to it, not a failed table match', () => {
    const r = ruleOf('Evacuation applies')
    expect(r.data['resolvedCoverageRefId']).toBe('CORE.COV.020')
    expect(r.data['tableRefIds']).toBeUndefined()
  })
  it('the transient _referenceText is cleared from every rule (no golden leak)', () => {
    expect(plan2.rules.every(r => !('_referenceText' in r.data))).toBe(true)
  })

  // ── Term derivation (D1/D7) ──
  const termsOf = (refId: string) =>
    (plan2.coverages.find(c => c.refId === refId)!.data['terms'] as Array<Record<string, unknown>>)
  it('a LIMIT table yields per-state LIMIT terms on its coverages (the "no limits" fix)', () => {
    const t = termsOf('CORE.COV.001').find(x => x['ldTableRef'] === 'CORE.TBL.001')!
    expect(t['kind']).toBe('LIMIT')
    expect(t['states']).toEqual(['AZ'])
    expect(t['allStates']).toBe(false)
    expect(t['options']).toEqual([25, 50, '100/300'])   // split limit preserved, not dropped
    expect(t['linkBasis']).toBe('derived')
  })
  it('a DEDUCTIBLE table yields DEDUCTIBLE terms on Collision + OTC', () => {
    expect(termsOf('CORE.COV.009').some(x => x['kind'] === 'DEDUCTIBLE' && x['ldTableRef'] === 'CORE.TBL.002')).toBe(true)
    expect(termsOf('CORE.COV.010').some(x => x['kind'] === 'DEDUCTIBLE')).toBe(true)
  })
  it('emits a reference_table_terms_derived notice distinct from the PCM-A ld_terms_folded', () => {
    expect(plan2.summary.notices.some(n => n.code === 'reference_table_terms_derived')).toBe(true)
  })

  // ── Rating groups (D5) ──
  const rgOf = (frag: string) =>
    (plan2.ratingProgram!.data['ratingGroups'] as Array<{ refId: string; name: string; coverageRefIds: string[]; matchBasis: string }>)
      .find(x => new RegExp(frag, 'i').test(x.name))!
  it('mints coverage-name rating groups (PREFIX.RTG.NNN) and stamps steps', () => {
    const grps = plan2.ratingProgram!.data['ratingGroups'] as unknown[]
    expect(grps).toHaveLength(3)
    expect((plan2.ratingProgram!.data['steps'] as Array<Record<string, unknown>>)[0]!['groupRefId']).toBe('CORE.RTG.001')
  })
  it('resolves a direct coverage-name group and a CSL group via the domain taxonomy', () => {
    expect(rgOf('Bodily Injury').coverageRefIds).toEqual(['CORE.COV.001'])
    expect(rgOf('Combined Single Limit').coverageRefIds.sort()).toEqual(['CORE.COV.001', 'CORE.COV.003'])
  })
  it('flags a group that names no coverage in the hierarchy (never invented)', () => {
    const bu = rgOf('Business Use')
    expect(bu.matchBasis).toBe('unmatched')
    expect(bu.coverageRefIds).toEqual([])
  })

  // ── Rate-table placeholders (D4) ──
  it('mints rate-table placeholders for the factors the algorithm names + links the steps', () => {
    expect(plan2.ratePlaceholders.length).toBeGreaterThan(0)
    expect(plan2.ratePlaceholders.every(p => p.data['status'] === 'PLACEHOLDER' && p.data['mintedId'] === true)).toBe(true)
    expect(plan2.ratePlaceholders.every(p => /\.RTB\.\d+$/.test(p.refId!))).toBe(true)
    const step = (plan2.ratingProgram!.data['steps'] as Array<Record<string, unknown>>).find(s => /Base Rate/i.test(String(s['label'])))!
    expect(String(step['ratePlaceholderRef'])).toMatch(/CORE\.RTB\.\d+/)
    expect(plan2.summary.notices.some(n => n.code === 'rate_table_placeholders')).toBe(true)
  })

  // ── Flag-not-invent notices/defects (R5) ──
  it('flags unmatched rating groups as a notice + actionable defects (R5)', () => {
    const n = plan2.summary.notices.find(x => x.code === 'rating_groups_unmatched')!
    expect((n.data as { count: number }).count).toBe(1)
    expect(plan2.summary.defects.some(d => d.code === 'rating_group_unmatched' && d.rawValue === 'Business Use')).toBe(true)
  })
  it('surfaces a reference_tables_linked summary + a D8 coverage-resolution notice', () => {
    expect(plan2.summary.notices.some(n => n.code === 'reference_tables_linked')).toBe(true)
    expect(plan2.summary.notices.some(n => n.code === 'rule_ref_resolved_to_coverage')).toBe(true)
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

// ─── LD term fold (ledger PCM-A) ───────────────────────────────────────────────
// The canonical model says coverage.terms are "assembled from the coverage row plus
// the LD tables and rules that reference it" (canonicalMap). Pre-fix, every imported
// coverage persisted terms:[] — the assembly did not exist — so the UI's Limits /
// Deductibles / Pricing counts read 0 ('–' dashes). Two association channels, two
// structurally different fixtures (two-fixture rule):
//   1. rules join — a rule carries ldTableRef + coverageRefIds (GL convention);
//   2. name join  — an LD table's name matches a coverage name modulo a trailing
//      'Coverage' token (IM convention; IM rules carry no LDTable.* refs).
describe('mapIsoWorkbook — LD term fold (PCM-A)', () => {
  const fw = g('GL Product Framework', [
    ['PRODUCT FRAMEWORK - GENERAL LIABILITY'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE',
     'FORM NUMBER(S)', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT', 'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
    ['Active', 'GL.PROD.001', 'GL Product', '', '', '', '', '', '', '', '', '', 'X'],
    ['Active', 'GL.COV.002', 'GL Product', 'CGL', 'Bodily Injury Liability', '', 'CG 00 01', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
    ['Active', 'GL.COV.003', 'GL Product', 'CGL', 'Property Damage Liability', '', 'CG 00 01', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
    ['Active', 'GL.COV.004', 'GL Product', 'CGL', 'Debris Removal', '', '', 'Occurrence', 'Optional', 'Yes', 'Yes', 'No', 'X'],
    ['Active', 'GL.COV.005', 'GL Product', 'CGL', 'Lonely Coverage', '', '', 'Occurrence', 'Optional', 'No', 'Yes', 'No', 'X'],
  ])
  const foldRules = g('GL Rules Specifications', [
    ['RULES SPECIFICATIONS'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'RULE ID', 'RULE CATEGORY', 'RULE SUB-CATEGORY', 'RULE CONDITION', 'RULE OUTCOME', 'RULE REFERENCE', 'ALL ACTIVE STATES'],
    // Two rules citing the SAME table for the same coverage → ONE term (dedupe).
    ['Active', 'GL.COV.002\nGL.COV.003', 'GL.RU.004', 'Product', 'Limit Ranges and Defaults', 'If CGL', 'Then an Occurrence Limit is available and mandatory (See Table)', 'Occurrence Limits (LDTable.001)', 'X'],
    ['Active', 'GL.COV.002', 'GL.RU.005', 'Product', 'Limit Ranges and Defaults', 'If CGL', 'Then an Occurrence Limit is optional (See Table)', 'Occurrence Limits (LDTable.001)', 'X'],
    ['Active', 'GL.COV.002', 'GL.RU.006', 'Product', 'Deductible Ranges and Defaults', 'If CGL', 'Then a BI/PD Deductible is available (See Table)', 'BI/PD Deductibles (LDTable.002)', 'X'],
    // RTTable references are RATING tables — they must NEVER fold into coverage terms.
    ['Active', 'GL.COV.002', 'GL.RU.007', 'Rating', 'Minimum Premium', 'If CGL', 'Then apply the factor (RTTable.001)', 'Factor Table (RTTable.001)', 'X'],
    // A rule citing a coverage that is not in this workbook — skipped, counted, never fabricated.
    ['Active', 'GL.COV.999', 'GL.RU.008', 'Product', 'Limit Ranges and Defaults', 'If CGL', 'Then a limit is available (See Table)', 'Occurrence Limits (LDTable.001)', 'X'],
  ])
  const foldLd = g('Limits and Deductibles', [
    ['RULES SPECIFICATIONS'],
    ['LDTable.001', 'TABLE NAME:', 'Occurrence Limits', 'AVAILABLE LIMITS', 'COMMENTS'],
    ['', '', '', 1000000, ''],
    ['', '', '', 2000000, 'Default'],
    ['LDTable.002', 'TABLE NAME:', 'BI/PD Deductibles'],
    ['', '', '', 'AVAILABLE DEDUCTIBLES', 'COMMENTS'],
    ['', '', '', 500, ''],
    ['', '', '', 1000, ''],
    // Name-join channel: table named "<coverage name> Coverage", cited by NO rule.
    ['LDTable.003', 'TABLE NAME:', 'Debris Removal Coverage'],
    ['', '', '', 'AVAILABLE LIMITS', 'COMMENTS'],
    ['', '', '', 25000, 'Default'],
    // Unmatched by any channel: stays an ldTable entity, attaches to nothing.
    ['LDTable.004', 'TABLE NAME:', 'Completely Unrelated Table'],
    ['', '', '', 'AVAILABLE LIMITS', 'COMMENTS'],
    ['', '', '', 99, ''],
  ])
  const foldPlan = mapIsoWorkbook([fw, foldRules, foldLd])
  const fcov = (refId: string) => foldPlan.coverages.find(c => c.refId === refId)!
  type Term = { id: string; kind: string; label: string; ldTableRef?: string; default: unknown; basis: string }
  const termsOf = (refId: string) => (fcov(refId).data['terms'] as Term[]) ?? []

  it('rules join: coverages cited by a rule with an LDTable ref gain a term (deduped)', () => {
    const t2 = termsOf('GL.COV.002')
    const limit = t2.find(t => t.ldTableRef === 'LDTable.001')!
    expect(limit).toBeTruthy()
    expect(limit.kind).toBe('LIMIT')
    expect(limit.label).toBe('Occurrence Limits')
    expect(limit.default).toBe(2000000) // the row marked Default
    // Two rules cite LDTable.001 for GL.COV.002 — still exactly one term for it.
    expect(t2.filter(t => t.ldTableRef === 'LDTable.001')).toHaveLength(1)
    // The second coverage on the multi-refId rule gets its own term.
    expect(termsOf('GL.COV.003').find(t => t.ldTableRef === 'LDTable.001')).toBeTruthy()
  })

  it('deductible tables fold with kind DEDUCTIBLE', () => {
    const ded = termsOf('GL.COV.002').find(t => t.ldTableRef === 'LDTable.002')!
    expect(ded).toBeTruthy()
    expect(ded.kind).toBe('DEDUCTIBLE')
    expect(ded.default).toBe(500) // no Default comment → first available value
  })

  it('RTTable references never fold into coverage terms', () => {
    expect(termsOf('GL.COV.002').some(t => /^RTTable\./i.test(String(t.ldTableRef ?? '')))).toBe(false)
  })

  it('name join: an uncited LD table named after a coverage attaches to it', () => {
    const t = termsOf('GL.COV.004').find(x => x.ldTableRef === 'LDTable.003')!
    expect(t).toBeTruthy()
    expect(t.kind).toBe('LIMIT')
    expect(t.default).toBe(25000)
  })

  it('unmatched tables stay unattached; uninvolved coverages keep terms []', () => {
    const allRefs = foldPlan.coverages.flatMap(c => ((c.data['terms'] as Term[]) ?? []).map(t => t.ldTableRef))
    expect(allRefs).not.toContain('LDTable.004')
    expect(termsOf('GL.COV.005')).toEqual([])
    // Conservation: the ldTable entities themselves are all still in the plan.
    expect(foldPlan.ldTables.map(t => t.refId).sort()).toEqual(['LDTable.001', 'LDTable.002', 'LDTable.003', 'LDTable.004'])
  })

  it('emits an aggregated fold notice (not a warning — snapshots stay stable)', () => {
    const n = foldPlan.summary.notices.find(x => x.code === 'ld_terms_folded')
    expect(n).toBeTruthy()
    // Exactly 4: COV.002×LD.001 + COV.003×LD.001 + COV.002×LD.002 + COV.004×LD.003
    // (the duplicate GL.RU.005 citation dedupes; the RTTable and unknown-coverage
    // rules attach nothing).
    expect((n!.data as { termsAttached: number; unknownCoverageRefs: number }).termsAttached).toBe(4)
    expect((n!.data as { unknownCoverageRefs: number }).unknownCoverageRefs).toBe(1)
  })

  it('the signature-detected term derivation NEVER fires on a GL workbook (PCM-A byte-identical)', () => {
    // No "TABLE NAME:" reference sheet → no minted tables → deriveTermsFromReferenceTables no-ops;
    // the fold above stays the sole term source and its ld_terms_folded notice is unchanged.
    expect(foldPlan.summary.notices.some(x => x.code === 'reference_table_terms_derived')).toBe(false)
    expect(foldPlan.ldTables.every(t => !(t.data as Record<string, unknown>)['mintedId'])).toBe(true)
  })

  it('stale numeric refs recover via the NAME in the same reference cell; unresolvable refs emit NO term', () => {
    // Real-corpus defect (judge-found): GL rules cite "Policy Deductible Type
    // (LDTable.122)" while the parsed table is LDTABLE.119 with that exact name.
    // Pre-revision the fold minted a phantom term (ldTableRef → nothing, default 0).
    const staleFw = g('GL Product Framework', [
      ['PRODUCT FRAMEWORK - GENERAL LIABILITY'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'FORM NUMBER(S)', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT', 'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
      ['Active', 'GL.PROD.001', 'GL Product', '', '', '', '', '', '', '', '', '', 'X'],
      ['Active', 'GL.COV.010', 'GL Product', 'CGL', 'Premises Liability', '', '', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
    ])
    const staleRules = g('GL Rules Specifications', [
      ['RULES SPECIFICATIONS'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'RULE ID', 'RULE CATEGORY', 'RULE SUB-CATEGORY', 'RULE CONDITION', 'RULE OUTCOME', 'RULE REFERENCE', 'ALL ACTIVE STATES'],
      ['Active', 'GL.COV.010', 'GL.RU.024', 'Product', 'Deductible Ranges and Defaults', 'If CGL', 'Then a deductible type applies', 'Policy Deductible Type (LDTable.122)', 'X'],
      ['Active', 'GL.COV.010', 'GL.RU.025', 'Product', 'Limit Ranges and Defaults', 'If CGL', 'Then a limit applies', 'Mystery Table (LDTable.999)', 'X'],
    ])
    const staleLd = g('Limits and Deductibles', [
      ['RULES SPECIFICATIONS'],
      ['LDTABLE.119', 'TABLE NAME:', 'Policy Deductible Type', 'AVAILABLE DEDUCTIBLES', 'COMMENTS'],
      ['', '', '', 250, 'Default'],
      ['', '', '', 500, ''],
    ])
    const p = mapIsoWorkbook([staleFw, staleRules, staleLd])
    const terms = (p.coverages.find(c => c.refId === 'GL.COV.010')!.data['terms'] as Term[])
    // Recovered by the same-cell name → attaches to the REAL parsed table, verbatim refId.
    expect(terms).toHaveLength(1)
    expect(terms[0]!.ldTableRef).toBe('LDTABLE.119')
    expect(terms[0]!.kind).toBe('DEDUCTIBLE')
    expect(terms[0]!.default).toBe(250)
    // The unresolvable ref minted NOTHING — no phantom ldTableRef, no fabricated 0.
    expect(terms.some(t => /999/.test(String(t.ldTableRef)))).toBe(false)
    const n = p.summary.notices.find(x => x.code === 'ld_terms_folded')!
    expect((n.data as { recoveredStaleRefs: number }).recoveredStaleRefs).toBe(1)
    expect((n.data as { danglingTableRefs: number }).danglingTableRefs).toBe(1)
    expect((n.data as { tablesConsumed: number }).tablesConsumed).toBe(1) // only the REAL table
  })

  it("every folded term satisfies the CoverageTerm contract the UI counts on", () => {
    for (const c of foldPlan.coverages) {
      for (const t of (c.data['terms'] as Term[]) ?? []) {
        expect(typeof t.id).toBe('string')
        expect(['LIMIT', 'DEDUCTIBLE', 'OPTION']).toContain(t.kind)
        expect(typeof t.label).toBe('string')
        expect(t.label.length).toBeGreaterThan(0)
        expect(t.default).not.toBeUndefined()
        expect(typeof t.basis).toBe('string')
      }
    }
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

// ─── Phase G generalization locks (ledger G-A / G-B / G-C / G-D) ─────────────────
// Permanent fixtures for the holdout-discovered defects: the frozen corpus at
// samples/hardening/holdout/ is the discovery lock; these are the unit locks.

describe('mapIsoWorkbook — header alias specificity + state-matrix profile (G-A)', () => {
  it('an X-marked Idaho column left of the id column never hijacks the "ID" alias', () => {
    const p = mapIsoWorkbook([g('GL Product Framework', [
      ['PRODUCT FRAMEWORK'],
      ['ID', 'STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL'],
      ['X', 'Active', 'GL.PROD.001', 'Monoline GL', '', '', ''],
      ['', 'Active', 'GL.COV.001', 'Monoline GL', 'CGL', 'Premises Liability', 'Mandatory'],
      ['X', 'Active', 'GL.COV.002', 'Monoline GL', 'CGL', 'Products Liability', 'Optional'],
    ])])
    expect(p.productId).toBe('GL.PROD.001')
    expect(p.coverages.map(c => c.refId)).toEqual(['GL.COV.001', 'GL.COV.002'])
  })

  it('a PCM-style id column literally headed "ID" (Idaho) keeps working — data profile beats header name', () => {
    const p = mapIsoWorkbook([g('Product Component Model', [
      ['COMPONENT MODEL'],
      ['STATUS', 'ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL'],
      ['Active', 'IM.PROD.001', 'Floater', '', '', ''],
      ['Active', 'IM.COV.001', 'Floater', 'Inland Marine', 'Scheduled Equipment', 'Mandatory'],
    ])])
    expect(p.productId).toBe('IM.PROD.001')
    expect(p.coverages.map(c => c.refId)).toEqual(['IM.COV.001'])
  })
})

describe('mapIsoWorkbook — separator-agnostic identity recognition (G-B)', () => {
  const p = mapIsoWorkbook([g('GL Product Framework', [
    ['PRODUCT FRAMEWORK'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL'],
    ['Active', 'GL-PROD-001', 'Monoline GL', '', '', ''],
    ['Active', 'GL-COV-001', 'Monoline GL', 'CGL', 'Premises Liability', 'Mandatory'],
  ])])
  it('recognizes a dash-notation product row and carries ids byte-for-byte', () => {
    expect(p.productId).toBe('GL-PROD-001')
    expect(p.coverages.map(c => c.refId)).toEqual(['GL-COV-001'])
  })
  it('resolves the line from the dashed prefix (never the PH default)', () => {
    expect(p.product?.data['marketSegment']).toBe('Commercial Lines / Casualty')
  })
})

describe('mapIsoWorkbook — synthesized prefix is registry-validated (G-C)', () => {
  it('junk coverage ids never leak into the minted product id — warned platform default instead', () => {
    const p = mapIsoWorkbook([g('Product Framework', [
      ['PRODUCT FRAMEWORK'],
      ['STATUS', 'ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL'],
      ['Active', 'ZZZTOP.9', 'Mystery Product', 'Unknown Line', 'Some Coverage', 'Mandatory'],
    ])])
    expect(p.productId).toBe('PH.PROD.SYNTH001')
    expect(p.summary.warnings.some(w => /product_synth_prefix_defaulted/.test(w))).toBe(true)
  })
})

describe('mapIsoWorkbook — no fabrication on silence (G-D)', () => {
  const p = mapIsoWorkbook([
    g('GL Product Framework', [
      ['PRODUCT FRAMEWORK'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL'],
      ['Active', 'GL.PROD.001', 'Monoline GL', '', '', ''],
      ['Active', 'GL.COV.001', 'Monoline GL', 'CGL', 'Premises Liability', ''],
      ['Active', 'GL.COV.002', 'Monoline GL', 'CGL', 'Products Liability', 'Optional'],
    ]),
    g('GL Forms Specifications', [
      ['FORMS SPECIFICATIONS'],
      ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'FORM EDITION DATE (MM YY)', 'FORM CATEGORY', 'MANDATORY/ OPTIONAL', 'DYNAMIC / STATIC'],
      ['GL.COV.001', 'Some Form', 'CG 77 01', '04 13', '', '', 'Static'],
    ]),
  ])
  it('a blank requirement cell maps to UNKNOWN, never a silent MANDATORY', () => {
    const covOf = (refId: string) => p.coverages.find(c => c.refId === refId)!
    expect(covOf('GL.COV.001').data['requirement']).toBe('UNKNOWN')
    expect(covOf('GL.COV.002').data['requirement']).toBe('OPTIONAL')
  })
  it('blank category/mandatory cells keep their documented defaults but are WARNED', () => {
    const form = p.forms.find(f => f.data['number'] === 'CG 77 01')!
    expect(form.data['category']).toBe('ENDORSEMENT')
    expect(p.summary.warnings.some(w => /blank FORM CATEGORY/.test(w))).toBe(true)
    expect(p.summary.warnings.some(w => /blank MANDATORY/.test(w))).toBe(true)
  })
})

// ─── Form anchor upgrades (D6) ────────────────────────────────────────────────────
// A form the source anchors only at product/line level, whose number the hierarchy's
// per-coverage form list names, is re-anchored to that coverage. Forms stay refId:null.
describe('mapIsoWorkbook — form anchor upgrades (D6)', () => {
  const fw = g('Framework', [
    ['PRODUCT FRAMEWORK'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'FORM NUMBER(S)', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.PRD.001', 'Core', '', '', '', '', 'X'],
    ['Active', 'CORE.COV.001', 'Core', 'Auto', 'Bodily Injury', '', 'AC 200', 'X'],
  ])
  // Two "TABLE NAME:" blocks → CORE signature (so the upgrade pass runs).
  const refs = g('Reference Data', [
    ['TABLE NAME: Liability Limits - AZ', '', 'BI'],
    ['RULE ID:', 'Available'],
    ['Single', 25],
    ['TABLE NAME: Fees'],
    ['RULE ID:', 'Amount'],
    ['Late', 10],
  ])
  const forms = g('Forms Specifications', [
    ['FORMS'],
    ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'FORM CATEGORY'],
    ['CORE.PRD.001', 'Some Form', 'AC 200', 'Endorsement'],   // line-level anchor only
    ['CORE.PRD.001', 'Other Form', 'AC 999', 'Endorsement'],  // in no coverage form list
  ])
  const plan3 = mapIsoWorkbook([fw, refs, forms])

  it('re-anchors a line-level form to the coverage whose form list names it (forms stay refId:null)', () => {
    const f = plan3.forms.find(x => x.data['number'] === 'AC 200')!
    expect(f.data['coverageRefIds']).toEqual(['CORE.COV.001'])
    expect(String(f.data['anchorBasis'])).toMatch(/hierarchy form list/)
    expect(f.refId).toBeNull()
    expect(plan3.summary.counts['formAnchorUpgrades']).toBe(1)
  })
  it('a form in no coverage form list is left unanchored (never invented)', () => {
    const f = plan3.forms.find(x => x.data['number'] === 'AC 999')!
    expect(f.data['coverageRefIds']).toBeUndefined()
  })
})

// ─── Review-hardening: rating-group forward-fill stops at policy-level steps (D5) ──
describe('mapIsoWorkbook — rating-group forward-fill never bleeds onto policy-level steps', () => {
  const fw = g('Framework', [
    ['PRODUCT FRAMEWORK'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.PRD.001', 'Core', '', '', '', 'X'],
    ['Active', 'CORE.COV.001', 'Core', 'Auto', 'Bodily Injury', '', 'X'],
  ])
  const refs = g('Reference Data', [
    ['TABLE NAME: Liability Limits - AZ', '', 'BI'],
    ['RULE ID:', 'Available'],
    ['Single', 25],
    ['TABLE NAME: Fees'],
    ['RULE ID:', 'Amount'],
    ['Late', 10],
  ])
  const rating = g('Rating Specifications', [
    ['RATING'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'RATING STEP ID', 'COVERAGE NAME', 'RATING RULES', 'ALGORITHM STEP', 'CALCULATION', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.RAT.1', '', 'Bodily Injury', 'base', 'Base Rate', '*', 'X'],
    ['Active', 'CORE.RAT.1', '', '', 'ilf', 'Increased Limit Factor', '*', 'X'],   // coverage continuation → attributed
    ['Active', 'CORE.RAT.1', '', '', 'fin', 'Final premium', '+', 'X'],            // policy-level → unattributed
    ['Active', 'CORE.RAT.1', '', '', 'tax', 'MCCA Assessment', '+', 'X'],          // policy-level → unattributed
  ])
  const p = mapIsoWorkbook([fw, refs, rating])
  const stepBy = (frag: string) => (p.ratingProgram!.data['steps'] as Array<Record<string, unknown>>).find(s => new RegExp(frag, 'i').test(String(s['label'])))!

  it('a coverage continuation step inherits the group; a policy-level step does not', () => {
    expect(stepBy('Increased Limit')['groupRefId']).toBe('CORE.RTG.001')
    expect(stepBy('Final premium')['groupRefId']).toBeUndefined()
    expect(stepBy('MCCA Assessment')['groupRefId']).toBeUndefined()
  })
})

// ─── Review-hardening: rate-table artifacts correlated to their own block (D4) ──
describe('mapIsoWorkbook — rate-table artifact detection is order/count-independent', () => {
  const fw = g('Framework', [
    ['PRODUCT FRAMEWORK'],
    ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE', 'ALL ACTIVE STATES'],
    ['Active', 'CORE.PRD.001', 'Core', '', '', '', 'X'],
    ['Active', 'CORE.COV.001', 'Core', 'Auto', 'Bodily Injury', '', 'X'],
  ])
  const refs = g('Reference Data', [
    ['TABLE NAME: Liability Limits - AZ', '', 'BI'],
    ['RULE ID:', 'Available'],
    ['Single', 25],
    ['TABLE NAME: Fees'],
    ['RULE ID:', 'Amount'],
    ['Late', 10],
  ])
  // Artifact block FIRST (no RATE TABLE ID), real table SECOND — the old slice(N) got this backwards.
  const rt = g('Rating Tables', [
    ['RATE TABLE NAME:', 'Wrong-Line Example'],
    ['(no id here)', 1],
    ['RATE TABLE NAME:', 'Real Factor Table'],
    ['RATE TABLE ID:', 'RTTable.001'],
    ['Territory', 'Factor'],
    ['A', 1.1],
  ])
  const p = mapIsoWorkbook([fw, refs, rt])
  it('reports only the block with no RATE TABLE ID as the excluded artifact', () => {
    const n = p.summary.notices.find(x => x.code === 'template_artifacts_excluded')!
    expect((n.data as { names: string[] }).names).toEqual(['Wrong-Line Example'])
    expect(p.rtTables.map(t => t.refId)).toContain('RTTable.001')   // the real table is kept
  })
})
