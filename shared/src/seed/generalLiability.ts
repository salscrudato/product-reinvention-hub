// generalLiability.ts — General Liability (CGL) seed constants.
// All refIds use the GL.* prefix. The rating algorithm is an occurrence-form
// ISO CGL program: exposure base × class rate → increased-limits factor →
// deductible credit → PCO premium (conditional) → experience modification →
// minimum-premium floor. Rates and factors are ILLUSTRATIVE — derived from the
// GL workbook fixtures at samples/iso/20-ISO-Pricing-GL.xlsx; replace with
// filed rates when importing via the ISO workbook pipeline.
// The $2,635 canary is locked by generalLiability.evaluator.test.ts.
import type {
  Product, Coverage, LDTable, RTTable, RatingProgram, Form,
  Rule, FormRule, DictionaryEntry, RatingInputField,
} from '../types'
import type { RtGetter } from '../rating/evaluator'
import { genericRtLookup } from '../rating/rtGrid'
import { makeLdGetter } from '../rating/ldGetter'
import { GL_LOB } from '../insurance/lobRegistry'

// ─── State footprint ──────────────────────────────────────────────────────────

export const GL_FOOTPRINT_STATES = GL_LOB.footprintStates

// ─── Governance helper ────────────────────────────────────────────────────────

function gov(overrides: { lifecycle?: Product['lifecycle']; status?: Product['status'] } = {}) {
  return {
    status:       (overrides.status    ?? 'ACTIVE')   as Product['status'],
    lifecycle:    (overrides.lifecycle ?? 'LAUNCHED') as Product['lifecycle'],
    reviewStatus: 'APPROVED'                          as Product['reviewStatus'],
    reviewer:     'system',
    createdAt:    null,
    updatedAt:    null,
    updatedBy:    'seed',
    rev:          1,
  }
}

const FOOTPRINT_SCOPE = { allStates: false, states: [...GL_FOOTPRINT_STATES] }

// ─── Product ──────────────────────────────────────────────────────────────────

export const GL_PRODUCT: Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:         'GL.PROD.001',
  name:          'Commercial General Liability',
  lob:           { refId: GL_LOB.refId, name: GL_LOB.name },
  description:   'ISO-style Commercial General Liability policy (CG 00 01) covering bodily injury and property damage liability (Coverage A), personal and advertising injury liability (Coverage B), and medical payments (Coverage C) on an occurrence trigger.',
  marketSegment: 'Commercial Lines / Casualty',
  owner:         { uid: 'seed', name: 'Product Factory Seed' },
  ...FOOTPRINT_SCOPE,
  ...gov(),
}

// ─── Limits & Deductible tables (LD) ─────────────────────────────────────────
// Table refs follow GL.LD.NNN pattern. Options and defaults derived from the
// GL product framework workbook (samples/iso/20-ISO-Framework-GL.xlsx).

export const GL_LD_TABLES: Record<string, LDTable> = {
  'GL.LD.001': {
    // Per-occurrence limit — the Each Occurrence cap in the CGL declarations.
    // Base limit = $100,000; standard commercial default = $1,000,000.
    name:         'Per-Occurrence Limit',
    defaultValue: 1000000,
    rows: [
      { label: '$100,000',   value: 100000,  constraintNote: 'Base limit — minimal coverage for most operations' },
      { label: '$300,000',   value: 300000 },
      { label: '$500,000',   value: 500000 },
      { label: '$1,000,000', value: 1000000 },
    ],
  },

  'GL.LD.002': {
    // General Aggregate — caps total Coverage A + B + C (excluding products/completed ops).
    // ISO CGL standard: 2× the per-occurrence limit; must be ≥ per-occurrence limit [GL.RU.007].
    name:         'General Aggregate Limit',
    defaultValue: 2000000,
    rows: [
      { label: '$200,000',   value: 200000,  constraintNote: 'Must be ≥ per-occurrence limit' },
      { label: '$600,000',   value: 600000,  constraintNote: 'Must be ≥ per-occurrence limit' },
      { label: '$1,000,000', value: 1000000, constraintNote: 'Must be ≥ per-occurrence limit' },
      { label: '$2,000,000', value: 2000000 },
    ],
  },

  'GL.LD.003': {
    // Products-Completed-Operations Aggregate — separate aggregate for Coverage A
    // losses arising out of the products-completed-operations hazard.
    // Reset at each policy period anniversary; typically set equal to the General Aggregate.
    name:         'Products-Completed-Operations Aggregate Limit',
    defaultValue: 2000000,
    rows: [
      { label: '$200,000',   value: 200000,  constraintNote: 'When PCO elected, must be ≥ per-occurrence limit [GL.RU.003]' },
      { label: '$600,000',   value: 600000,  constraintNote: 'When PCO elected, must be ≥ per-occurrence limit [GL.RU.003]' },
      { label: '$1,000,000', value: 1000000 },
      { label: '$2,000,000', value: 2000000 },
    ],
  },

  'GL.LD.004': {
    // Per-occurrence BI/PD deductible (Coverage A only). When elected, CG 03 00 attaches.
    name:         'Per-Occurrence Deductible',
    defaultValue: 0,
    rows: [
      { label: '$0 (none)', value: 0 },
      { label: '$500',      value: 500 },
      { label: '$1,000',    value: 1000 },
      { label: '$2,500',    value: 2500 },
    ],
  },
}

