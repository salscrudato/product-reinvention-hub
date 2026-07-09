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

import {
  PH_COVERAGES, PH_LD_TABLES, PH_RT_TABLES, PH_FORMS, PH_RULES, PH_FORM_RULES,
  PH_DICTIONARY, PH_PRODUCT,
  PA_COVERAGES, PA_LD_TABLES, PA_RT_TABLES, PA_FORMS, PA_RULES, PA_FORM_RULES,
  PA_DICTIONARY, PA_PRODUCT,
  findUnverifiedCitations, verifyItems, cleanForms, normalizeFormNumber,
  buildBundleChunks, dedupeChunks, lexicalRetrieve,
  verifiedCitedAnchors, staleCitedAnchors, decideSemanticCache,
} from '@pf/shared'
import type {
  Product, Coverage, Rule, FormRule, Form, DictionaryEntry, CorpusBundle,
} from '@pf/shared'

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
      refId:      'PH.COV.001',
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
    { label: 'All-peril deductible', value: 'Per the Declarations', source: 'PH.LD.003' },
  ],
  reasoning: [
    'The loss — a burst internal pipe causing water damage to the dwelling — is a direct physical loss from sudden and accidental water discharge [Coverage A — Dwelling, HO 00 03].',
    'Section I exclusions address wear and tear, gradual seepage and backup from sewers/drains; none of these apply to a sudden internal pipe burst [Section I – Exclusions, HO 00 03].',
    'Coverage A responds for the dwelling structure damage; the insured\'s Coverage A limit (per Declarations) applies, subject to the all-peril deductible [PH.COV.001, PH.LD.003].',
  ],
  openItems: [
    'Declarations page: Coverage A dwelling limit',
    'Declarations page: all-peril deductible amount',
    'Adjuster inspection: scope of structural damage vs. personal property',
  ],
  citations: ['Section I – Exclusions', 'Coverage A — Dwelling', 'PH.COV.001', 'HO 00 03', 'PH.LD.003'],
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

// ─── Case 3: summarizeProduct — PH.PROD.001 ───────────────────────────────────
// Represents the structured summary returned by summarizeProduct for the Personal
// Home product. All facts are drawn from the product metadata; nothing is invented.
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
    'Wind/hail percentage deductible is available in coastal states only (PH.LD.004 restriction).',
    'Replacement cost coverage for personal property requires HO 04 90 endorsement election.',
    'Scheduled personal property riders (HO 04 61) must be individually appraised.',
  ],
}

// ─── Case 4: draftRule — Coverage F requires Coverage E ≥ 300k ───────────────
// Represents a correctly-drafted rule from draftRule. The rule condition and
// outcome are grounded in real coverage refIds from the Personal Home portfolio.
const ruleDraft: Record<string, unknown> = {
  category:       'PRODUCT',
  subCategory:    'Coverage Constraints',
  condition:      'Coverage F — Medical Payments $5,000 limit elected',
  outcome:        'Coverage E — Personal Liability limit must be ≥ $300,000',
  coverageRefIds: ['PH.COV.005', 'PH.COV.006'],
  formNumbers:    ['HO 00 03'],
  ldTableRef:     'PH.LD.002',
  rationale: [
    'The $5,000 Coverage F option is only available when Coverage E is at least $300,000 [PH.LD.002].',
    'This mirrors the constraint in the seeded Coverage F LD table and the existing rule PH.RU.006 [PH.COV.005, PH.COV.006].',
  ],
  citations: ['PH.COV.005', 'PH.COV.006', 'PH.LD.002', 'HO 00 03'],
  warnings:  [],
}

// ─── Exported cases ───────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [
  {
    id:             'claims-pipe-burst',
    feature:        'analyzeClaim',
    description:    'Sudden pipe burst / Coverage A — COVERED determination, cites PH.COV.001',
    response:       claimsDetermination,
    expectedRefIds: ['PH.COV.001', 'PH.LD.003'],
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
    description:    'PH.PROD.001 product summary — headline, highlights, coverageHighlights',
    response:       productSummary,
    expectedRefIds: [],  // summary cites product metadata, not refIds
    requiredFields: ['headline', 'overview', 'highlights', 'coverageHighlights'],
  },
  {
    id:             'draft-rule-cov-f',
    feature:        'draftRule',
    description:    'Rule: Coverage F $5k requires Coverage E ≥ $300k — grounded in PH.COV.005, PH.COV.006',
    response:       ruleDraft,
    expectedRefIds: ['PH.COV.005', 'PH.COV.006', 'PH.LD.002'],
    requiredFields: ['category', 'condition', 'outcome', 'coverageRefIds', 'citations'],
  },
]

