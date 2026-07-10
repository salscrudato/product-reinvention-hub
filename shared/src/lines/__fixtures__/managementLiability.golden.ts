// Management Liability golden fixture — MANAGEMENT_LIABILITY family (D&O + EPL).
// Canary: $4,800. Rates are illustrative; source: market conventions for D&O and EPL —
// proprietary-dominant claims-made forms; no ISO standard D&O form exists and few
// insurers use the ISO EPL forms (ISO CG 00 67 / EP 00 01).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const MANAGEMENT_LIABILITY_ARCHETYPE: LineArchetype = {
  lobRefId:    'ML.FAMILY',
  displayName: 'Management Liability (D&O, EPL, Fiduciary — proprietary claims-made)',
  family:      'MANAGEMENT_LIABILITY',
  exposureBases:         ['REVENUE'],
  // Claims-made with retroactive date is the universal market standard for D&O.
  // "No ISO standard D&O form … treat these as proprietary-dominant archetypes."
  triggerTypes:          ['CLAIMS_MADE_WITH_RETRO'],
  limitStructures:       ['SINGLE_AGGREGATE_WITH_SUBLIMITS'],
  aggregatePatterns:     ['PER_INSURING_AGREEMENT_SUBLIMIT'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'CLAIMS_MADE_STEP_FACTOR', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // No ISO standard numbering; proprietary filings dominate.
    { bureau: 'PROPRIETARY', rangeStart: 1, rangeEnd: 999, kind: 'FACTOR_TABLE', description: 'Carrier-proprietary D&O/EPL rating factors (assets band, revenue, SIC, limit, retro year).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['directors officers rate', 'd&o rate', 'epl rate order', 'management liability rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['directors officers manual', 'd&o manual', 'management liability manual', 'employment practices manual'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ["directors' and officers'", 'd&o coverage', 'employment practices liability', 'wrongful act', 'insured persons', 'prior and pending litigation'], confidenceWeight: 0.9 },
    { role: 'RULES',       signals: ['d&o eligibility', 'governance questionnaire', 'epl questionnaire', 'prior claims disclosure'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      "directors|d&o|employment\\s+practices|epl|wrongful\\s+act|fiduciary",
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'CLAIMS_MADE_STEP_FACTOR', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT_MULTI_FORM',
    formSplitDimension:      'Coverage part (D&O / EPL / Fiduciary)',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: true,
    // D&O step factor: year 1 is the first year without a retroactive tail; typically
    // priced at 50–70% of the mature (unlimited retro) rate. 100% reached by year 4–6
    // depending on the insurer's actuarial tables.
    notes: 'No ISO standard D&O form. EPL available on ISO EP 00 01 but market uses proprietary forms. Retroactive date and prior-and-pending date are critical rating variables. Step factor reaches mature rate by year 4–6.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// D&O rating (all factors illustrative):
//   s1 SET  LI.ML.RT.001[assetsBand='10M', limit='2000000'] = 8000   (mature-equivalent base)
//   s2 MUL  LI.ML.RT.002[retroYear='1'] = 0.60   (yr 1 step factor, no prior tail)
//           → 8000 × 0.60 = 4800.00
//   s3 MIN_FLOOR CONST 1500                       → max(4800, 1500) = 4800
// Expected: $4,800

export const MANAGEMENT_LIABILITY_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.ML.RT.001': {
      // Source: carrier-proprietary D&O base premium by total assets and limit (illustrative).
      name: 'D&O Base Premium by Assets Band and Limit',
      columns: ['assetsBand', 'limit', 'rate'],
      dimensions: [
        { key: 'assetsBand', label: 'Total Assets Band', values: ['1M','10M','50M','250M'] },
        { key: 'limit',      label: 'Policy Limit',      values: ['1000000','2000000','5000000'] },
      ],
      valueColumn: 'rate',
      rows: [
        { assetsBand: '1M',  limit: '1000000', rate: 2500 },
        { assetsBand: '10M', limit: '1000000', rate: 5000 },
        { assetsBand: '10M', limit: '2000000', rate: 8000 },
        { assetsBand: '10M', limit: '5000000', rate: 15000 },
        { assetsBand: '50M', limit: '2000000', rate: 14000 },
      ],
    },
    'LI.ML.RT.002': {
      // Source: carrier-proprietary D&O claims-made step factor (illustrative).
      // Year 1 = first year (no retroactive tail) typically priced at 55–70% of mature.
      name: 'Claims-Made Step Factor by Retroactive Year',
      columns: ['retroYear', 'factor'],
      dimensions: [{ key: 'retroYear', label: 'Retroactive Year', values: ['1','2','3','4','5+'] }],
      valueColumn: 'factor',
      rows: [
        { retroYear: '1',  factor: 0.60 },
        { retroYear: '2',  factor: 0.75 },
        { retroYear: '3',  factor: 0.88 },
        { retroYear: '4',  factor: 0.95 },
        { retroYear: '5+', factor: 1.00 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.ML.RAT.1', name: 'Management Liability Rating Program (archetype fixture)',
    minimumPremium: 1500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by assets/limit', op: 'SET',       source: { type: 'RT', ref: 'LI.ML.RT.001', keys: ['assetsBand', 'limit'] } },
      { id: 's2', order: 2, label: 'Claims-made step factor',      op: 'MUL',       source: { type: 'RT', ref: 'LI.ML.RT.002', keys: ['retroYear'] } },
      { id: 's3', order: 3, label: 'Minimum premium floor',        op: 'MIN_FLOOR', source: { type: 'CONST', value: 1500 }, roundTo: 0 },
    ],
  },
  workedExample: { assetsBand: '10M', limit: '2000000', retroYear: '1' },
  expectedPremium: 4800,
}
