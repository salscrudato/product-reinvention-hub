// personalAuto.ts — Personal Auto seed constants (ISO-style PAP).
// All refIds use the PA.* prefix. The $1,002 canary is locked by an evaluator test.
// Rates are illustrative — not proprietary filed rates.
import type {
  Product, Coverage, LDTable, RTTable, RatingProgram, Form,
  Rule, FormRule, DictionaryEntry, RatingInputField,
} from '../types'
import type { RtGetter } from '../rating/evaluator'
import { genericRtLookup } from '../rating/rtGrid'
import { makeLdGetter } from '../rating/ldGetter'
import { PA_LOB } from '../insurance/lobRegistry'

// ─── State footprint ───────────────────────────────────────────────────────────

export const PA_FOOTPRINT_STATES = PA_LOB.footprintStates

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

const FOOTPRINT_SCOPE = { allStates: false, states: [...PA_FOOTPRINT_STATES] }

// ─── Product ─────────────────────────────────────────────────────────────────

export const PA_PRODUCT: Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:         'PA.PROD.001',
  name:          'Personal Auto Policy',
  lob:           { refId: PA_LOB.refId, name: PA_LOB.name },
  description:   'ISO-style Personal Auto Policy (PAP PP 00 01) covering liability, medical payments, uninsured/underinsured motorists, and physical damage — rated by territory, driver class and vehicle symbol.',
  marketSegment: 'Personal Lines / Automobile',
  owner:         { uid: 'seed', name: 'Product Factory Seed' },
  health:        { score: 100, findingCount: 0, updatedAt: null },
  ...FOOTPRINT_SCOPE,
  ...gov(),
}

// ─── Limits & Deductible tables (LD) ─────────────────────────────────────────

export const PA_LD_TABLES: Record<string, LDTable> = {
  'PA.LD.001': {
    name:         'Bodily Injury Liability Limits (per person / per accident)',
    defaultValue: 100000,
    rows: [
      { label: '25/50',   value: 25000,  constraintNote: 'Meets most state minimums' },
      { label: '50/100',  value: 50000 },
      { label: '100/300', value: 100000 },
      { label: '250/500', value: 250000 },
    ],
  },
  'PA.LD.002': {
    name:         'Property Damage Liability Limits',
    defaultValue: 100000,
    rows: [
      { label: '$25,000',  value: 25000,  constraintNote: 'Meets most state minimums' },
      { label: '$50,000',  value: 50000 },
      { label: '$100,000', value: 100000 },
      { label: '$300,000', value: 300000 },
    ],
  },
  'PA.LD.003': {
    name:         'Medical Payments Limits',
    defaultValue: 5000,
    rows: [
      { label: '$1,000',  value: 1000 },
      { label: '$5,000',  value: 5000 },
      { label: '$10,000', value: 10000 },
      { label: '$25,000', value: 25000 },
    ],
  },
  'PA.LD.004': {
    name:         'UM / UIM Bodily Injury Limits (per person / per accident)',
    defaultValue: 100000,
    rows: [
      { label: '25/50',   value: 25000,  constraintNote: 'Must match or be ≤ BI limit in most states' },
      { label: '50/100',  value: 50000 },
      { label: '100/300', value: 100000 },
      { label: '250/500', value: 250000 },
    ],
  },
  'PA.LD.005': {
    name:         'Collision Deductible',
    defaultValue: 500,
    rows: [
      { label: '$100', value: 100 },
      { label: '$250', value: 250 },
      { label: '$500', value: 500 },
      { label: '$1,000', value: 1000 },
    ],
  },
  'PA.LD.006': {
    name:         'Comprehensive (Other Than Collision) Deductible',
    defaultValue: 250,
    rows: [
      { label: '$100', value: 100 },
      { label: '$250', value: 250 },
      { label: '$500', value: 500 },
      { label: '$1,000', value: 1000 },
    ],
  },
}

// ─── Rating tables (RT) ───────────────────────────────────────────────────────

