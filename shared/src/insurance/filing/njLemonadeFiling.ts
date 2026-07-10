// filing/njLemonadeFiling.ts — the REFERENCE FILING, encoded as the model would extract it.
//
// This is the NJ Lemonade Homeowners filing (samples/filings/nj-lemonade-ho/) reduced to the
// exact FilingExtraction shape the CLASSIFY + EXTRACT stages produce. Every value here is drawn
// from the three source PDFs (rate order of calculations, HO manual ed. Dec 2023, policy form
// LEM 03 05 23) — the base loss costs, LCM = 1.727, the zip→territory→LCMF triples, the tier
// relativities, the Rule 406 deductible matrix, the Rule 92 maximum-credit percentages, the
// Rule 205 minimum premiums, and the Coverage A–F structure of the policy form. The verbatim
// `rowRegion` blocks are what the model quotes for the DETERMINISTIC parser to read (it never
// transcribes structured rows itself); a couple of illustrative credit values are flagged.
//
// It is the single source of truth for two consumers: the shared golden + canary test
// (filing.reconcile.test.ts) and the functions AI_FAKE client (functions/src/fake) that drives
// the SSE pipeline end-to-end without a live model. Treat it like seed data: grounded, frozen.
import type { ExtractionResult } from '../extraction'
import type { FilingExtraction, RateOrderVariable, ManualRule } from './types'

// ─── CLASSIFY (from each document's structural cue) ─────────────────────────────────

const classifications: FilingExtraction['classifications'] = [
  { name: 'NJ HO Rate Order of Calculations.pdf', role: 'rateOrder',  cue: 'Title "RATE ORDER OF CALCULATIONS"; ordered Premium/Factor rows with per-form (HO3/HO4/HO6) applicability columns', confidence: 0.98 },
  { name: 'NJ HO Manual 02.27.24.pdf',            role: 'manual',     cue: 'Title "HOMEOWNERS MANUAL"; dense numbered rules (1, 2, 13, 92, 205, 406) with factor tables', confidence: 0.98 },
  { name: 'LEM 03 05 23 Lemonade Homeowners_FINAL.pdf', role: 'policyForm', cue: 'Form-number/edition footer "LEM 03 05 23"; "SECTION I – PROPERTY COVERAGES" with Coverage A–F', confidence: 0.97 },
]

// ─── EXTRACT · rate order (HO3 chain, in order) ─────────────────────────────────────
// Per-form applicability from the rate order's HO3 column. Additive (Premium) vs
// multiplicative (Factor) as printed. Protection-Construction and Key Factor are real
// rate-order variables the manual states no table for → they will resolve to UNRESOLVED.

const RO_CITE = 'Rate Order of Calculations, HO3 column'
function v(name: string, op: 'ADD' | 'MUL', stage: RateOrderVariable['stage'], confidence = 0.95): RateOrderVariable {
  return { name, op, stage, forms: ['HO3'], citation: RO_CITE, confidence }
}
const rateOrderVariables: RateOrderVariable[] = [
  v('ISO Base Loss Cost',                          'ADD', 'BASE_LOSS_COST'),
  v('Loss Cost Multiplier',                        'MUL', 'BASE_LOSS_COST'),
  v('Loss Cost Modification Factor',               'MUL', 'BASE_LOSS_COST'),
  v('Protection - Construction Factors',           'MUL', 'BASE_PREMIUM'),
  v('Key Factor',                                  'MUL', 'BASE_PREMIUM'),
  v('Tier',                                        'MUL', 'ADJUSTED_BASE'),
  v('All Perils Deductible',                       'MUL', 'ADJUSTED_BASE'),
  v('Loss Settlement Option - Personal Property',  'MUL', 'ADJUSTED_BASE'),
  v('Age of Dwelling Credit',                      'MUL', 'ADJUSTED_BASE'),
  v('Renovation Credit',                           'MUL', 'ADJUSTED_BASE'),
  v('Loyalty Credit',                              'MUL', 'ADJUSTED_BASE'),
  v('Gated Community Credit',                      'MUL', 'ADJUSTED_BASE'),
  v('Building Code Effectiveness Grading Windstorm','ADD', 'ADJUSTED_BASE'),
  v('Water Back-up and Sump Discharge or Overflow Coverage', 'ADD', 'ADDITIONAL_COVERAGE'),
  v('Scheduled Personal Property - Jewelry',       'ADD', 'ADDITIONAL_COVERAGE'),
]

