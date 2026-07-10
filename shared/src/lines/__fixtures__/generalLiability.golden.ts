// General Liability golden fixture — GENERAL_LIABILITY family.
// Canary: $1,350. Distinct from the production GL $2,635 canary (generalLiability.evaluator.test.ts).
// Rates are illustrative; source: ISO CGL programme structure (CG 00 01 / CG 00 02).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const GENERAL_LIABILITY_ARCHETYPE: LineArchetype = {
  lobRefId:    'GL.LOB.001',
  displayName: 'Commercial General Liability (ISO CGL)',
  family:      'GENERAL_LIABILITY',
  // Most CGL is written on occurrence trigger (CG 00 01); claims-made available (CG 00 02).
  exposureBases:         ['PAYROLL_PER_100', 'GROSS_SALES_PER_1000'],
  triggerTypes:          ['OCCURRENCE', 'CLAIMS_MADE', 'CLAIMS_MADE_WITH_RETRO'],
  limitStructures:       ['PER_OCCURRENCE_PLUS_TWO_AGGREGATES'],
  // ISO CGL standard: general aggregate + products-completed-operations aggregate (CG 00 01 §V).
  aggregatePatterns:     ['GENERAL_AGGREGATE', 'PRODUCTS_COMPLETED_OPS_AGGREGATE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST', description: 'CGL base loss cost by class code and LCM.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',   description: 'CGL rating factors (ILF, deductible, experience mod, schedule rating).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',    description: 'CGL minimum premium.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'CGL endorsement premium schedules (additional insured, etc.).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['commercial general liability rate', 'cgl rate order'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['commercial general liability manual', 'cgl manual', 'cg 00 01'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['cg 00 01', 'cg0001', 'commercial general liability coverage form', 'coverage a bodily injury', 'products-completed operations'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE', signals: ['class code', 'class basis', 'iso classification', 'code 4', 'code 5', 'code 9'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^CG\\s*00\\s*0[12]',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               true,
    hasClaimsMadeStepFactors: false,
    notes: 'PCO aggregate is a separate coverage part; when elected, a second aggregate applies to products-completed-operations hazard (ISO CG 00 01 §V Def 17).',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Simplified GL (occurrence, payroll basis, no PCO — avoids the compound PCO step
// that needs a bespoke getter in the production GL seed):
//   s1 SET  LI.GL.RT.001[classCode='41677'] = 2.50   ($ per $1,000 payroll)
//   s2 MUL  INPUT payroll_per1000 = 400              → 2.50 × 400 = 1000.00
//   s3 MUL  LI.GL.RT.002[occLimit='500000'] = 1.35   (ILF) → 1000 × 1.35 = 1350.00
//   s4 MIN_FLOOR CONST 500                           → max(1350, 500) = 1350
// Expected: $1,350

export const GENERAL_LIABILITY_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.GL.RT.001': {
      // Source: ISO CGL illustrative class rates (samples/iso/20-ISO-Pricing-GL.xlsx).
      name: 'Class Code Base Rate (per $1,000 payroll)',
      columns: ['classCode', 'rate'],
      dimensions: [{ key: 'classCode', label: 'Class Code', values: ['41677', '91342', '96816'] }],
      valueColumn: 'rate',
      rows: [
        { classCode: '41677', rate: 2.50 },
        { classCode: '91342', rate: 1.85 },
        { classCode: '96816', rate: 4.10 },
      ],
    },
    'LI.GL.RT.002': {
      // Source: ISO CGL increased-limits factors (ISO GL ILF table; base limit $100,000).
      name: 'Increased Limits Factor',
      columns: ['occLimit', 'ilf'],
      dimensions: [{ key: 'occLimit', label: 'Per-Occurrence Limit', values: ['100000','300000','500000','1000000'] }],
      valueColumn: 'ilf',
      rows: [
        { occLimit: '100000',  ilf: 1.00 },
        { occLimit: '300000',  ilf: 1.15 },
        { occLimit: '500000',  ilf: 1.35 },
        { occLimit: '1000000', ilf: 1.82 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.GL.RAT.1', name: 'General Liability Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Class code base rate',    op: 'SET',       source: { type: 'RT', ref: 'LI.GL.RT.001', keys: ['classCode'] } },
      { id: 's2', order: 2, label: 'Payroll exposure ($1K)',  op: 'MUL',       source: { type: 'INPUT', ref: 'payroll_per1000' } },
      { id: 's3', order: 3, label: 'Increased-limits factor', op: 'MUL',       source: { type: 'RT', ref: 'LI.GL.RT.002', keys: ['occLimit'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',   op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { classCode: '41677', payroll_per1000: 400, occLimit: '500000' },
  expectedPremium: 1350,
}
