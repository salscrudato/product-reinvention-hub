// Cyber golden fixture — CYBER family.
// Canary: $4,000. Rates are illustrative; source: cyber market conventions — claims-made
// trigger, single aggregate with per-insuring-agreement sublimits, WAITING_PERIOD
// retentions for business income / system restoration.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const CYBER_ARCHETYPE: LineArchetype = {
  lobRefId:    'CY.FAMILY',
  displayName: 'Cyber (first/third-party, claims-made)',
  family:      'CYBER',
  exposureBases:         ['REVENUE'],
  // Cyber is exclusively claims-made; retroactive dates are standard on renewal.
  triggerTypes:          ['CLAIMS_MADE', 'CLAIMS_MADE_WITH_RETRO'],
  // Single aggregate policy limit with per-insuring-agreement sublimits (e.g. ransomware,
  // business interruption, regulatory defense each capped within the aggregate).
  limitStructures:       ['SINGLE_AGGREGATE_WITH_SUBLIMITS'],
  aggregatePatterns:     ['PER_INSURING_AGREEMENT_SUBLIMIT'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'CLAIMS_MADE_STEP_FACTOR', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // No ISO standard form; cyber is proprietary-dominant.
    { bureau: 'PROPRIETARY', rangeStart: 1, rangeEnd: 999, kind: 'FACTOR_TABLE', description: 'Carrier-proprietary cyber rating factors (revenue band, industry sector, retention, security controls).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['cyber rate order', 'cyber liability rate', 'data breach rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['cyber manual', 'cyber liability manual', 'data breach manual', 'technology errors and omissions'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['cyber policy', 'data breach', 'ransomware', 'network security', 'privacy liability', 'insuring agreement a', 'insuring agreement b'], confidenceWeight: 0.9 },
    { role: 'RULES',       signals: ['cyber eligibility', 'security controls', 'mfa required', 'edr required', 'network segmentation'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      'cyber|data\\s+breach|network\\s+security|privacy\\s+liability',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'ILF_STEP', 'CLAIMS_MADE_STEP_FACTOR', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    // Cyber typically does NOT ramp up the same way PL/D&O does — most carriers write
    // occurrence-equivalent from policy year 1 with retroactive coverage available.
    // Step factors DO apply when a prior-acts exclusion is in place.
    hasClaimsMadeStepFactors: true,
    notes: 'WAITING_PERIOD deductibles apply to business income / system restoration coverages (hours-based). Sublimits per insuring agreement (ransomware, regulatory, PCI DSS, social engineering) aggregate within the policy limit.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Cyber rating (all factors illustrative):
//   s1 SET  LI.CY.RT.001[revenueBand='5M', retention='10000'] = 4000   (base annual premium)
//   s2 MUL  LI.CY.RT.002[limit='1000000'] = 1.00                       → 4000 × 1.00 = 4000 (base limit)
//   s3 MUL  LI.CY.RT.003[year='1'] = 1.00                              → 4000 × 1.00 = 4000 (yr 1 step factor)
//   s4 MIN_FLOOR CONST 1000                                             → max(4000, 1000) = 4000
// Expected: $4,000

export const CYBER_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.CY.RT.001': {
      // Source: carrier-proprietary cyber base premium by revenue band and retention (illustrative).
      name: 'Cyber Base Premium by Revenue Band and Retention',
      columns: ['revenueBand', 'retention', 'rate'],
      dimensions: [
        { key: 'revenueBand', label: 'Revenue Band',  values: ['1M','5M','25M','100M'] },
        { key: 'retention',   label: 'Retention ($)', values: ['5000','10000','25000','50000'] },
      ],
      valueColumn: 'rate',
      rows: [
        { revenueBand: '1M',  retention: '10000', rate: 1500 },
        { revenueBand: '5M',  retention: '5000',  rate: 5500 },
        { revenueBand: '5M',  retention: '10000', rate: 4000 },
        { revenueBand: '5M',  retention: '25000', rate: 2800 },
        { revenueBand: '25M', retention: '10000', rate: 8500 },
      ],
    },
    'LI.CY.RT.002': {
      // Source: carrier-proprietary cyber ILF table (illustrative; base at $1M aggregate).
      name: 'Aggregate Limit Factor',
      columns: ['limit', 'ilf'],
      dimensions: [{ key: 'limit', label: 'Aggregate Limit', values: ['500000','1000000','2000000','5000000'] }],
      valueColumn: 'ilf',
      rows: [
        { limit: '500000',  ilf: 0.65 },
        { limit: '1000000', ilf: 1.00 },
        { limit: '2000000', ilf: 1.50 },
        { limit: '5000000', ilf: 2.80 },
      ],
    },
    'LI.CY.RT.003': {
      // Source: carrier-proprietary cyber claims-made step factor (illustrative).
      // Year 1 at 100% (cyber typically does not ramp; prior-acts retroactive from inception).
      name: 'Claims-Made Step Factor by Policy Year',
      columns: ['year', 'factor'],
      dimensions: [{ key: 'year', label: 'Policy Year', values: ['1','2','3','4','5+'] }],
      valueColumn: 'factor',
      rows: [
        { year: '1',  factor: 1.00 },
        { year: '2',  factor: 1.00 },
        { year: '3',  factor: 1.00 },
        { year: '4',  factor: 1.00 },
        { year: '5+', factor: 1.00 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.CY.RAT.1', name: 'Cyber Rating Program (archetype fixture)',
    minimumPremium: 1000,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base premium by revenue/retention', op: 'SET',       source: { type: 'RT', ref: 'LI.CY.RT.001', keys: ['revenueBand', 'retention'] } },
      { id: 's2', order: 2, label: 'Aggregate limit factor',             op: 'MUL',       source: { type: 'RT', ref: 'LI.CY.RT.002', keys: ['limit'] } },
      { id: 's3', order: 3, label: 'Claims-made step factor',           op: 'MUL',       source: { type: 'RT', ref: 'LI.CY.RT.003', keys: ['year'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',             op: 'MIN_FLOOR', source: { type: 'CONST', value: 1000 }, roundTo: 0 },
    ],
  },
  workedExample: { revenueBand: '5M', retention: '10000', limit: '1000000', year: '1' },
  expectedPremium: 4000,
}