export const PA_RT_TABLES: Record<string, RTTable> = {
  'PA.RT.001': {
    // Territory base rate (Part A Liability annual base premium)
    name:    'Territory Base Rate',
    columns: ['territory', 'rate'],
    rows: [
      { territory: 'T001', rate: 350 },
      { territory: 'T002', rate: 400 },
      { territory: 'T003', rate: 465 },
      { territory: 'T004', rate: 510 },
      { territory: 'T005', rate: 590 },
    ],
  },

  'PA.RT.002': {
    // Driver class factor — keys the primary driver's experience / usage class
    name:    'Driver Class Factor',
    columns: ['driverClass', 'factor'],
    rows: [
      { driverClass: 'DC1', factor: 0.90 },  // preferred/mature
      { driverClass: 'DC2', factor: 1.00 },  // standard
      { driverClass: 'DC3', factor: 1.20 },  // non-standard/young
    ],
  },

  'PA.RT.003': {
    // BI/PD combined limit factor — keys the elected limit package code
    name:    'BI/PD Limit Factor',
    columns: ['biPdLimitCode', 'factor'],
    rows: [
      { biPdLimitCode: '25/50/25',    factor: 0.85 },
      { biPdLimitCode: '50/100/50',   factor: 0.93 },
      { biPdLimitCode: '100/300/100', factor: 1.00 },
      { biPdLimitCode: '250/500/250', factor: 1.14 },
    ],
  },

  'PA.RT.004': {
    // Vehicle age class factor — model year band, rounded to 2 dp after application
    name:    'Vehicle Age Factor',
    columns: ['vehicleAgeClass', 'factor'],
    rows: [
      { vehicleAgeClass: 'Economy',  factor: 0.90 },
      { vehicleAgeClass: 'Standard', factor: 1.00 },
      { vehicleAgeClass: 'Luxury',   factor: 1.15 },
    ],
  },

  'PA.RT.005': {
    // Medical Payments flat rate by territory (additive, when medPayElected)
    name:    'Medical Payments Rate by Territory',
    columns: ['territory', 'rate'],
    rows: [
      { territory: 'T001', rate: 35 },
      { territory: 'T002', rate: 42 },
      { territory: 'T003', rate: 49 },
      { territory: 'T004', rate: 55 },
      { territory: 'T005', rate: 63 },
    ],
  },

  'PA.RT.006': {
    // UM/UIM flat rate by territory (additive, when umElected)
    name:    'UM/UIM Rate by Territory',
    columns: ['territory', 'rate'],
    rows: [
      { territory: 'T001', rate: 50 },
      { territory: 'T002', rate: 62 },
      { territory: 'T003', rate: 74 },
      { territory: 'T004', rate: 83 },
      { territory: 'T005', rate: 95 },
    ],
  },

  'PA.RT.007': {
    // Collision premium by vehicle symbol × deductible (additive, when collisionElected)
    name:    'Collision Premium',
    columns: ['vehicleSymbol', 'collisionDed', 'premium'],
    rows: [
      { vehicleSymbol: 'sym10', collisionDed: 250,  premium: 380 },
      { vehicleSymbol: 'sym10', collisionDed: 500,  premium: 335 },
      { vehicleSymbol: 'sym10', collisionDed: 1000, premium: 290 },
      { vehicleSymbol: 'sym12', collisionDed: 250,  premium: 350 },
      { vehicleSymbol: 'sym12', collisionDed: 500,  premium: 306 },
      { vehicleSymbol: 'sym12', collisionDed: 1000, premium: 262 },
    ],
  },

  'PA.RT.008': {
    // Comprehensive premium by vehicle symbol × deductible (additive, when compElected)
    name:    'Comprehensive Premium',
    columns: ['vehicleSymbol', 'compDed', 'premium'],
    rows: [
      { vehicleSymbol: 'sym10', compDed: 100, premium: 205 },
      { vehicleSymbol: 'sym10', compDed: 250, premium: 172 },
      { vehicleSymbol: 'sym10', compDed: 500, premium: 145 },
      { vehicleSymbol: 'sym12', compDed: 100, premium: 182 },
      { vehicleSymbol: 'sym12', compDed: 250, premium: 154 },
      { vehicleSymbol: 'sym12', compDed: 500, premium: 128 },
    ],
  },

  'PA.RT.009': {
    // Tier factor — multiplied after all additive components
    name:    'Tier Factor',
    columns: ['tier', 'factor'],
    rows: [
      { tier: 'Preferred',     factor: 0.90 },
      { tier: 'Standard',      factor: 1.00 },
      { tier: 'Non-Standard',  factor: 1.20 },
    ],
  },

  'PA.RT.010': {
    // Rental reimbursement flat annual rate (additive, when rentalElected)
    name:    'Rental Reimbursement Rate',
    columns: ['rentalCode', 'rate'],
    rows: [
      { rentalCode: '$20_600',  rate: 24 },
      { rentalCode: '$30_900',  rate: 38 },
      { rentalCode: '$40_1200', rate: 52 },
    ],
  },

  'PA.RT.011': {
    // Towing and labor flat annual rate (additive, when towingElected)
    name:    'Towing and Labor Rate',
    columns: ['towingLimit', 'rate'],
    rows: [
      { towingLimit: 50,  rate: 10 },
      { towingLimit: 100, rate: 15 },
      { towingLimit: 200, rate: 22 },
    ],
  },
}

// ─── RT getter (Personal Auto — PA.RAT.1 steps) ───────────────────────────────

