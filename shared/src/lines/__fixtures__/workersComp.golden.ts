// Workers Compensation golden fixture — WORKERS_COMP family.
// Canary: $4,500. Rates are illustrative; source: NCCI Basic Manual (WC 00 00 00 Ed. 2014),
// Parts 1–4: classification, loss cost, LCM, experience rating, schedule rating, minimum premium.
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'
import { fixtureGov } from '../ratingKit'

export const WORKERS_COMP_ARCHETYPE: LineArchetype = {
  lobRefId:    'WC.FAMILY',
  displayName: 'Workers Compensation (NCCI WC 00 00 00)',
  family:      'WORKERS_COMP',
  // WC is always payroll-based: annual payroll ÷ 100 × loss cost × LCM × e-mod.
  exposureBases:         ['PAYROLL_PER_100'],
  // WC has no occurrence/claims-made distinction; the statutory benefit obligation
  // attaches when the injury arises out of and in the course of employment.
  triggerTypes:          ['OCCURRENCE'],
  limitStructures:       ['CSL'],   // Employers Liability (Part 2) uses a CSL limit.
  aggregatePatterns:     ['NONE'],
  ratingStageArchetypes: ['LOSS_COST_TIMES_LCM', 'EXPERIENCE_MOD', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
  bureauRuleNumberSemantics: [
    // NCCI Basic Manual Parts (not ISO rule numbers).
    { bureau: 'NCCI', rangeStart: 1, rangeEnd: 1, kind: 'GENERAL_RULES',      description: 'NCCI Basic Manual Part 1 — general rules, eligibility, policy conditions.' },
    { bureau: 'NCCI', rangeStart: 2, rangeEnd: 2, kind: 'CLASSIFICATION',     description: 'NCCI Scopes Manual / Basic Part 2 — class codes, phraseology, payroll basis.' },
    { bureau: 'NCCI', rangeStart: 3, rangeEnd: 3, kind: 'LOSS_COST',          description: 'NCCI Basic Part 3 — loss costs per $100 payroll + LCM.' },
    { bureau: 'NCCI', rangeStart: 4, rangeEnd: 4, kind: 'PREMIUM_DETERMINATION', description: 'NCCI Basic Part 4 — e-mod, schedule rating (±15% capped), minimum premium.' },
    { bureau: 'NCCI', rangeStart: 40, rangeEnd: 40, kind: 'EXPERIENCE_MOD',  description: 'NCCI Experience Rating Plan — e-mod calculation.' },
    { bureau: 'NCCI', rangeStart: 41, rangeEnd: 41, kind: 'SCHEDULE_RATING', description: 'NCCI schedule rating credit/debit (±15% per NCCI; some states allow ±25%).' },
  ],
  documentRoleFingerprints: [
    { role: 'RATE_ORDER',   signals: ['workers compensation rate', 'wc rate order', 'loss cost filing'], confidenceWeight: 0.9 },
    { role: 'MANUAL',       signals: ['workers compensation manual', 'ncci basic manual', 'wc 00 00 00', 'loss cost'], confidenceWeight: 0.85 },
    { role: 'POLICY_FORM',  signals: ['wc 00 00 00', 'workers compensation and employers liability', 'part one', 'part two statutory', 'experience modifier'], confidenceWeight: 0.9 },
    { role: 'ERC_PACKAGE',  signals: ['experience rating calculation', 'erc', 'mod worksheet', 'e-mod calculation', 'ncci experience rating'], confidenceWeight: 0.9 },
    { role: 'CLASS_TABLE',  signals: ['classification code', 'class code', 'ncci code', 'scopes'], confidenceWeight: 0.75 },
  ],
  translationRecipe: {
    primaryFormPattern:      '^WC\\s*00\\s*00\\s*00',
    ratingProgramStructure:  ['LOSS_COST_TIMES_LCM', 'EXPERIENCE_MOD', 'SCHEDULE_RATING_CAPPED', 'MINIMUM_PREMIUM_FLOOR'],
    productSplitStrategy:    'SINGLE_PRODUCT',
    defaultVariableOp:       'MUL',
    hasLcmStep:              true,
    hasExpMod:               true,
    hasClaimsMadeStepFactors: false,
    notes: 'State bureaus (NYCIRB, WCIRB CA, TX DWC, etc.) file their own loss costs; NCCI serves as rating bureau for ~40 states. ERP calculation is separate from rate filing.',
  },
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// WC rating: loss cost × LCM → manual rate × payroll/100 × e-mod → floor
// (all factors illustrative):
//   s1 SET  LI.WC.RT.001[classCode='5537'] = 8.00   (loss cost per $100 payroll, roofers)
//   s2 MUL  CONST 1.25 (LCM)                        → 8.00 × 1.25 = 10.00
//   s3 MUL  INPUT payroll_per100 = 500              → 10.00 × 500 = 5000.00
//   s4 MUL  LI.WC.RT.002[expMod='0.90'] = 0.90      → 5000 × 0.90 = 4500.00
//   s5 MIN_FLOOR CONST 200                           → max(4500, 200) = 4500
// Expected: $4,500

export const WORKERS_COMP_FIXTURE: ArchetypeFixture = {
  rt: {
    'LI.WC.RT.001': {
      // Source: NCCI loss cost filing (illustrative; class 5537 = roofing, all types).
      name: 'Loss Cost by Class Code (per $100 payroll)',
      columns: ['classCode', 'rate'],
      dimensions: [{ key: 'classCode', label: 'Class Code', values: ['5537','8810','9015','3632'] }],
      valueColumn: 'rate',
      rows: [
        { classCode: '5537', rate: 8.00 },  // roofing, all types
        { classCode: '8810', rate: 0.25 },  // clerical office employees
        { classCode: '9015', rate: 2.10 },  // janitorial services
        { classCode: '3632', rate: 5.50 },  // machine shop
      ],
    },
    'LI.WC.RT.002': {
      // Source: NCCI experience rating (illustrative e-mod lookup).
      name: 'Experience Modification Factor',
      columns: ['expMod', 'factor'],
      dimensions: [{ key: 'expMod', label: 'E-Mod', values: ['0.75','0.90','1.00','1.10','1.25'] }],
      valueColumn: 'factor',
      rows: [
        { expMod: '0.75', factor: 0.75 },
        { expMod: '0.90', factor: 0.90 },
        { expMod: '1.00', factor: 1.00 },
        { expMod: '1.10', factor: 1.10 },
        { expMod: '1.25', factor: 1.25 },
      ],
    },
  },
  ld: {},
  program: {
    refId: 'LI.WC.RAT.1', name: 'Workers Compensation Rating Program (archetype fixture)',
    minimumPremium: 200,
    ...fixtureGov(),
    allStates: true, states: [],
    steps: [
      { id: 's1', order: 1, label: 'Loss cost by class code',    op: 'SET',       source: { type: 'RT', ref: 'LI.WC.RT.001', keys: ['classCode'] } },
      { id: 's2', order: 2, label: 'Loss cost multiplier (LCM)', op: 'MUL',       source: { type: 'CONST', value: 1.25 } },
      { id: 's3', order: 3, label: 'Payroll exposure (÷$100)',   op: 'MUL',       source: { type: 'INPUT', ref: 'payroll_per100' } },
      { id: 's4', order: 4, label: 'Experience mod',             op: 'MUL',       source: { type: 'RT', ref: 'LI.WC.RT.002', keys: ['expMod'] } },
      { id: 's5', order: 5, label: 'Minimum premium floor',      op: 'MIN_FLOOR', source: { type: 'CONST', value: 200 }, roundTo: 0 },
    ],
  },
  workedExample: { classCode: '5537', payroll_per100: 500, expMod: '0.90' },
  expectedPremium: 4500,
}
