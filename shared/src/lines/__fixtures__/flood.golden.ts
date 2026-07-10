// Flood golden fixture — FLOOD family (NFIP Risk Rating 2.0 + private flood).
// Canary: $750. Rates are illustrative; source: FEMA NFIP Risk Rating 2.0 methodology
// (per-property multivariable pricing, effective Oct 2021) and CRS discount schedule.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const FLOOD_ARCHETYPE: LineArchetype = {
  lobRefId:    'FL.FAMILY',
  displayName: 'Flood (NFIP Risk Rating 2.0 + private)',
  family:      'FLOOD',
  exposureBases:         ['COVERAGE_A_AMOUNT', 'REPLACEMENT_COST_VALUE'],
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['BLANKET', 'PERCENTAGE_DEDUCTIBLE'],
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // NFIP does not use ISO rule numbers; rates are administratively set by FEMA.
    { bureau: 'PROPRIETARY', rangeStart: 1,   rangeEnd: 999, kind: 'FACTOR_TABLE', description: 'FEMA NFIP rate tables by flood zone, construction, and CRS class discount.' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['flood rate order', 'nfip rate', 'fema flood rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['flood manual', 'nfip manual', 'flood insurance manual', 'risk rating 2.0'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['standard flood insurance policy', 'sfip', 'flood insurance policy', 'dwelling form', 'general property form'], confidenceWeight: 0.9 },
    { role: 'TERRITORY_TABLE', signals: ['flood zone', 'sfha', 'community rating system', 'crs class'], confidenceWeight: 0.8 },
  ],
  translationRecipe: {
    primaryFormPattern:      'sfip|standard\\s+flood|flood\\s+insurance\\s+policy|dwelling\\s+form',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SIBLING_PRODUCTS_PER_FORM',
    formSplitDimension:      'NFIP form (Dwelling / General Property / RCBAP)',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: false,
    // Statutory annual premium increase caps: 18% primary residence, 25% other property
    // (Biggert-Waters 2012 §100205, Homeowner Flood Insurance Affordability Act 2014 §8).
    // CRS discount: 5% per CRS class improvement step, 45% maximum (FEMA NFIP CRS Coordinator's Manual).
    notes: 'Statutory rate caps: +18% primary / +25% other per policy year. CRS discount: 5–45% (class 1–9). Private flood may deviate; Risk Rating 2.0 uses per-property multivariable risk scores.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// NFIP-style flood rating (all factors illustrative):
//   s1 SET  LI.FL.RT.001[zone='AE', construction='POST_FIRM'] = 0.40   ($ per $100 Coverage A)
//   s2 MUL  INPUT coverageA_per100 = 2500                               → 0.40 × 2500 = 1000.00
//   s3 MUL  LI.FL.RT.002[crsClass='7'] = 0.75   (CRS class 7 = 25% discount) → 1000 × 0.75 = 750.00
//   s4 MIN_FLOOR CONST 100                                               → max(750, 100) = 750
// Expected: $750

export const FLOOD_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.FL.RT.001': {
      // Source: FEMA NFIP Rate Tables (illustrative; actual tables use multi-variable risk scoring).
      name: 'Flood Base Rate by Zone and Construction',
      columns: ['zone', 'construction', 'rate'],
      dimensions: [
        { key: 'zone',         label: 'Flood Zone',  values: ['X', 'AE', 'AO', 'VE'] },
        { key: 'construction', label: 'Construction', values: ['PRE_FIRM', 'POST_FIRM'] },
      ],
      valueColumn: 'rate',
      rows: [
        { zone: 'X',  construction: 'PRE_FIRM',  rate: 0.10 },
        { zone: 'X',  construction: 'POST_FIRM', rate: 0.08 },
        { zone: 'AE', construction: 'PRE_FIRM',  rate: 0.65 },
        { zone: 'AE', construction: 'POST_FIRM', rate: 0.40 },
        { zone: 'AO', construction: 'POST_FIRM', rate: 0.55 },
        { zone: 'VE', construction: 'POST_FIRM', rate: 0.90 },
      ],
    },
    'LI.FL.RT.002': {
      // Source: FEMA NFIP Community Rating System (CRS) discount schedule — 5% per class step.
      // Class 1 = 45% discount; Class 10 = no discount (non-participating community).
      name: 'CRS Discount Factor by Class',
      columns: ['crsClass', 'factor'],
      dimensions: [{ key: 'crsClass', label: 'CRS Class', values: ['1','2','3','4','5','6','7','8','9','10'] }],
      valueColumn: 'factor',
      rows: [
        { crsClass: '1',  factor: 0.55 },
        { crsClass: '2',  factor: 0.60 },
        { crsClass: '3',  factor: 0.65 },
        { crsClass: '4',  factor: 0.70 },
        { crsClass: '5',  factor: 0.75 },
        { crsClass: '6',  factor: 0.80 },
        { crsClass: '7',  factor: 0.75 },
        { crsClass: '8',  factor: 0.90 },
        { crsClass: '9',  factor: 0.95 },
        { crsClass: '10', factor: 1.00 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.FL.RAT.1', name: 'Flood Rating Program (archetype fixture)',
    minimumPremium: 100,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Base rate by zone/construction', op: 'SET',       source: { type: 'RT', ref: 'LI.FL.RT.001', keys: ['zone', 'construction'] } },
      { id: 's2', order: 2, label: 'Coverage A exposure (per $100)', op: 'MUL',       source: { type: 'INPUT', ref: 'coverageA_per100' } },
      { id: 's3', order: 3, label: 'CRS discount factor',            op: 'MUL',       source: { type: 'RT', ref: 'LI.FL.RT.002', keys: ['crsClass'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',          op: 'MIN_FLOOR', source: { type: 'CONST', value: 100 }, roundTo: 0 },
    ],
  },
  workedExample: { zone: 'AE', construction: 'POST_FIRM', coverageA_per100: 2500, crsClass: '7' },
  expectedPremium: 750,
}
