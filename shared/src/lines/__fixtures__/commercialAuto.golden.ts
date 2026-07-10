// Commercial Auto golden fixture — COMMERCIAL_AUTO family (ISO CA 00 01).
// Canary: $3,570. Rates are illustrative; source: ISO BAP CA 00 01 programme structure,
// covered-auto symbols 1–9 and 19 (ISO CA 00 01 12 93 §I).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const COMMERCIAL_AUTO_ARCHETYPE: LineArchetype = {
  lobRefId:    'CA.FAMILY',
  displayName: 'Commercial Auto (ISO BAP CA 00 01)',
  family:      'COMMERCIAL_AUTO',
  exposureBases:         ['PER_VEHICLE'],
  triggerTypes:          ['OCCURRENCE'],
  // Offers both SPLIT (BI/PD separate) and CSL options; symbol-driven coverage selection.
  limitStructures:       ['SPLIT', 'CSL'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    { bureau: 'ISO', rangeStart: 1,   rangeEnd: 2,   kind: 'BASE_LOSS_COST', description: 'CA base loss cost by symbol/territory and LCM.' },
    { bureau: 'ISO', rangeStart: 3,   rangeEnd: 91,  kind: 'FACTOR_TABLE',   description: 'CA rating factors (vehicle use, fleet size, driver record).' },
    { bureau: 'ISO', rangeStart: 205, rangeEnd: 205, kind: 'MIN_PREMIUM',    description: 'CA minimum premium per vehicle.' },
    { bureau: 'ISO', rangeStart: 500, rangeEnd: 699, kind: 'ENDORSEMENT_SCHEDULE', description: 'CA endorsement premiums (hired auto, non-owned, etc.).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['commercial auto rate', 'ca rate order', 'business auto rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['commercial auto manual', 'business auto manual', 'ca 00 01'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['ca 00 01', 'ca0001', 'business auto coverage form', 'covered auto symbol', 'section i liability'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE', signals: ['symbol', 'vehicle symbol', 'covered auto', 'radius class', 'fleet discount'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    // ISO BAP CA 00 01; covered-auto symbols 1–9 and 19 define which autos are covered.
    primaryFormPattern:      '^CA\\s*00\\s*01',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'EXPERIENCE_MOD', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               true,
    hasClaimsMadeStepFactors: false,
    notes: 'Covered-auto symbols 1–9 select the coverage universe; Symbol 19 (mobile equipment subject to compulsory or financial-responsibility law) is a specialty extension. Fleet discounts apply above threshold vehicle counts.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// CA rating (all factors illustrative):
//   s1 SET  LI.CA.RT.001[symbol='7', territory='5'] = 850   (base annual premium per unit)
//   s2 MUL  INPUT numUnits = 3                              → 850 × 3 = 2550.00
//   s3 MUL  LI.CA.RT.002[biLimit='500/1000'] = 1.40         → 2550 × 1.40 = 3570.00
//   s4 MIN_FLOOR CONST 500                                  → max(3570, 500) = 3570
// Expected: $3,570

export const COMMERCIAL_AUTO_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.CA.RT.001': {
      // Source: ISO CA symbol/territory base rate structure (illustrative).
      // Symbol 7 = autos specifically described; territory 5 = example urban-suburban territory.
      name: 'Base Premium by Symbol and Territory',
      columns: ['symbol', 'territory', 'rate'],
      dimensions: [
        { key: 'symbol',    label: 'Covered Auto Symbol', values: ['1','7','8','9'] },
        { key: 'territory', label: 'Rating Territory',    values: ['1','3','5','7'] },
      ],
      valueColumn: 'rate',
      rows: [
        { symbol: '1', territory: '5', rate: 1100 },
        { symbol: '7', territory: '3', rate: 700  },
        { symbol: '7', territory: '5', rate: 850  },
        { symbol: '7', territory: '7', rate: 1050 },
        { symbol: '9', territory: '5', rate: 600  },
      ],
    },
    'LI.CA.RT.002': {
      // Source: ISO CA BI limit relativities (illustrative).
      name: 'BI Limit Relativity',
      columns: ['biLimit', 'factor'],
      dimensions: [{ key: 'biLimit', label: 'BI Limit (000 per person/accident)', values: ['25/50','100/300','300/600','500/1000'] }],
      valueColumn: 'factor',
      rows: [
        { biLimit: '25/50',    factor: 0.75 },
        { biLimit: '100/300',  factor: 1.00 },
        { biLimit: '300/600',  factor: 1.20 },
        { biLimit: '500/1000', factor: 1.40 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.CA.RAT.1', name: 'Commercial Auto Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by symbol/territory', op: 'SET',       source: { type: 'RT', ref: 'LI.CA.RT.001', keys: ['symbol', 'territory'] } },
      { id: 's2', order: 2, label: 'Number of vehicles',               op: 'MUL',       source: { type: 'INPUT', ref: 'numUnits' } },
      { id: 's3', order: 3, label: 'BI limit relativity',              op: 'MUL',       source: { type: 'RT', ref: 'LI.CA.RT.002', keys: ['biLimit'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',            op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { symbol: '7', territory: '5', numUnits: 3, biLimit: '500/1000' },
  expectedPremium: 3570,
}
