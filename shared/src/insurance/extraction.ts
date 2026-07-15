// extraction.ts — the grounded-extraction contract + its anti-fabrication guards.
// A base coverage form is read server-side by Claude, which proposes the product's
// coverages, forms, rules and rating hints via forced tools. This module owns the
// wire shapes both sides agree on AND the pure sanitizers that turn a model's raw
// tool input into proposals we can stand behind:
//
//   • Every proposal MUST carry a non-empty citation — anything without one is
//     dropped here, in code, not merely discouraged in the prompt.
//   • A proposed form number (and any form number a coverage/rule cites) is verified
//     to actually appear in the document's text; unverifiable ones are dropped.
//     (For a PDF the text isn't available to grep, so `text` is null and the check
//     is skipped — grounding then rests on the citation + the never-invent prompt.)
//   • The model never emits refIds; those are internal identifiers allocated by the
//     app at persist time, so a fabricated refId is structurally impossible.
//
// Pure TypeScript (zero platform imports) so functions/ imports it AND the gate test
// exercises it deterministically without a live model. See functions/src/extract.ts.
import type { Requirement, FormCategory, AttachmentCondition } from '../types'

// ─── Wire shapes (client + server agree on these) ───────────────────────────────

export interface ProposedCoverage {
  name:              string
  requirement:       Requirement
  /** null = the document does not state premium treatment (F14). */
  premiumGenerating: boolean | null
  formNumbers:       string[]
  limitHint?:        string
  confidence:        number   // 0..1
  citation:          string   // where in the document it was found
}

export interface ProposedForm {
  number:              string
  name:                string
  edition:             string
  category:            FormCategory
  mandatoryDefault:    boolean
  attachmentCondition: AttachmentCondition
  confidence:          number
  citation:            string
}

// Rules and rating hints both persist as Rule entities (category PRODUCT/FORMS vs
// RATING); they're proposed by separate tools because the reasoning differs. Rules
// reference coverages by NAME (never a refId — the doc has none) and forms by number;
// the client resolves names → real refIds at persist time and drops what won't ground.
export interface ProposedRule {
  category:      'PRODUCT' | 'FORMS'
  subCategory:   string
  condition:     string
  outcome:       string
  coverageNames: string[]
  formNumbers:   string[]
  confidence:    number
  citation:      string
}

export interface ProposedRatingHint {
  subCategory:     string
  condition:       string
  outcome:         string
  coverageNames:   string[]
  formNumbers:     string[]
  minimumPremium?: number
  confidence:      number
  citation:        string
}

/** One extracted section: the surviving proposals plus a human note. The note is how
 *  a section says "nothing here" explicitly — either the model's own explanation or a
 *  synthesized one when a section came back empty or had ungrounded items dropped. */
export interface ExtractionSection<T> { items: T[]; note?: string }

export interface ExtractionResult {
  coverages: ExtractionSection<ProposedCoverage>
  forms:     ExtractionSection<ProposedForm>
  rules:     ExtractionSection<ProposedRule>
  rating:    ExtractionSection<ProposedRatingHint>
}

export type ExtractionKind = keyof ExtractionResult

// ─── Coercion helpers ───────────────────────────────────────────────────────────

const str    = (v: unknown): string   => String(v ?? '').trim()
const bool   = (v: unknown): boolean  => v === true
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
/** Clamp any model-supplied confidence into [0,1]; non-numbers become 0 (unknown). */
const conf   = (v: unknown): number   => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0 }

const FORM_CATEGORIES = new Set<FormCategory>(['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'])

/** Compact a form number to a comparison key: uppercase, all whitespace removed, so
 *  "HO 00 03" / "ho0003" / "HO-00-03" all reduce to "HO0003". */
export function normalizeFormNumber(n: string): string {
  return n.toUpperCase().replace(/[\s-]+/g, '')
}

/** Does this form number actually appear in the document's text?
 *  `text === null` means we have no text to check (e.g. a PDF read directly by the
 *  model) — we cannot verify, so we don't drop; grounding then rests on the citation.
 *  Guards against trivially-short tokens so a stray "A" can't match everything. */
export function formAppearsInText(number: string, text: string | null): boolean {
  if (text === null) return true
  const key = normalizeFormNumber(number)
  if (key.length < 4) return false   // a real ISO/proprietary number is ≥4 chars once compacted
  return normalizeFormNumber(text).includes(key)
}

/** Compose a section note from the model's own note plus anything the guards did:
 *  an empty section says so, and dropped-for-grounding items are disclosed. */
function sectionNote(modelNote: string, kept: number, dropped: number, noun: string): string | undefined {
  const parts: string[] = []
  if (modelNote) parts.push(modelNote)
  if (kept === 0 && !modelNote) parts.push(`The document does not appear to define ${noun} content.`)
  if (dropped > 0) parts.push(`${dropped} ungrounded ${noun} proposal${dropped === 1 ? '' : 's'} dropped (missing citation or a form number not found in the document).`)
  return parts.length ? parts.join(' ') : undefined
}

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

