// functions/eval/runner.ts — offline eval harness for AI features.
//
// Scoring dimensions (per case):
//   grounding       — response cites every refId in expectedRefIds (subset check)
//   citation_valid  — every refId / form-number extracted from the response exists
//                     in the seed data (no hallucinated references)
//   shape           — all requiredFields are present at the top level of response
//
// Run from repo root:  pnpm eval   (tsx functions/eval/runner.ts)
//
// No live API calls are made. All cases are pre-recorded golden fixtures.

import {
  PH_COVERAGES, PH_LD_TABLES, PH_RT_TABLES, PH_FORMS,
  PH_RULES, PH_FORM_RULES, PH_DICTIONARY, PH_PRODUCT,
  PA_COVERAGES, PA_LD_TABLES, PA_RT_TABLES, PA_FORMS,
  PA_RULES, PA_FORM_RULES, PA_DICTIONARY, PA_PRODUCT,
} from '@pf/shared'
import { EVAL_CASES, GUARD_CASES, RETRIEVAL_CASES, RETRIEVAL_CORPUS_SIZE, retrievedAnchors } from './cases'
import type { EvalCase, GuardCase, RetrievalCase } from './cases'

// ── Build known-entity sets from live seed data ────────────────────────────────
//
// The eval harness tests citation validity by checking extracted refIds/form-numbers
// against this authoritative set. Any extracted string that pattern-matches a refId
// but is NOT in this set is a hallucinated reference (the hostile self-review check).

// Some seed types declare refId as string | null (e.g. DictSeed). Filter nulls
// before building the set so the type stays Set<string>.
const KNOWN_REF_IDS = new Set<string>(
  [
    PH_PRODUCT.refId,
    ...PH_COVERAGES.map((c) => c.refId),
    ...Object.keys(PH_LD_TABLES),
    ...Object.keys(PH_RT_TABLES),
    ...PH_RULES.map((r) => r.refId),
    ...PH_FORM_RULES.map((r) => r.refId),
    ...PH_DICTIONARY.map((d) => d.refId),
    PA_PRODUCT.refId,
    ...PA_COVERAGES.map((c) => c.refId),
    ...Object.keys(PA_LD_TABLES),
    ...Object.keys(PA_RT_TABLES),
    ...PA_RULES.map((r) => r.refId),
    ...PA_FORM_RULES.map((r) => r.refId),
    ...PA_DICTIONARY.map((d) => d.refId),
  ].filter((r): r is string => r != null),
)

const KNOWN_FORM_NUMBERS = new Set<string>([
  ...PH_FORMS.map((f) => f.number),
  ...PA_FORMS.map((f) => f.number),
])

// RefId pattern: e.g. HO.COV.001, HO.COV.001.001, GL.PROD.001, HO.LD.003
// Two uppercase segments separated by dots, followed by a numeric suffix.
const REF_ID_RE = /\b([A-Z]{2,}\.[A-Z]+\.\d[\w.]*)/g

// ISO form number pattern: e.g. HO 00 03, CG 00 01, HO DS 01
// Two uppercase letters, space, two digits, space, two digits.
const FORM_NUM_RE = /\b([A-Z]{2} \d{2} \d{2})\b/g

// ── Citation extraction ────────────────────────────────────────────────────────

/** Recursively extract all refId-like and form-number-like strings from an object.
 *  Accumulates into the passed sets so callers can share state across subtrees. */
function extractCitations(
  obj: unknown,
  refIds: Set<string>,
  formNums: Set<string>,
): void {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(REF_ID_RE))  refIds.add(m[1]!)
    for (const m of obj.matchAll(FORM_NUM_RE)) formNums.add(m[1]!)
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractCitations(item, refIds, formNums)
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      extractCitations(val, refIds, formNums)
    }
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────────

interface CaseResult {
  id:            string
  feature:       string
  grounding:     'PASS' | 'FAIL' | 'SKIP'
  groundingNote: string
  citValid:      'PASS' | 'FAIL'
  citNote:       string
  shape:         'PASS' | 'FAIL'
  shapeNote:     string
  pass:          boolean
}

