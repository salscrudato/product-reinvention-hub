// conceptMatch.ts — pure, line-agnostic concept-matching toolkit for the ISO importer.
//
// Real carrier specifications link entities by CONCEPT, not by key: a rule cites a table
// by its free-text name ("Liability Limits"), a rating group names a coverage in words
// ("Combined Single Limit"), a limit matrix labels its columns with domain codes (BI, PD,
// CSL). This module reverse-engineers those implied links the way a human analyst would —
// by matching normalized names, folding domain synonyms, scoring token overlap, and
// resolving coverage codes against THE UPLOADED FILE'S OWN hierarchy (never a hard-coded
// carrier id). It is the deterministic core the concept-linker import path (isoImport.ts)
// stands on; the AI overlay (proposeMapping) only extends the seeds below per-workbook.
//
// Ported from the reference implementation docs/prompts/reference-concept-linker.cjs, with
// every literal `CORE.COV.NNN` refId replaced by concept resolution so the logic is
// line-agnostic. The seeded vocabularies below are ISO auto/liability DOMAIN terms
// (BI/PD/UM/CSL/…) — standard industry abbreviations, not carrier identifiers.
//
// Zero platform imports; pure + browser-safe (this module is bundled into the app AND the
// server CJS bridge, server/lib/import-brain-shared.cjs).

import type { TermKind, LinkBasis } from '../types'

// ─── String primitives (R2 spec) ────────────────────────────────────────────────

/** Uppercase, punctuation → single space, collapse whitespace, trim. */
export function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
/** norm() with spaces removed — punctuation/whitespace-insensitive identity key. */
export function squish(s: string): string {
  return norm(s).replace(/ /g, '')
}
/** Trailing-S fold for tokens longer than 3 chars ("LIMITS" → "LIMIT", but "GAS" stays). */
export function stem(t: string): string {
  return t.length > 3 ? t.replace(/S$/, '') : t
}

// Stopwords dropped before token comparison — connective + insurance-boilerplate words
// that carry no discriminating signal (R2 spec).
const STOP = new Set([
  'THE', 'A', 'AN', 'OF', 'VIA', 'AND', 'OR', 'FOR', 'TO', 'BY', 'WITH',
  'COVERAGE', 'COVERAGES', 'ENDORSEMENT', 'TABLE', 'MATRIX',
])

/** norm → split → drop stopwords → stem. The significant-word bag used for overlap/subset. */
export function tokens(s: string): string[] {
  return norm(s).split(' ').filter(t => t && !STOP.has(t)).map(stem)
}

// Form-number grammar: ISO/carrier form tokens ("AC 002", "PP 0001", "AC 00 01",
// state-suffixed "AC 002 CO"). Matched on the raw upper-cased string; the embedded-space
// variant is normalized away by squish() at comparison time so "AC 00 01" ≡ "AC 0001".
// Extensible: the AI overlay can supply additional tokens for a novel carrier prefix.
export const FORM_TOKEN =
  /\b(?:AC|PP|EP|NC|CA|CORULES|CAM)\s?\d[\d ]{0,6}\d?\b|\bAC \d{3} [A-Z]{2}\b/g

/** Distinct, whitespace-collapsed form tokens found anywhere in a string. */
export function formTokens(s: string): string[] {
  return [...new Set((s.toUpperCase().match(FORM_TOKEN) || []).map(m => m.replace(/\s+/g, ' ').trim()))]
}

// ─── Domain synonym seeds (ISO auto/liability vocab — NOT carrier identifiers) ────

// Inline abbreviation folds applied (space-padded) to a normalized phrase before token
// comparison, so "UM BI" reads as "UNINSURED MOTORISTS BODILY INJURY". Ordered so multi-word
// expansions (UNDER INSURED) run before single tokens. AI-overlay-extensible per R2/R4.
const ABBREV_FOLD: [RegExp, string][] = [
  [/ UNDER INSURED /g, ' UNDERINSURED '],
  [/ UM /g, ' UNINSURED MOTORISTS '],
  [/ UIM /g, ' UNDERINSURED MOTORISTS '],
  [/ BI /g, ' BODILY INJURY '],
  [/ PD /g, ' PROPERTY DAMAGE '],
  [/ OTC /g, ' OTHER THAN COLLISION '],
  [/ MED PAY /g, ' MEDICAL PAYMENTS '],
  [/ MPL /g, ' MOTORCYCLE PASSENGER LIABILITY '],
]