// ─── Per-section sanitizers ─────────────────────────────────────────────────────
// Each takes the model's raw tool `input` plus the document text (or null for a PDF)
// and returns only the proposals that clear the grounding bar, with a note.

export function cleanCoverages(input: Record<string, unknown> | undefined, text: string | null): ExtractionSection<ProposedCoverage> {
  const rows = asArray(input?.coverages)
  const items: ProposedCoverage[] = []
  let dropped = 0
  for (const c of rows) {
    const name = str(c.name)
    const citation = str(c.citation)
    if (!name || !citation) { dropped++; continue }               // citation is mandatory
    // F14: a value the document does not state must land as UNKNOWN / null —
    // an unrecognized token is NOT evidence of MANDATORY, and an absent premium
    // marker is NOT evidence either way.
    const reqTok = str(c.requirement).toUpperCase()
    const pgRaw = c.premiumGenerating
    const pgTok = typeof pgRaw === 'string' ? pgRaw.toUpperCase() : pgRaw
    items.push({
      name,
      requirement:       reqTok === 'OPTIONAL' ? 'OPTIONAL' : reqTok === 'MANDATORY' ? 'MANDATORY' : 'UNKNOWN',
      premiumGenerating: pgTok === true || pgTok === 'YES' || pgTok === 'TRUE' ? true
                       : pgTok === false || pgTok === 'NO' || pgTok === 'FALSE' ? false
                       : null,
      formNumbers:       strArr(c.formNumbers).filter(f => formAppearsInText(f, text)),   // drop invented form refs
      limitHint:         str(c.limitHint) || undefined,
      confidence:        conf(c.confidence),
      citation,
    })
  }
  return { items, note: sectionNote(str(input?.note), items.length, dropped, 'coverage') }
}

export function cleanForms(input: Record<string, unknown> | undefined, text: string | null): ExtractionSection<ProposedForm> {
  const rows = asArray(input?.forms)
  const items: ProposedForm[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const f of rows) {
    const number = str(f.number)
    const citation = str(f.citation)
    if (!number || !citation) { dropped++; continue }             // citation is mandatory
    if (!formAppearsInText(number, text)) { dropped++; continue } // the number must be in the document
    const key = normalizeFormNumber(number)
    if (seen.has(key)) { dropped++; continue }                    // de-dupe repeats
    seen.add(key)
    const cat = str(f.category).toUpperCase() as FormCategory
    items.push({
      number,
      name:                str(f.name) || number,
      edition:             str(f.edition),
      category:            FORM_CATEGORIES.has(cat) ? cat : 'ENDORSEMENT',
      mandatoryDefault:    bool(f.mandatoryDefault),
      attachmentCondition: str(f.attachmentCondition).toUpperCase() === 'NONE' ? 'NONE' : 'RULE',
      confidence:          conf(f.confidence),
      citation,
    })
  }
  return { items, note: sectionNote(str(input?.note), items.length, dropped, 'form') }
}

export function cleanRules(input: Record<string, unknown> | undefined, text: string | null): ExtractionSection<ProposedRule> {
  const rows = asArray(input?.rules)
  const items: ProposedRule[] = []
  let dropped = 0
  for (const r of rows) {
    const condition = str(r.condition)
    const outcome = str(r.outcome)
    const citation = str(r.citation)
    if (!condition || !outcome || !citation) { dropped++; continue }
    items.push({
      category:      str(r.category).toUpperCase() === 'FORMS' ? 'FORMS' : 'PRODUCT',
      subCategory:   str(r.subCategory) || 'Authored',
      condition,
      outcome,
      coverageNames: strArr(r.coverageNames),
      formNumbers:   strArr(r.formNumbers).filter(f => formAppearsInText(f, text)),
      confidence:    conf(r.confidence),
      citation,
    })
  }
  return { items, note: sectionNote(str(input?.note), items.length, dropped, 'rule') }
}

export function cleanRating(input: Record<string, unknown> | undefined, text: string | null): ExtractionSection<ProposedRatingHint> {
  const rows = asArray(input?.hints)
  const items: ProposedRatingHint[] = []
  let dropped = 0
  for (const h of rows) {
    const condition = str(h.condition)
    const outcome = str(h.outcome)
    const citation = str(h.citation)
    if (!condition || !outcome || !citation) { dropped++; continue }
    const mp = Number(h.minimumPremium)
    items.push({
      subCategory:    str(h.subCategory) || 'Rating',
      condition,
      outcome,
      coverageNames:  strArr(h.coverageNames),
      formNumbers:    strArr(h.formNumbers).filter(f => formAppearsInText(f, text)),
      minimumPremium: Number.isFinite(mp) && mp > 0 ? mp : undefined,
      confidence:     conf(h.confidence),
      citation,
    })
  }
  return { items, note: sectionNote(str(input?.note), items.length, dropped, 'rating') }
}