export function makePARtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, q: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)

    // Grid-managed tables resolve through the generic N-D lookup; null for all seeded
    // tables (no `dimensions`), so the bespoke lookups below are untouched.
    const generic = genericRtLookup(t, q)
    if (generic !== null) return generic

    const rows = t.rows

    switch (tableRef) {
      case 'PA.RT.001': {
        const r = rows.find(r => r['territory'] === q['territory'])
        if (!r) throw new Error(`PA.RT.001: no row for territory=${q['territory']}`)
        return r['rate'] as number
      }
      case 'PA.RT.002': {
        const r = rows.find(r => r['driverClass'] === q['driverClass'])
        if (!r) throw new Error(`PA.RT.002: no row for driverClass=${q['driverClass']}`)
        return r['factor'] as number
      }
      case 'PA.RT.003': {
        const r = rows.find(r => r['biPdLimitCode'] === q['biPdLimitCode'])
        if (!r) throw new Error(`PA.RT.003: no row for biPdLimitCode=${q['biPdLimitCode']}`)
        return r['factor'] as number
      }
      case 'PA.RT.004': {
        const r = rows.find(r => r['vehicleAgeClass'] === q['vehicleAgeClass'])
        if (!r) throw new Error(`PA.RT.004: no row for vehicleAgeClass=${q['vehicleAgeClass']}`)
        return r['factor'] as number
      }
      case 'PA.RT.005': {
        const r = rows.find(r => r['territory'] === q['territory'])
        if (!r) throw new Error(`PA.RT.005: no row for territory=${q['territory']}`)
        return r['rate'] as number
      }
      case 'PA.RT.006': {
        const r = rows.find(r => r['territory'] === q['territory'])
        if (!r) throw new Error(`PA.RT.006: no row for territory=${q['territory']}`)
        return r['rate'] as number
      }
      case 'PA.RT.007': {
        const r = rows.find(r =>
          r['vehicleSymbol'] === q['vehicleSymbol'] && r['collisionDed'] === q['collisionDed'])
        if (!r) throw new Error(`PA.RT.007: no row for symbol=${q['vehicleSymbol']} ded=${q['collisionDed']}`)
        return r['premium'] as number
      }
      case 'PA.RT.008': {
        const r = rows.find(r =>
          r['vehicleSymbol'] === q['vehicleSymbol'] && r['compDed'] === q['compDed'])
        if (!r) throw new Error(`PA.RT.008: no row for symbol=${q['vehicleSymbol']} ded=${q['compDed']}`)
        return r['premium'] as number
      }
      case 'PA.RT.009': {
        const r = rows.find(r => r['tier'] === q['tier'])
        if (!r) throw new Error(`PA.RT.009: no row for tier=${q['tier']}`)
        return r['factor'] as number
      }
      case 'PA.RT.010': {
        const r = rows.find(r => r['rentalCode'] === q['rentalCode'])
        if (!r) throw new Error(`PA.RT.010: no row for rentalCode=${q['rentalCode']}`)
        return r['rate'] as number
      }
      case 'PA.RT.011': {
        const r = rows.find(r => r['towingLimit'] === q['towingLimit'])
        if (!r) throw new Error(`PA.RT.011: no row for towingLimit=${q['towingLimit']}`)
        return r['rate'] as number
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`)
    }
  }
}

// LD-source getter. PA routes limit/deductible selections in as numeric INPUTs, so no PA.RAT.1
// step uses an LD source today; the shared getter is wired (not a throwing stub) so a PM-authored
// LD step still evaluates correctly. See rating/ldGetter.ts (D6).
export const makePALdGetter = makeLdGetter

// ─── Rating program (PA.RAT.1 — 11 logical steps, 12 executable steps) ─────────
// Territory base → driver class → limit factor → vehicle age → med pay (conditional)
// → UM/UIM (conditional) → collision (conditional) → comp (conditional)
// → tier factor → rental (conditional) → towing (conditional) → minimum floor.
// Canary: T002/DC2/100-300-100/Standard/medPay/UM/sym12-$500/sym12-$250/Standard/rental → $1,002.

// Single source of truth for the Personal Auto minimum premium. The `minimumPremium` field
// (displayed on the pricing card + fed to AI context) and the s11 MIN_FLOOR step BOTH read this
// one constant, so the declared floor and the applied floor can never desync (D3: one mechanism).
const PA_MINIMUM_PREMIUM = 250

export const PA_RATING_PROGRAM: Omit<RatingProgram, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:          'PA.RAT.1',
  name:           'Personal Auto Policy Rating Program',
  minimumPremium: PA_MINIMUM_PREMIUM,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    // s1: Territory base rate (SET)
    { id: 's1',  order: 1,  label: 'Territory base rate',                op: 'SET',       source: { type: 'RT', ref: 'PA.RT.001', keys: ['territory'] } },
    // s2: Driver class factor (MUL)
    { id: 's2',  order: 2,  label: 'Driver class factor',                op: 'MUL',       source: { type: 'RT', ref: 'PA.RT.002', keys: ['driverClass'] } },
    // s3: BI/PD limit factor (MUL)
    { id: 's3',  order: 3,  label: 'BI/PD limit factor',                 op: 'MUL',       source: { type: 'RT', ref: 'PA.RT.003', keys: ['biPdLimitCode'] } },
    // s4: Vehicle age factor (MUL), round to ¢ to stabilise floating point
    { id: 's4',  order: 4,  label: 'Vehicle age factor',                 op: 'MUL',       source: { type: 'RT', ref: 'PA.RT.004', keys: ['vehicleAgeClass'] }, roundTo: 2 },
    // s5: Medical Payments flat rate (ADD, conditional)
    { id: 's5',  order: 5,  label: 'Medical Payments premium',           op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.005', keys: ['territory'] },        condition: 'medPayElected' },
    // s6: UM/UIM flat rate (ADD, conditional)
    { id: 's6',  order: 6,  label: 'UM/UIM premium',                     op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.006', keys: ['territory'] },        condition: 'umElected' },
    // s7: Collision premium (ADD, conditional)
    { id: 's7',  order: 7,  label: 'Collision premium',                  op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.007', keys: ['vehicleSymbol', 'collisionDed'] }, condition: 'collisionElected' },
    // s8: Comprehensive premium (ADD, conditional)
    { id: 's8',  order: 8,  label: 'Comprehensive premium',              op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.008', keys: ['vehicleSymbol', 'compDed'] },       condition: 'compElected' },
    // s9: Tier factor (MUL — applies to the full running total)
    { id: 's9',  order: 9,  label: 'Tier factor',                        op: 'MUL',       source: { type: 'RT', ref: 'PA.RT.009', keys: ['tier'] } },
    // s10a: Rental reimbursement flat rate (ADD, conditional)
    { id: 's10a',order: 10, label: 'Rental reimbursement premium',       op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.010', keys: ['rentalCode'] },       condition: 'rentalElected' },
    // s10b: Towing and labor flat rate (ADD, conditional)
    { id: 's10b',order: 11, label: 'Towing and labor premium',           op: 'ADD',       source: { type: 'RT', ref: 'PA.RT.011', keys: ['towingLimit'] },      condition: 'towingElected' },
    // s11: Minimum premium floor; round to $
    { id: 's11', order: 12, label: `Apply minimum premium ($${PA_MINIMUM_PREMIUM})`, op: 'MIN_FLOOR', source: { type: 'CONST', value: PA_MINIMUM_PREMIUM },             roundTo: 0 },
  ],
}

// ─── Coverages ────────────────────────────────────────────────────────────────

type CoverageSeed = Omit<Coverage, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const PA_COVERAGES: CoverageSeed[] = [
  // ── Part A — Liability ────────────────────────────────────────────────────
  {
    refId: 'PA.COV.001', name: 'Part A — Liability Coverage',
    parentId: null, order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'bipd-limit-code', kind: 'OPTION', label: 'BI/PD Limit Package',
      basis: 'per person/per accident/per occurrence', default: '100/300/100',
      notes: 'Combined per-person BI / per-accident BI / per-occurrence PD limit code used as the rating key (PA.RT.003).' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.001.001', name: 'Bodily Injury Liability',
    parentId: 'PA.COV.001', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'bi-limit', kind: 'LIMIT', label: 'Bodily Injury Per Person / Per Accident', basis: 'per person per accident', ldTableRef: 'PA.LD.001', default: 100000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.001.002', name: 'Property Damage Liability',
    parentId: 'PA.COV.001', order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'pd-limit', kind: 'LIMIT', label: 'Property Damage Per Occurrence', basis: 'per occurrence', ldTableRef: 'PA.LD.002', default: 100000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Part B — Medical Payments ─────────────────────────────────────────────
  {
    refId: 'PA.COV.002', name: 'Part B — Medical Payments Coverage',
    parentId: null, order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'medpay-limit', kind: 'LIMIT', label: 'Medical Payments Limit (any one person)', basis: 'per person', ldTableRef: 'PA.LD.003', default: 5000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Part C — Uninsured / Underinsured Motorists ───────────────────────────
  {
    refId: 'PA.COV.003', name: 'Part C — Uninsured Motorists Coverage',
    parentId: null, order: 3, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'um-limit', kind: 'LIMIT', label: 'UM/UIM Limit Per Person / Per Accident', basis: 'per person per accident', ldTableRef: 'PA.LD.004', default: 100000, unit: 'dollars',
      constraintNote: 'Must match or be ≤ Bodily Injury limit (most states)' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.003.001', name: 'Uninsured Motorist Bodily Injury',
    parentId: 'PA.COV.003', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'um-bi-limit', kind: 'LIMIT', label: 'UM Bodily Injury Limit', basis: 'per person per accident', default: 'Matches Part C limit', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.003.002', name: 'Underinsured Motorist Bodily Injury',
    parentId: 'PA.COV.003', order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'uim-bi-limit', kind: 'LIMIT', label: 'UIM Bodily Injury Limit', basis: 'per person per accident', default: 'Matches Part C limit', unit: 'dollars',
      constraintNote: 'UIM limit may not exceed BI limit (PA.RU.007)' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Part D — Damage to Your Auto ─────────────────────────────────────────
  {
    refId: 'PA.COV.004', name: 'Part D — Coverage for Damage to Your Auto',
    parentId: null, order: 4, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'part-d-note', kind: 'OPTION', label: 'Physical damage coverage elected', basis: 'flag', default: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.004.001', name: 'Collision Coverage',
    parentId: 'PA.COV.004', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'collision-ded', kind: 'DEDUCTIBLE', label: 'Collision Deductible', basis: 'per occurrence', ldTableRef: 'PA.LD.005', default: 500, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.004.002', name: 'Other Than Collision (Comprehensive)',
    parentId: 'PA.COV.004', order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 00 01'],
    terms: [{ id: 'comp-ded', kind: 'DEDUCTIBLE', label: 'Comprehensive Deductible', basis: 'per occurrence', ldTableRef: 'PA.LD.006', default: 250, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.004.003', name: 'Rental Reimbursement',
    parentId: 'PA.COV.004', order: 3, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 13 01'],
    terms: [{ id: 'rental-elected', kind: 'OPTION', label: 'Rental reimbursement elected', basis: 'flag', default: false,
      notes: 'Rental code keys daily/max limit ($20/$600, $30/$900, $40/$1,200).' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'PA.COV.004.004', name: 'Towing and Labor Costs',
    parentId: 'PA.COV.004', order: 4, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['PP 03 28'],
    terms: [{ id: 'towing-elected', kind: 'OPTION', label: 'Towing and labor elected', basis: 'flag', default: false,
      notes: 'Towing limit: $50, $100, or $200 per disablement.' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Forms (PP-series) ────────────────────────────────────────────────────────

type FormSeed = Omit<Form, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

const PA_PARTS = [
  'Part A — Liability Coverage',
  'Part B — Medical Payments Coverage',
  'Part C — Uninsured Motorists Coverage',
  'Part D — Coverage for Damage to Your Auto',
]

export const PA_FORMS: FormSeed[] = [
  {
    number: 'PP 00 01', edition: '01 05',
    name: 'Personal Auto Policy', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: PA_PARTS,
    productRefIds: ['PA.PROD.001'],
    description: 'Base Personal Auto Policy form covering liability, medical payments, uninsured/underinsured motorists and physical damage to your auto on an occurrence basis.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP DS 01', edition: '01 05',
    name: 'Personal Auto Policy Declarations', category: 'DECLARATIONS',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['PA.PROD.001'],
    description: 'Declarations page listing named insured, vehicle schedule, coverage selections, limits, deductibles and total premium.',
    dynamicFields: [
      { name: 'NamedInsured',     dataType: 'TEXT',     repeating: false },
      { name: 'PolicyAddress',    dataType: 'TEXT',     repeating: false },
      { name: 'VehicleYear',      dataType: 'TEXT',     repeating: true  },
      { name: 'VehicleMake',      dataType: 'TEXT',     repeating: true  },
      { name: 'VehicleModel',     dataType: 'TEXT',     repeating: true  },
      { name: 'VIN',              dataType: 'TEXT',     repeating: true  },
      { name: 'PolicyEffective',  dataType: 'DATE',     repeating: false },
      { name: 'PolicyExpiration', dataType: 'DATE',     repeating: false },
      { name: 'TotalPremium',     dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 13 01', edition: '01 05',
    name: 'Extended Transportation Expenses (Rental Reimbursement)', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part D — Coverage for Damage to Your Auto'],
    productRefIds: ['PA.PROD.001'],
    description: 'Provides rental reimbursement and transportation expenses when a covered auto is disabled by a covered loss. Daily and maximum limits apply.',
    dynamicFields: [
      { name: 'DailyLimit', dataType: 'CURRENCY', repeating: false },
      { name: 'MaxLimit',   dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 03 28', edition: '01 05',
    name: 'Towing and Labor Costs Coverage', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part D — Coverage for Damage to Your Auto'],
    productRefIds: ['PA.PROD.001'],
    description: 'Covers towing and labor costs each time a covered auto is disabled, up to the selected per-disablement limit.',
    dynamicFields: [{ name: 'TowingLimit', dataType: 'CURRENCY', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 04 46', edition: '01 05',
    name: 'Loan or Lease Gap Coverage', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part D — Coverage for Damage to Your Auto'],
    productRefIds: ['PA.PROD.001'],
    description: 'Pays the difference between the actual cash value of a totaled covered auto and the outstanding loan or lease balance.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 04 04', edition: '01 05',
    name: 'Driver Exclusion Endorsement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: true,
    transactions: [], coverageParts: ['Part A — Liability Coverage'],
    productRefIds: ['PA.PROD.001'],
    description: 'Excludes a named individual from all coverages under the policy; losses caused while that person is operating any covered auto are not covered.',
    dynamicFields: [
      { name: 'ExcludedDriverName', dataType: 'TEXT', repeating: true },
      { name: 'LicenseNumber',      dataType: 'TEXT', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 03 05', edition: '01 05',
    name: 'Extended Non-Owned Coverage — Vehicles Furnished or Available for Regular Use', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part A — Liability Coverage', 'Part B — Medical Payments Coverage'],
    productRefIds: ['PA.PROD.001'],
    description: 'Extends liability and medical payments coverage to a non-owned vehicle furnished for the regular use of the named insured or a family member.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 03 01', edition: '01 05',
    name: 'Named Non-Owner Coverage Endorsement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part A — Liability Coverage', 'Part B — Medical Payments Coverage'],
    productRefIds: ['PA.PROD.001'],
    description: 'Provides liability and medical payments coverage to individuals who do not own a vehicle but regularly drive non-owned autos.',
    dynamicFields: [{ name: 'NamedNonOwner', dataType: 'TEXT', repeating: true }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 04 02', edition: '01 05',
    name: 'Excess Electronic Equipment Coverage', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Part D — Coverage for Damage to Your Auto'],
    productRefIds: ['PA.PROD.001'],
    description: 'Extends coverage for electronic equipment installed in the covered auto beyond the standard policy limit.',
    dynamicFields: [{ name: 'EquipmentLimit', dataType: 'CURRENCY', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'PP 01 75', edition: '01 05',
    name: 'Special Provisions — California', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['PA.PROD.001'],
    description: 'Modifies the Personal Auto Policy to comply with California Insurance Code and Department of Insurance regulations.',
    dynamicFields: [],
    allStates: false, states: ['CA'], ...gov(),
  },
  {
    number: 'PP 01 79', edition: '01 05',
    name: 'Special Provisions — Texas', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['PA.PROD.001'],
    description: 'Modifies the Personal Auto Policy to comply with Texas Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['TX'], ...gov(),
  },
  {
    number: 'PN PP 01', edition: '01 05',
    name: 'Personal Auto Policy Notice — Important Information', category: 'POLICY_NOTICE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['PA.PROD.001'],
    description: 'Required notice providing policyholders with important information about rights, obligations, and claims procedures.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Product rules ────────────────────────────────────────────────────────────

type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const PA_RULES: RuleSeed[] = [
  { refId: 'PA.RU.001', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'Personal passenger automobile, motorcycle, or light truck — personal use',
    outcome: 'Eligible for Personal Auto Policy (PP 00 01)',
    coverageRefIds: [], formNumbers: ['PP 00 01'], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.002', category: 'PRODUCT', subCategory: 'Mandatory Coverage',
    condition: 'Personal Auto Policy selected',
    outcome: 'Part A — Liability (BI + PD) is mandatory; both sub-coverages must be present',
    coverageRefIds: ['PA.COV.001', 'PA.COV.001.001', 'PA.COV.001.002'], formNumbers: ['PP 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.003', category: 'PRODUCT', subCategory: 'Limit Ranges',
    condition: 'Bodily Injury limit selection',
    outcome: 'Options per PA.LD.001; default 100/300 per person/per accident',
    ldTableRef: 'PA.LD.001', coverageRefIds: ['PA.COV.001.001'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.004', category: 'PRODUCT', subCategory: 'Limit Ranges',
    condition: 'Property Damage limit selection',
    outcome: 'Options per PA.LD.002; default $100,000 per occurrence',
    ldTableRef: 'PA.LD.002', coverageRefIds: ['PA.COV.001.002'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.005', category: 'PRODUCT', subCategory: 'Optional Coverage',
    condition: 'Medical Payments coverage elected',
    outcome: 'Part B elected; limit options per PA.LD.003; attach per PP 00 01',
    ldTableRef: 'PA.LD.003', coverageRefIds: ['PA.COV.002'], formNumbers: ['PP 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.006', category: 'PRODUCT', subCategory: 'Optional Coverage',
    condition: 'Part A Liability is elected',
    outcome: 'UM/UIM (Part C) is available and strongly recommended; required unless waived in writing in most states',
    ldTableRef: 'PA.LD.004', coverageRefIds: ['PA.COV.003'], formNumbers: ['PP 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.007', category: 'PRODUCT', subCategory: 'Coverage Constraints',
    condition: 'UIM limits selected',
    outcome: 'UIM limit may not exceed BI limit per occurrence',
    coverageRefIds: ['PA.COV.001.001', 'PA.COV.003.002'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.008', category: 'PRODUCT', subCategory: 'Coverage Constraints',
    condition: 'Rental Reimbursement (PA.COV.004.003) elected',
    outcome: 'Requires physical damage coverage (Collision or Comprehensive) to be in force',
    coverageRefIds: ['PA.COV.004.001', 'PA.COV.004.002', 'PA.COV.004.003'], formNumbers: ['PP 13 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.009', category: 'PRODUCT', subCategory: 'Coverage Constraints',
    condition: 'Towing and Labor (PA.COV.004.004) elected',
    outcome: 'Requires physical damage coverage (Collision or Comprehensive) to be in force',
    coverageRefIds: ['PA.COV.004.001', 'PA.COV.004.002', 'PA.COV.004.004'], formNumbers: ['PP 03 28'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'PA.RU.010', category: 'RATING', subCategory: 'Premium Floor',
    condition: 'Calculated premium',
    outcome: 'Minimum policy premium $250 (PA.RAT.1 step 11)',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
]

// ─── Form attachment rules ────────────────────────────────────────────────────

type FormRuleSeed = Omit<FormRule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const PA_FORM_RULES: FormRuleSeed[] = [
  { refId: 'PA.FORM.RU.001', condition: 'Rental Reimbursement elected', outcome: 'Attach PP 13 01', formNumbers: ['PP 13 01'], mandatory: true, ...gov() },
  { refId: 'PA.FORM.RU.002', condition: 'Towing and Labor elected',     outcome: 'Attach PP 03 28', formNumbers: ['PP 03 28'], mandatory: true, ...gov() },
  { refId: 'PA.FORM.RU.003', condition: 'Loan/Lease Gap elected',       outcome: 'Attach PP 04 46', formNumbers: ['PP 04 46'], mandatory: true, ...gov() },
  { refId: 'PA.FORM.RU.004', condition: 'Named Non-Owner coverage',     outcome: 'Attach PP 03 01', formNumbers: ['PP 03 01'], mandatory: true, ...gov() },
  { refId: 'PA.FORM.RU.005', condition: 'Driver exclusion required',    outcome: 'Attach PP 04 04', formNumbers: ['PP 04 04'], mandatory: true, ...gov() },
  { refId: 'PA.FORM.RU.006', condition: 'Risk state = CA',              outcome: 'Attach PP 01 75; TX → PP 01 79', formNumbers: ['PP 01 75', 'PP 01 79'], mandatory: true, ...gov() },
]

// ─── Dictionary ───────────────────────────────────────────────────────────────

type DictSeed = Omit<DictionaryEntry, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const PA_DICTIONARY: DictSeed[] = [
  { refId: 'PA.DEF.001', name: 'Territory (Auto)', type: 'LIST',
    description: 'Rating territory assigned to the garaging location of the insured vehicle; keys the territory base rate and med pay/UM rates.',
    allowedValues: ['T001','T002','T003','T004','T005'], format: 'T0NN', tags: ['rating'],
    aliases: ['Territory Code', 'rating territory', 'garaging territory'], ...gov() },
  { refId: 'PA.DEF.002', name: 'Driver Class', type: 'LIST',
    description: 'ISO driver classification combining age, marital status, and use; keys the driver class factor (PA.RT.002).',
    allowedValues: ['DC1','DC2','DC3'], format: 'DC[1-3]', tags: ['rating','underwriting'],
    aliases: ['Driver Class', 'driverClass', 'driver classification'], ...gov() },
  { refId: 'PA.DEF.003', name: 'Vehicle Symbol', type: 'LIST',
    description: 'ISO vehicle symbol reflecting cost new, age, and loss experience; keys physical damage premium tables.',
    allowedValues: ['sym10','sym12'], format: 'sym[NN]', tags: ['rating','vehicle'],
    aliases: ['Vehicle Symbol', 'vehicleSymbol', 'ISO symbol'], ...gov() },
  { refId: 'PA.DEF.004', name: 'Bodily Injury Limit', type: 'CURRENCY',
    description: 'Per-person and per-accident limits for Part A Bodily Injury Liability.',
    allowedValues: ['25/50','50/100','100/300','250/500'], format: 'per person / per accident ($000s)', tags: ['limit','rating'],
    aliases: ['Bodily Injury Limit', 'BI limit', 'bi-limit'], ...gov() },
  { refId: 'PA.DEF.005', name: 'Property Damage Limit', type: 'CURRENCY',
    description: 'Per-occurrence limit for Part A Property Damage Liability.',
    allowedValues: ['25000','50000','100000','300000'], format: 'USD (whole dollars)', tags: ['limit','rating'],
    aliases: ['Property Damage Limit', 'PD limit', 'pd-limit'], ...gov() },
  { refId: 'PA.DEF.006', name: 'Collision Deductible', type: 'CURRENCY',
    description: 'Per-occurrence deductible for Part D Collision coverage.',
    allowedValues: ['100','250','500','1000'], format: 'USD (whole dollars)', tags: ['deductible','rating'],
    aliases: ['Collision Deductible', 'collisionDed'], ...gov() },
  { refId: 'PA.DEF.007', name: 'Comprehensive Deductible', type: 'CURRENCY',
    description: 'Per-occurrence deductible for Part D Other Than Collision (Comprehensive) coverage.',
    allowedValues: ['100','250','500','1000'], format: 'USD (whole dollars)', tags: ['deductible','rating'],
    aliases: ['Comprehensive Deductible', 'compDed', 'OTC deductible'], ...gov() },
  { refId: 'PA.DEF.008', name: 'Effective Date (Auto)', type: 'DATE',
    description: 'Date the auto policy period begins.',
    allowedValues: [], format: 'YYYY-MM-DD', tags: ['policy','declarations'],
    aliases: ['PolicyEffective', 'effective date'], ...gov() },
]

// ─── Data-driven pricing worksheet (rendered by GenericRatingPanel) ───────────

export const PA_RATING_INPUT_SPEC: RatingInputField[] = [
  { key: 'territory',       label: 'Territory',              kind: 'select',  options: [{ label: 'T001', value: 'T001' }, { label: 'T002', value: 'T002' }, { label: 'T003', value: 'T003' }, { label: 'T004', value: 'T004' }, { label: 'T005', value: 'T005' }] },
  { key: 'driverClass',     label: 'Driver class',           kind: 'select',  options: [{ label: 'DC1 — Preferred', value: 'DC1' }, { label: 'DC2 — Standard', value: 'DC2' }, { label: 'DC3 — Non-Standard', value: 'DC3' }] },
  { key: 'biPdLimitCode',   label: 'BI/PD limit package',   kind: 'select',  options: [{ label: '25/50/25',    value: '25/50/25' }, { label: '50/100/50',   value: '50/100/50' }, { label: '100/300/100', value: '100/300/100' }, { label: '250/500/250', value: '250/500/250' }] },
  { key: 'vehicleAgeClass', label: 'Vehicle age class',      kind: 'select',  options: [{ label: 'Economy', value: 'Economy' }, { label: 'Standard', value: 'Standard' }, { label: 'Luxury', value: 'Luxury' }] },
  { key: 'vehicleSymbol',   label: 'Vehicle symbol',         kind: 'select',  options: [{ label: 'sym10', value: 'sym10' }, { label: 'sym12', value: 'sym12' }] },
  { key: 'tier',            label: 'Tier',                   kind: 'select',  options: [{ label: 'Preferred', value: 'Preferred' }, { label: 'Standard', value: 'Standard' }, { label: 'Non-Standard', value: 'Non-Standard' }] },
  { key: 'medPayElected',   label: 'Medical Payments (Part B)', kind: 'boolean' },
  { key: 'umElected',       label: 'UM/UIM (Part C)',        kind: 'boolean' },
  { key: 'collisionElected',label: 'Collision',              kind: 'boolean' },
  { key: 'collisionDed',    label: 'Collision deductible',   kind: 'select',  ldTableRef: 'PA.LD.005' },
  { key: 'compElected',     label: 'Comprehensive',          kind: 'boolean' },
  { key: 'compDed',         label: 'Comprehensive deductible', kind: 'select', ldTableRef: 'PA.LD.006' },
  { key: 'rentalElected',   label: 'Rental reimbursement',   kind: 'boolean' },
  { key: 'rentalCode',      label: 'Rental limit',           kind: 'select',  options: [{ label: '$20/day, $600 max', value: '$20_600' }, { label: '$30/day, $900 max', value: '$30_900' }, { label: '$40/day, $1,200 max', value: '$40_1200' }] },
  { key: 'towingElected',   label: 'Towing and labor',       kind: 'boolean' },
  { key: 'towingLimit',     label: 'Towing limit',           kind: 'select',  options: [{ label: '$50', value: 50 }, { label: '$100', value: 100 }, { label: '$200', value: 200 }] },
]

// ─── Worked example (must produce $1,002) ────────────────────────────────────
// s1: SET  PA.RT.001[T002]              = 400    → 400.00
// s2: MUL  PA.RT.002[DC2]              = 1.00   → 400.00
// s3: MUL  PA.RT.003[100/300/100]      = 1.00   → 400.00
// s4: MUL  PA.RT.004[Standard], r2     = 1.00   → 400.00
// s5: ADD  PA.RT.005[T002] (medPay)    = 42     → 442.00
// s6: ADD  PA.RT.006[T002] (um)        = 62     → 504.00
// s7: ADD  PA.RT.007[sym12,$500] (col) = 306    → 810.00
// s8: ADD  PA.RT.008[sym12,$250] (comp)= 154    → 964.00
// s9: MUL  PA.RT.009[Standard]         = 1.00   → 964.00
// s10a ADD PA.RT.010[$30_900] (rental) = 38     → 1002.00
// s10b ADD SKIPPED (towingElected=false)
// s11: MIN_FLOOR CONST 250, r0         → max(1002,250) = 1002

export const PA_WORKED_EXAMPLE = {
  territory:        'T002',
  driverClass:      'DC2',
  biPdLimitCode:    '100/300/100',
  vehicleAgeClass:  'Standard',
  vehicleSymbol:    'sym12',
  tier:             'Standard',
  medPayElected:    true,
  umElected:        true,
  collisionElected: true,
  collisionDed:     500,
  compElected:      true,
  compDed:          250,
  rentalElected:    true,
  rentalCode:       '$30_900',
  towingElected:    false,
  towingLimit:      100,
}
