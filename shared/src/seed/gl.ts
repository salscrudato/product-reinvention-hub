// GL seed constants — a faithful, illustrative SUBSET of the four ISO General
// Liability workbooks (Framework · Rules · Rating · Forms), mirroring shared/seed/ho3.ts.
// Every refId, form number and table id here is copied VERBATIM from the workbooks
// (GL.PROD.001, GL.COV.*, GL.RU.*, GL.FORM.RU.*, CG 00 01, LDTable.001, RTTable.001…);
// factors/rates are illustrative where the template left the cells blank (exactly as
// DOMAIN_HO treats HO-3 rates as illustrative). This is the second reference line —
// commercial casualty, occurrence + claims-made, territory-rated — proving the model
// and every surface are line-agnostic, not Homeowners-only. Pure TypeScript.
import type {
  Product, Coverage, LDTable, RTTable, RatingProgram, Form,
  Rule, FormRule, DictionaryEntry, RatingInputField,
} from '../types'
import type { RtGetter, LdGetter } from '../rating/evaluator'
import { GL_LOB } from '../insurance/lobRegistry'

// ─── State footprint ───────────────────────────────────────────────────────────

// GL.PROD.001 is a broad commercial footprint (the workbook marks most coverages
// "All Active States"); the standard footprint is owned by the LOB registry and the
// seed re-exports it. GL has no coastal peril — it rates by territory (GL_LOB).
export const GL_FOOTPRINT_STATES = GL_LOB.footprintStates

// ─── Governance helper (createdAt/updatedAt null → stamped by the seed script) ──

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

// ─── Product ─────────────────────────────────────────────────────────────────

export const GL_PRODUCT: Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:         'GL.PROD.001',
  name:          'Monoline General Liability Product',
  lob:           { refId: 'GL.LOB.001', name: 'General Liability' },
  description:   'ISO-style Commercial General Liability policy (CG 00 01) covering premises/operations and products/completed-operations bodily injury and property damage, personal & advertising injury, and medical payments — rated by class, exposure and increased-limit factors.',
  marketSegment: 'Commercial Lines / Casualty',
  owner:         { uid: 'seed', name: 'Product Factory Seed' },
  health:        { score: 100, findingCount: 0, updatedAt: null },
  ...FOOTPRINT_SCOPE,
  ...gov(),
}

// ─── Limits & Deductibles tables (LD) — refIds verbatim from the workbook ──────
// The evaluator never calls the LdGetter; selected limit values flow through the
// rating inputs (mirrors HO-3). These tables back the coverage terms + input options.

export const GL_LD_TABLES: Record<string, LDTable> = {
  'LDTable.001': {
    // Illustrative subset of the workbook's Occurrence Limits, capped at the $1M the
    // Increased Limit Factor table (RTTable.001) rates, so every choice prices cleanly.
    name:         'Occurrence Limits',
    defaultValue: 1000000,
    rows: [
      { label: '$100,000',   value: 100000 },
      { label: '$300,000',   value: 300000 },
      { label: '$500,000',   value: 500000 },
      { label: '$1,000,000', value: 1000000 },
    ],
  },
  'LDTable.002': {
    name:         'General Aggregate Limits',
    defaultValue: 2000000,
    rows: [
      { label: '$300,000',   value: 300000,  constraintNote: 'Available when Occurrence Limit ≤ 300,000' },
      { label: '$600,000',   value: 600000 },
      { label: '$1,000,000', value: 1000000 },
      { label: '$2,000,000', value: 2000000 },
      { label: '$4,000,000', value: 4000000 },
    ],
  },
  'LDTable.005': {
    name:         'Policy Deductible',
    defaultValue: 0,
    rows: [
      { label: 'None',    value: 0 },
      { label: '$500',    value: 500 },
      { label: '$1,000',  value: 1000 },
      { label: '$2,500',  value: 2500 },
      { label: '$5,000',  value: 5000 },
      { label: '$10,000', value: 10000 },
    ],
  },
  'LDTable.006': {
    name:         'Products Completed Aggregate Limit',
    defaultValue: 2000000,
    rows: [
      { label: '$500,000',   value: 500000 },
      { label: '$1,000,000', value: 1000000 },
      { label: '$2,000,000', value: 2000000 },
      { label: 'Exclude',    value: 0, constraintNote: 'Excludes Products/Completed Operations coverage [GL.RU.007]' },
    ],
  },
}