/** Fold domain abbreviations in a phrase to their canonical words (space-padded, normalized). */
export function foldSynonyms(nn: string): string {
  let f = ` ${norm(nn)} `
  for (const [re, rep] of ABBREV_FOLD) f = f.replace(re, rep)
  return f.replace(/\s+/g, ' ').trim()
}

// Coverage-code → canonical concept phrase(s), for the column headers of a limit/deductible
// matrix (D1/D7). Each phrase is resolved to a coverage refId at runtime via
// matchCoverageByName against the file's hierarchy — never a hard-coded id. CSL ("combined
// single limit") deliberately expands to BOTH bodily-injury and property-damage concepts.
// Regexes are tested against norm(code) (punctuation → space), so "BI/PD CSL" reads
// "BI PD CSL". Order matters: multi-token codes precede their single-token prefixes.
export const COVERAGE_CODE_MAP: { code: RegExp; phrases: string[] }[] = [
  { code: /^(BI PD CSL|CSL)$/,   phrases: ['BODILY INJURY', 'PROPERTY DAMAGE'] },
  { code: /^UM ?UIM BI$/,        phrases: ['UNINSURED MOTORISTS BODILY INJURY', 'UNDERINSURED MOTORISTS BODILY INJURY'] },
  { code: /^UM BI$/,             phrases: ['UNINSURED MOTORISTS BODILY INJURY'] },
  { code: /^UM PD$/,             phrases: ['UNINSURED MOTORISTS PROPERTY DAMAGE'] },
  { code: /^UIM BI$/,            phrases: ['UNDERINSURED MOTORISTS BODILY INJURY'] },
  { code: /^UIM PD$/,            phrases: ['UNDERINSURED MOTORISTS PROPERTY DAMAGE'] },
  { code: /^BI$/,                phrases: ['BODILY INJURY'] },
  { code: /^PD$/,                phrases: ['PROPERTY DAMAGE'] },
  { code: /^(MP|MED PAY|MEDICAL PAYMENTS?)$/, phrases: ['MEDICAL PAYMENTS'] },
  { code: /^MPL$/,               phrases: ['MOTORCYCLE PASSENGER LIABILITY'] },
]

// Endorsement PACKAGES rated as programs but modeled as forms: the rating group names the
// package in words while the coverages it grants are the package form's coverage list. These
// package↔form pairs are ISO collector-auto DOMAIN data (form numbers, not client
// identifiers); the AI overlay (R4) extends the map per-workbook. Each entry resolves via the
// file's own covsByForm reverse index — no literal coverage refIds.
export const PACKAGE_FORMS: { re: RegExp; formNum: string }[] = [
  { re: /^VALUE ADDED/,           formNum: 'AC 400' },
  { re: /^VEHICLE UNDER CONSTRUCTION/, formNum: 'AC 116' },
  { re: /^TRAVELING COLLECTOR/,   formNum: 'AC 113' },
  { re: /^LEGENDARY RIDE/,        formNum: 'AC 114' },
  { re: /^MOTORSPORTS ADVANTAGE/, formNum: 'AC 115' },
]

// ─── Concept shapes ──────────────────────────────────────────────────────────────

/** A coverage as the matchers see it: its verbatim refId + display name. */
export interface NamedCoverage { refId: string; name: string }

/** A reference table as the rule↔table matcher sees it. */
export interface ConceptTable { refId: string; baseName: string; state?: string }

/** Result of a coverage-name resolution. */
export interface CoverageMatch { refId: string; how: string }

/** Result of a rule-reference → table(s) resolution. */
export interface RuleRefMatch {
  tableRefIds: string[]
  how: string
  /** D8: the reference named a COVERAGE, not a table — resolved to this coverage refId. */
  resolvedCoverageRefId?: string
}

/** Result of a rating-group → coverage(s)/package-form resolution. */
export interface GroupMatch {
  covRefIds: string[]
  formNums: string[]
  how: string
  matchBasis: LinkBasis | 'unmatched'
}

