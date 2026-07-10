// Homeowners golden fixture — PERSONAL_PROPERTY family (HO-3 style).
// Canary: $3,520. Distinct from the production HO-3 $1,528 canary (evaluator.test.ts).
// Rates are illustrative; sources: ISO HO-3 program structure and rating manual conventions.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const HOMEOWNERS_ARCHETYPE: LineArchetype = {
  lobRefId:    'PH.LOB.001',
  displayName: 'Homeowners (HO-2/3/4/5/6/8)',
  family:      'PERSONAL_PROPERTY',
  exposureBases:         ['COVERAGE_A_AMOUNT'],
  // ISO HO-3 is an occurrence-trigger form (ISO HO 00 03 10 00 §I — Perils Insured Against).
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['BLANKET'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['LOSS_COST_TIMES_LCM', 'BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST',      description: 'HO base loss cost (Rule 1) and LCM (Rule 2).' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',        description: 'Rating factor tables in the adjusted-base chain.' },
    { bureau: 'ISO', rangeStart: 92,  rangeEnd: 92,  kind: 'CREDIT_CAP',          description: 'Maximum total credits floor (Rule 92).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',         description: 'Minimum premium per form (Rule 205).' },
    { bureau: 'ISO', rangeStart: 406, rangeEnd: 406, kind: 'DEDUCTIBLE',          description: 'All-perils deductible credit matrix (Rule 406).' },
    { bureau: 'ISO', rangeStart: 400, rangeEnd: 499, kind: 'PROTECTIVE_DEVICE',   description: 'Protective device credits (Rules 400–499).' },
    { bureau: 'ISO', rangeStart: 300, rangeEnd: 399, kind: 'SCHEDULED_PROPERTY',  description: 'Scheduled personal property rates (Rules 300–399).' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'Endorsement premium schedules (Rules 500–699).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['rate order', 'order of calculation', 'rate filing'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['homeowners manual', 'ho manual', 'rating manual', 'loss cost'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['ho 00 0', 'ho0003', 'homeowners policy', 'section i', 'section ii'], confidenceWeight: 0.9 },
    { role: 'RULES',       signals: ['eligibility rules', 'underwriting guidelines', 'ho rules'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    // ISO HO-3 10 00 base form; carriers use proprietary equivalents like LEM 03 05 23.
    primaryFormPattern:      '^(HO|LEM)\\s*0*3',
    ratingProgramStructure:  ['LOSS_COST_TIMES_LCM', 'BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
    // HO-3 vs HO-5 → separate sibling products sharing a product line.
    productSplitStrategy:    'SIBLING_PRODUCTS_PER_FORM',
    formSplitDimension:      'HO form variant (HO-3 / HO-5)',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Premium derivation (all factors illustrative):
//   s1 SET  LI.HO.RT.001[territory='1'] = 2.00   ($ per $100 Coverage A)
//   s2 MUL  INPUT coverageA_per100 = 2000         → 2.00 × 2000 = 4000.00
//   s3 MUL  LI.HO.RT.002[construction='FRAME'] = 1.10 → 4000 × 1.10 = 4400.00
//   s4 MUL  LI.HO.RT.003[ageGroup='NEW'] = 0.80   → 4400 × 0.80 = 3520.00
//   s5 MIN_FLOOR CONST 500                         → max(3520, 500) = 3520
// Expected: $3,520

export const HOMEOWNERS_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.HO.RT.001': {
      name: 'Base Rate by Territory',
      columns: ['territory', 'rate'],
      dimensions: [{ key: 'territory', label: 'Territory', values: ['1', '2', '3'] }],
      valueColumn: 'rate',
      rows: [
        { territory: '1', rate: 2.00 },
        { territory: '2', rate: 2.50 },
        { territory: '3', rate: 3.00 },
      ],
    },
    'LI.HO.RT.002': {
      name: 'Construction Type Factor',
      columns: ['construction', 'factor'],
      dimensions: [{ key: 'construction', label: 'Construction', values: ['FRAME', 'MASONRY', 'SUPERIOR'] }],
      valueColumn: 'factor',
      rows: [
        { construction: 'FRAME',    factor: 1.10 },
        { construction: 'MASONRY',  factor: 0.90 },
        { construction: 'SUPERIOR', factor: 0.75 },
      ],
    },
    'LI.HO.RT.003': {
      name: 'Age of Home Factor',
      columns: ['ageGroup', 'factor'],
      dimensions: [{ key: 'ageGroup', label: 'Age Group', values: ['NEW', '1-5', '6-15', '16-25', '25+'] }],
      valueColumn: 'factor',
      rows: [
        { ageGroup: 'NEW',   factor: 0.80 },
        { ageGroup: '1-5',   factor: 0.90 },
        { ageGroup: '6-15',  factor: 1.00 },
        { ageGroup: '16-25', factor: 1.15 },
        { ageGroup: '25+',   factor: 1.30 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.HO.RAT.1', name: 'Homeowners Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base rate by territory',   op: 'SET',       source: { type: 'RT', ref: 'LI.HO.RT.001', keys: ['territory'] } },
      { id: 's2', order: 2, label: 'Coverage A exposure',       op: 'MUL',       source: { type: 'INPUT', ref: 'coverageA_per100' } },
      { id: 's3', order: 3, label: 'Construction type factor',  op: 'MUL',       source: { type: 'RT', ref: 'LI.HO.RT.002', keys: ['construction'] } },
      { id: 's4', order: 4, label: 'Age of home factor',        op: 'MUL',       source: { type: 'RT', ref: 'LI.HO.RT.003', keys: ['ageGroup'] } },
      { id: 's5', order: 5, label: 'Minimum premium floor',     op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { territory: '1', coverageA_per100: 2000, construction: 'FRAME', ageGroup: 'NEW' },
  expectedPremium: 3520,
}