// ─── Rating tables (RT) — refIds verbatim from the workbook ────────────────────
// ILF per-occurrence/aggregate are kept in the workbook's $000s units; the getter
// divides the full-dollar rating inputs by 1,000 before matching.

export const GL_RT_TABLES: Record<string, RTTable> = {
  'RTTable.001': {
    // INCREASE LIMIT FACTOR — workbook layout (COVERAGE, TABLE, PER OCCURRENCE,
    // AGGREGATE, ILF). Prem/Ops uses class tables 1–3; ILF cells illustrative.
    name:    'Increase Limit Factor',
    columns: ['coverage', 'table', 'perOccurrence', 'aggregate', 'ilf'],
    rows: [
      { coverage: 'Prem/Ops', table: 1, perOccurrence: 100,  aggregate: 300,  ilf: 1.00 },
      { coverage: 'Prem/Ops', table: 1, perOccurrence: 300,  aggregate: 600,  ilf: 1.12 },
      { coverage: 'Prem/Ops', table: 1, perOccurrence: 500,  aggregate: 1000, ilf: 1.22 },
      { coverage: 'Prem/Ops', table: 1, perOccurrence: 1000, aggregate: 2000, ilf: 1.32 },
      { coverage: 'Prem/Ops', table: 2, perOccurrence: 100,  aggregate: 300,  ilf: 1.00 },
      { coverage: 'Prem/Ops', table: 2, perOccurrence: 300,  aggregate: 600,  ilf: 1.15 },
      { coverage: 'Prem/Ops', table: 2, perOccurrence: 500,  aggregate: 1000, ilf: 1.28 },
      { coverage: 'Prem/Ops', table: 2, perOccurrence: 1000, aggregate: 2000, ilf: 1.40 },
      { coverage: 'Prem/Ops', table: 3, perOccurrence: 100,  aggregate: 300,  ilf: 1.00 },
      { coverage: 'Prem/Ops', table: 3, perOccurrence: 300,  aggregate: 600,  ilf: 1.18 },
      { coverage: 'Prem/Ops', table: 3, perOccurrence: 500,  aggregate: 1000, ilf: 1.34 },
      { coverage: 'Prem/Ops', table: 3, perOccurrence: 1000, aggregate: 2000, ilf: 1.50 },
    ],
  },

  'RTTable.002': {
    // Company Loss Cost Multiplier — one filed LCM per state (illustrative values).
    name:    'LCM',
    columns: ['state', 'lcm'],
    rows: [
      { state: 'OH', lcm: 1.50 },
      { state: 'MO', lcm: 1.62 },
    ],
  },

  'RTTable.004': {
    // Minimum Premium by ISO class table (values from the workbook OH rate page).
    name:    'Minimum Premium',
    columns: ['classTable', 'minimumPremium'],
    rows: [
      { classTable: 1,   minimumPremium: 100 },
      { classTable: 2,   minimumPremium: 125 },
      { classTable: 3,   minimumPremium: 190 },
      { classTable: 'A', minimumPremium: 95  },
      { classTable: 'B', minimumPremium: 190 },
      { classTable: 'C', minimumPremium: 275 },
    ],
  },

  'RTTable.006': {
    // General Liability Schedule Rating — risk-characteristic credits/debits, capped
    // at ±25%. The applied modification flows as the `scheduleMod` rating input;
    // this table documents the eligible characteristics (referenced by GL.RU.091).
    name:    'General Liability Schedule Rating',
    columns: ['characteristic', 'maxCredit', 'maxDebit'],
    rows: [
      { characteristic: 'Management — Cooperation, Safety Program', maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Location — Exposures inside the premises', maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Location — Exposures outside the premises', maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Premises — Condition and care',            maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Equipment — Type, condition and care',     maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Employees — Selection and training',       maxCredit: 25, maxDebit: 25 },
      { characteristic: 'Classification peculiarities',             maxCredit: 25, maxDebit: 25 },
    ],
  },
}

// ─── RT getter (GL-specific) ───────────────────────────────────────────────────

export function makeGLRtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, q: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)
    const rows = t.rows

    switch (tableRef) {
      case 'RTTable.001': {
        // The ILF is driven by the per-occurrence limit ($000s) for the coverage's
        // class table; the paired aggregate rides along for display/traceability. Any
        // aggregate the user selects rates cleanly against the matched occurrence row.
        const occK = (q['perOccurrenceLimit'] as number) / 1000
        const r = rows.find(r =>
          r['coverage'] === q['coverage'] && r['table'] === q['classTable'] && r['perOccurrence'] === occK)
        if (!r) throw new Error(`RTTable.001: no ILF for ${q['coverage']}/table ${q['classTable']} @ occ ${occK}`)
        return r['ilf'] as number
      }
      case 'RTTable.002': {
        const r = rows.find(r => r['state'] === q['lcmState'])
        if (!r) throw new Error(`RTTable.002: no LCM for state=${q['lcmState']}`)
        return r['lcm'] as number
      }
      case 'RTTable.004': {
        const r = rows.find(r => r['classTable'] === q['classTable'])
        if (!r) throw new Error(`RTTable.004: no minimum premium for classTable=${q['classTable']}`)
        return r['minimumPremium'] as number
      }
      default:
        throw new Error(`No GL lookup implementation for RT table: ${tableRef}`)
    }
  }
}

