// Dwelling Fire / Landlord golden fixture — DWELLING family (ISO DP-3 style).
// Canary: $1,913. Rates are illustrative; source: ISO Dwelling Fire programme (DP 00 03).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const DWELLING_ARCHETYPE: LineArchetype = {
  lobRefId:    'DP.FAMILY',   // virtual — no seeded product yet
  displayName: 'Dwelling Fire / Landlord (DP-1/2/3)',
  family:      'DWELLING',
  exposureBases:         ['REPLACEMENT_COST_VALUE'],
  // ISO DP-3 is an occurrence-trigger form (DP 00 03 — Special Form).
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['BLANKET'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['LOSS_COST_TIMES_LCM', 'BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST', description: 'DP base loss cost and LCM.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',   description: 'DP rating factor tables (construction, protection class, occupancy).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',    description: 'Minimum premium per form (DP-1/2/3).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['dwelling fire rate', 'dp rate order'], confidenceWeight: 0.85 },
    { role: 'MANUAL',      signals: ['dwelling fire manual', 'dp manual', 'dp 00 0'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['dp 00 01', 'dp 00 02', 'dp 00 03', 'dwelling fire policy', 'landlord policy'], confidenceWeight: 0.9 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^DP\\s*00\\s*0[123]',
    ratingProgramStructure:  ['LOSS_COST_TIMES_LCM', 'BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SIBLING_PRODUCTS_PER_FORM',
    formSplitDimension:      'DP form variant (DP-1 / DP-2 / DP-3)',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Premium derivation (all factors illustrative):
//   s1 SET  LI.DP.RT.001[territory='2'] = 1.50   ($ per $100 TIV)
//   s2 MUL  INPUT tiv_per100 = 1500              → 1.50 × 1500 = 2250.00
//   s3 MUL  LI.DP.RT.002[construction='MASONRY'] = 0.85 → 2250 × 0.85 = 1912.50, roundTo=0 → 1913
//   s4 MIN_FLOOR CONST 300                        → max(1913, 300) = 1913
// Expected: $1,913

export const DWELLING_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.DP.RT.001': {
      name: 'Base Rate by Territory',
      columns: ['territory', 'rate'],
      dimensions: [{ key: 'territory', label: 'Territory', values: ['1', '2', '3', '4'] }],
      valueColumn: 'rate',
      rows: [
        { territory: '1', rate: 1.20 },
        { territory: '2', rate: 1.50 },
        { territory: '3', rate: 1.85 },
        { territory: '4', rate: 2.20 },
      ],
    },
    'LI.DP.RT.002': {
      name: 'Construction Factor',
      columns: ['construction', 'factor'],
      dimensions: [{ key: 'construction', label: 'Construction', values: ['FRAME', 'MASONRY', 'SUPERIOR'] }],
      valueColumn: 'factor',
      rows: [
        { construction: 'FRAME',    factor: 1.00 },
        { construction: 'MASONRY',  factor: 0.85 },
        { construction: 'SUPERIOR', factor: 0.70 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.DP.RAT.1', name: 'Dwelling Fire Rating Program (archetype fixture)',
    minimumPremium: 300,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base rate by territory',   op: 'SET',       source: { type: 'RT', ref: 'LI.DP.RT.001', keys: ['territory'] } },
      { id: 's2', order: 2, label: 'TIV exposure (per $100)',  op: 'MUL',       source: { type: 'INPUT', ref: 'tiv_per100' } },
      { id: 's3', order: 3, label: 'Construction factor',      op: 'MUL',       source: { type: 'RT', ref: 'LI.DP.RT.002', keys: ['construction'] }, roundTo: 0 },
      { id: 's4', order: 4, label: 'Minimum premium floor',    op: 'MIN_FLOOR', source: { type: 'CONST', value: 300 } },
    ],
  },
  workedExample: { territory: '2', tiv_per100: 1500, construction: 'MASONRY' },
  expectedPremium: 1913,
}
