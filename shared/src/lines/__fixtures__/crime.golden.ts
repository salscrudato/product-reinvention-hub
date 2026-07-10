// Crime / Fidelity golden fixture — CRIME family.
// Canary: $450. Rates are illustrative; source: ISO Commercial Crime programme
// (ISO CR 00 22 Commercial Crime Policy — discovery form; also CR 00 23 loss-sustained form).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const CRIME_ARCHETYPE: LineArchetype = {
  lobRefId:    'CR.FAMILY',
  displayName: 'Crime / Fidelity (ISO CR 00 22 discovery form)',
  family:      'CRIME',
  exposureBases:         ['PER_UNIT', 'FLAT'],
  // Commercial crime is written on discovery (claims-made equivalent — covers losses
  // discovered during the policy period regardless of when they occurred).
  triggerTypes:          ['CLAIMS_MADE'],
  limitStructures:       ['SINGLE_AGGREGATE_WITH_SUBLIMITS', 'SCHEDULED'],
  aggregatePatterns:     ['PER_INSURING_AGREEMENT_SUBLIMIT'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 91,  kind: 'FACTOR_TABLE', description: 'Crime base rate tables and rating factors (risk class, number of employees, limit).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',  description: 'Crime minimum premium.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'Crime endorsement premiums (computer fraud, forgery, social engineering).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['crime rate order', 'fidelity rate', 'commercial crime rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['crime manual', 'fidelity manual', 'commercial crime manual', 'cr 00'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['cr 00 22', 'cr0022', 'commercial crime policy', 'discovery form', 'insuring agreement a employee theft', 'forgery'], confidenceWeight: 0.9 },
    { role: 'RULES',       signals: ['crime eligibility', 'fidelity questionnaire', 'employee honesty', 'prior bond cancellation'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^CR\\s*00\\s*2[23]|commercial\\s+crime|fidelity\\s+bond',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    notes: 'Discovery form (CR 00 22) vs loss-sustained form (CR 00 23) is the primary product split. Per-insuring-agreement limits (employee theft, forgery, computer fraud) nest within the policy aggregate.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Crime rating (all factors illustrative):
//   s1 SET  LI.CR.RT.001[riskClass='RETAIL', numEmployees='10'] = 500   (base annual premium)
//   s2 MUL  LI.CR.RT.002[limit='100000'] = 1.00  → 500 × 1.00 = 500.00 (base-limit factor)
//   s3 MUL  LI.CR.RT.003[deductible='1000'] = 0.90 → 500 × 0.90 = 450.00 (deductible credit)
//   s4 MIN_FLOOR CONST 250                          → max(450, 250) = 450
// Expected: $450

export const CRIME_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.CR.RT.001': {
      // Source: ISO crime base rate by risk class and employee count (illustrative).
      name: 'Crime Base Premium by Risk Class and Employee Count',
      columns: ['riskClass', 'numEmployees', 'rate'],
      dimensions: [
        { key: 'riskClass',    label: 'Risk Class',       values: ['RETAIL','PROFESSIONAL','FINANCIAL','HEALTHCARE'] },
        { key: 'numEmployees', label: 'Number of Employees', values: ['1-5','6-10','11-25','26-50'] },
      ],
      valueColumn: 'rate',
      rows: [
        { riskClass: 'RETAIL',       numEmployees: '1-5',   rate: 300 },
        { riskClass: 'RETAIL',       numEmployees: '6-10',  rate: 500 },
        { riskClass: 'RETAIL',       numEmployees: '11-25', rate: 900 },
        { riskClass: 'PROFESSIONAL', numEmployees: '6-10',  rate: 400 },
        { riskClass: 'FINANCIAL',    numEmployees: '6-10',  rate: 900 },
        { riskClass: 'HEALTHCARE',   numEmployees: '6-10',  rate: 600 },
      ],
    },
    'LI.CR.RT.002': {
      // Source: ISO crime limit factor (illustrative; base at $100,000 per-IA limit).
      name: 'Limit Factor',
      columns: ['limit', 'factor'],
      dimensions: [{ key: 'limit', label: 'Per-Insuring-Agreement Limit', values: ['25000','50000','100000','250000','500000'] }],
      valueColumn: 'factor',
      rows: [
        { limit: '25000',  factor: 0.60 },
        { limit: '50000',  factor: 0.80 },
        { limit: '100000', factor: 1.00 },
        { limit: '250000', factor: 1.45 },
        { limit: '500000', factor: 2.10 },
      ],
    },
    'LI.CR.RT.003': {
      // Source: ISO crime deductible credit (illustrative).
      name: 'Deductible Credit Factor',
      columns: ['deductible', 'factor'],
      dimensions: [{ key: 'deductible', label: 'Deductible', values: ['0','500','1000','2500','5000'] }],
      valueColumn: 'factor',
      rows: [
        { deductible: '0',     factor: 1.00 },
        { deductible: '500',   factor: 0.95 },
        { deductible: '1000',  factor: 0.90 },
        { deductible: '2500',  factor: 0.80 },
        { deductible: '5000',  factor: 0.70 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.CR.RAT.1', name: 'Crime Rating Program (archetype fixture)',
    minimumPremium: 250,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by risk class/employees', op: 'SET',       source: { type: 'RT', ref: 'LI.CR.RT.001', keys: ['riskClass', 'numEmployees'] } },
      { id: 's2', order: 2, label: 'Limit factor',                         op: 'MUL',       source: { type: 'RT', ref: 'LI.CR.RT.002', keys: ['limit'] } },
      { id: 's3', order: 3, label: 'Deductible credit',                    op: 'MUL',       source: { type: 'RT', ref: 'LI.CR.RT.003', keys: ['deductible'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',                op: 'MIN_FLOOR', source: { type: 'CONST', value: 250 }, roundTo: 0 },
    ],
  },
  workedExample: { riskClass: 'RETAIL', numEmployees: '6-10', limit: '100000', deductible: '1000' },
  expectedPremium: 450,
}
