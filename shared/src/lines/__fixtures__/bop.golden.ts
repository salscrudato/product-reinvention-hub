// Business Owners Policy golden fixture — PACKAGE family (BOP, ISO BP 00 03).
// Canary: $1,200. Rates are illustrative; source: ISO BOP programme (BP 00 03 07 13),
// composite rate structure (property + liability in one package rate).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const BOP_ARCHETYPE: LineArchetype = {
  lobRefId:    'BP.FAMILY',
  displayName: 'Business Owners Policy (ISO BOP BP 00 03)',
  family:      'PACKAGE',
  exposureBases:         ['PER_LOCATION', 'REVENUE'],
  triggerTypes:          ['OCCURRENCE'],
  // BOP property is blanket-limit; liability is per-occurrence + aggregate.
  limitStructures:       ['BLANKET', 'PER_OCCURRENCE_PLUS_AGGREGATE'],
  aggregatePatterns:     ['GENERAL_AGGREGATE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'PACKAGE_MODIFICATION', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST',  description: 'BOP composite base rate by SIC/class and protection class.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',    description: 'BOP modifiers (liability limit, optional coverages, sprinkler credit).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',     description: 'BOP minimum premium.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'BOP optional coverage premiums (equipment breakdown, data breach, etc.).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['businessowners rate', 'bop rate order', 'bp 00 03'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['businessowners manual', 'bop manual', 'bp manual'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['bp 00 03', 'bp0003', 'businessowners coverage form', 'section i property', 'section ii liability'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE', signals: ['eligible class', 'sic code', 'naics', 'business class'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^BP\\s*00\\s*03',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'PACKAGE_MODIFICATION', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    notes: 'BOP uses composite (combined property+liability) base rates by SIC class, protection class, and limit. Accounts not eligible for BOP must be placed on a monoline CPP.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// BOP composite rating (all factors illustrative):
//   s1 SET  LI.BP.RT.001[sic='04', protClass='3', limit='1M'] = 1000   (composite annual premium)
//   s2 MUL  LI.BP.RT.002[liabilityFactor='standard'] = 1.20            → 1000 × 1.20 = 1200.00
//   s3 MIN_FLOOR CONST 400                                              → max(1200, 400) = 1200
// Expected: $1,200

export const BOP_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.BP.RT.001': {
      // Source: ISO BOP class/protection/limit composite base premium (illustrative).
      // SIC division 04 = retail trade. Protection class 3 = good public fire protection.
      name: 'BOP Composite Base Premium by Class / Protection / Limit',
      columns: ['sic', 'protClass', 'limit', 'rate'],
      dimensions: [
        { key: 'sic',       label: 'SIC Division',    values: ['01','02','04','07','08'] },
        { key: 'protClass', label: 'Protection Class', values: ['1','3','5','8'] },
        { key: 'limit',     label: 'Liability Limit',  values: ['500K','1M','2M'] },
      ],
      valueColumn: 'rate',
      rows: [
        { sic: '04', protClass: '3', limit: '500K', rate: 750  },
        { sic: '04', protClass: '3', limit: '1M',   rate: 1000 },
        { sic: '04', protClass: '3', limit: '2M',   rate: 1350 },
        { sic: '04', protClass: '8', limit: '1M',   rate: 1400 },
        { sic: '02', protClass: '3', limit: '1M',   rate: 1200 },
      ],
    },
    'LI.BP.RT.002': {
      // Source: ISO BOP liability limit modification factor (illustrative).
      name: 'Liability Modification Factor',
      columns: ['liabilityFactor', 'factor'],
      dimensions: [{ key: 'liabilityFactor', label: 'Liability Factor Type', values: ['reduced','standard','enhanced'] }],
      valueColumn: 'factor',
      rows: [
        { liabilityFactor: 'reduced',  factor: 0.90 },
        { liabilityFactor: 'standard', factor: 1.20 },
        { liabilityFactor: 'enhanced', factor: 1.45 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.BP.RAT.1', name: 'BOP Rating Program (archetype fixture)',
    minimumPremium: 400,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Composite base premium',     op: 'SET',       source: { type: 'RT', ref: 'LI.BP.RT.001', keys: ['sic', 'protClass', 'limit'] } },
      { id: 's2', order: 2, label: 'Liability modification',     op: 'MUL',       source: { type: 'RT', ref: 'LI.BP.RT.002', keys: ['liabilityFactor'] } },
      { id: 's3', order: 3, label: 'Minimum premium floor',      op: 'MIN_FLOOR', source: { type: 'CONST', value: 400 }, roundTo: 0 },
    ],
  },
  workedExample: { sic: '04', protClass: '3', limit: '1M', liabilityFactor: 'standard' },
  expectedPremium: 1200,
}
