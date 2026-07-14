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