// ─── EXTRACT · manual (numbered rules, verbatim regions for the deterministic parser) ──

const MAN = 'HOMEOWNERS MANUAL (ED. DEC 2023), STATE OF NEW JERSEY'
const manualRules: ManualRule[] = [
  {
    ruleNumber: '—', title: 'Base Loss Costs', kind: 'BASE_LOSS_COST', concept: 'baseLossCost',
    citation: `${MAN}, "BASE LOSS COSTS" (LEM 03 column by ISO Territory)`, confidence: 0.96,
    table: {
      layout: 'pairs', keyColumns: ['territory'], valueColumn: 'lossCost',
      // Verbatim territory → LEM 03 base loss cost (the HO3 column of the base-loss-cost page).
      rowRegion: [
        '30  456.93', '31  294.98', '32  557.36', '33  548.69', '34  234.46', '35  267.13',
        '36  360.12', '37  198.85', '38  200.75', '39  469.10', '40  538.20', '41  170.89',
      ].join('\n'),
    },
  },
  {
    ruleNumber: '1', title: 'Loss Cost Multiplier', kind: 'SCALAR', concept: 'lossCostMult',
    citation: `${MAN}, Rule 1 "LOSS COST MULTIPLIER" (LEM 03/LEM 06 = 1.727)`, confidence: 0.97,
    scalars: [{ label: 'Loss Cost Multiplier', value: 1.727 }],
  },
  {
    ruleNumber: '2', title: 'Loss Cost Modification Factors', kind: 'FACTOR_TABLE', concept: 'lossCostMod',
    citation: `${MAN}, Rule 2 "LOSS COST MODIFICATION FACTORS - Form LEM 03" (Zip → ISO Territory → LEM 03 LCMF)`, confidence: 0.9,
    table: {
      // Looked up by ZIP; territory is a descriptive column (not a required query dimension).
      layout: 'triples', keyColumns: ['zip', 'territory'], lookupKeys: ['zip'], valueColumn: 'lcmf',
      // Verbatim zip → ISO territory → LEM 03 LCMF triples.
      rowRegion: [
        '07003  44  1.601', '07004  30  1.606', '07005  35  1.574',
        '07006  35  1.622', '07008  49  1.592', '07009  35  1.649',
      ].join('\n'),
    },
  },
  {
    ruleNumber: '13', title: 'Tier Rating Factors', kind: 'FACTOR_TABLE', concept: 'tier',
    citation: `${MAN}, Rule 13 "TIER RATING FACTORS" (Pure Premium Relativity by Tier)`, confidence: 0.9,
    table: {
      layout: 'pairs', keyColumns: ['tier'], valueColumn: 'factor',
      // Tier → Pure Premium Relativity (the manual's relativity column).
      rowRegion: ['1  0.602', '2  0.707', '3  0.810', '4  0.899', '5  1.022', '6  1.127', '7  1.344', '8  1.740'].join('\n'),
    },
  },
  {
    ruleNumber: '14', title: 'Loss Settlement Options - Personal Property', kind: 'FACTOR_TABLE', concept: 'lossSettlement',
    citation: `${MAN}, Rule 14 "LOSS SETTLEMENT OPTIONS - PERSONAL PROPERTY"`, confidence: 0.9,
    table: {
      layout: 'pairs', keyColumns: ['ppReplacementCost'], valueColumn: 'factor',
      rowRegion: ['No  1.00', 'Yes: LEM 03  1.35'].join('\n'),
    },
  },
  {
    ruleNumber: '406', title: 'Deductibles', kind: 'DEDUCTIBLE', concept: 'allPerilDed',
    citation: `${MAN}, Rule 406 "DEDUCTIBLES" — Optional Higher Deductibles factor matrix (Territories 33–35, 37–42, 44–51, 53 & 54)`, confidence: 0.88,
    table: {
      layout: 'matrix', keyColumns: ['covABand', 'deductible'], columnKeys: ['1000', '2500', '5000', '7500', '10000'], valueColumn: 'factor',
      // Coverage A Limit band × deductible amount → factor (two fully-legible bands from the page).
      rowRegion: [
        '$100,000 to $199,999   0.93  0.82  0.72  0.70  0.66',
        '$300,000 and Over      0.94  0.83  0.74  0.74  0.70',
      ].join('\n'),
    },
  },
  {
    ruleNumber: '24', title: 'Loyalty Credits', kind: 'FACTOR_TABLE', concept: 'loyalty',
    citation: `${MAN}, Rule 24 "LOYALTY CREDITS" (0.97)`, confidence: 0.92,
    scalars: [{ label: 'Loyalty Credit', value: 0.97 }],
  },
  {
    ruleNumber: '26', title: 'Renovation Credits', kind: 'FACTOR_TABLE', concept: 'renovation',
    citation: `${MAN}, Rule 26 "RENOVATION CREDITS" (0.91)`, confidence: 0.9,
    scalars: [{ label: 'Renovation Credit', value: 0.91 }],
  },
  {
    ruleNumber: '23', title: 'Gated Community Credit', kind: 'FACTOR_TABLE', concept: 'gatedCommunity',
    citation: `${MAN}, Rule 23 "GATED COMMUNITY CREDIT" (1.000)`, confidence: 0.9,
    scalars: [{ label: 'Gated Community Credit', value: 1.000 }],
  },
  {
    ruleNumber: '92', title: 'Maximum Credits', kind: 'CREDIT_CAP', concept: '',
    citation: `${MAN}, Rule 92 "MAXIMUM CREDITS" — "a maximum total credit of 50% for LEM 03 and 40% for LEM 06"`, confidence: 0.95,
    scalars: [{ label: 'Max total credit', value: 50, form: 'LEM 03' }, { label: 'Max total credit', value: 40, form: 'LEM 06' }],
  },
  {
    ruleNumber: '205', title: 'Minimum Premium', kind: 'MIN_PREMIUM', concept: '',
    citation: `${MAN}, Rule 205 "MINIMUM PREMIUM" — LEM 03 $420.00, LEM 06 $300.00, LEM 04 $60.00`, confidence: 0.95,
    scalars: [{ label: 'Minimum premium', value: 420, form: 'LEM 03' }, { label: 'Minimum premium', value: 300, form: 'LEM 06' }, { label: 'Minimum premium', value: 60, form: 'LEM 04' }],
  },
  {
    ruleNumber: '94', title: 'Premium Capping', kind: 'PREMIUM_CAP', concept: '',
    citation: `${MAN}, Rule 94 "PREMIUM CAPPING" — renewal change capped/floored at 25%`, confidence: 0.9,
    ruleDraft: { condition: 'Renewal premium change exceeds ±25% from published rate/characteristic changes', outcome: 'Cap the renewal premium change at 25% (Rule 94), up to four consecutive terms' },
  },
  {
    ruleNumber: '11', title: 'Type of Residence', kind: 'ELIGIBILITY', concept: 'residenceType',
    citation: `${MAN}, Rule 11 "TYPE OF RESIDENCE" (Primary 1.000; Secondary/Seasonal 1.100)`, confidence: 0.85,
    ruleDraft: { condition: 'Residence type is Secondary or Seasonal', outcome: 'Apply the 1.100 residence-type factor (Rule 11)' },
  },
]

