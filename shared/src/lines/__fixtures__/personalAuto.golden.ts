// Personal Auto golden fixture — PERSONAL_AUTO family (ISO PP 00 01 style).
// Canary: $1,380. Distinct from the production PA $1,002 canary (personalAuto.evaluator.test.ts).
// Rates are illustrative; source: ISO PAP PP 00 01 programme structure.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const PERSONAL_AUTO_ARCHETYPE: LineArchetype = {
  lobRefId:    'PA.LOB.001',
  displayName: 'Personal Auto (ISO PAP PP 00 01)',
  family:      'PERSONAL_AUTO',
  exposureBases:         ['PER_VEHICLE'],
  // ISO PAP is an occurrence-trigger form (PP 00 01 12 15 §I "We will pay damages…for which any
  // covered person becomes legally responsible because of an auto accident").
  triggerTypes:          ['OCCURRENCE'],
  // Offers both SPLIT (25/50/25) and CSL (combined single limit) options.
  limitStructures:       ['SPLIT', 'CSL'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST', description: 'PA base loss cost by class/territory and LCM.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',   description: 'Driver class, vehicle symbol, use, and other rating factors.' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',    description: 'Minimum premium per coverage part.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'Optional coverage endorsement premiums.' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['personal auto rate order', 'private passenger'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['personal auto manual', 'private passenger manual', 'pp 00 01'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['pp 00 01', 'pp0001', 'personal auto policy', 'part a', 'part b', 'part c', 'part d'], confidenceWeight: 0.9 },
    { role: 'TERRITORY_TABLE', signals: ['territory', 'rating territory', 'zip code territory'], confidenceWeight: 0.8 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^PP\\s*00\\s*01',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               true,
    hasClaimsMadeStepFactors: false,
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Premium derivation (all factors illustrative):
//   s1 SET  LI.PA.RT.001[driverClass='1', territory='3'] = 600   (base annual premium)
//   s2 MUL  INPUT numVehicles = 2                                 → 600 × 2 = 1200.00
//   s3 MUL  LI.PA.RT.002[biLimit='100/300'] = 1.15               → 1200 × 1.15 = 1380.00
//   s4 MIN_FLOOR CONST 200                                        → max(1380, 200) = 1380
// Expected: $1,380

export const PERSONAL_AUTO_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.PA.RT.001': {
      name: 'Base Premium by Driver Class and Territory',
      columns: ['driverClass', 'territory', 'rate'],
      dimensions: [
        { key: 'driverClass', label: 'Driver Class', values: ['1', '2', '3'] },
        { key: 'territory',   label: 'Territory',    values: ['1', '3', '5'] },
      ],
      valueColumn: 'rate',
      rows: [
        { driverClass: '1', territory: '1', rate: 500 },
        { driverClass: '1', territory: '3', rate: 600 },
        { driverClass: '1', territory: '5', rate: 750 },
        { driverClass: '2', territory: '3', rate: 800 },
        { driverClass: '3', territory: '3', rate: 1100 },
      ],
    },
    'LI.PA.RT.002': {
      name: 'BI Limit Relativity',
      columns: ['biLimit', 'factor'],
      dimensions: [{ key: 'biLimit', label: 'BI Limit', values: ['25/50', '50/100', '100/300', '250/500'] }],
      valueColumn: 'factor',
      rows: [
        { biLimit: '25/50',   factor: 0.80 },
        { biLimit: '50/100',  factor: 0.90 },
        { biLimit: '100/300', factor: 1.15 },
        { biLimit: '250/500', factor: 1.45 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.PA.RAT.1', name: 'Personal Auto Rating Program (archetype fixture)',
    minimumPremium: 200,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by class/territory', op: 'SET',       source: { type: 'RT', ref: 'LI.PA.RT.001', keys: ['driverClass', 'territory'] } },
      { id: 's2', order: 2, label: 'Number of vehicles',              op: 'MUL',       source: { type: 'INPUT', ref: 'numVehicles' } },
      { id: 's3', order: 3, label: 'BI limit relativity',             op: 'MUL',       source: { type: 'RT', ref: 'LI.PA.RT.002', keys: ['biLimit'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',           op: 'MIN_FLOOR', source: { type: 'CONST', value: 200 }, roundTo: 0 },
    ],
  },
  workedExample: { driverClass: '1', territory: '3', numVehicles: 2, biLimit: '100/300' },
  expectedPremium: 1380,
}
