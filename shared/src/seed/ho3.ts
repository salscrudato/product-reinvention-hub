// HO-3 seed constants — the canonical HO-3 domain reference (coverages, forms, rating).
// Every refId, rate, factor and form number here is the traceability backbone.
// The seed script reads these and writes them to Firestore; tests assert against them.
import type {
  Product, Coverage, LDTable, RTTable, RatingProgram, Form,
  Rule, FormRule, DictionaryEntry, TaskTemplate, Feedback, User, RatingInputs,
} from '../types'
import { HO_LOB } from '../insurance/lobRegistry'

// ─── State sets ──────────────────────────────────────────────────────────────

// Footprint and coastal wind/hail eligibility are line-level facts owned by the LOB
// registry (single source of truth); the seed re-exports the footprint for convenience.
export const HO3_FOOTPRINT_STATES = HO_LOB.footprintStates

// Section identifiers for form coverageParts — derived from the HO LOB taxonomy so
// no 'Section I / Section II' string is hard-coded outside the registry.
const SEC_I  = HO_LOB.sections[0]!.shortName   // 'Section I'
const SEC_II = HO_LOB.sections[1]!.shortName   // 'Section II'

// Coastal constraint note for HO.LD.004 and HO.RU.008 — built from the LOB's
// peril definition so the coastal state list is owned by the registry alone.
const COASTAL_CONSTRAINT_NOTE =
  `Coastal states only (${HO_LOB.peril.eligibleStates.join(' ')}); dollar amount must be ≥ all-peril deductible`
const COASTAL_RULE_OUTCOME =
  `Coastal states only (${HO_LOB.peril.eligibleStates.join(' ')}); dollar amount ≥ all-peril deductible`

// ─── Governance helper ───────────────────────────────────────────────────────

// createdAt/updatedAt are null here; the seed script replaces them with FieldValue.serverTimestamp()
function gov(overrides: { lifecycle?: Product['lifecycle']; status?: Product['status'] } = {}) {
  return {
    status:       (overrides.status       ?? 'ACTIVE') as Product['status'],
    lifecycle:    (overrides.lifecycle    ?? 'LAUNCHED') as Product['lifecycle'],
    reviewStatus: 'APPROVED'                              as Product['reviewStatus'],
    reviewer:     'system',
    createdAt:    null,
    updatedAt:    null,
    updatedBy:    'seed',
    rev:          1,
  }
}

const FOOTPRINT_SCOPE = { allStates: false, states: [...HO3_FOOTPRINT_STATES] }
const COASTAL_SCOPE   = { allStates: false, states: [...HO_LOB.peril.eligibleStates] }

// ─── Product ─────────────────────────────────────────────────────────────────

export const HO3_PRODUCT: Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:         'HO.PROD.001',
  name:          'Homeowners — HO-3 Special Form',
  lob:           { refId: HO_LOB.refId, name: HO_LOB.name },
  description:   'ISO-style Special Form homeowners policy covering dwelling, personal property, liability and medical payments on an open-peril basis.',
  marketSegment: 'Personal Lines / Property',
  owner:         { uid: 'seed', name: 'Product Factory Seed' },
  health:        { score: 100, findingCount: 0, updatedAt: null },
  ...FOOTPRINT_SCOPE,
  ...gov(),
}

// ─── Limits & Deductible tables ───────────────────────────────────────────────

export const HO3_LD_TABLES: Record<string, LDTable> = {
  'HO.LD.001': {
    name:         'Coverage E — Personal Liability Limits',
    defaultValue: 300000,
    rows: [
      { label: '$100,000', value: 100000 },
      { label: '$300,000', value: 300000 },
      { label: '$500,000', value: 500000 },
    ],
  },
  'HO.LD.002': {
    name:         'Coverage F — Medical Payments Limits',
    defaultValue: 1000,
    rows: [
      { label: '$1,000',  value: 1000 },
      { label: '$2,000',  value: 2000 },
      { label: '$5,000',  value: 5000, constraintNote: 'Available only when Coverage E ≥ 300,000' },
    ],
  },
  'HO.LD.003': {
    name:         'All-Peril Deductible',
    defaultValue: 1000,
    rows: [
      { label: '$500',   value: 500 },
      { label: '$1,000', value: 1000 },
      { label: '$2,500', value: 2500 },
      { label: '$5,000', value: 5000 },
    ],
  },
  'HO.LD.004': {
    name: 'Wind/Hail Percentage Deductible',
    rows: [
      { label: '1%', value: 1, constraintNote: COASTAL_CONSTRAINT_NOTE },
      { label: '2%', value: 2, constraintNote: COASTAL_CONSTRAINT_NOTE },
      { label: '5%', value: 5, constraintNote: COASTAL_CONSTRAINT_NOTE },
    ],
  },
  'HO.LD.005': {
    name:         'Coverage C — Personal Property % of Coverage A',
    defaultValue: 50,
    rows: [
      { label: '50%', value: 50 },
      { label: '70%', value: 70 },
      { label: '75%', value: 75 },
    ],
  },
  'HO.LD.006': {
    name:         'Water Back-Up & Sump Overflow Limit',
    defaultValue: 5000,
    rows: [
      { label: '$5,000',  value: 5000 },
      { label: '$10,000', value: 10000 },
      { label: '$25,000', value: 25000 },
    ],
  },
}