// ─── Guard cases — hostile inputs that must be REJECTED by the grounding guards ──
// The four cases above assert a CORRECT fixture stays green. These assert the guards
// bite: each feeds an adversarial input to the pure guard shipped for a P4 fix and
// verifies the fabrication is caught. Deterministic + offline (no live API, no network:
// the news probe is stubbed). One per new guard — regressions here fail `pnpm eval`.

export interface GuardCase {
  id:          string
  feature:     string
  description: string
  run:         () => Promise<{ pass: boolean; note: string }>
}

// The live catalogue's stand-in, built from the seed: refIds upper-cased, form numbers
// normalised — exactly what functions/src/tools.ts loadKnownCitations produces at runtime.
const guardRefIds = new Set<string>(
  [
    PH_PRODUCT.refId, ...PH_COVERAGES.map(c => c.refId), ...Object.keys(PH_LD_TABLES),
    ...Object.keys(PH_RT_TABLES), ...PH_RULES.map(r => r.refId), ...PH_FORM_RULES.map(r => r.refId),
    ...PH_DICTIONARY.map(d => d.refId),
    PA_PRODUCT.refId, ...PA_COVERAGES.map(c => c.refId), ...Object.keys(PA_LD_TABLES),
    ...Object.keys(PA_RT_TABLES), ...PA_RULES.map(r => r.refId), ...PA_FORM_RULES.map(r => r.refId),
    ...PA_DICTIONARY.map(d => d.refId),
  ].filter((r): r is string => r != null).map(r => r.toUpperCase()),
)
const guardForms = new Set<string>([...PH_FORMS, ...PA_FORMS].map(f => normalizeFormNumber(f.number)))

// ─── Retrieval-quality cases — "did we retrieve the refId the answer needs?" ────
// The indexed grounding tools only help if the chunk carrying the answer's citation is
// actually retrieved. These cases build the real chunk corpus from BOTH seeded products
// and assert the expected refId / form number is in the top-k for a natural-language
// query — via the lexical fallback that runs offline (and in prod when no VOYAGE_API_KEY
// is set). A regression here means a grounded answer can no longer FIND its source.

const bundle = (
  product: unknown, coverages: unknown, rules: unknown, formRules: unknown,
  forms: unknown, dictionary: unknown, ldTables: CorpusBundle['ldTables'], rtTables: CorpusBundle['rtTables'],
): CorpusBundle => ({
  product: product as Product, coverages: coverages as Coverage[], rules: rules as Rule[],
  formRules: formRules as FormRule[], forms: forms as Form[], dictionary: dictionary as DictionaryEntry[],
  ldTables, rtTables,
})

const RETRIEVAL_CORPUS = dedupeChunks([
  ...buildBundleChunks(bundle(PH_PRODUCT, PH_COVERAGES, PH_RULES, PH_FORM_RULES, PH_FORMS, PH_DICTIONARY, PH_LD_TABLES, PH_RT_TABLES)),
  ...buildBundleChunks(bundle(PA_PRODUCT, PA_COVERAGES, PA_RULES, PA_FORM_RULES, PA_FORMS, PA_DICTIONARY, PA_LD_TABLES, PA_RT_TABLES)),
])

export const RETRIEVAL_CORPUS_SIZE = RETRIEVAL_CORPUS.length

export interface RetrievalCase { id: string; query: string; expect: string; k: number }

export const RETRIEVAL_CASES: RetrievalCase[] = [
  { id: 'water-backup-endorsement', query: 'water backing up through a sewer or drain endorsement', expect: 'HO 04 95', k: 6 },
  { id: 'covF-requires-covE',       query: 'coverage F medical payments $5,000 requires coverage E limit', expect: 'PH.RU.006', k: 6 },
  { id: 'scheduled-property',       query: 'scheduled personal property jewelry appraised value', expect: 'PH.COV.003.002', k: 6 },
  { id: 'coverage-a-dwelling',      query: 'coverage A dwelling replacement value', expect: 'PH.COV.001', k: 6 },
  { id: 'windhail-coastal',         query: 'wind and hail percentage deductible in coastal states', expect: 'PH.RU.008', k: 6 },
  { id: 'auto-bodily-injury',       query: 'personal auto bodily injury liability part A', expect: 'PA.COV.001.001', k: 6 },
  { id: 'auto-uninsured-motorist',  query: 'uninsured motorist coverage auto', expect: 'PA.COV.003', k: 6 },
  { id: 'auto-collision',           query: 'collision coverage damage to your auto deductible', expect: 'PA.COV.004.001', k: 6 },
]