// A tiny "not applicable / blank" guard shared with the mapper's placeholder handling.
function isNA(s: string): boolean { return /^n\/?a\.?$/i.test(s) || s.trim() === '' }

// ─── Coverage-name matcher ───────────────────────────────────────────────────────

/**
 * Resolve a free-text coverage name to a coverage in the hierarchy. Four tiers, most
 * certain first (R2 spec):
 *   1. exact normalized name
 *   2. domain-synonym fold → token-overlap ≥ 0.6
 *   3. token-overlap ≥ 0.6 on the raw (unfolded) tokens
 *   4. coverage-tokens ⊆ input-tokens containment (≥ 2 significant tokens)
 * Parenthetical qualifiers and "excluding …" tails are stripped first (they narrow, not
 * rename). "LIABILITY" is dropped from the overlap bag — it is near-universal in this domain
 * and would inflate every score. Returns null when nothing clears the bar (never a guess).
 */
export function matchCoverageByName(raw: string, coverages: readonly NamedCoverage[]): CoverageMatch | null {
  const stripped = raw.replace(/\(.*?\)/g, ' ').replace(/excluding.*$/i, ' ')
  const nn = norm(stripped)
  if (!nn) return null

  // Tier 1 — exact normalized name.
  for (const c of coverages) if (norm(c.name) === nn) return { refId: c.refId, how: 'exact name' }

  const overlapBag = (s: string): Set<string> =>
    new Set(tokens(s).filter(t => t !== 'LIABILITY'))

  // Tier 2/3 — best token-overlap, trying the synonym-folded phrase first then the raw.
  const bestOverlap = (inputTokens: Set<string>): { c: NamedCoverage; score: number } | null => {
    let best: NamedCoverage | null = null
    let bestScore = 0
    for (const c of coverages) {
      const ct = overlapBag(c.name)
      let overlap = 0
      for (const t of inputTokens) if (ct.has(t)) overlap++
      const score = overlap / Math.max(1, Math.max(inputTokens.size, ct.size))
      if (score > bestScore) { bestScore = score; best = c }
    }
    return best ? { c: best, score: bestScore } : null
  }

  const folded = bestOverlap(overlapBag(foldSynonyms(nn)))
  if (folded && folded.score >= 0.6) return { refId: folded.c.refId, how: `name match (${Math.round(folded.score * 100)}%)` }
  const rawM = bestOverlap(overlapBag(nn))
  if (rawM && rawM.score >= 0.6) return { refId: rawM.c.refId, how: `name match (${Math.round(rawM.score * 100)}%)` }

  // Tier 4 — containment: a coverage whose (≥2) significant tokens all appear in the input
  // (e.g. group "Optional Bodily Injury To Others" ⊇ coverage "Bodily Injury Liability
  // Coverage"). LIABILITY is dropped from the coverage side (near-universal domain word, like
  // the overlap tiers) so it doesn't block an otherwise-clean containment. Longest wins.
  const inTokens = new Set(tokens(foldSynonyms(nn)))
  let cont: NamedCoverage | null = null
  let contLen = 0
  for (const c of coverages) {
    const ct = tokens(c.name).filter(t => t !== 'LIABILITY')
    if (ct.length >= 2 && ct.every(t => inTokens.has(t)) && ct.length > contLen) { cont = c; contLen = ct.length }
  }
  if (cont) return { refId: cont.refId, how: 'containment' }

  return null
}

/**
 * Resolve a limit/deductible matrix column code (BI, PD, CSL, UM BI, …) to coverage refIds
 * via COVERAGE_CODE_MAP + matchCoverageByName. CSL resolves to BOTH bodily-injury and
 * property-damage coverages. Returns [] when the code maps to no coverage in the hierarchy.
 */
export function resolveCoverageCode(code: string, coverages: readonly NamedCoverage[]): string[] {
  const nc = norm(code)
  for (const { code: re, phrases } of COVERAGE_CODE_MAP) {
    if (!re.test(nc)) continue
    const out = new Set<string>()
    for (const phrase of phrases) {
      const m = matchCoverageByName(phrase, coverages)
      if (m) out.add(m.refId)
    }
    return [...out]   // first matching code wins (mirrors the reference impl's break)
  }
  return []
}

