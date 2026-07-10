// Personal Umbrella golden fixture — UMBRELLA family (personal lines).
// Canary: $1,500. Rates are illustrative; source: ISO UE-form personal umbrella conventions.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const PERSONAL_UMBRELLA_ARCHETYPE: LineArchetype = {
  lobRefId:    'PU.FAMILY',
  displayName: 'Personal Umbrella',
  family:      'UMBRELLA',
  exposureBases:         ['PER_LOCATION', 'FLAT'],
  // Personal umbrella is an occurrence-trigger form following the underlying policy.
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['CSL'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 50,  kind: 'FACTOR_TABLE', description: 'Umbrella rating factors by underlying-policy retention and household exposures.' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',  description: 'Minimum premium.' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['personal umbrella rate', 'umbrella rate order'], confidenceWeight: 0.85 },
    { role: 'MANUAL',      signals: ['personal umbrella manual', 'umbrella manual'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['personal umbrella policy', 'umbrella liability', 'excess liability', 'ue 00'], confidenceWeight: 0.9 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^UE\\s*00|personal\\s+umbrella',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Premium derivation (all factors illustrative):
//   s1 SET  LI.PU.RT.001[retention='300000', limit='1000000'] = 750   (base annual premium)
//   s2 MUL  INPUT numLocations = 2                                     → 750 × 2 = 1500.00
//   s3 MIN_FLOOR CONST 500                                             → max(1500, 500) = 1500
// Expected: $1,500

export const PERSONAL_UMBRELLA_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.PU.RT.001': {
      name: 'Personal Umbrella Base Premium (retention × limit)',
      columns: ['retention', 'limit', 'rate'],
      dimensions: [
        { key: 'retention', label: 'Underlying Retention', values: ['100000', '300000', '500000'] },
        { key: 'limit',     label: 'Umbrella Limit',       values: ['1000000', '2000000', '5000000'] },
      ],
      valueColumn: 'rate',
      rows: [
        { retention: '100000', limit: '1000000', rate: 900 },
        { retention: '300000', limit: '1000000', rate: 750 },
        { retention: '500000', limit: '1000000', rate: 600 },
        { retention: '300000', limit: '2000000', rate: 1000 },
        { retention: '300000', limit: '5000000', rate: 1500 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.PU.RAT.1', name: 'Personal Umbrella Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by retention/limit', op: 'SET',       source: { type: 'RT', ref: 'LI.PU.RT.001', keys: ['retention', 'limit'] } },
      { id: 's2', order: 2, label: 'Number of locations/households',  op: 'MUL',       source: { type: 'INPUT', ref: 'numLocations' } },
      { id: 's3', order: 3, label: 'Minimum premium floor',           op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { retention: '300000', limit: '1000000', numLocations: 2 },
  expectedPremium: 1500,
}