// ─── Rating tables (RT) ───────────────────────────────────────────────────────
// Illustrative class rates and factors derived from samples/iso/20-ISO-Pricing-GL.xlsx.
// Replace with filed manual rates before any regulatory or commercial use.

export const GL_RT_TABLES: Record<string, RTTable> = {
  'GL.RT.001': {
    // Class code base rate — the annual cost per $1,000 of the designated exposure base.
    // Exposure basis by class: 'payroll' for most operations; 'gross_sales' for retail/products.
    // s1 SET: getter returns this rate; s2 MUL INPUT exposureThousands converts to premium.
    name:    'Class Code Base Rate (per $1,000 of exposure)',
    columns: ['classCode', 'exposureBasis', 'baseRate'],
    rows: [
      { classCode: '41677', exposureBasis: 'payroll',      baseRate: 2.50 }, // Contractors — Residential Remodeling
      { classCode: '11011', exposureBasis: 'gross_sales',  baseRate: 1.80 }, // Restaurants
      { classCode: '45191', exposureBasis: 'gross_sales',  baseRate: 0.90 }, // Retail Stores — not elsewhere classified
      { classCode: '61110', exposureBasis: 'payroll',      baseRate: 0.35 }, // Office — clerical
      { classCode: '16811', exposureBasis: 'payroll',      baseRate: 1.20 }, // Building Operations — not classified
    ],
  },

  'GL.RT.002': {
    // Per-Occurrence Increased Limits Factor — scales base-limit premium to the selected
    // each-occurrence limit. Base = $100,000 (factor 1.000). Source: GL Forms workbook
    // (samples/iso/20-ISO-Pricing-GL.xlsx, Rating Specifications sheet, ILF table).
    name:    'Per-Occurrence Increased Limits Factor',
    columns: ['occLimit', 'factor'],
    rows: [
      { occLimit: 100000,  factor: 1.000 }, // base limit
      { occLimit: 300000,  factor: 1.320 },
      { occLimit: 500000,  factor: 1.540 },
      { occLimit: 1000000, factor: 1.820 },
    ],
  },

  'GL.RT.003': {
    // BI/PD Deductible Credit Factor — multiplicative credit applied when a per-occurrence
    // deductible is elected (Coverage A only). Factor < 1.00 = premium reduction.
    name:    'BI/PD Deductible Credit Factor',
    columns: ['occDeductible', 'factor'],
    rows: [
      { occDeductible: 0,    factor: 1.000 }, // no deductible
      { occDeductible: 500,  factor: 0.960 },
      { occDeductible: 1000, factor: 0.940 },
      { occDeductible: 2500, factor: 0.910 },
    ],
  },

  'GL.RT.004': {
    // Products-Completed-Operations rate — annual cost per $1,000 of PCO exposure base.
    // Used by step s5: ADD(RT GL.RT.004 [classCode, pcoExposureThousands]).
    // The getter multiplies pcoRate × pcoExposureThousands and returns the full PCO premium,
    // so the ADD step adds it directly to the running total.
    name:    'Products-Completed-Operations Rate (per $1,000 of exposure)',
    columns: ['classCode', 'pcoRate'],
    rows: [
      { classCode: '41677', pcoRate: 1.80 }, // Contractors — elevated PCO exposure
      { classCode: '11011', pcoRate: 0.85 }, // Restaurants
      { classCode: '45191', pcoRate: 0.40 }, // Retail Stores
      { classCode: '61110', pcoRate: 0.15 }, // Office — minimal product/work exposure
      { classCode: '16811', pcoRate: 0.80 }, // Building Operations
    ],
  },

  'GL.RT.005': {
    // Experience Modification Factor — applied to the full running premium AFTER the
    // PCO component is added. Standard ISO modification range 0.75–1.25.
    name:    'Experience Modification Factor',
    columns: ['expMod', 'factor'],
    rows: [
      { expMod: '0.75', factor: 0.75 },
      { expMod: '0.90', factor: 0.90 },
      { expMod: '1.00', factor: 1.00 },
      { expMod: '1.15', factor: 1.15 },
      { expMod: '1.25', factor: 1.25 },
    ],
  },
}