// LdGetter is unused in GL.RAT.1 (limit values flow as inputs) — mirrors HO-3.
export function makeGLLdGetter(_tables: Record<string, LDTable>): LdGetter {
  return (): number => {
    throw new Error('LdGetter should not be called by any GL.RAT.1 step')
  }
}

// ─── Rating program (GL.RAT.1 — Premises/Operations premium) ───────────────────
// A faithful, linear subset of the ISO Prem/Ops algorithm: base loss cost × exposure
// × LCM × ILF × schedule mod × tier, plus an optional terrorism charge, floored at
// the class minimum premium. RT lookups are grounded in the workbook tables above.

export const GL_RATING_PROGRAM: Omit<RatingProgram, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:          'GL.RAT.1',
  name:           'Monoline General Liability Rating Program',
  minimumPremium: 125,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    { id: 's1', order: 1, label: 'Base loss cost (per $1,000 exposure)',  op: 'SET',       source: { type: 'INPUT', ref: 'lossCost' } },
    { id: 's2', order: 2, label: 'Rating exposure (units of $1,000)',     op: 'MUL',       source: { type: 'INPUT', ref: 'exposureUnits' } },
    { id: 's3', order: 3, label: 'Loss cost multiplier (LCM)',            op: 'MUL',       source: { type: 'RT', ref: 'RTTable.002', keys: ['lcmState'] } },
    { id: 's4', order: 4, label: 'Increased limit factor (ILF)',          op: 'MUL',       source: { type: 'RT', ref: 'RTTable.001', keys: ['coverage', 'classTable', 'perOccurrenceLimit', 'aggregateLimit'] }, roundTo: 2 },
    { id: 's5', order: 5, label: 'Schedule rating modification',          op: 'MUL',       source: { type: 'INPUT', ref: 'scheduleMod' } },
    { id: 's6', order: 6, label: 'Tier factor',                           op: 'MUL',       source: { type: 'INPUT', ref: 'tierFactor' }, roundTo: 2 },
    { id: 's7', order: 7, label: 'Terrorism coverage premium [CG 21 70]', op: 'ADD',       source: { type: 'CONST', value: 50 }, condition: 'terrorismElected' },
    { id: 's8', order: 8, label: 'Minimum premium by class [RTTable.004]', op: 'MIN_FLOOR', source: { type: 'RT', ref: 'RTTable.004', keys: ['classTable'] }, roundTo: 0 },
  ],
}

// ─── Worked example → must produce $2,789 (the GL canary, sibling to HO-3 $1,528) ─
// $4.20/$1,000 × $300,000 sales = 1,260 → ×1.50 LCM = 1,890 → ×1.40 ILF = 2,646 →
// ×0.90 schedule = 2,381.40 → ×1.15 tier = 2,738.61 → +50 terrorism = 2,788.61 →
// MAX(·, 125 min) round 0 = $2,789.

export const GL_WORKED_EXAMPLE = {
  coverage:           'Prem/Ops',
  classTable:         2,
  lossCost:           4.20,
  exposureUnits:      300,        // $300,000 gross sales in units of $1,000
  perOccurrenceLimit: 1000000,
  aggregateLimit:     2000000,
  lcmState:           'OH',
  scheduleMod:        0.90,       // net 10% schedule credit (within RTTable.006 ±25%)
  tierFactor:         1.15,
  terrorismElected:   true,
} as const