/** "Physical Damage" ≡ Collision + Other Than Collision (comprehensive) — the two coverages
 *  a physical-damage deductible table applies to (D7). */
export function physicalDamageCoverages(coverages: readonly NamedCoverage[]): string[] {
  const out: string[] = []
  for (const c of coverages) {
    if (/^collision/i.test(c.name) || /other than collision|comprehensive/i.test(c.name)) out.push(c.refId)
  }
  return out
}

// ─── Rule-reference → table matcher (D2) ─────────────────────────────────────────

/**
 * Resolve a rule's free-text RULE REFERENCE ("Liability Limits", "Minimum Premiums",
 * "Form/Coverage/Limit Matrix") to the reference table(s) it cites. Match tiers:
 *   • normalized containment either direction (ref ⊆ table name or table name ⊆ ref)
 *   • significant-token subset (every >2-char ref token appears in the table name)
 *   • shared form token
 *   • matrix synonym special-case ("… Limit Matrix" ≡ the sub-coverage limit matrix)
 * For state-suffixed families ("Liability Limits - AZ" × 9), prefer variants whose state is
 * in the rule's scope (fall back to the whole family for an all-states rule).
 * D8: when nothing matches but the reference names a COVERAGE, resolve to that coverage
 * (a coverage link + notice, not a failed table match).
 */
export function matchRuleReferenceToTables(
  ref: string,
  tables: readonly ConceptTable[],
  ruleStates: readonly string[],
  ruleAll: boolean,
  coverages: readonly NamedCoverage[],
): RuleRefMatch {
  if (isNA(ref)) return { tableRefIds: [], how: '' }
  const refN = norm(ref)
  const refT = new Set(tokens(ref))
  const refF = formTokens(ref)

  let cands = tables.filter(t => {
    const tn = norm(t.baseName)
    if (tn && (tn.includes(refN) || refN.includes(tn))) return true
    const tt = tokens(t.baseName)
    const sig = [...refT].filter(x => x.length > 2)
    if (sig.length && sig.every(x => tt.includes(x))) return true              // token subset
    if (refF.length && formTokens(t.baseName).some(f => refF.includes(f))) return true // shared form token
    return false
  })

  // Special-case: "Form/Coverage/Limit Matrix" → the sub-coverage limit matrix.
  if (!cands.length && /LIMIT/.test(refN) && /MATRIX/i.test(ref)) {
    cands = tables.filter(t => /SUB-?COVERAGE.*LIMIT/i.test(t.baseName))
  }

  if (!cands.length) {
    const cm = matchCoverageByName(ref.replace(FORM_TOKEN, ' '), coverages)
    if (cm) return { tableRefIds: [], how: `reference resolves to coverage ${cm.refId} — no table in source`, resolvedCoverageRefId: cm.refId }
    return { tableRefIds: [], how: 'NO MATCHING TABLE IN SOURCE' }
  }

  // Prefer state-relevant variants of a state-suffixed family.
  const stateful = cands.filter(t => t.state)
  if (stateful.length && !ruleAll && ruleStates.length) {
    const inScope = stateful.filter(t => ruleStates.includes(t.state!))
    cands = [...cands.filter(t => !t.state), ...(inScope.length ? inScope : stateful)]
  }
  return { tableRefIds: cands.map(t => t.refId), how: 'concept match on reference name' }
}

// ─── Rating-group → coverage matcher (D5) ────────────────────────────────────────