// ─── RT getter (General Liability — GL.RAT.1 steps) ──────────────────────────

export function makeGLRtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, q: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)

    // Grid-managed tables (with `dimensions`) resolve through the generic N-D lookup;
    // returns null for all seeded tables (no `dimensions`), so the bespoke lookups below
    // are always reached — the $2,635 canary is untouched by the generic path.
    const generic = genericRtLookup(t, q)
    if (generic !== null) return generic

    const rows = t.rows

    switch (tableRef) {
      case 'GL.RT.001': {
        // s1 SET: returns baseRate (per $1,000 exposure) for the selected class code.
        // The exposure multiplier is applied in s2 (MUL INPUT exposureThousands).
        const r = rows.find(r => r['classCode'] === q['classCode'])
        if (!r) throw new Error(`GL.RT.001 (sheet "Rating Specifications", column "Class Code"): no row for classCode=${q['classCode']}`)
        return r['baseRate'] as number
      }

      case 'GL.RT.002': {
        // s3 MUL: per-occurrence increased-limits factor.
        const r = rows.find(r => r['occLimit'] === q['occLimit'])
        if (!r) throw new Error(`GL.RT.002 (sheet "Rating Specifications", column "Each Occ Limit"): no row for occLimit=${q['occLimit']}`)
        return r['factor'] as number
      }

      case 'GL.RT.003': {
        // s4 MUL: deductible credit factor.
        const r = rows.find(r => r['occDeductible'] === q['occDeductible'])
        if (!r) throw new Error(`GL.RT.003 (sheet "Limits and Deductibles", column "Deductible"): no row for occDeductible=${q['occDeductible']}`)
        return r['factor'] as number
      }

      case 'GL.RT.004': {
        // s5 ADD (conditional pcoElected): returns the FULL PCO premium for this class code
        // and exposure volume. The returned value is pcoRate × pcoExposureThousands — the
        // evaluator's ADD op adds it directly to the running total.
        const r = rows.find(r => r['classCode'] === q['classCode'])
        if (!r) throw new Error(`GL.RT.004 (sheet "Rating Specifications", column "Class Code"): no PCO row for classCode=${q['classCode']}`)
        const pcoRate              = r['pcoRate'] as number
        const pcoExposureThousands = q['pcoExposureThousands'] as number
        if (typeof pcoExposureThousands !== 'number') {
          throw new Error(`GL.RT.004: pcoExposureThousands must be a number, got ${typeof pcoExposureThousands}`)
        }
        return pcoRate * pcoExposureThousands
      }

      case 'GL.RT.005': {
        // s6 MUL: experience modification factor.
        const r = rows.find(r => r['expMod'] === q['expMod'])
        if (!r) throw new Error(`GL.RT.005 (sheet "Rating Specifications", column "Exp Mod"): no row for expMod=${q['expMod']}`)
        return r['factor'] as number
      }

      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`)
    }
  }
}

// LD getter — routes LD source steps through the generic makeLdGetter (same as PH, PA).
// No GL.RAT.1 step currently uses an LD source; wired here so a PM-authored LD step evaluates.
export const makeGLLdGetter = makeLdGetter

// ─── Rating program (GL.RAT.1 — 7 logical steps, 8 executable steps) ──────────
// Step order:
//   s1 SET   class rate per $1,000 of payroll/gross-sales (GL.RT.001)
//   s2 MUL   × exposureThousands  → base premises/operations premium
//   s3 MUL   × per-occurrence ILF (GL.RT.002)
//   s4 MUL   × deductible credit  (GL.RT.003)
//   s5 ADD   + PCO premium        (GL.RT.004, pcoRate × pcoExposureThousands) [conditional]
//   s6 MUL   × experience mod     (GL.RT.005)
//   s7 MIN_FLOOR $500, round to $
//
// Canary: class 41677, exposureThousands=500, occLimit=$1M, occDeductible=$0,
//         pcoElected=true, pcoExposureThousands=200, expMod='1.00'
//   s1 = 2.50    s2 = 2.50 × 500 = 1,250.00    s3 = 1,250 × 1.82 = 2,275.00
//   s4 = 2,275 × 1.00 = 2,275.00    s5 = 2,275 + (200 × 1.80) = 2,275 + 360 = 2,635.00
//   s6 = 2,635 × 1.00 = 2,635.00    s7 = max(2,635, 500) → $2,635

const GL_MINIMUM_PREMIUM = 500

export const GL_RATING_PROGRAM: Omit<RatingProgram, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:          'GL.RAT.1',
  name:           'Commercial General Liability Rating Program',
  minimumPremium: GL_MINIMUM_PREMIUM,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    // s1: Class base rate (per $1,000 of payroll or gross sales) — the anchor for all steps.
    { id: 's1', order: 1, label: 'Class base rate (per $1,000 of exposure)',
      op: 'SET', source: { type: 'RT', ref: 'GL.RT.001', keys: ['classCode'] } },

    // s2: Multiply by exposure volume (thousands of dollars of payroll or gross sales).
    //     INPUT source reads `exposureThousands` directly from the inputs map.
    { id: 's2', order: 2, label: 'Exposure volume (thousands of payroll / gross sales)',
      op: 'MUL', source: { type: 'INPUT', ref: 'exposureThousands' } },

    // s3: Per-occurrence increased-limits factor.
    { id: 's3', order: 3, label: 'Per-occurrence limit factor',
      op: 'MUL', source: { type: 'RT', ref: 'GL.RT.002', keys: ['occLimit'] } },

    // s4: BI/PD deductible credit (1.00 when no deductible elected).
    { id: 's4', order: 4, label: 'BI/PD deductible credit',
      op: 'MUL', source: { type: 'RT', ref: 'GL.RT.003', keys: ['occDeductible'] } },

    // s5: Products-Completed-Operations premium (conditional on pcoElected).
    //     GL.RT.004 getter returns pcoRate × pcoExposureThousands — the full PCO premium.
    { id: 's5', order: 5, label: 'Products-Completed-Operations premium',
      op: 'ADD', source: { type: 'RT', ref: 'GL.RT.004', keys: ['classCode', 'pcoExposureThousands'] },
      condition: 'pcoElected' },

    // s6: Experience modification factor (applied to the combined P/O + PCO premium).
    { id: 's6', order: 6, label: 'Experience modification factor',
      op: 'MUL', source: { type: 'RT', ref: 'GL.RT.005', keys: ['expMod'] } },

    // s7: Apply minimum premium and round to whole dollars.
    { id: 's7', order: 7, label: `Apply minimum premium ($${GL_MINIMUM_PREMIUM})`,
      op: 'MIN_FLOOR', source: { type: 'CONST', value: GL_MINIMUM_PREMIUM }, roundTo: 0 },
  ],
}

// ─── Coverages ────────────────────────────────────────────────────────────────

type CoverageSeed = Omit<Coverage, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_COVERAGES: CoverageSeed[] = [
  // ── Coverage A — Bodily Injury & Property Damage Liability ────────────────
  {
    refId: 'GL.COV.001', name: 'Coverage A — Bodily Injury & Property Damage Liability',
    parentId: null, order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [
      { id: 'occ-limit',   kind: 'LIMIT', label: 'Each Occurrence Limit', basis: 'per occurrence', ldTableRef: 'GL.LD.001', default: 1000000, unit: 'dollars' },
      { id: 'gen-agg',     kind: 'LIMIT', label: 'General Aggregate Limit', basis: 'aggregate', ldTableRef: 'GL.LD.002', default: 2000000, unit: 'dollars',
        constraintNote: 'Must be ≥ per-occurrence limit [GL.RU.007]' },
      { id: 'occ-ded',     kind: 'DEDUCTIBLE', label: 'Per-Occurrence Deductible', basis: 'per occurrence', ldTableRef: 'GL.LD.004', default: 0, unit: 'dollars' },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.001.001', name: 'Premises & Operations',
    parentId: 'GL.COV.001', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [
      { id: 'po-exposure-basis', kind: 'OPTION', label: 'Exposure Basis',
        basis: 'annual', default: 'payroll',
        notes: 'payroll = rated per $1,000 of annual payroll; gross_sales = rated per $1,000 of annual gross sales. Determined by class code (GL.RT.001).' },
      { id: 'po-exposure',       kind: 'LIMIT', label: 'Annual Exposure Amount', basis: 'annual', default: 500000, unit: 'dollars' },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.001.002', name: 'Products-Completed-Operations',
    parentId: 'GL.COV.001', order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [
      { id: 'pco-aggregate', kind: 'LIMIT', label: 'Products-Completed-Operations Aggregate', basis: 'aggregate',
        ldTableRef: 'GL.LD.003', default: 2000000, unit: 'dollars',
        constraintNote: 'When elected, must be ≥ per-occurrence limit [GL.RU.003]' },
      { id: 'pco-exposure',  kind: 'LIMIT', label: 'PCO Annual Exposure Amount', basis: 'annual', default: 200000, unit: 'dollars' },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Coverage B — Personal & Advertising Injury Liability ─────────────────
  {
    refId: 'GL.COV.002', name: 'Coverage B — Personal & Advertising Injury Liability',
    parentId: null, order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [
      { id: 'pb-limit', kind: 'LIMIT', label: 'Personal & Advertising Injury Limit (any one person or org)',
        basis: 'per occurrence', ldTableRef: 'GL.LD.001', default: 1000000, unit: 'dollars',
        notes: 'Capped by the General Aggregate (erodes the same GL.LD.002 bucket as Coverage A non-PCO losses).' },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Coverage C — Medical Payments ─────────────────────────────────────────
  {
    refId: 'GL.COV.003', name: 'Coverage C — Medical Payments',
    parentId: null, order: 3, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [
      { id: 'medpay-limit', kind: 'LIMIT', label: 'Medical Payments Limit (any one person)',
        basis: 'per person per occurrence', default: 5000, unit: 'dollars',
        notes: 'Pays regardless of fault. Capped by the General Aggregate.' },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Forms (CG-series) ────────────────────────────────────────────────────────

type FormSeed = Omit<Form, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

const GL_PARTS = [
  'Coverage A — Bodily Injury & Property Damage Liability',
  'Coverage B — Personal & Advertising Injury Liability',
  'Coverage C — Medical Payments',
]

export const GL_FORMS: FormSeed[] = [
  // ── Base form ─────────────────────────────────────────────────────────────
  {
    number: 'CG 00 01', edition: '10 01',
    name: 'Commercial General Liability Coverage Form', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: GL_PARTS,
    productRefIds: ['GL.PROD.001'],
    description: 'ISO occurrence-trigger CGL base form providing Coverage A (BI/PD), Coverage B (Personal and Advertising Injury), and Coverage C (Medical Payments). Each-Occurrence Limit caps any single occurrence; General Aggregate caps all non-PCO loss; Products-Completed-Operations Aggregate caps PCO loss. Both aggregates reset each policy period.',
    dynamicFields: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Declarations ─────────────────────────────────────────────────────────
  {
    number: 'CG DS 01', edition: '10 01',
    name: 'Commercial General Liability Declarations', category: 'DECLARATIONS',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['GL.PROD.001'],
    description: 'Declarations page showing named insured, business description, class codes, exposure bases, limits of insurance, premium, and applicable endorsement schedule.',
    dynamicFields: [
      { name: 'NamedInsured',     dataType: 'TEXT',     repeating: false },
      { name: 'BusinessAddress',  dataType: 'TEXT',     repeating: false },
      { name: 'PolicyEffective',  dataType: 'DATE',     repeating: false },
      { name: 'PolicyExpiration', dataType: 'DATE',     repeating: false },
      { name: 'ClassCode',        dataType: 'TEXT',     repeating: true,
        notes: 'ISO classification code for each premises/operations exposure.' },
      { name: 'ExposureAmount',   dataType: 'CURRENCY', repeating: true,
        notes: 'Annual payroll or gross sales for the corresponding class code.' },
      { name: 'TotalPremium',     dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Endorsements ─────────────────────────────────────────────────────────
  {
    number: 'CG 20 10', edition: '07 04',
    name: 'Additional Insured — Owners, Lessees or Contractors', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: true,
    transactions: [], coverageParts: ['Coverage A — Bodily Injury & Property Damage Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Adds a named owner, lessee or contractor as an additional insured for ongoing operations performed for that party. Limits coverage to the insured\'s negligence and excludes the additional insured\'s own acts.',
    dynamicFields: [
      { name: 'AdditionalInsuredName',    dataType: 'TEXT', repeating: true },
      { name: 'AdditionalInsuredAddress', dataType: 'TEXT', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 20 33', edition: '07 04',
    name: 'Additional Insured — Owners, Lessees or Contractors — Products-Completed Operations', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: true,
    transactions: [], coverageParts: ['Coverage A — Bodily Injury & Property Damage Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Extends Coverage A Products-Completed-Operations to a named additional insured. Required when products-completed-operations coverage is elected [GL.FORM.RU.001].',
    dynamicFields: [
      { name: 'AdditionalInsuredName', dataType: 'TEXT', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 03 00', edition: '01 96',
    name: 'BI/PD Deductible Endorsement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Coverage A — Bodily Injury & Property Damage Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Establishes a per-occurrence deductible for Coverage A bodily injury and property damage claims. Attaches when a BI/PD deductible is elected [GL.FORM.RU.002].',
    dynamicFields: [
      { name: 'DeductibleAmount', dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 06', edition: '05 14',
    name: 'Exclusion — Access or Disclosure of Confidential or Personal Information', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: ['Coverage A — Bodily Injury & Property Damage Liability', 'Coverage B — Personal & Advertising Injury Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Excludes liability arising out of the access to or disclosure of confidential or personal information. Applies to Coverage A and B.',
    dynamicFields: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 67', edition: '12 04',
    name: 'Fungi or Bacteria Exclusion', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: GL_PARTS,
    productRefIds: ['GL.PROD.001'],
    description: 'Excludes all liability arising out of actual or alleged exposure to, ingestion of, inhalation of or contact with fungi or bacteria, including mold.',
    dynamicFields: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 70', edition: '01 15',
    name: 'Exclusion — Contractors — Professional Liability', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: ['Coverage A — Bodily Injury & Property Damage Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Excludes liability arising out of the rendering of or failure to render professional services as an architect, engineer or surveyor. Applies to contractor accounts only.',
    dynamicFields: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Product rules ────────────────────────────────────────────────────────────

type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_RULES: RuleSeed[] = [
  {
    refId: 'GL.RU.001', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'CG 00 01 is an OCCURRENCE-triggered form',
    outcome: 'Coverage responds to bodily injury or property damage that OCCURS during the policy period; a claims-made variant (CG 00 02) would instead respond to claims first made during the period — never assume the trigger; read the form.',
    coverageRefIds: ['GL.COV.001'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.002', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'General Aggregate limit options',
    outcome: 'Options per GL.LD.002; default $2,000,000; must be ≥ per-occurrence limit (GL.RU.007)',
    ldTableRef: 'GL.LD.002', coverageRefIds: ['GL.COV.001'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.003', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Products-Completed-Operations elected and PCO aggregate selected',
    outcome: 'PCO aggregate (GL.LD.003) must be ≥ per-occurrence limit; default $2,000,000',
    ldTableRef: 'GL.LD.003', coverageRefIds: ['GL.COV.001.002'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.004', category: 'RATING', subCategory: 'Exposure Basis',
    condition: 'Class code selected',
    outcome: 'Exposure basis (payroll or gross sales) is determined by class code per GL.RT.001; annual exposure drives s1–s2 of GL.RAT.1',
    coverageRefIds: ['GL.COV.001.001'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.005', category: 'RATING', subCategory: 'Deductibles',
    condition: 'BI/PD deductible elected (> $0)',
    outcome: 'Deductible credit applied at GL.RAT.1 step s4 (GL.RT.003); CG 03 00 attaches [GL.FORM.RU.002]',
    ldTableRef: 'GL.LD.004', coverageRefIds: ['GL.COV.001'], formNumbers: ['CG 03 00'],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.006', category: 'RATING', subCategory: 'Premium Floor',
    condition: 'Calculated annual premium',
    outcome: `Minimum policy premium $${GL_MINIMUM_PREMIUM} (GL.RAT.1 step s7)`,
    coverageRefIds: [], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.RU.007', category: 'PRODUCT', subCategory: 'Aggregate Consistency',
    condition: 'Per-occurrence limit > General Aggregate',
    outcome: 'Ineligible: the per-occurrence limit may not exceed the General Aggregate — the per-occurrence cap cannot be larger than the total budget [ISO CGL Section III rule]',
    coverageRefIds: ['GL.COV.001'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Form attachment rules ────────────────────────────────────────────────────

type FormRuleSeed = Omit<FormRule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_FORM_RULES: FormRuleSeed[] = [
  {
    refId: 'GL.FORM.RU.001', condition: 'Products-Completed-Operations coverage elected',
    outcome: 'Attach CG 20 33 (Additional Insured — Products-Completed Operations)',
    formNumbers: ['CG 20 33'], mandatory: true, ...gov(),
  },
  {
    refId: 'GL.FORM.RU.002', condition: 'BI/PD per-occurrence deductible > $0 elected',
    outcome: 'Attach CG 03 00 (BI/PD Deductible Endorsement)',
    formNumbers: ['CG 03 00'], mandatory: true, ...gov(),
  },
  {
    refId: 'GL.FORM.RU.003', condition: 'Additional insured required by contract',
    outcome: 'Attach CG 20 10 (Additional Insured — Owners, Lessees or Contractors) for ongoing operations',
    formNumbers: ['CG 20 10'], mandatory: false, ...gov(),
  },
]

// ─── Dictionary ───────────────────────────────────────────────────────────────

type DictSeed = Omit<DictionaryEntry, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_DICTIONARY: DictSeed[] = [
  {
    refId: 'GL.DEF.001', name: 'Occurrence', type: 'TEXT',
    description: 'An accident, including continuous or repeated exposure to substantially the same general harmful conditions. The occurrence trigger means coverage responds when the injury or damage happens, not when the claim is filed.',
    allowedValues: [], format: 'Defined term in CG 00 01', tags: ['trigger', 'coverage', 'gl'],
    aliases: ['occurrence', 'accident', 'coverage trigger'],
    ...gov(),
  },
  {
    refId: 'GL.DEF.002', name: 'Each Occurrence Limit', type: 'CURRENCY',
    description: 'The maximum the insurer will pay for the sum of all damages and medical expenses arising out of any one occurrence. A single per-occurrence event cannot exhaust more than this amount regardless of the number of claimants.',
    allowedValues: ['100000', '300000', '500000', '1000000'], format: 'USD (whole dollars)', tags: ['limit', 'coverage', 'gl'],
    aliases: ['Each Occurrence Limit', 'per occurrence limit', 'occurrence limit'],
    ...gov(),
  },
  {
    refId: 'GL.DEF.003', name: 'General Aggregate Limit', type: 'CURRENCY',
    description: 'The maximum the insurer will pay in total for all Coverage A (non-PCO), Coverage B, and Coverage C losses during the policy period. Erodes with each covered loss. Resets at each annual policy anniversary.',
    allowedValues: ['200000', '600000', '1000000', '2000000'], format: 'USD (whole dollars)', tags: ['aggregate', 'limit', 'gl'],
    aliases: ['General Aggregate', 'General Aggregate Limit', 'aggregate limit'],
    ...gov(),
  },
  {
    refId: 'GL.DEF.004', name: 'Products-Completed-Operations Aggregate', type: 'CURRENCY',
    description: 'A separate aggregate that caps Coverage A losses arising out of the products-completed-operations hazard — bodily injury or property damage occurring away from the insured\'s premises and arising out of the insured\'s product or completed work. Also resets each policy period.',
    allowedValues: ['200000', '600000', '1000000', '2000000'], format: 'USD (whole dollars)', tags: ['aggregate', 'products', 'pco', 'gl'],
    aliases: ['Products-Completed-Operations Aggregate', 'PCO aggregate', 'products aggregate'],
    ...gov(),
  },
  {
    refId: 'GL.DEF.005', name: 'Exposure Basis', type: 'LIST',
    description: 'The unit of measurement used to express the insured\'s volume of operations for rating purposes. Payroll (per $1,000) is used for most contracting and service operations; gross sales (per $1,000) is used for retail, restaurant, and product-manufacturing operations.',
    allowedValues: ['payroll', 'gross_sales'], format: 'Enumerated', tags: ['rating', 'exposure', 'gl'],
    aliases: ['Exposure Basis', 'exposure base', 'rating basis'],
    ...gov(),
  },
  {
    refId: 'GL.DEF.006', name: 'Claims-Made Trigger', type: 'TEXT',
    description: 'An alternative coverage trigger (not used in CG 00 01) under which coverage responds only when the claim is first made during the policy period, regardless of when the underlying injury or damage occurred. The CG 00 01 base form uses the Occurrence trigger — always read the form declarations.',
    allowedValues: [], format: 'Defined term', tags: ['trigger', 'claims-made', 'gl'],
    aliases: ['claims-made', 'claims made', 'claims-made trigger'],
    ...gov(),
  },
]

// ─── Data-driven pricing worksheet (rendered by DynamicRatingForm) ────────────
// Fields drive the GL pricing panel. GL.LD.* options are inline here so the panel
// renders without a Firestore round-trip during development.

export const GL_RATING_INPUT_SPEC: RatingInputField[] = [
  {
    key:     'classCode',
    label:   'Class code',
    kind:    'select',
    options: [
      { label: '41677 — Contractors, Residential Remodeling (payroll)', value: '41677' },
      { label: '11011 — Restaurants (gross sales)',                      value: '11011' },
      { label: '45191 — Retail Stores — NEC (gross sales)',              value: '45191' },
      { label: '61110 — Office — Clerical (payroll)',                    value: '61110' },
      { label: '16811 — Building Operations — NEC (payroll)',            value: '16811' },
    ],
  },
  { key: 'exposureThousands', label: 'Annual exposure (thousands of $)', kind: 'number', min: 1, step: 1 },
  {
    key:     'occLimit',
    label:   'Per-occurrence limit',
    kind:    'select',
    options: [
      { label: '$100,000 (base)',  value: 100000 },
      { label: '$300,000',         value: 300000 },
      { label: '$500,000',         value: 500000 },
      { label: '$1,000,000',       value: 1000000 },
    ],
  },
  {
    key:     'occDeductible',
    label:   'BI/PD deductible',
    kind:    'select',
    options: [
      { label: '$0 (none)', value: 0 },
      { label: '$500',      value: 500 },
      { label: '$1,000',    value: 1000 },
      { label: '$2,500',    value: 2500 },
    ],
  },
  { key: 'pcoElected',           label: 'Products-Completed-Operations elected', kind: 'boolean' },
  { key: 'pcoExposureThousands', label: 'PCO exposure (thousands of $)',          kind: 'number', min: 0, step: 1 },
  {
    key:     'expMod',
    label:   'Experience modification',
    kind:    'select',
    options: [
      { label: '0.75 (credit)', value: '0.75' },
      { label: '0.90 (credit)', value: '0.90' },
      { label: '1.00 (unity)',  value: '1.00' },
      { label: '1.15 (debit)', value: '1.15' },
      { label: '1.25 (debit)', value: '1.25' },
    ],
  },
]

// ─── Worked example (must produce $2,635) ─────────────────────────────────────
// Class 41677 (Contractors — Residential Remodeling), payroll basis:
//   s1 SET  GL.RT.001[41677]          = 2.50                    → 2.50
//   s2 MUL  INPUT exposureThousands   = 500                     → 2.50 × 500 = 1,250.00
//   s3 MUL  GL.RT.002[occLimit=1M]    = 1.82                    → 1,250 × 1.82 = 2,275.00
//   s4 MUL  GL.RT.003[occDed=0]       = 1.00                    → 2,275 × 1.00 = 2,275.00
//   s5 ADD  GL.RT.004[41677, pco=200] = 200 × 1.80 = 360        → 2,275 + 360 = 2,635.00
//   s6 MUL  GL.RT.005[expMod='1.00']  = 1.00                    → 2,635 × 1.00 = 2,635.00
//   s7 MIN_FLOOR 500 round 0          → max(2,635, 500) = 2,635

export const GL_WORKED_EXAMPLE: Record<string, unknown> = {
  classCode:              '41677',
  exposureThousands:      500,
  occLimit:               1000000,
  occDeductible:          0,
  pcoElected:             true,
  pcoExposureThousands:   200,
  expMod:                 '1.00',
}
