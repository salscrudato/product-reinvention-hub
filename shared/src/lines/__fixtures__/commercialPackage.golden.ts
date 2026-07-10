// Commercial Package Policy golden fixture — PACKAGE family (CPP).
// Canary: $3,325. Rates are illustrative; source: ISO CPP IL declarations structure —
// coverage parts share IL 00 17 declarations and IL 00 21 conditions; each part is rated
// separately and a package modification factor is applied to the combined total.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const COMMERCIAL_PACKAGE_ARCHETYPE: LineArchetype = {
  lobRefId:    'CPP.FAMILY',
  displayName: 'Commercial Package Policy (ISO CPP)',
  family:      'PACKAGE',
  exposureBases:         ['PER_LOCATION', 'REVENUE'],
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['BLANKET', 'PER_OCCURRENCE_PLUS_AGGREGATE'],
  aggregatePatterns:     ['GENERAL_AGGREGATE', 'PRODUCTS_COMPLETED_OPS_AGGREGATE'],
  ratingStageArchetypes: ['ADDITIVE_SCHEDULED_PREMIUMS', 'PACKAGE_MODIFICATION', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // CPP rules are per coverage part (CP, CA, GL, CrP, etc.); the package discount
    // is a cross-part modification. ISO rule numbers apply per part.
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 91,  kind: 'FACTOR_TABLE',   description: 'Coverage-part-specific rating factors.' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',    description: 'Package minimum premium.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'Cross-part endorsement premiums.' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['commercial package rate', 'cpp rate order', 'package policy rate'], confidenceWeight: 0.85 },
    { role: 'MANUAL',      signals: ['commercial package manual', 'cpp manual', 'package modification'], confidenceWeight: 0.80 },
    { role: 'POLICY_FORM', signals: ['il 00 17', 'il 00 21', 'common policy declarations', 'common policy conditions', 'coverage parts'], confidenceWeight: 0.9 },
    { role: 'DECLARATIONS', signals: ['common policy declarations', 'il 00 17', 'named insured', 'policy period', 'coverage parts forming part of this policy'], confidenceWeight: 0.85 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^IL\\s*00\\s*17|commercial\\s+package',
    ratingProgramStructure:  ['ADDITIVE_SCHEDULED_PREMIUMS', 'PACKAGE_MODIFICATION', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    defaultVariableOp:       'ADD',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    notes: 'Coverage parts (CP, CA, CGL, CrP, etc.) are rated independently; their premiums are summed then multiplied by the package modification factor. IL 00 17 is the common declarations; IL 00 21 the common conditions.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// CPP: sum coverage-part premiums → package discount:
//   s1 SET  INPUT premCP = 2000   → 2000.00 (CP portion)
//   s2 ADD  INPUT premGL = 1500   → 2000 + 1500 = 3500.00 (GL portion)
//   s3 MUL  LI.CPP.RT.001[parts='2'] = 0.95   → 3500 × 0.95 = 3325.00 (package discount)
//   s4 MIN_FLOOR CONST 500        → max(3325, 500) = 3325
// Expected: $3,325

export const COMMERCIAL_PACKAGE_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.CPP.RT.001': {
      // Source: ISO CPP package modification factor (illustrative).
      // A 2-part package (CP + CGL) earns a 5% discount; more parts earn more.
      name: 'Package Modification Factor by Number of Coverage Parts',
      columns: ['parts', 'factor'],
      dimensions: [{ key: 'parts', label: 'Coverage Parts', values: ['1','2','3','4+'] }],
      valueColumn: 'factor',
      rows: [
        { parts: '1',  factor: 1.00 },
        { parts: '2',  factor: 0.95 },
        { parts: '3',  factor: 0.92 },
        { parts: '4+', factor: 0.90 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.CPP.RAT.1', name: 'Commercial Package Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Commercial Property premium', op: 'SET',       source: { type: 'INPUT', ref: 'premCP' } },
      { id: 's2', order: 2, label: 'General Liability premium',   op: 'ADD',       source: { type: 'INPUT', ref: 'premGL' } },
      { id: 's3', order: 3, label: 'Package modification factor', op: 'MUL',       source: { type: 'RT', ref: 'LI.CPP.RT.001', keys: ['parts'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',       op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { premCP: 2000, premGL: 1500, parts: '2' },
  expectedPremium: 3325,
}
