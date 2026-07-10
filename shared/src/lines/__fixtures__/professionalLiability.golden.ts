// Professional Liability / E&O golden fixture — PROFESSIONAL_LIABILITY family.
// Canary: $1,215. Rates are illustrative; source: E&O market conventions — claims-made
// trigger; step rating to maturity (first-year roughly 38–60% of occurrence-equivalent,
// 100% by year 5) per widely-cited actuarial study (Gillam & Snader, 1992).
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const PROFESSIONAL_LIABILITY_ARCHETYPE: LineArchetype = {
  lobRefId:    'PL.FAMILY',
  displayName: 'Professional Liability / E&O (claims-made, step-rated)',
  family:      'PROFESSIONAL_LIABILITY',
  exposureBases:         ['REVENUE', 'FLAT'],
  triggerTypes:          ['CLAIMS_MADE', 'CLAIMS_MADE_WITH_RETRO'],
  limitStructures:       ['PER_OCCURRENCE_PLUS_AGGREGATE'],
  aggregatePatterns:     ['GENERAL_AGGREGATE'],
  ratingStageArchetypes: ['BASE_RATE_RELATIVITY_CHAIN', 'CLAIMS_MADE_STEP_FACTOR', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // Some PL segments have ISO forms (CG 22 43 accountants, etc.) but most are proprietary.
    { bureau: 'ISO',        rangeStart: 1,   rangeEnd: 91,  kind: 'FACTOR_TABLE', description: 'ISO E&O base rates and factors (where ISO forms exist, e.g. CG 22 43).' },
    { bureau: 'PROPRIETARY', rangeStart: 1,  rangeEnd: 999, kind: 'FACTOR_TABLE', description: 'Carrier-proprietary PL rating factors (profession class, revenue, deductible, step factor).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',  signals: ['professional liability rate', 'e&o rate order', 'errors and omissions rate', 'tech e&o rate'], confidenceWeight: 0.9 },
    { role: 'MANUAL',      signals: ['professional liability manual', 'e&o manual', 'errors and omissions manual', 'professional indemnity'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM', signals: ['professional liability', 'errors and omissions', 'wrongful act', 'claims-made and reported', 'retroactive date', 'prior acts'], confidenceWeight: 0.9 },
    { role: 'RULES',       signals: ['professional services', 'eligible professions', 'prior claims', 'professional indemnity questionnaire'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      'professional\\s+liability|errors\\s+and\\s+omissions|e&o|professional\\s+indemnity',
    ratingProgramStructure:  ['BASE_RATE_RELATIVITY_CHAIN', 'CLAIMS_MADE_STEP_FACTOR', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              false,
    hasExpMod:               false,
    hasClaimsMadeStepFactors: true,
    // Step factor reaches 100% (occurrence-equivalent) by policy year 5.
    // First-year factor approximately 38–60% depending on profession and insurer
    // (Gillam & Snader 1992 "Reserving for Claims-Made Policies").
    notes: 'Step rating: first-year premium ≈38–60% of occurrence-equivalent; 100% by year 5. Retroactive date removes prior-acts coverage, resetting the step factor. Deductible options are critical premium drivers.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// PL / E&O rating (all factors illustrative):
//   s1 SET  LI.PL.RT.001[profClass='ACCOUNTANT', revenueBand='1M'] = 3000   (mature occ. equiv.)
//   s2 MUL  LI.PL.RT.002[year='1'] = 0.45   → 3000 × 0.45 = 1350.00 (step yr 1, within 38–60%)
//   s3 MUL  LI.PL.RT.003[deductible='2500'] = 0.90 → 1350 × 0.90 = 1215.00
//   s4 MIN_FLOOR CONST 500                          → max(1215, 500) = 1215
// Expected: $1,215

export const PROFESSIONAL_LIABILITY_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.PL.RT.001': {
      // Source: carrier-proprietary PL base rate by profession and revenue band (illustrative).
      // Mature (year-5+) occurrence-equivalent rate.
      name: 'PL Base Rate by Profession Class and Revenue Band (mature)',
      columns: ['profClass', 'revenueBand', 'rate'],
      dimensions: [
        { key: 'profClass',   label: 'Profession Class', values: ['ACCOUNTANT','CONSULTANT','TECH_VENDOR','ARCHITECT'] },
        { key: 'revenueBand', label: 'Revenue Band',     values: ['500K','1M','5M','25M'] },
      ],
      valueColumn: 'rate',
      rows: [
        { profClass: 'ACCOUNTANT',  revenueBand: '500K', rate: 1500 },
        { profClass: 'ACCOUNTANT',  revenueBand: '1M',   rate: 3000 },
        { profClass: 'ACCOUNTANT',  revenueBand: '5M',   rate: 7000 },
        { profClass: 'CONSULTANT',  revenueBand: '1M',   rate: 2500 },
        { profClass: 'TECH_VENDOR', revenueBand: '1M',   rate: 4000 },
        { profClass: 'ARCHITECT',   revenueBand: '1M',   rate: 3500 },
      ],
    },
    'LI.PL.RT.002': {
      // Source: market-standard E&O claims-made step factors (illustrative; range 38–60% yr 1).
      // Gillam & Snader (1992) documented ~40–55% first-year step for accounting/consulting.
      name: 'Claims-Made Step Factor by Policy Year',
      columns: ['year', 'factor'],
      dimensions: [{ key: 'year', label: 'Policy Year', values: ['1','2','3','4','5+'] }],
      valueColumn: 'factor',
      rows: [
        { year: '1',  factor: 0.45 },
        { year: '2',  factor: 0.65 },
        { year: '3',  factor: 0.80 },
        { year: '4',  factor: 0.92 },
        { year: '5+', factor: 1.00 },
      ],
    },
    'LI.PL.RT.003': {
      // Source: carrier-proprietary PL deductible credit (illustrative).
      name: 'Deductible Credit Factor',
      columns: ['deductible', 'factor'],
      dimensions: [{ key: 'deductible', label: 'Per-Claim Deductible', values: ['0','1000','2500','5000','10000'] }],
      valueColumn: 'factor',
      rows: [
        { deductible: '0',      factor: 1.00 },
        { deductible: '1000',   factor: 0.95 },
        { deductible: '2500',   factor: 0.90 },
        { deductible: '5000',   factor: 0.83 },
        { deductible: '10000',  factor: 0.75 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.PL.RAT.1', name: 'Professional Liability Rating Program (archetype fixture)',
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Mature base rate by profession/revenue', op: 'SET',       source: { type: 'RT', ref: 'LI.PL.RT.001', keys: ['profClass', 'revenueBand'] } },
      { id: 's2', order: 2, label: 'Claims-made step factor',                op: 'MUL',       source: { type: 'RT', ref: 'LI.PL.RT.002', keys: ['year'] } },
      { id: 's3', order: 3, label: 'Deductible credit',                      op: 'MUL',       source: { type: 'RT', ref: 'LI.PL.RT.003', keys: ['deductible'] } },
      { id: 's4', order: 4, label: 'Minimum premium floor',                  op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
    ],
  },
  workedExample: { profClass: 'ACCOUNTANT', revenueBand: '1M', year: '1', deductible: '2500' },
  expectedPremium: 1215,
}