// Data-driven pricing worksheet for GL (rendered generically — the LOB registry
// routes non-Homeowners lines to the generic panel; see app ProductPricing).
export const GL_RATING_INPUT_SPEC: RatingInputField[] = [
  { key: 'classTable',         label: 'ISO class table',              kind: 'select',  options: [{ label: 'Table 1', value: 1 }, { label: 'Table 2', value: 2 }, { label: 'Table 3', value: 3 }] },
  { key: 'lcmState',           label: 'Rating state (LCM)',           kind: 'select',  options: [{ label: 'OH', value: 'OH' }, { label: 'MO', value: 'MO' }] },
  { key: 'lossCost',           label: 'Base loss cost (per $1,000)',  kind: 'number',  step: 0.1,  min: 0 },
  { key: 'exposureUnits',      label: 'Exposure (units of $1,000)',   kind: 'number',  step: 10,   min: 0 },
  { key: 'perOccurrenceLimit', label: 'Occurrence limit',             kind: 'select',  ldTableRef: 'LDTable.001' },
  { key: 'aggregateLimit',     label: 'General aggregate limit',      kind: 'select',  ldTableRef: 'LDTable.002' },
  { key: 'scheduleMod',        label: 'Schedule rating mod',          kind: 'number',  step: 0.05, min: 0 },
  { key: 'tierFactor',         label: 'Tier factor',                  kind: 'number',  step: 0.05, min: 0 },
  { key: 'terrorismElected',   label: 'Terrorism coverage (CG 21 70)', kind: 'boolean' },
]

// ─── Coverages ──────────────────────────────────────────────────────────────────
// ISO CGL groups coverage into parts A (BI/PD), B (Personal & Advertising Injury),
// C (Medical Payments) plus other coverages — the grouping is line-driven (GL_LOB).

type CoverageSeed = Omit<Coverage, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

const occLimitTerm = () => ({
  id: 'occurrence-limit', kind: 'LIMIT' as const, label: 'Each Occurrence Limit',
  basis: 'per occurrence', ldTableRef: 'LDTable.001', default: 1000000, unit: 'dollars',
})