// ─── EXTRACT · policy form (via the EXISTING four-section extractCoverages machinery) ──

const PF = 'LEM 03 05 23'
const policyForm: ExtractionResult = {
  coverages: {
    items: [
      { name: 'Coverage A — Dwelling',            requirement: 'MANDATORY', premiumGenerating: true,  formNumbers: [PF], limitHint: 'The dwelling on the residence premises', confidence: 0.96, citation: 'Section I – Property Coverages, A. Coverage A – Dwelling' },
      { name: 'Coverage B — Other Structures',    requirement: 'MANDATORY', premiumGenerating: true,  formNumbers: [PF], limitHint: '10% of Coverage A', confidence: 0.95, citation: 'Section I – Property Coverages, B. Coverage B – Other Structures (§3, 10% of Coverage A)' },
      { name: 'Coverage C — Personal Property',   requirement: 'MANDATORY', premiumGenerating: true,  formNumbers: [PF], limitHint: 'Special limits of liability apply', confidence: 0.95, citation: 'Section I – Property Coverages, C. Coverage C – Personal Property (§3 Special Limits)' },
      { name: 'Coverage D — Loss of Use',         requirement: 'MANDATORY', premiumGenerating: false, formNumbers: [PF], confidence: 0.9, citation: 'Section I – Property Coverages, D. Coverage D – Loss Of Use' },
      { name: 'Coverage E — Personal Liability',  requirement: 'MANDATORY', premiumGenerating: true,  formNumbers: [PF], confidence: 0.94, citation: 'Section II – Liability Coverages, E. Coverage E – Personal Liability' },
      { name: 'Coverage F — Medical Payments To Others', requirement: 'MANDATORY', premiumGenerating: true, formNumbers: [PF], confidence: 0.93, citation: 'Section II – Liability Coverages, F. Coverage F – Medical Payments To Others' },
    ],
  },
  forms: {
    items: [
      { number: PF, name: 'Lemonade Homeowners', edition: '05 23', category: 'BASE_COVERAGE', mandatoryDefault: true, attachmentCondition: 'NONE', confidence: 0.97, citation: 'Footer "LEM 03 05 23 © 2023 Lemonade Insurance Company"' },
    ],
  },
  rules: {
    items: [
      { category: 'PRODUCT', subCategory: 'Coverage Limits', condition: 'Coverage B — Other Structures selected', outcome: 'Limit is 10% of Coverage A and does not reduce the Coverage A limit', coverageNames: ['Coverage B — Other Structures'], formNumbers: [PF], confidence: 0.9, citation: 'Section I – Property Coverages, B.3' },
      { category: 'PRODUCT', subCategory: 'Special Limits', condition: 'Loss by theft of jewelry, watches, furs', outcome: 'Special sub-limit of $1,500 applies (Coverage C)', coverageNames: ['Coverage C — Personal Property'], formNumbers: [PF], confidence: 0.88, citation: 'Section I – Property Coverages, C.3 Special Limits Of Liability (e)' },
    ],
  },
  rating: {
    items: [
      { subCategory: 'Deductibles', condition: 'All Section I perils', outcome: 'A deductible applies to loss from all Section I perils (base $500)', coverageNames: ['Coverage A — Dwelling'], formNumbers: [], confidence: 0.85, citation: 'Policy form Section I – Conditions (deductible)' },
    ],
  },
}

// ─── The full canned extraction ─────────────────────────────────────────────────────

export const NJ_LEMONADE_EXTRACTION: FilingExtraction = {
  classifications,
  rateOrder: { variables: rateOrderVariables, maxCreditRuleRef: 'Rule 92', minPremiumRuleRef: 'Rule 205' },
  manual: { rules: manualRules },
  policyForm,
  filingState: 'NJ',
  baseFormNumber: 'LEM 03',
  baseFormEdition: '05 23',
  productName: 'Lemonade Homeowners (NJ)',
}

/** A worked example assembled from the manual's own defaults, used to freeze the imported
 *  product's canary premium. territory 30 / zip 07004 (LCMF 1.606) / tier 5 (relativity 1.022)
 *  / Coverage A ≥ $300,000 with a $2,500 all-perils deductible (0.83) / personal-property
 *  replacement cost elected (1.35). Every key matches a parsed table dimension value. */
export const FILING_WORKED_EXAMPLE: Record<string, string> = {
  territory:         '30',
  zip:               '07004',
  tier:              '5',
  covABand:          '$300,000 and Over',
  deductible:        '2500',
  ppReplacementCost: 'Yes: LEM 03',
}
