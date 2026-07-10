// Commercial Excess / Umbrella golden fixture — UMBRELLA family (commercial).
// Canary: $4,000. Rates are illustrative; source: ISO commercial umbrella conventions
// (CU 00 01 11 85 Commercial Umbrella Liability Policy) and excess-liability market norms.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const EXCESS_UMBRELLA_ARCHETYPE: LineArchetype = {
  lobRefId:    'XS.FAMILY',
  displayName: 'Commercial Excess / Umbrella (follow-form + drop-down)',
  family:      'UMBRELLA',
  exposureBases:         ['PER_LOCATION', 'FLAT', 'REVENUE'],
  // Commercial umbrella is occurrence-trigger following the underlying policy;
  // excess follow-form matches the underlying trigger (occurrence or claims-made).
  triggerTypes:          ['OCCURRENCE', 'CLAIMS_MADE_WITH_RETRO'],
  limitStructures:       ['CSL', 'PER_OCCURRENCE_PLUS_AGGREGATE'],
  aggregatePatterns:     ['GENERAL_AGGREGATE', 'PRODUCTS_COMPLETED_OPS_AGGREGATE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO',        rangeStart: 1,   rangeEnd: 91,  kind: 'FACTOR_TABLE', description: 'ISO CU base rate tables and rating factors (primary-line limit, layers, retained limit).' },
    { bureau: 'ISO',        rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',  description: 'Commercial umbrella minimum premium.' },
    { bureau: 'PROPRIETARY', rangeStart: 1,  rangeEnd: 999, kind: 'FACTOR_TABLE', description: 'Carrier-proprietary excess/umbrella pricing (loss-sensitive, large-account).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['commercial umbrella rate', 'excess liability rate', 'umbrella rate order', 'cu 00'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['commercial umbrella manual', 'excess liability manual', 'cu manual'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['cu 00 01', 'commercial umbrella', 'umbrella liability', 'retained limit', 'underlying insurance', 'drop-down coverage'], confidenceWeight: 0.9 },
    { role: 'DECLARATIONS', signals: ['schedule of underlying insurance', 'retained limit', 'umbrella declarations'], confidenceWeight: 0.8 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^CU\\s*00\\s*01|commercial\\s+umbrella|excess\\s+liability',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    notes: 'Commercial umbrella drops down to fill primary-policy gaps; excess follow-form strictly follows the underlying triggers and exclusions. Retained limit = the underlying per-occurrence limit the umbrella sits above.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Commercial umbrella rating (all factors illustrative):
//   s1 SET  LI.XS.RT.001[primaryLine='GL', limit='1M'] = 2000   (base annual premium per $1M)
//   s2 MUL  INPUT numMillions = 2                                → 2000 × 2 = 4000.00
//   s3 MIN_FLOOR CONST 500                                       → max(4000, 500) = 4000
// Expected: $4,000

export const EXCESS_UMBRELLA_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.XS.RT.001': {
      // Source: ISO CU base premium per $1M of umbrella limit by primary line (illustrative).
      name: 'Umbrella Base Premium per $1M by Primary Line',
      columns: ['primaryLine', 'limit', 'rate'],
      dimensions: [
        { key: 'primaryLine', label: 'Primary Line of Business', values: ['GL','CPP','BOP','CA'] },
        { key: 'limit',       label: 'Underlying Retained Limit', values: ['1M','2M','5M'] },
      ],
      valueColumn: 'rate',
      rows: [
        { primaryLine: 'GL',  limit: '1M', rate: 2000 },
        { primaryLine: 'GL',  limit: '2M', rate: 1500 },
        { primaryLine: 'CPP', limit: '1M', rate: 1800 },
        { primaryLine: 'BOP', limit: '1M', rate: 1200 },
        { primaryLine: 'CA',  limit: '1M', rate: 2500 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.XS.RAT.1', name: 'Commercial Excess/Umbrella Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium per $1M of limit', op: 'SET',       source: { type: 'RT', ref: 'LI.XS.RT.001', keys: ['primaryLine', 'limit'] } },
      { id: 's2', order: 2, label: 'Number of $1M limit layers',    op: 'MUL',       source: { type: 'INPUT', ref: 'numMillions' } },
      { id: 's3', order: 3, label: 'Minimum premium floor',         op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { primaryLine: 'GL', limit: '1M', numMillions: 2 },
  expectedPremium: 4000,
}