// Auto/collector rating-group taxonomy: a group names a coverage CONCEPT in words that don't
// lexically match the hierarchy coverage names (e.g. "Combined Single Limit" rates the bodily-
// injury + property-damage coverages; a bare "Scheduled"/"Unscheduled" group rates the
// scheduled personal-property coverage). Each entry maps a group-name pattern to canonical
// concept PHRASE(s) that are resolved to refIds at runtime via matchCoverageByName against THIS
// file's hierarchy — never a hard-coded id. Ordered most-specific first (UM/UIM CSL before bare
// CSL, before bare UM/UIM). ISO auto DOMAIN vocab, not carrier identifiers; AI-overlay-extensible.
export const RATING_GROUP_CONCEPTS: { re: RegExp; phrases: string[] }[] = [
  { re: /\bUNINSURED MOTORISTS? COMBINED SINGLE LIMIT/,    phrases: ['UNINSURED MOTORISTS BODILY INJURY', 'UNINSURED MOTORISTS PROPERTY DAMAGE'] },
  { re: /\bUNDERINSURED MOTORISTS? COMBINED SINGLE LIMIT/, phrases: ['UNDERINSURED MOTORISTS BODILY INJURY', 'UNDERINSURED MOTORISTS PROPERTY DAMAGE'] },
  { re: /\bCOMBINED SINGLE LIMIT/,                         phrases: ['BODILY INJURY', 'PROPERTY DAMAGE'] },
  { re: /\bUNINSURED\b.*\bUNDERINSURED MOTORISTS/,         phrases: ['UNINSURED MOTORISTS BODILY INJURY', 'UNDERINSURED MOTORISTS BODILY INJURY'] },
  { re: /\bUNDERINSURED MOTORISTS\b/,                      phrases: ['UNDERINSURED MOTORISTS BODILY INJURY'] },
  { re: /\bUNINSURED MOTORISTS\b/,                         phrases: ['UNINSURED MOTORISTS BODILY INJURY'] },
  { re: /^(UN)?SCHEDULED$/,                                phrases: ['COLLECTIBLE PERSONAL PROPERTY', 'PERSONAL PROPERTY'] },
]

/**
 * Resolve a rating-group coverage-name to the hierarchy coverage(s) it rates. Order:
 *   1. endorsement PACKAGE (PACKAGE_FORMS) → the package form's coverage list (via covsByForm)
 *   2. domain taxonomy (RATING_GROUP_CONCEPTS) → concept phrases → matchCoverageByName
 *   3. direct coverage-name match (matchCoverageByName: exact/synonym/overlap/containment)
 * Returns an empty covRefIds + matchBasis 'unmatched' when the group names no coverage in the
 * hierarchy — a genuinely missing coverage the customer must add (flagged upstream, never
 * invented). `covsByForm` maps a squished form number → the coverage refIds that list it.
 */
export function matchGroup(
  raw: string,
  coverages: readonly NamedCoverage[],
  covsByForm: ReadonlyMap<string, string[]>,
): GroupMatch {
  const base = norm(raw.replace(/\(.*?\)/g, ' ').replace(/excluding.*$/i, ' ').replace(/™/g, ' '))

  // 1 — endorsement package rated as a program.
  for (const { re, formNum } of PACKAGE_FORMS) {
    if (re.test(base)) {
      const via = covsByForm.get(squish(formNum)) ?? []
      return { covRefIds: [...new Set(via)].slice(0, 40), formNums: [formNum], how: `rates endorsement package ${formNum}`, matchBasis: 'derived' }
    }
  }

  // 2 — domain taxonomy (UM/UIM/CSL/scheduled) → concept phrases resolved against the hierarchy.
  const folded = foldSynonyms(base)
  for (const { re, phrases } of RATING_GROUP_CONCEPTS) {
    if (!re.test(folded)) continue
    const ids = new Set<string>()
    for (const p of phrases) { const m = matchCoverageByName(p, coverages); if (m) ids.add(m.refId) }
    if (ids.size) return { covRefIds: [...ids], formNums: [], how: 'domain concept', matchBasis: 'derived' }
  }

  // 3 — direct coverage-name resolution.
  const m = matchCoverageByName(raw, coverages)
  if (m) return { covRefIds: [m.refId], formNums: [], how: m.how, matchBasis: 'derived' }

  return { covRefIds: [], formNums: [], how: 'NO MATCHING COVERAGE IN HIERARCHY', matchBasis: 'unmatched' }
}

// ─── Term-kind inference from a reference table's signature ───────────────────────

/**
 * Infer a reference table's term kind from its name, its back-link label, and its column
 * codes (the "hay" the reference impl scans). LIMIT + DEDUCTIBLE both present → the caller
 * splits; here we return the dominant kind, defaulting to OPTION when neither word appears.
 */
export function inferTableKind(hay: string): TermKind {
  const h = hay.toUpperCase()
  if (/DEDUCTIBLE/.test(h)) return 'DEDUCTIBLE'
  if (/\bLIMIT/.test(h)) return 'LIMIT'
  return 'OPTION'
}
