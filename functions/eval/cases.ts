// functions/eval/cases.ts — frozen golden cases for the AI eval harness.
//
// Each case is a pre-recorded fixture representing CORRECT AI behavior. The
// runner validates three properties against every fixture:
//   grounding      — response cites every refId listed in expectedRefIds
//   citationValid  — every refId/form-number cited in the response exists in the
//                    live seed data (no hallucinated references)
//   shape          — response has the required structural fields
//
// These cases are intentionally model-independent: they test the validation
// layer (citation guards, sanitizers, shape checks) rather than the AI output
// itself. To extend the harness, add a new EvalCase here and the runner picks
// it up automatically.

export interface EvalCase {
  id:              string
  feature:         string   // matches recordUsage feature name
  description:     string
  // Pre-recorded AI response payload (the structured output, not raw SSE text)
  response:        Record<string, unknown>
  // RefIds the response MUST cite to be considered grounded. Checked as a
  // subset: the response may cite additional refIds, but not fewer.
  expectedRefIds:  string[]
  // Required top-level fields for the shape check
  requiredFields:  string[]
}

// ─── Case 1: analyzeClaim — pipe burst, Coverage A (COVERED) ──────────────────
// A sudden pipe burst causing water damage to the dwelling is covered under
// Coverage A of HO-3. The Water Back-Up exclusion (base form) does NOT apply
// here because this is discharge from within the plumbing, not backup from a
// sewer/drain. The fixture represents a correct COVERED determination.
const claimsDetermination: Record<string, unknown> = {
  verdict:    'COVERED',
  summary:    'The sudden discharge from a burst pipe inside the home is a covered loss under Coverage A — Dwelling of HO 00 03.',
  formNumber: 'HO 00 03',
  coverages: [
    {
      name:       'Coverage A — Dwelling',
      refId:      'HO.COV.001',
      formNumber: 'HO 00 03',
      definition: 'Covers risk of direct physical loss to the dwelling structure from sudden and accidental discharge or overflow of water from within a plumbing system.',
    },
  ],
  exclusions: [
    {
      name:       'Water Back-Up from Sewers or Drains',
      formNumber: 'HO 00 03',
      note:       'This exclusion applies only to backup or overflow from an external sewer or drain — it does not exclude sudden discharge from a pipe within the dwelling.',
    },
  ],
  limits: [
    { label: 'Coverage A Limit', value: 'Per the Declarations', source: 'Declarations' },
    { label: 'All-peril deductible', value: 'Per the Declarations', source: 'HO.LD.003' },
  ],
  reasoning: [
    'The loss — a burst internal pipe causing water damage to the dwelling — is a direct physical loss from sudden and accidental water discharge [Coverage A — Dwelling, HO 00 03].',
    'Section I exclusions address wear and tear, gradual seepage and backup from sewers/drains; none of these apply to a sudden internal pipe burst [Section I – Exclusions, HO 00 03].',
    'Coverage A responds for the dwelling structure damage; the insured\'s Coverage A limit (per Declarations) applies, subject to the all-peril deductible [HO.COV.001, HO.LD.003].',
  ],
  openItems: [
    'Declarations page: Coverage A dwelling limit',
    'Declarations page: all-peril deductible amount',
    'Adjuster inspection: scope of structural damage vs. personal property',
  ],
  citations: ['Section I – Exclusions', 'Coverage A — Dwelling', 'HO.COV.001', 'HO 00 03', 'HO.LD.003'],
}

// ─── Case 2: extractCoverages — HO-3 form extraction ─────────────────────────
// Represents the coverages section from an extractCoverages call on an HO-3
// form text. Each item must have a citation; form numbers must match the source.
const extractionResult: Record<string, unknown> = {
  coverages: {
    items: [
      {
        name:              'Coverage A — Dwelling',
        requirement:       'MANDATORY',
        premiumGenerating: true,
        formNumbers:       ['HO 00 03'],
        confidence:        0.98,
        citation:          'Section I – Property Coverages, Coverage A',
      },
      {
        name:              'Coverage B — Other Structures',
        requirement:       'MANDATORY',
        premiumGenerating: false,
        formNumbers:       ['HO 00 03'],
        confidence:        0.97,
        citation:          'Section I – Property Coverages, Coverage B',
      },
      {
        name:              'Coverage C — Personal Property',
        requirement:       'MANDATORY',
        premiumGenerating: true,
        formNumbers:       ['HO 00 03'],
        confidence:        0.97,
        citation:          'Section I – Property Coverages, Coverage C',
      },
      {
        name:              'Coverage D — Loss of Use',
        requirement:       'MANDATORY',
        premiumGenerating: false,
        formNumbers:       ['HO 00 03'],
        confidence:        0.96,
        citation:          'Section I – Property Coverages, Coverage D',
      },
      {
        name:              'Coverage E — Personal Liability',
        requirement:       'MANDATORY',
        premiumGenerating: true,
        formNumbers:       ['HO 00 03'],
        confidence:        0.97,
        citation:          'Section II – Liability Coverages, Coverage E',
      },
      {
        name:              'Coverage F — Medical Payments to Others',
        requirement:       'MANDATORY',
        premiumGenerating: true,
        formNumbers:       ['HO 00 03'],
        confidence:        0.96,
        citation:          'Section II – Liability Coverages, Coverage F',
      },
      {
        name:              'Water Back-Up and Sump Discharge or Overflow',
        requirement:       'OPTIONAL',
        premiumGenerating: true,
        formNumbers:       ['HO 04 95'],
        confidence:        0.92,
        citation:          'HO 04 95 endorsement referenced in policy schedule',
      },
    ],
    note: '',
  },
  forms: {
    items: [
      {
        number:           'HO 00 03',
        name:             'Homeowners 3 — Special Form',
        edition:          '05 11',
        category:         'BASE_COVERAGE',
        mandatoryDefault: true,
        confidence:       0.99,
        citation:         'Form header and declarations',
      },
      {
        number:           'HO DS 01',
        name:             'Homeowners Policy Declarations',
        edition:          '05 11',
        category:         'DECLARATIONS',
        mandatoryDefault: true,
        confidence:       0.98,
        citation:         'Policy header references HO DS 01',
      },
      {
        number:           'HO 04 95',
        name:             'Water Back-Up and Sump Discharge or Overflow',
        edition:          '05 11',
        category:         'ENDORSEMENT',
        mandatoryDefault: false,
        confidence:       0.93,
        citation:         'Section I – Exclusions 2.f references backup/overflow endorsement',
      },
    ],
    note: '',
  },
}