function scoreCase(c: EvalCase): CaseResult {
  const citedRefIds  = new Set<string>()
  const citedForms   = new Set<string>()
  extractCitations(c.response, citedRefIds, citedForms)

  // Grounding: every expectedRefId must appear somewhere in the response.
  let grounding: 'PASS' | 'FAIL' | 'SKIP' = 'SKIP'
  let groundingNote = ''
  if (c.expectedRefIds.length > 0) {
    const missing = c.expectedRefIds.filter((r) => !citedRefIds.has(r))
    grounding     = missing.length === 0 ? 'PASS' : 'FAIL'
    groundingNote = missing.length > 0 ? `missing: ${missing.join(', ')}` : ''
  }

  // Citation validity: extracted refIds and form numbers must exist in seed data.
  // This is the hostile self-review check — catches hallucinated entity references.
  const bogusRefIds  = [...citedRefIds].filter((r) => !KNOWN_REF_IDS.has(r))
  const bogusForms   = [...citedForms].filter((f) => !KNOWN_FORM_NUMBERS.has(f))
  const citValid     = bogusRefIds.length === 0 && bogusForms.length === 0 ? 'PASS' : 'FAIL'
  const citNote      = citValid === 'FAIL'
    ? [
        bogusRefIds.length ? `unknown refIds: ${bogusRefIds.join(', ')}`  : '',
        bogusForms.length  ? `unknown forms: ${bogusForms.join(', ')}`    : '',
      ].filter(Boolean).join('; ')
    : ''

  // Shape: all requiredFields must be present at the top level of the response.
  const missingFields = c.requiredFields.filter((f) => !(f in c.response))
  const shape         = missingFields.length === 0 ? 'PASS' : 'FAIL'
  const shapeNote     = shape === 'FAIL' ? `missing fields: ${missingFields.join(', ')}` : ''

  const pass = grounding !== 'FAIL' && citValid === 'PASS' && shape === 'PASS'

  return {
    id: c.id, feature: c.feature,
    grounding, groundingNote,
    citValid, citNote,
    shape, shapeNote,
    pass,
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const pad = (s: string, n: number) => s.padEnd(n)

function renderTable(results: CaseResult[]): void {
  const W = { id: 34, feat: 18, grnd: 12, cit: 16, shape: 7, pass: 4 }
  const header =
    pad('CASE', W.id) +
    pad('FEATURE', W.feat) +
    pad('GROUNDING', W.grnd) +
    pad('CITATION_VALID', W.cit) +
    pad('SHAPE', W.shape) +
    'PASS'
  const sep = '─'.repeat(header.length)

  console.log('\nAI EVAL HARNESS')
  console.log(sep)
  console.log(header)
  console.log(sep)

  for (const r of results) {
    const gStr = r.grounding === 'SKIP' ? 'SKIP (n/a)' : r.grounding
    console.log(
      pad(r.id, W.id) +
      pad(r.feature, W.feat) +
      pad(gStr, W.grnd) +
      pad(r.citValid, W.cit) +
      pad(r.shape, W.shape) +
      (r.pass ? 'PASS' : 'FAIL'),
    )
    if (r.groundingNote) console.log(`${''.padEnd(W.id + W.feat)}  ^ GROUNDING: ${r.groundingNote}`)
    if (r.citNote)       console.log(`${''.padEnd(W.id + W.feat)}  ^ CITATION:  ${r.citNote}`)
    if (r.shapeNote)     console.log(`${''.padEnd(W.id + W.feat)}  ^ SHAPE:     ${r.shapeNote}`)
  }

  const passed = results.filter((r) => r.pass).length
  console.log(sep)
  console.log(`\n${passed}/${results.length} cases passed`)
  console.log(`\nSeed inventory: ${KNOWN_REF_IDS.size} known refIds, ${KNOWN_FORM_NUMBERS.size} known form numbers`)
  console.log()
}

// ── Guard cases (hostile inputs the grounding guards must reject) ───────────────

interface GuardResult { id: string; feature: string; description: string; pass: boolean; note: string }

async function runGuards(cases: GuardCase[]): Promise<GuardResult[]> {
  const out: GuardResult[] = []
  for (const c of cases) {
    const { pass, note } = await c.run()
    out.push({ id: c.id, feature: c.feature, description: c.description, pass, note })
  }
  return out
}

function renderGuardTable(results: GuardResult[]): void {
  const W = { id: 32, feat: 18, pass: 4 }
  const header = pad('GUARD CASE', W.id) + pad('FEATURE', W.feat) + 'PASS'
  const sep = '─'.repeat(header.length)
  console.log('\nGROUNDING GUARDS (adversarial — must reject)')
  console.log(sep)
  console.log(header)
  console.log(sep)
  for (const r of results) {
    console.log(pad(r.id, W.id) + pad(r.feature, W.feat) + (r.pass ? 'PASS' : 'FAIL'))
    if (!r.pass && r.note) console.log(`${''.padEnd(W.id + W.feat)}  ^ ${r.note}`)
  }
  const passed = results.filter((r) => r.pass).length
  console.log(sep)
  console.log(`\n${passed}/${results.length} guard cases passed`)
  console.log()
}

// ── Retrieval-quality cases (is the expected refId retrieved in the top-k?) ─────

interface RetrievalResult { id: string; expect: string; k: number; pass: boolean; note: string }

function scoreRetrieval(c: RetrievalCase): RetrievalResult {
  const anchors = retrievedAnchors(c.query, c.k)
  const pass = anchors.includes(c.expect)
  return { id: c.id, expect: c.expect, k: c.k, pass, note: pass ? '' : `top-${c.k}: ${anchors.join(', ') || '(none)'}` }
}

function renderRetrievalTable(results: RetrievalResult[]): void {
  const W = { id: 32, exp: 18, k: 4 }
  const header = pad('RETRIEVAL CASE', W.id) + pad('EXPECT', W.exp) + pad('K', W.k) + 'PASS'
  const sep = '─'.repeat(header.length)
  console.log('\nRETRIEVAL QUALITY (expected anchor in top-k — offline lexical over the chunk corpus)')
  console.log(sep)
  console.log(header)
  console.log(sep)
  for (const r of results) {
    console.log(pad(r.id, W.id) + pad(r.expect, W.exp) + pad(String(r.k), W.k) + (r.pass ? 'PASS' : 'FAIL'))
    if (!r.pass && r.note) console.log(`${''.padEnd(W.id + W.exp)}  ^ ${r.note}`)
  }
  const passed = results.filter((r) => r.pass).length
  console.log(sep)
  console.log(`\n${passed}/${results.length} retrieval cases passed (corpus: ${RETRIEVAL_CORPUS_SIZE} chunks)`)
  console.log()
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results = EVAL_CASES.map(scoreCase)
  renderTable(results)
  const guardResults = await runGuards(GUARD_CASES)
  renderGuardTable(guardResults)
  const retrievalResults = RETRIEVAL_CASES.map(scoreRetrieval)
  renderRetrievalTable(retrievalResults)
  const allPass =
    results.every((r) => r.pass) &&
    guardResults.every((r) => r.pass) &&
    retrievalResults.every((r) => r.pass)
  process.exit(allPass ? 0 : 1)
}

void main()