// ─── Rating tables ────────────────────────────────────────────────────────────

export const HO3_RT_TABLES: Record<string, RTTable> = {
  'HO.RT.001': {
    name:    'Territory Base Rate',
    columns: ['territory', 'rate'],
    rows: [
      { territory: 'T001', rate: 640 },
      { territory: 'T002', rate: 700 },
      { territory: 'T003', rate: 815 },
      { territory: 'T004', rate: 905 },
      { territory: 'T005', rate: 1040 },
    ],
  },

  'HO.RT.002': {
    name:    'Protection Class × Construction Factor',
    // pcMin/pcMax define the PC range; F = Frame, M = Masonry
    columns: ['pcMin', 'pcMax', 'F', 'M'],
    rows: [
      { pcMin: 1, pcMax: 3,  F: 0.95, M: 0.90 },
      { pcMin: 4, pcMax: 6,  F: 1.10, M: 1.05 },
      { pcMin: 7, pcMax: 8,  F: 1.30, M: 1.20 },
      { pcMin: 9, pcMax: 10, F: 1.55, M: 1.45 },
    ],
  },

  'HO.RT.003': {
    // Exact lookup; covA > 600,000 extrapolates at +0.32 per additional 100k [DOMAIN_HO.md]
    name:    'Coverage A Key Factor',
    columns: ['covA', 'factor'],
    rows: [
      { covA: 200000, factor: 0.80 },
      { covA: 250000, factor: 0.90 },
      { covA: 300000, factor: 1.00 },
      { covA: 350000, factor: 1.14 },
      { covA: 400000, factor: 1.30 },
      { covA: 500000, factor: 1.62 },
      { covA: 600000, factor: 1.94 },
    ],
  },

  'HO.RT.004': {
    // subTable field distinguishes all-peril rows from wind/hail rows
    name:    'Deductible Factors',
    columns: ['subTable', 'key', 'factor'],
    rows: [
      { subTable: 'allPeril', key: 500,   factor: 1.10 },
      { subTable: 'allPeril', key: 1000,  factor: 1.00 },
      { subTable: 'allPeril', key: 2500,  factor: 0.88 },
      { subTable: 'allPeril', key: 5000,  factor: 0.76 },
      { subTable: 'windHail', key: 1,     factor: 0.97 },
      { subTable: 'windHail', key: 2,     factor: 0.94 },
      { subTable: 'windHail', key: 5,     factor: 0.89 },
    ],
  },

  'HO.RT.005': {
    name:    'Coverage C Percentage Factor',
    columns: ['covCPct', 'factor'],
    rows: [
      { covCPct: 50, factor: 1.00 },
      { covCPct: 70, factor: 1.06 },
      { covCPct: 75, factor: 1.09 },
    ],
  },

  'HO.RT.006': {
    // limType "E" | "F" distinguishes Coverage E rows from Coverage F rows
    name:    'Liability Increased-Limit Charges ($)',
    columns: ['limType', 'limit', 'charge'],
    rows: [
      { limType: 'E', limit: 100000, charge: 0  },
      { limType: 'E', limit: 300000, charge: 24 },
      { limType: 'E', limit: 500000, charge: 38 },
      { limType: 'F', limit: 1000,   charge: 0  },
      { limType: 'F', limit: 2000,   charge: 6  },
      { limType: 'F', limit: 5000,   charge: 18 },
    ],
  },

  'HO.RT.007': {
    name:    'Scheduled Personal Property Class Rates (per $100 of appraised value)',
    columns: ['itemClass', 'ratePerHundred'],
    rows: [
      { itemClass: 'Jewelry',              ratePerHundred: 1.27 },
      { itemClass: 'Furs',                 ratePerHundred: 0.55 },
      { itemClass: 'Cameras',              ratePerHundred: 1.10 },
      { itemClass: 'Fine Arts',            ratePerHundred: 0.85 },
      { itemClass: 'Silverware',           ratePerHundred: 0.45 },
      { itemClass: 'Musical Instruments',  ratePerHundred: 0.60 },
    ],
  },

  'HO.RT.008': {
    name:    'Endorsement/Credit Factors',
    columns: ['deviceCredit', 'factor'],
    rows: [
      { deviceCredit: 'none',    factor: 1.00 },
      { deviceCredit: 'local',   factor: 0.98 },
      { deviceCredit: 'central', factor: 0.95 },
    ],
    // Note: RC factor (1.10) is CONST 1.10 in step 8a; only device credit is a table lookup.
  },

  'HO.RT.009': {
    name:    'Tier Factor',
    columns: ['tier', 'factor'],
    rows: [
      { tier: 'A', factor: 0.90 },
      { tier: 'B', factor: 1.10 },
      { tier: 'C', factor: 1.25 },
    ],
  },

  'HO.RT.010': {
    name:    'Water Back-Up Flat Premium',
    columns: ['limit', 'flatPremium'],
    rows: [
      { limit: 5000,  flatPremium: 75  },
      { limit: 10000, flatPremium: 110 },
      { limit: 25000, flatPremium: 175 },
    ],
  },
}

