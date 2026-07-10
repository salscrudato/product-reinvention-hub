// Commercial Property golden fixture — COMMERCIAL_PROPERTY family.
// Canary: $3,600. Rates are illustrative; source: ISO CP programme (CP 00 10 10 12,
// causes-of-loss forms CP 10 10/20/30, CP 00 90, IL 00 17).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const COMMERCIAL_PROPERTY_ARCHETYPE: LineArchetype = {
  lobRefId:    'CP.FAMILY',
  displayName: 'Commercial Property (ISO CP 00 10)',
  family:      'COMMERCIAL_PROPERTY',
  exposureBases:         ['REPLACEMENT_COST_VALUE', 'PER_LOCATION'],
  triggerTypes:          ['OCCURRENCE'],
  // Blanket: one limit over all locations/items; Scheduled: per-item or per-location limits.
  // Agreed Value (CP 00 10 Optional Coverage G.1) removes the coinsurance penalty.
  limitStructures:       ['BLANKET', 'SCHEDULED'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST',  description: 'CP base loss cost by construction class / protection class and LCM.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',    description: 'CP rating factors (causes of loss, coinsurance, occupancy, sprinkler).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',     description: 'CP minimum premium.' },
    { bureau: 'ISO', rangeStart: 400, rangeEnd: 499, kind: 'PROTECTIVE_DEVICE', description: 'Fire-protection / sprinkler credits.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'CP endorsement premiums (business income, extra expense, etc.).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['commercial property rate', 'cp rate order', 'building and personal property'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['commercial property manual', 'cp 00 10', 'cp manual'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['cp 00 10', 'cp0010', 'building and personal property coverage form', 'causes of loss', 'coinsurance', 'agreed value'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE', signals: ['construction class', 'protection class', 'occupancy class', 'building code class'] , confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^CP\\s*00\\s*10',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    // Coinsurance (80/90/100%) vs agreed value (CP 00 10 Optional Coverage G.1) changes the
    // penalty structure; blanket vs scheduled changes how the limit is apportioned.
    notes: 'Causes-of-loss form selection (Basic CP 10 10 / Broad CP 10 20 / Special CP 10 30) is a major rate multiplier. Agreed Value endorsement removes coinsurance penalty.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// CP rating (all factors illustrative):
//   s1 SET  LI.CP.RT.001[class='8A', protection='3'] = 0.60   ($ per $100 TIV, building)
//   s2 MUL  INPUT tiv_per100 = 5000                           → 0.60 × 5000 = 3000.00
//   s3 MUL  LI.CP.RT.002[cause='BC'] = 1.20   (Broad causes of loss factor) → 3000 × 1.20 = 3600.00
//   s4 MIN_FLOOR CONST 500                                    → max(3600, 500) = 3600
// Expected: $3,600

export const COMMERCIAL_PROPERTY_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.CP.RT.001': {
      // Source: ISO CP construction/protection class rate tables (illustrative).
      // Class 8A = frame, protection class 3.
      name: 'Building Base Rate by Construction and Protection Class',
      columns: ['class', 'protection', 'rate'],
      dimensions: [
        { key: 'class',      label: 'Construction Class', values: ['1A','2A','3A','4A','5A','6A','7A','8A'] },
        { key: 'protection', label: 'Protection Class',   values: ['1','2','3','4','5','6','7','8','9','10'] },
      ],
      valueColumn: 'rate',
      rows: [
        { class: '1A', protection: '3', rate: 0.20 },
        { class: '4A', protection: '3', rate: 0.35 },
        { class: '6A', protection: '3', rate: 0.50 },
        { class: '8A', protection: '3', rate: 0.60 },
        { class: '8A', protection: '6', rate: 0.80 },
        { class: '8A', protection: '9', rate: 1.10 },
      ],
    },
    'LI.CP.RT.002': {
      // Source: ISO CP causes-of-loss factors (Basic / Broad / Special).
      name: 'Causes of Loss Factor',
      columns: ['cause', 'factor'],
      dimensions: [{ key: 'cause', label: 'Causes of Loss', values: ['BA', 'BC', 'SC'] }],
      valueColumn: 'factor',
      rows: [
        { cause: 'BA', factor: 1.00 },  // Basic (CP 10 10)
        { cause: 'BC', factor: 1.20 },  // Broad (CP 10 20)
        { cause: 'SC', factor: 1.45 },  // Special (CP 10 30)
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.CP.RAT.1', name: 'Commercial Property Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Building base rate',       op: 'SET',       source: { type: 'RT', ref: 'LI.CP.RT.001', keys: ['class', 'protection'] } },
      { id: 's2', order: 2, label: 'TIV exposure (per $100)',  op: 'MUL',       source: { type: 'INPUT', ref: 'tiv_per100' } },
      { id: 's3', order: 3, label: 'Causes-of-loss factor',   op: 'MUL',       source: { type: 'RT', ref: 'LI.CP.RT.002', keys: ['cause'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',    op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { class: '8A', protection: '3', tiv_per100: 5000, cause: 'BC' },
  expectedPremium: 3600,
}