export const GL_COVERAGES: CoverageSeed[] = [
  // ── Other coverages ──
  {
    refId: 'GL.COV.001', name: 'Wrongful Acts Coverage',
    parentId: null, order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['CG 21 70', 'CG 21 87'],
    terms: [{ id: 'terrorism-cap', kind: 'OPTION', label: 'Certified acts of terrorism cap', basis: 'flag', default: true }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.001.001', name: 'Terrorism Coverage',
    parentId: 'GL.COV.001', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['CG 21 70'],
    terms: [{ id: 'terrorism-elected', kind: 'OPTION', label: 'Terrorism coverage elected', basis: 'flag', default: true }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Coverage A — Bodily Injury & Property Damage ──
  {
    refId: 'GL.COV.002', name: 'Bodily Injury (Premises Operations) Coverage',
    parentId: null, order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [occLimitTerm()],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.002.001', name: 'Mobile Equipment Operation Coverage',
    parentId: 'GL.COV.002', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'shares-policy-limit', kind: 'LIMIT', label: 'Shares the policy Occurrence/Aggregate limit', basis: 'per occurrence', default: 'Policy limit', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.002.007', name: 'Liquor Liability Coverage',
    parentId: 'GL.COV.002', order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['CG 24 08', 'CG 00 33'],
    terms: [{ id: 'liquor-elected', kind: 'OPTION', label: 'Liquor liability elected', basis: 'flag', default: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.003', name: 'Property Damage (Premises Operations) Coverage',
    parentId: null, order: 3, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [occLimitTerm()],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.004', name: 'Bodily Injury (Products / Completed Ops) Coverage',
    parentId: null, order: 4, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'products-agg-limit', kind: 'LIMIT', label: 'Products/Completed Ops Aggregate Limit', basis: 'aggregate', ldTableRef: 'LDTable.006', default: 2000000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.005', name: 'Property Damage (Products / Completed Ops) Coverage',
    parentId: null, order: 5, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'products-agg-limit', kind: 'LIMIT', label: 'Products/Completed Ops Aggregate Limit', basis: 'aggregate', ldTableRef: 'LDTable.006', default: 2000000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Coverage B — Personal & Advertising Injury ──
  {
    refId: 'GL.COV.006', name: 'Personal and Advertising Injury Coverage',
    parentId: null, order: 6, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'pai-limit', kind: 'LIMIT', label: 'Personal & Advertising Injury Limit (= Occurrence Limit)', basis: 'per occurrence', default: 1000000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.006.001', name: 'Advertising Infringement Coverage',
    parentId: 'GL.COV.006', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'shares-pai-limit', kind: 'LIMIT', label: 'Shares the Personal & Advertising Injury limit', basis: 'per occurrence', default: 'Policy limit', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.006.002', name: 'Media and Internet Business Coverage',
    parentId: 'GL.COV.006', order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'shares-pai-limit', kind: 'LIMIT', label: 'Shares the Personal & Advertising Injury limit', basis: 'per occurrence', default: 'Policy limit', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Coverage C — Medical Payments ──
  {
    refId: 'GL.COV.007', name: 'Medical Payments Coverage',
    parentId: null, order: 7, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 00 01'],
    terms: [{ id: 'medpay-limit', kind: 'LIMIT', label: 'Medical Expense Limit (any one person)', basis: 'per person', default: 5000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },

  // ── Other coverages — Employee Benefits Liability (claims-made) ──
  {
    refId: 'GL.COV.010', name: 'Employee Benefits Liability Coverage',
    parentId: null, order: 8, requirement: 'MANDATORY',
    claimsBasis: 'Claims-made', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 04 35'],
    terms: [{ id: 'ebl-each-employee', kind: 'LIMIT', label: 'Each Employee Limit', basis: 'per claim', default: 1000000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    refId: 'GL.COV.010.001', name: 'Act, Error or Omission Coverage',
    parentId: 'GL.COV.010', order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Claims-made', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['CG 04 35'],
    terms: [{ id: 'shares-ebl-limit', kind: 'LIMIT', label: 'Shares the Employee Benefits Liability limit', basis: 'per claim', default: 'Policy limit', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Forms — numbers, editions and categories verbatim from the workbook ────────

type FormSeed = Omit<Form, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

const CGL_PART = ['Commercial General Liability']

export const GL_FORMS: FormSeed[] = [
  {
    number: 'CG 00 01', edition: '04 13',
    name: 'Commercial General Liability Coverage Form', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Base occurrence-form Commercial General Liability policy covering premises/operations and products/completed-operations bodily injury and property damage, personal & advertising injury, and medical payments.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 00 39', edition: '04 13',
    name: 'Pollution Liability Coverage Form Designated Sites', category: 'BASE_COVERAGE',
    claimsBasis: 'Claims-made', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Pollution'],
    productRefIds: ['GL.PROD.001'],
    description: 'Claims-made pollution liability coverage for bodily injury and property damage at scheduled designated sites.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 03 00', edition: '01 96',
    name: 'Deductible Liability Insurance', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Applies a per-claim or per-occurrence deductible to bodily injury and/or property damage liability.',
    dynamicFields: [
      { name: 'BI Deductible', dataType: 'CURRENCY', repeating: false },
      { name: 'PD Deductible', dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 04 35', edition: '12 07',
    name: 'Employee Benefits Liability Coverage', category: 'ENDORSEMENT',
    claimsBasis: 'Claims-made', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Adds claims-made Employee Benefits Liability coverage for negligent acts, errors or omissions in administering the insured’s employee benefits program.',
    dynamicFields: [
      { name: 'Each Employee Limit', dataType: 'CURRENCY', repeating: false },
      { name: 'Aggregate Limit',     dataType: 'CURRENCY', repeating: false },
      { name: 'Retroactive Date',    dataType: 'DATE',     repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 20 10', edition: '04 13',
    name: 'Additional Insured — Owners, Lessees Or Contractors — Scheduled Person Or Organization', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: true,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Adds a scheduled person or organization as an additional insured for liability arising out of the named insured’s ongoing operations.',
    dynamicFields: [
      { name: 'Name Of Person(s) Or Organization(s)', dataType: 'TEXT', repeating: true },
      { name: 'Location(s) of Covered Operations',    dataType: 'TEXT', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 35', edition: '10 01',
    name: 'Exclusion — Coverage C — Medical Payments', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Excludes Coverage C — Medical Payments from the policy.',
    dynamicFields: [{ name: 'Description of Premises or Classification', dataType: 'TEXT', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 38', edition: '11 85',
    name: 'Exclusion — Personal And Advertising Injury', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Excludes Coverage B — Personal and Advertising Injury from the policy.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 45', edition: '07 98',
    name: 'Exclusion — Damage To Premises Rented To You', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Removes the exception to the property-damage exclusion for premises rented to the insured.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 70', edition: '01 15',
    name: 'Cap On Losses From Certified Acts Of Terrorism', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Caps the insurer’s losses for certified acts of terrorism under the Terrorism Risk Insurance Act.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 21 87', edition: '01 15',
    name: 'Conditional Exclusion Of Terrorism (Relating To Disposition Of Federal Terrorism Risk Insurance Act)', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Conditionally excludes terrorism losses depending on the disposition of the federal Terrorism Risk Insurance Act.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 24 04', edition: '05 09',
    name: 'Waiver Of Transfer Of Rights Of Recovery Against Others To Us', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Waives the insurer’s right of subrogation against a scheduled person or organization (waiver of subrogation).',
    dynamicFields: [{ name: 'Name of Person or Organization', dataType: 'TEXT', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 00 33', edition: '04 13',
    name: 'Liquor Liability Coverage Form', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Liquor Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Stand-alone occurrence-form liquor liability coverage for injury caused by intoxication of a person the insured served or furnished alcoholic beverages.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 24 08', edition: '10 93',
    name: 'Liquor Liability', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Liquor Liability'],
    productRefIds: ['GL.PROD.001'],
    description: 'Adds liquor liability coverage to the Commercial General Liability coverage part for insureds in the business of manufacturing, selling or serving alcoholic beverages.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'CG 01 03', edition: '06 06',
    name: 'Texas Changes', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: CGL_PART,
    productRefIds: ['GL.PROD.001'],
    description: 'Amends the policy to comply with Texas Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['TX'], ...gov(),
  },
]

// ─── Product rules (GL.RU.*) — PRODUCT rows verbatim; RATING rows curated ───────

type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_RULES: RuleSeed[] = [
  // ── PRODUCT — copied verbatim from GL Rules Specifications ──
  { refId: 'GL.RU.001', category: 'PRODUCT', subCategory: 'Base Coverage (Default)',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then Bodily Injury (Premises/Products) and Property Damage (Premises/Products) Coverage is available and mandatory',
    coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.004', category: 'PRODUCT', subCategory: 'Limit Ranges and Defaults',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then an Occurrence Limit is available and mandatory (See Table)',
    ldTableRef: 'LDTable.001', coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.005', category: 'PRODUCT', subCategory: 'Limit Ranges and Defaults',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then a General Aggregate Limit is available and mandatory (See Table)',
    ldTableRef: 'LDTable.002', coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.006', category: 'PRODUCT', subCategory: 'Limit Ranges and Defaults',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then a Products Completed Aggregate Limit is available and optional (See Table)',
    ldTableRef: 'LDTable.006', coverageRefIds: ['GL.COV.004','GL.COV.005'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.007', category: 'PRODUCT', subCategory: 'Mandatory Inclusion/Exclusion of Coverage',
    condition: 'If Products Completed Aggregate Limit is excluded',
    outcome: 'Then Products Completed Operations Coverage is removed',
    coverageRefIds: ['GL.COV.004','GL.COV.005'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.011', category: 'PRODUCT', subCategory: 'Base Coverage (Default)',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then Medical Payments Coverage is available and optional',
    coverageRefIds: ['GL.COV.007'], formNumbers: ['CG 00 01'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.013', category: 'PRODUCT', subCategory: 'Mandatory Inclusion/Exclusion of Coverage',
    condition: 'If Medical Payments Coverage is excluded',
    outcome: 'Then Medical Payments Coverage is removed',
    coverageRefIds: ['GL.COV.007'], formNumbers: ['CG 21 35'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.020', category: 'PRODUCT', subCategory: 'Mandatory Inclusion/Exclusion of Coverage',
    condition: 'If Personal Advertising Injury Coverage is excluded',
    outcome: 'Then Advertising Infringement, Media and Internet Business, Cost of Bail Bonds, Loss of Wages, and Defense Costs Coverage is removed',
    coverageRefIds: ['GL.COV.006'], formNumbers: ['CG 21 38'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.023', category: 'PRODUCT', subCategory: 'Deductible Ranges and Defaults',
    condition: 'If Monoline Commercial General Liability is selected',
    outcome: 'Then a Policy Deductible is available and optional',
    coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: ['CG 03 00'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.026', category: 'PRODUCT', subCategory: 'Deductible Ranges and Defaults',
    condition: 'If a Deductible is selected for Monoline Commercial General Liability',
    outcome: 'Then the Policy Deductible is available and mandatory (See Table)',
    ldTableRef: 'LDTable.005', coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: ['CG 03 00'],
    ...FOOTPRINT_SCOPE, ...gov() },

  // ── RATING — illustrative; the GL Rating Specifications encodes rating as GL.RAT.1
  //    steps (not GL.RU rows), so these summarise those steps for the Rules surface. ──
  { refId: 'GL.RU.090', category: 'RATING', subCategory: 'Loss Cost Multiplier',
    condition: 'When a premises/operations premium is computed',
    outcome: 'Then the company Loss Cost Multiplier for the rating state applies (See Table) [GL.RAT.1 s3]',
    ldTableRef: 'RTTable.002', coverageRefIds: ['GL.COV.002','GL.COV.003'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.091', category: 'RATING', subCategory: 'Increased Limit Factor',
    condition: 'When the occurrence and aggregate limits exceed the base 100/300',
    outcome: 'Then the Increased Limit Factor for the selected limits applies (See Table) [GL.RAT.1 s4]',
    ldTableRef: 'RTTable.001', coverageRefIds: ['GL.COV.002','GL.COV.003','GL.COV.004','GL.COV.005'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'GL.RU.092', category: 'RATING', subCategory: 'Premium Floor',
    condition: 'When the computed premium is below the class minimum premium',
    outcome: 'Then the minimum premium for the ISO class table applies (See Table) [GL.RAT.1 s8]',
    ldTableRef: 'RTTable.004', coverageRefIds: [], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
]

// ─── Form attachment rules (GL.FORM.RU.*) — verbatim from GL Optional Forms Rules ─

type FormRuleSeed = Omit<FormRule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_FORM_RULES: FormRuleSeed[] = [
  { refId: 'GL.FORM.RU.001', condition: 'If Pollution Liability Coverage Form Designated Sites is selected',
    outcome: 'Then "Pollution Liability Coverage Form Designated Sites" is available and mandatory',
    formNumbers: ['CG 00 39'], mandatory: true, ...gov() },
  { refId: 'GL.FORM.RU.018', condition: 'If Employee Benefits Liability Coverage is selected',
    outcome: 'Then "Employee Benefits Liability" is available and mandatory',
    formNumbers: ['CG 04 35'], mandatory: true, ...gov() },
]

// ─── Dictionary starter fields ─────────────────────────────────────────────────

type DictSeed = Omit<DictionaryEntry, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const GL_DICTIONARY: DictSeed[] = [
  { name: 'Occurrence Limit',    type: 'CURRENCY', description: 'Each-occurrence limit of liability for bodily injury and property damage', allowedValues: [], format: 'USD', tags: ['limit','rating'], usedIn: [], ...gov() },
  { name: 'General Aggregate Limit', type: 'CURRENCY', description: 'Most the policy will pay in the policy period for covered losses', allowedValues: [], format: 'USD', tags: ['limit'], usedIn: [], ...gov() },
  { name: 'ISO Class Table',     type: 'LIST',     description: 'ISO increased-limit class table (1–3 premises/operations)', allowedValues: ['1','2','3'], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Base Loss Cost',      type: 'CURRENCY', description: 'ISO base loss cost per $1,000 of exposure for the class code', allowedValues: [], format: 'USD', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Loss Cost Multiplier', type: 'PERCENT', description: 'Company multiplier applied to ISO loss costs (filed per state)', allowedValues: [], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Schedule Rating Modification', type: 'PERCENT', description: 'Credit or debit for risk characteristics, capped at ±25%', allowedValues: [], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Claims Basis',        type: 'LIST',     description: 'Occurrence or Claims-made trigger for a coverage', allowedValues: ['Occurrence','Claims-made'], format: '', tags: ['coverage'], usedIn: [], ...gov() },
]