// ─── RT getter (HO-3 specific) ────────────────────────────────────────────────

import type { RtGetter, LdGetter } from '../rating/evaluator'
import { genericRtLookup } from '../rating/rtGrid'

export function makeHO3RtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, q: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)

    // Grid-managed tables (PM defined dimensions via the grid editor) resolve through the
    // generic N-D lookup; it returns null for every legacy/seeded table (no `dimensions`),
    // so the bespoke lookups below — and the $1,528 canary — are untouched.
    const generic = genericRtLookup(t, q)
    if (generic !== null) return generic

    const rows = t.rows

    switch (tableRef) {
      case 'HO.RT.001': {
        const r = rows.find(r => r['territory'] === q['territory'])
        if (!r) throw new Error(`HO.RT.001: no row for territory=${q['territory']}`)
        return r['rate'] as number
      }
      case 'HO.RT.002': {
        const pc = q['pc'] as number
        const constr = q['construction'] as string
        const r = rows.find(r => (r['pcMin'] as number) <= pc && pc <= (r['pcMax'] as number))
        if (!r) throw new Error(`HO.RT.002: no row for pc=${pc}`)
        const f = r[constr]
        if (typeof f !== 'number') throw new Error(`HO.RT.002: unknown construction=${constr}`)
        return f
      }
      case 'HO.RT.003': {
        const covA = q['covA'] as number
        const exact = rows.find(r => r['covA'] === covA)
        if (exact) return exact['factor'] as number
        // Extrapolate above 600k: +0.32 per additional 100k (ceiling increments)
        if (covA > 600000) {
          return 1.94 + Math.ceil((covA - 600000) / 100000) * 0.32
        }
        throw new Error(`HO.RT.003: no row for covA=${covA}`)
      }
      case 'HO.RT.004': {
        if ('allPerilDed' in q) {
          const r = rows.find(r => r['subTable'] === 'allPeril' && r['key'] === q['allPerilDed'])
          if (!r) throw new Error(`HO.RT.004: no allPeril row for ded=${q['allPerilDed']}`)
          return r['factor'] as number
        }
        if ('windHailPct' in q) {
          const r = rows.find(r => r['subTable'] === 'windHail' && r['key'] === q['windHailPct'])
          if (!r) throw new Error(`HO.RT.004: no windHail row for pct=${q['windHailPct']}`)
          return r['factor'] as number
        }
        throw new Error('HO.RT.004: query must include allPerilDed or windHailPct')
      }
      case 'HO.RT.005': {
        const r = rows.find(r => r['covCPct'] === q['covCPct'])
        if (!r) throw new Error(`HO.RT.005: no row for covCPct=${q['covCPct']}`)
        return r['factor'] as number
      }
      case 'HO.RT.006': {
        if ('covELimit' in q) {
          const r = rows.find(r => r['limType'] === 'E' && r['limit'] === q['covELimit'])
          if (!r) throw new Error(`HO.RT.006: no E row for limit=${q['covELimit']}`)
          return r['charge'] as number
        }
        if ('covFLimit' in q) {
          const r = rows.find(r => r['limType'] === 'F' && r['limit'] === q['covFLimit'])
          if (!r) throw new Error(`HO.RT.006: no F row for limit=${q['covFLimit']}`)
          return r['charge'] as number
        }
        throw new Error('HO.RT.006: query must include covELimit or covFLimit')
      }
      case 'HO.RT.007': {
        const r = rows.find(r => r['itemClass'] === q['itemClass'])
        if (!r) throw new Error(`HO.RT.007: unknown itemClass=${q['itemClass']}`)
        return r['ratePerHundred'] as number
      }
      case 'HO.RT.008': {
        const r = rows.find(r => r['deviceCredit'] === q['deviceCredit'])
        if (!r) throw new Error(`HO.RT.008: unknown deviceCredit=${q['deviceCredit']}`)
        return r['factor'] as number
      }
      case 'HO.RT.009': {
        const r = rows.find(r => r['tier'] === q['tier'])
        if (!r) throw new Error(`HO.RT.009: unknown tier=${q['tier']}`)
        return r['factor'] as number
      }
      case 'HO.RT.010': {
        const r = rows.find(r => r['limit'] === q['waterBackupLimit'])
        if (!r) throw new Error(`HO.RT.010: no row for limit=${q['waterBackupLimit']}`)
        return r['flatPremium'] as number
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`)
    }
  }
}

// LdGetter is not used in HO.RAT.1 steps (all LD values flow as INPUTs after user selection)
export function makeHO3LdGetter(_tables: Record<string, LDTable>): LdGetter {
  return (_tableRef: string, _selectedValue: number | string): number => {
    // LD table lookups are not needed in the evaluator; the selected numeric value
    // flows directly through RatingInputs. This getter exists for interface completeness.
    throw new Error('LdGetter should not be called by any HO.RAT.1 step')
  }
}

// ─── Rating program (HO.RAT.1 — 11 logical steps, 14 executable steps) ───────

export const HO3_RATING_PROGRAM: Omit<RatingProgram, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:          'HO.RAT.1',
  name:           'HO-3 Special Form Rating Program',
  minimumPremium: 500,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    // Step 1: Territory base rate
    { id: 's1',  order: 1,  label: 'Territory base rate',                    op: 'SET',       source: { type: 'RT',    ref: 'HO.RT.001', keys: ['territory'] } },
    // Step 2: Protection class × construction factor
    { id: 's2',  order: 2,  label: 'Protection/construction factor',          op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.002', keys: ['pc', 'construction'] } },
    // Step 3: Coverage A key factor → Key Premium (round to $)
    { id: 's3',  order: 3,  label: 'Coverage A key factor → Key Premium',     op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.003', keys: ['covA'] },                roundTo: 0 },
    // Step 4a: All-peril deductible factor
    { id: 's4a', order: 4,  label: 'All-peril deductible factor',             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.004', keys: ['allPerilDed'] } },
    // Step 4b: Wind/hail deductible factor (only when wind/hail elected)
    { id: 's4b', order: 5,  label: 'Wind/hail deductible factor',             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.004', keys: ['windHailPct'] },          condition: 'windHailElected' },
    // Step 5: Coverage C percentage factor
    { id: 's5',  order: 6,  label: 'Coverage C percentage factor',            op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.005', keys: ['covCPct'] } },
    // Step 6: Coverage E increased-limit charge (additive $)
    { id: 's6',  order: 7,  label: 'Coverage E increased-limit charge',       op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.006', keys: ['covELimit'] } },
    // Step 7: Coverage F increased-limit charge (additive $)
    { id: 's7',  order: 8,  label: 'Coverage F increased-limit charge',       op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.006', keys: ['covFLimit'] } },
    // Step 8a: Replacement Cost endorsement factor ×1.10 (only when RC elected)
    { id: 's8a', order: 9,  label: 'Replacement Cost endorsement factor',     op: 'MUL',       source: { type: 'CONST', value: 1.10 },                                      condition: 'rcElected' },
    // Step 8b: Protective device credit; round to ¢ captures combined 8a×8b result
    { id: 's8b', order: 10, label: 'Protective device credit',                op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.008', keys: ['deviceCredit'] },         roundTo: 2 },
    // Step 9: Tier factor
    { id: 's9',  order: 11, label: 'Tier factor',                             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.009', keys: ['tier'] } },
    // Step 10a: Water back-up flat premium (only when elected)
    { id: 's10a',order: 12, label: 'Water back-up flat premium',              op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.010', keys: ['waterBackupLimit'] },     condition: 'waterBackupElected' },
    // Step 10b: Scheduled Personal Property premium Σ(value/100 × classRate)
    { id: 's10b',order: 13, label: 'Scheduled Personal Property premium',     op: 'ADD',       source: { type: 'SPP',   ref: 'HO.RT.007' },                                condition: 'sppElected' },
    // Step 11: Apply minimum premium; round to $
    { id: 's11', order: 14, label: 'Apply minimum premium ($500)',             op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 },                                       roundTo: 0 },
  ],
}

// ─── Coverages ────────────────────────────────────────────────────────────────

type CoverageSeed = Omit<Coverage, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

function covGov() { return gov() }

export const HO3_COVERAGES: CoverageSeed[] = [
  {
    refId: 'HO.COV.001', name: 'Coverage A — Dwelling',
    parentId: null, order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-a-limit', kind: 'LIMIT', label: 'Coverage A Amount', basis: 'per occurrence', default: 300000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.002', name: 'Coverage B — Other Structures',
    parentId: null, order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-b-limit', kind: 'LIMIT', label: 'Coverage B Limit (10% of A default)', basis: 'per occurrence', ldTableRef: undefined, default: '10% of Coverage A', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003', name: 'Coverage C — Personal Property',
    parentId: null, order: 3, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-c-pct', kind: 'LIMIT', label: 'Coverage C % of A', basis: 'per occurrence', ldTableRef: 'HO.LD.005', default: 50, unit: 'percent' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.004', name: 'Coverage D — Loss of Use',
    parentId: null, order: 4, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-d-limit', kind: 'LIMIT', label: 'Coverage D Limit (30% of A)', basis: 'per occurrence', default: '30% of Coverage A', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.005', name: 'Coverage E — Personal Liability',
    parentId: null, order: 5, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-e-limit', kind: 'LIMIT', label: 'Coverage E Limit', basis: 'per occurrence', ldTableRef: 'HO.LD.001', default: 300000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.006', name: 'Coverage F — Medical Payments',
    parentId: null, order: 6, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-f-limit', kind: 'LIMIT', label: 'Coverage F Limit', basis: 'per person per occurrence', ldTableRef: 'HO.LD.002', default: 1000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.001.001', name: 'Water Back-Up & Sump Overflow',
    parentId: 'HO.COV.001', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 95'],
    terms: [{ id: 'water-backup-limit', kind: 'LIMIT', label: 'Water Back-Up Limit', basis: 'per occurrence', ldTableRef: 'HO.LD.006', default: 5000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.002.001', name: 'Other Structures — Increased Limits',
    parentId: 'HO.COV.002', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'PROPRIETARY',
    formNumbers: ['HO 04 48'],
    terms: [{ id: 'other-struct-limit', kind: 'LIMIT', label: 'Other Structures Increased Limit', basis: 'per occurrence', default: 0, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003.001', name: 'Personal Property Replacement Cost',
    parentId: 'HO.COV.003', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 90'],
    terms: [{ id: 'rc-elected', kind: 'OPTION', label: 'Replacement Cost Coverage', basis: 'flag', default: false }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003.002', name: 'Scheduled Personal Property',
    parentId: 'HO.COV.003', order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 61'],
    terms: [{
      id: 'spp-schedule', kind: 'OPTION', label: 'SPP Schedule (class + appraised value)',
      basis: 'per item', default: false,
      notes: 'Repeating schedule: ItemClass + AppraisedValue per item. See HO 04 61.',
    }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
]

// ─── Forms ────────────────────────────────────────────────────────────────────

type FormSeed = Omit<Form, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_FORMS: FormSeed[] = [
  {
    number: 'HO 00 03', edition: '05 11',
    name: 'Homeowners 3 — Special Form', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [SEC_I, SEC_II],
    productRefIds: ['HO.PROD.001'],
    description: 'Base open-peril homeowners policy form covering dwelling, other structures, personal property, loss of use, personal liability and medical payments.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO DS 01', edition: '05 11',
    name: 'Homeowners Policy Declarations', category: 'DECLARATIONS',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Policy declarations page showing named insured, property address, coverage limits, deductibles and total premium.',
    dynamicFields: [
      { name: 'NamedInsured',     dataType: 'TEXT',     repeating: false },
      { name: 'PropertyAddress',  dataType: 'TEXT',     repeating: false },
      { name: 'PolicyEffective',  dataType: 'DATE',     repeating: false },
      { name: 'PolicyExpiration', dataType: 'DATE',     repeating: false },
      { name: 'CoverageLimits',   dataType: 'CURRENCY', repeating: true, notes: 'Coverage TEXT + Limit CURRENCY per row' },
      { name: 'TotalPremium',     dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 90', edition: '05 11',
    name: 'Personal Property Replacement Cost Loss Settlement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [SEC_I],
    productRefIds: ['HO.PROD.001'],
    description: 'Amends Coverage C to settle losses at replacement cost rather than actual cash value.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 95', edition: '05 11',
    name: 'Water Back-Up and Sump Discharge or Overflow', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [SEC_I],
    productRefIds: ['HO.PROD.001'],
    description: 'Extends coverage to loss caused by water that backs up through sewers or drains or overflows from a sump.',
    dynamicFields: [{ name: 'BackUpLimit', dataType: 'CURRENCY', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 61', edition: '05 11',
    name: 'Scheduled Personal Property Endorsement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [SEC_I],
    productRefIds: ['HO.PROD.001'],
    description: 'Schedules high-value personal property items (jewelry, furs, cameras, fine arts, etc.) at agreed appraised values.',
    dynamicFields: [
      { name: 'ItemClass',       dataType: 'LIST',     repeating: true, options: ['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'] },
      { name: 'ItemDescription', dataType: 'TEXT',     repeating: true },
      { name: 'AppraisedValue',  dataType: 'CURRENCY', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 16', edition: '05 11',
    name: 'Premises Alarm or Fire Protection System', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Documents a qualifying protective device system and applies the corresponding premium credit.',
    dynamicFields: [
      { name: 'DeviceType',    dataType: 'LIST', repeating: false, options: ['Local Alarm','Central Station'] },
      { name: 'CertificateNo', dataType: 'TEXT', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 48', edition: '05 11',
    name: 'Other Structures — Increased Limits', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: true,
    transactions: [], coverageParts: [SEC_I],
    productRefIds: ['HO.PROD.001'],
    description: 'Increases Coverage B beyond the default 10% of Coverage A for specifically described other structures.',
    dynamicFields: [
      { name: 'StructureDescription', dataType: 'TEXT',     repeating: true },
      { name: 'IncreasedLimit',        dataType: 'CURRENCY', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 03 12', edition: '05 11',
    name: 'Windstorm or Hail Percentage Deductible', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [SEC_I],
    productRefIds: ['HO.PROD.001'],
    description: 'Replaces the standard deductible for windstorm or hail losses with a percentage-of-dwelling deductible.',
    dynamicFields: [
      { name: 'DeductiblePercent', dataType: 'LIST', repeating: false, options: ['1%','2%','5%'] },
    ],
    ...COASTAL_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 96', edition: '05 11',
    name: 'No Section II Coverage — Home Day Care Business', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [SEC_II],
    productRefIds: ['HO.PROD.001'],
    description: 'Excludes personal liability and medical payments coverage for the day-care business conducted at the residence.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 01 04', edition: '05 11',
    name: 'Special Provisions — California', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Modifies the base policy to comply with California statutes and Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['CA'], ...gov(),
  },
  {
    number: 'HO 01 33', edition: '05 11',
    name: 'Special Provisions — Texas', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Modifies the base policy to comply with Texas Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['TX'], ...gov(),
  },
  {
    number: 'PN HO 01', edition: '05 11',
    name: 'Policyholder Notice — Important Information', category: 'POLICY_NOTICE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Required notice providing policyholders with important information about their policy rights and obligations.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Product rules ────────────────────────────────────────────────────────────

type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_RULES: RuleSeed[] = [
  { refId: 'HO.RU.001', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'Owner-occupied 1–4 family dwelling, residential use',
    outcome: 'Eligible for HO-3 Special Form',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.002', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage B default limit',
    outcome: 'Default = 10% of Coverage A; increase only via HO 04 48',
    ldTableRef: undefined, coverageRefIds: ['HO.COV.002'], formNumbers: ['HO 04 48'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.003', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage C percentage of A',
    outcome: 'Options per HO.LD.005; default 50% of A',
    ldTableRef: 'HO.LD.005', coverageRefIds: ['HO.COV.003'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.004', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage D limit',
    outcome: '30% of Coverage A (calculated)',
    coverageRefIds: ['HO.COV.004'], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.005', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage E limit options',
    outcome: 'Options per HO.LD.001; default $300,000',
    ldTableRef: 'HO.LD.001', coverageRefIds: ['HO.COV.005'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.006', category: 'PRODUCT', subCategory: 'Coverage Constraints',
    condition: 'Coverage F $5,000 limit selected',
    outcome: 'Requires Coverage E ≥ $300,000',
    ldTableRef: 'HO.LD.002', coverageRefIds: ['HO.COV.005','HO.COV.006'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.007', category: 'RATING', subCategory: 'Deductibles',
    condition: 'All-peril deductible selection',
    outcome: 'Options per HO.LD.003; default $1,000',
    ldTableRef: 'HO.LD.003', coverageRefIds: [], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.008', category: 'RATING', subCategory: 'Deductibles',
    condition: 'Wind/Hail percentage deductible elected',
    outcome: COASTAL_RULE_OUTCOME,
    ldTableRef: 'HO.LD.004', coverageRefIds: [], formNumbers: ['HO 03 12'],
    ...COASTAL_SCOPE, ...gov() },
  { refId: 'HO.RU.009', category: 'RATING', subCategory: 'Premium Floor',
    condition: 'Calculated premium',
    outcome: 'Minimum policy premium $500 (HO.RAT.1 step 11)',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.010', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'Seasonal or secondary dwelling',
    outcome: 'Ineligible unless companion primary policy is in force',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
]

// ─── Form attachment rules ────────────────────────────────────────────────────

type FormRuleSeed = Omit<FormRule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_FORM_RULES: FormRuleSeed[] = [
  { refId: 'HO.FORM.RU.001', condition: 'Replacement Cost elected', outcome: 'Attach HO 04 90',         formNumbers: ['HO 04 90'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.002', condition: 'Water Back-Up elected',    outcome: 'Attach HO 04 95',         formNumbers: ['HO 04 95'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.003', condition: 'Scheduled Personal Property elected', outcome: 'Attach HO 04 61', formNumbers: ['HO 04 61'], mandatory: true, ...gov() },
  { refId: 'HO.FORM.RU.004', condition: 'Protective-device credit ≠ none', outcome: 'Attach HO 04 16',  formNumbers: ['HO 04 16'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.005', condition: 'Wind/Hail % deductible elected',  outcome: 'Attach HO 03 12',  formNumbers: ['HO 03 12'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.006', condition: 'Risk state = CA',           outcome: 'Attach HO 01 04; TX → HO 01 33', formNumbers: ['HO 01 04','HO 01 33'], mandatory: true, ...gov() },
  { refId: 'HO.FORM.RU.007', condition: 'Home day-care exclusion elected', outcome: 'Attach HO 04 96',  formNumbers: ['HO 04 96'], mandatory: false, ...gov() },
]

// ─── Dictionary ───────────────────────────────────────────────────────────────

type DictSeed = Omit<DictionaryEntry, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

// Governed HO-3 field/term definitions. `refId` is the citable id (the AI cites e.g.
// [HO.DEF.003]); `aliases` are the real surface forms each term appears under in
// coverage/rule/form text, driving the computed "used in" back-references. Rating-only
// inputs (Protection Class, Construction, Territory) live in RT tables, not in
// coverage/form/rule prose, so they legitimately resolve to no back-references.
export const HO3_DICTIONARY: DictSeed[] = [
  { refId: 'HO.DEF.001', name: 'Named Insured', type: 'TEXT',
    description: 'Full legal name of the primary insured named on the declarations.',
    allowedValues: [], format: 'Free text', tags: ['party','declarations'],
    aliases: ['NamedInsured', 'named insured'], ...gov() },
  { refId: 'HO.DEF.002', name: 'Property Address', type: 'TEXT',
    description: 'Physical street address of the insured dwelling / residence premises.',
    allowedValues: [], format: 'USPS address', tags: ['location','declarations'],
    aliases: ['PropertyAddress', 'property address', 'residence premises'], ...gov() },
  { refId: 'HO.DEF.003', name: 'Coverage A Amount', type: 'CURRENCY',
    description: 'Insured replacement value of the dwelling; the base for Coverage B/C/D derivations.',
    allowedValues: [], format: 'USD (whole dollars)', tags: ['coverage','rating','limit'],
    aliases: ['Coverage A', 'Coverage A Amount', 'Dwelling limit'], ...gov() },
  { refId: 'HO.DEF.004', name: 'All-Peril Deductible', type: 'CURRENCY',
    description: 'Per-occurrence deductible applied to all covered perils before wind/hail options.',
    allowedValues: ['500', '1000', '2500', '5000'], format: 'USD (whole dollars)', tags: ['deductible','rating'],
    aliases: ['all-peril deductible', 'all peril deductible'], ...gov() },
  { refId: 'HO.DEF.005', name: 'Protection Class', type: 'LIST',
    description: 'ISO Public Protection Classification (fire) 1–10 for the risk location.',
    allowedValues: ['1','2','3','4','5','6','7','8','9','10'], format: 'Integer 1–10', tags: ['rating','underwriting'],
    aliases: ['Protection Class', 'ISO fire protection class', 'PPC'], ...gov() },
  { refId: 'HO.DEF.006', name: 'Construction Type', type: 'LIST',
    description: 'Primary construction material of the dwelling used for the construction rating factor.',
    allowedValues: ['Frame', 'Masonry'], format: 'Enumerated', tags: ['rating','underwriting'],
    aliases: ['Construction Type', 'construction class'], ...gov() },
  { refId: 'HO.DEF.007', name: 'Territory Code', type: 'LIST',
    description: 'Rating territory assigned to the property location; keys the territory base rate.',
    allowedValues: ['T001','T002','T003','T004','T005'], format: 'T0NN', tags: ['rating'],
    aliases: ['Territory Code', 'rating territory'], ...gov() },
  { refId: 'HO.DEF.008', name: 'Appraised Value', type: 'CURRENCY',
    description: 'Professionally appraised value of a scheduled personal property item.',
    allowedValues: [], format: 'USD (whole dollars)', tags: ['spp','scheduled-property'],
    aliases: ['AppraisedValue', 'appraised value'], ...gov() },
  { refId: 'HO.DEF.009', name: 'Device Type', type: 'LIST',
    description: 'Qualifying protective device installed at the premises; drives the device credit.',
    allowedValues: ['Local Alarm', 'Central Station'], format: 'Enumerated', tags: ['credit','underwriting'],
    aliases: ['DeviceType', 'protective device', 'device type'], ...gov() },
  { refId: 'HO.DEF.010', name: 'Effective Date', type: 'DATE',
    description: 'Date the policy period begins.',
    allowedValues: [], format: 'YYYY-MM-DD', tags: ['policy','declarations'],
    aliases: ['PolicyEffective', 'effective date'], ...gov() },
]

// ─── Default task template (SLA set) ────────────────────────────────────────
//
// Generic product-lifecycle SLA set: dueAt = projectStartDate + daysOffset.
// This constant is the CODE FALLBACK.  The authoritative, editable copy lives in
// Firestore `taskTemplates` (ADMIN-writable).  NewProductModal reads Firestore
// first and falls back to these values when the collection is empty.

export const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [
  { title: 'Define coverage strategy',       column: 'IDEATION',        daysOffset: 7,   slaLabel: '7 days'   },
  { title: 'Draft rating plan',              column: 'IDEATION',        daysOffset: 14,  slaLabel: '2 weeks'  },
  { title: 'Configure product in Factory',   column: 'BUILD_FILE',      daysOffset: 30,  slaLabel: '30 days'  },
  { title: 'File with states',               column: 'BUILD_FILE',      daysOffset: 45,  slaLabel: '45 days'  },
  { title: 'UAT rating scenarios',           column: 'TEST_APPROVE',    daysOffset: 60,  slaLabel: '60 days'  },
  { title: 'Business review sign-off',       column: 'TEST_APPROVE',    daysOffset: 70,  slaLabel: '70 days'  },
  { title: 'Launch readiness check',         column: 'LAUNCH_MONITOR',  daysOffset: 80,  slaLabel: '80 days'  },
  { title: '30-day results review',          column: 'LAUNCH_MONITOR',  daysOffset: 110, slaLabel: '110 days' },
]

// Back-compat alias — seed.ts and any code that pre-dates the rename still work.
export const HO3_DEFAULT_TASK_TEMPLATES = DEFAULT_TASK_TEMPLATES

// ─── Sample users ─────────────────────────────────────────────────────────────

export const HO3_SEED_USERS: Array<Omit<User, 'createdAt'> & { createdAt: null; password: string }> = [
  {
    // Convenience admin for local sign-in (no forced password change).
    email: 'admin@admin.com', name: 'Admin',
    role: 'ADMIN', active: true, mustChangePassword: false,
    password: 'admin123', createdAt: null,
  },
  {
    email: 'admin@productfactory.app', name: 'Product Factory Admin',
    role: 'ADMIN', active: true, mustChangePassword: true,
    password: 'admin123', createdAt: null,
  },
  {
    email: 'editor@productfactory.app', name: 'Product Editor',
    role: 'EDITOR', active: true, mustChangePassword: false,
    password: 'editor123', createdAt: null,
  },
  {
    email: 'viewer@productfactory.app', name: 'Product Viewer',
    role: 'VIEWER', active: true, mustChangePassword: false,
    password: 'viewer123', createdAt: null,
  },
]

// ─── Sample feedback ──────────────────────────────────────────────────────────

export const HO3_SAMPLE_FEEDBACK: Array<Omit<Feedback, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }> = [
  {
    type: 'IDEA', title: 'Add flood coverage endorsement',
    detail: 'Customers frequently ask about flood. Adding a standalone flood endorsement option would expand our addressable market.',
    context: { route: '/app/products' },
    votes: { count: 3, voters: [] }, status: 'NEW', impact: 3, effort: 3,
    priorityScore: 3, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
  {
    type: 'ISSUE', title: 'Rating trace should display step-by-step in the UI',
    detail: 'During UAT we needed to verify the $1,528 worked example. The evaluator returns a trace array but the pricing tab does not display it yet.',
    context: { route: '/app/products/:id/pricing' },
    votes: { count: 5, voters: [] }, status: 'REVIEWING', impact: 2, effort: 1,
    priorityScore: 5, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
  {
    type: 'PRAISE', title: 'Form attachment rules work perfectly',
    detail: 'Tested all 7 HO.FORM.RU rules. Every form attaches exactly when expected. The rules engine is solid.',
    context: { route: '/app/products/:id/forms' },
    votes: { count: 1, voters: [] }, status: 'PLANNED', impact: 1, effort: 1,
    priorityScore: 1, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
]

// ─── Worked-example preset (must produce $1,528) ──────────────────────────────

export const HO3_WORKED_EXAMPLE: RatingInputs = {
  territory:           'T002',
  pc:                  5,
  construction:        'M',
  covA:                400000,
  allPerilDed:         1000,
  windHailElected:     false,
  windHailPct:         undefined,
  covCPct:             70,
  covELimit:           300000,
  covFLimit:           2000,
  rcElected:           true,
  deviceCredit:        'none',
  tier:                'B',
  waterBackupElected:  true,
  waterBackupLimit:    5000,
  sppElected:          true,
  sppItems:            [{ itemClass: 'Jewelry', appraisedValue: 15000 }],
}