// ─── Case 3: summarizeProduct — HO.PROD.001 ───────────────────────────────────
// Represents the structured summary returned by summarizeProduct for the HO-3
// product. All facts are drawn from the product metadata; nothing is invented.
const productSummary: Record<string, unknown> = {
  headline:  'An ISO-style HO-3 open-peril homeowners product across 15 states, built on HO 00 03.',
  overview:
    'Homeowners — HO-3 Special Form is a bureau-backed, open-peril policy for owner-occupied ' +
    'residential dwellings. The product covers dwelling, other structures, personal property, ' +
    'loss of use, personal liability and medical payments, with optional endorsements for ' +
    'replacement cost coverage and water back-up protection.',
  highlights: [
    { label: 'Coverages', value: '9 (6 mandatory, 3 optional)' },
    { label: 'Footprint',  value: '15 states' },
    { label: 'Base form',  value: 'HO 00 03 (05 11)' },
    { label: 'Rating steps', value: '14 steps' },
    { label: 'Min premium', value: '$500' },
  ],
  coverageHighlights: [
    { name: 'Coverage A — Dwelling', note: 'Open-peril coverage for the dwelling structure; all direct physical losses not excluded.' },
    { name: 'Coverage C — Personal Property', note: 'Named-peril coverage at 50–75% of Coverage A.' },
    { name: 'Coverage E — Personal Liability', note: 'Third-party liability at $100k–$500k per occurrence.' },
    { name: 'Water Back-Up & Sump Overflow', note: 'Optional endorsement (HO 04 95) for sewer/drain backup losses.' },
  ],
  considerations: [
    'Wind/hail percentage deductible is available in coastal states only (HO.LD.004 restriction).',
    'Replacement cost coverage for personal property requires HO 04 90 endorsement election.',
    'Scheduled personal property riders (HO 04 61) must be individually appraised.',
  ],
}

// ─── Case 4: draftRule — Coverage F requires Coverage E ≥ 300k ───────────────
// Represents a correctly-drafted rule from draftRule. The rule condition and
// outcome are grounded in real coverage refIds from the HO-3 portfolio.
const ruleDraft: Record<string, unknown> = {
  category:       'PRODUCT',
  subCategory:    'Coverage Constraints',
  condition:      'Coverage F — Medical Payments $5,000 limit elected',
  outcome:        'Coverage E — Personal Liability limit must be ≥ $300,000',
  coverageRefIds: ['HO.COV.005', 'HO.COV.006'],
  formNumbers:    ['HO 00 03'],
  ldTableRef:     'HO.LD.002',
  rationale: [
    'The $5,000 Coverage F option is only available when Coverage E is at least $300,000 [HO.LD.002].',
    'This mirrors the constraint in the seeded Coverage F LD table and the existing rule HO.RU.004 [HO.COV.005, HO.COV.006].',
  ],
  citations: ['HO.COV.005', 'HO.COV.006', 'HO.LD.002', 'HO 00 03'],
  warnings:  [],
}

// ─── Exported cases ───────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [
  {
    id:             'claims-pipe-burst',
    feature:        'analyzeClaim',
    description:    'Sudden pipe burst / Coverage A — COVERED determination, cites HO.COV.001',
    response:       claimsDetermination,
    expectedRefIds: ['HO.COV.001', 'HO.LD.003'],
    requiredFields: ['verdict', 'summary', 'coverages', 'citations', 'formNumber'],
  },
  {
    id:             'extract-ho3-coverages',
    feature:        'extractCoverages',
    description:    'HO-3 coverage extraction — 7 coverages, 3 forms, all cited',
    response:       extractionResult,
    expectedRefIds: [],  // extraction uses form numbers, not refIds — shape + citation validity suffice
    requiredFields: ['coverages', 'forms'],
  },
  {
    id:             'summarize-ho3-product',
    feature:        'summarizeProduct',
    description:    'HO.PROD.001 product summary — headline, highlights, coverageHighlights',
    response:       productSummary,
    expectedRefIds: [],  // summary cites product metadata, not refIds
    requiredFields: ['headline', 'overview', 'highlights', 'coverageHighlights'],
  },
  {
    id:             'draft-rule-cov-f',
    feature:        'draftRule',
    description:    'Rule: Coverage F $5k requires Coverage E ≥ $300k — grounded in HO.COV.005, HO.COV.006',
    response:       ruleDraft,
    expectedRefIds: ['HO.COV.005', 'HO.COV.006', 'HO.LD.002'],
    requiredFields: ['category', 'condition', 'outcome', 'coverageRefIds', 'citations'],
  },
]
