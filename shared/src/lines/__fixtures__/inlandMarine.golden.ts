// Inland Marine / Valuable Articles golden fixture — INLAND_MARINE family.
// Canary: $1,500. Rates are illustrative; source: ISO IM programme structure and the
// ISO Inland Marine Risk Classification (scheduled personal property classes).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const INLAND_MARINE_ARCHETYPE: LineArchetype = {
  lobRefId:    'IM.FAMILY',
  displayName: 'Inland Marine / Valuable Articles (scheduled + blanket)',
  family:      'INLAND_MARINE',
  // IM products include both scheduled (per-item, agreed value or actual cash value)
  // and blanket (one limit across a category like fine arts or jewelry).
  exposureBases:         ['PER_UNIT', 'REPLACEMENT_COST_VALUE'],
  triggerTypes:          ['OCCURRENCE'],
  // Scheduled = per-item limits; blanket = one limit over a category.
  limitStructures:       ['SCHEDULED', 'BLANKET'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'ADDITIVE_SCHEDULED_PREMIUMS', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // ISO IM scheduled property rates follow the 300–399 band for HO endorsement overlap;
    // standalone IM filings use proprietary numbering.
    { bureau: 'ISO',        rangeStart: 300, rangeEnd: 399, kind: 'SCHEDULED_PROPERTY', description: 'Scheduled personal property class rates ($ per $100 appraised value).' },
    { bureau: 'PROPRIETARY', rangeStart: 1,  rangeEnd: 999, kind: 'FACTOR_TABLE',       description: 'Carrier-proprietary IM rating factors.' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['inland marine rate', 'im rate order', 'valuable articles rate'], confidenceWeight: 0.85 },
    { role: 'MANUAL',      signals: ['inland marine manual', 'im manual', 'valuable articles manual', 'scheduled personal property'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['inland marine policy', 'im 00', 'valuable articles', 'scheduled property floater', 'blanket jewelry'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE', signals: ['class code', 'item class', 'jewelry class', 'fine arts class'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^IM\\s*00|scheduled\\s+personal|valuable\\s+articles',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'ADDITIVE_SCHEDULED_PREMIUMS', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    notes: 'Agreed value (ACV) vs replacement cost settlement option creates a form variant within one product; blanket and scheduled items may coexist on one policy.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Scheduled personal property (jewelry class) rating (all factors illustrative):
//   s1 SET  LI.IM.RT.001[itemClass='JEWELRY'] = 1.50   ($ per $100 scheduled value)
//   s2 MUL  INPUT scheduledValue_per100 = 1000          → 1.50 × 1000 = 1500.00
//   s3 MIN_FLOOR CONST 150                              → max(1500, 150) = 1500
// Expected: $1,500

export const INLAND_MARINE_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.IM.RT.001': {
      // Source: ISO HO SPP class rate conventions (ISO HO 04 61 scheduled personal property
      // rates are the basis for standalone IM class rates).
      name: 'Scheduled Personal Property Rate by Item Class',
      columns: ['itemClass', 'rate'],
      dimensions: [{ key: 'itemClass', label: 'Item Class', values: ['JEWELRY', 'FURS', 'CAMERAS', 'BICYCLES', 'FINE_ARTS', 'SILVERWARE', 'COLLECTIBLES'] }],
      valueColumn: 'rate',
      rows: [
        { itemClass: 'JEWELRY',      rate: 1.50 },
        { itemClass: 'FURS',         rate: 1.25 },
        { itemClass: 'CAMERAS',      rate: 1.00 },
        { itemClass: 'BICYCLES',     rate: 0.90 },
        { itemClass: 'FINE_ARTS',    rate: 0.50 },
        { itemClass: 'SILVERWARE',   rate: 0.60 },
        { itemClass: 'COLLECTIBLES', rate: 1.20 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.IM.RAT.1', name: 'Inland Marine Rating Program (archetype fixture)',
    minimumPremium: 150,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Class rate per $100 scheduled value', op: 'SET',       source: { type: 'RT', ref: 'LI.IM.RT.001', keys: ['itemClass'] } },
      { id: 's2', order: 2, label: 'Scheduled value (per $100)',           op: 'MUL',       source: { type: 'INPUT', ref: 'scheduledValue_per100' } },
      { id: 's3', order: 3, label: 'Minimum premium floor',                op: 'MIN_FLOOR', source: { type: 'CONST', value: 150 }, roundTo: 0 },
    ],
  },
  workedExample: { itemClass: 'JEWELRY', scheduledValue_per100: 1000 },
  expectedPremium: 1500,
}