/** Anchors (refIds + form numbers) retrieved in the top-k for a query, via the offline
 *  lexical ranker over the real chunk corpus — the same path prod uses without a key. */
export function retrievedAnchors(query: string, k: number): string[] {
  return lexicalRetrieve(query, RETRIEVAL_CORPUS, { topK: k })
    .flatMap(h => [h.chunk.metadata.refId, h.chunk.metadata.formNumber])
    .filter((x): x is string => !!x)
}

export const GUARD_CASES: GuardCase[] = [
  {
    id:          'chat-uncited-refid',
    feature:     'chat',
    description: 'chat citation guard flags a fabricated refId, keeps a real one + descriptive cites',
    run: async () => {
      const text = 'Coverage A is open-peril [PH.COV.001] under [Section I – Exclusions]; the phantom rule [PH.RU.999] also applies.'
      const un = findUnverifiedCitations(text, guardRefIds, guardForms)
      const pass = un.length === 1 && un[0] === 'PH.RU.999'
      return { pass, note: pass ? '' : `expected ['PH.RU.999'], got ${JSON.stringify(un)}` }
    },
  },
  {
    id:          'news-dead-url',
    feature:     'refreshNews',
    description: 'news URL verifier drops a dead + a malformed URL, keeps the live one (probe stubbed)',
    run: async () => {
      const items = [
        { url: 'https://www.iii.org/article/live', title: 'live' },
        { url: 'https://hallucinated.example.test/nope', title: 'dead' },
        { url: 'not-a-real-url', title: 'malformed' },
      ]
      const kept = await verifyItems(items, async (u) => u.includes('iii.org'))
      const urls = kept.map(k => k.url)
      const pass = urls.length === 1 && urls[0] === 'https://www.iii.org/article/live'
      return { pass, note: pass ? '' : `kept ${JSON.stringify(urls)}` }
    },
  },
  {
    id:          'semantic-cache-stale-citation',
    feature:     'chat',
    description: 'semantic cache never serves an answer whose cited refId no longer resolves (Part A/B)',
    run: async () => {
      // A cached answer that cited PH.COV.001 + HO 00 03 (verified at write time).
      const anchors = verifiedCitedAnchors('Coverage A is open-peril [PH.COV.001] on form [HO 00 03].', guardRefIds, guardForms)
      // Now PH.COV.001 has been deleted from the live catalogue — the answer is stale.
      const liveRefIds = new Set([...guardRefIds].filter(r => r !== 'PH.COV.001'))
      const stale = staleCitedAnchors(anchors, liveRefIds, guardForms)
      // Even at a perfect similarity match, a stale-cited answer must NOT be served.
      const outcome = decideSemanticCache({ similarity: 1.0, staleAnchors: stale })
      const pass = stale.includes('PH.COV.001') && outcome === 'stale-citation'
      return { pass, note: pass ? '' : `expected stale-citation, got '${outcome}' (stale=${JSON.stringify(stale)})` }
    },
  },
  {
    id:          'pdf-unverifiable-formnumber',
    feature:     'extractCoverages',
    description: 'form-number verification drops a number absent from the (PDF) source text, keeps a present one',
    run: async () => {
      // The verifyText a PDF upload now yields server-side (see functions/src/pdfText.ts).
      const pdfText = 'HOMEOWNERS 3 – SPECIAL FORM  HO 00 03 10 00 ... Water Back-Up HO 04 95 ...'
      const section = cleanForms({
        forms: [
          { number: 'HO 00 03', category: 'BASE_COVERAGE', citation: 'form header',   confidence: 0.99 },
          { number: 'HO 99 99', category: 'ENDORSEMENT',   citation: 'invented',      confidence: 0.5  },
        ],
      }, pdfText)
      const numbers = section.items.map(i => i.number)
      const pass = numbers.length === 1 && numbers[0] === 'HO 00 03' && !!section.note?.includes('dropped')
      return { pass, note: pass ? '' : `kept ${JSON.stringify(numbers)}; note="${section.note ?? ''}"` }
    },
  },
]
