// citations.ts — the "AI grounded + cited" invariant, applied to free-prose answers.
// A grounded answer cites refIds ([HO.RU.006]) and form numbers ([HO 04 95]) in
// square brackets. This module recognises those citation shapes and verifies each one
// resolves to a REAL entity — the payload behind the portfolio chat's server-side
// citation post-check (functions/src/ai.ts) and the offline eval's regression guard.
//
// It is deliberately conservative: only tokens that LOOK like a refId or an ISO form
// number are checked. Descriptive brackets the models also emit — a clause or section
// name like [Section I – Exclusions] or a coverage name like [Coverage A — Dwelling] —
// are not entity ids, so they are never flagged. That keeps the guard from crying wolf
// while still catching a fabricated [HO.COV.999] before it is shown as if verified.
//
// Pure TypeScript (zero platform imports): functions/ calls it with the live catalogue,
// and the gate exercises it deterministically with the seed sets. See functions/src/ai.ts.
import { normalizeFormNumber } from '../insurance/extraction'

// A leading ISO form number, e.g. "HO 00 03" / "CG 00 01". Anchored so a bracket like
// "HO 00 03 §I.B.12" is still recognised as a form citation (we verify the number part).
const FORM_LEAD_RE = /^([A-Z]{2}\s\d{2}\s\d{2})/

/** True when a token has the shape of a domain refId: a 2+ letter prefix followed by one
 *  or more dotted segments, and containing at least one digit. Matches HO.COV.001,
 *  HO.COV.001.001, HO.FORM.RU.003, PA.RAT.1, PA.RT.001, PA.LD.005 — but not a plain
 *  word, a phrase with spaces, or a bare "Section I". */
function isRefIdShaped(token: string): boolean {
  return /^[A-Za-z]{2,}(?:\.[A-Za-z0-9]+)+$/.test(token) && /\d/.test(token)
}

/** Every [bracketed] citation token in a block of markdown/prose, trimmed. */
export function extractBracketCitations(text: string): string[] {
  return [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]!.trim())
}

/** Core: of a list of candidate citation tokens, return the refId-shaped and form-number-
 *  shaped ones that do NOT resolve against the known catalogue. Descriptive tokens (a clause,
 *  section or coverage name) are never checked and never returned. Duplicates collapse to a
 *  single entry, in first-seen order. Shared by the prose guard and the determination guard. */
function unverifiedFromTokens(
  tokens: Iterable<string>,
  knownRefIds: ReadonlySet<string>,
  knownFormNumbers: ReadonlySet<string>,
): string[] {
  const unresolved: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    if (!token || seen.has(token)) continue
    const form = FORM_LEAD_RE.exec(token)
    if (form) {
      seen.add(token)
      if (!knownFormNumbers.has(normalizeFormNumber(form[1]!))) unresolved.push(token)
      continue
    }
    if (isRefIdShaped(token)) {
      seen.add(token)
      if (!knownRefIds.has(token.toUpperCase())) unresolved.push(token)
    }
  }
  return unresolved
}

/**
 * Return the cited tokens that do NOT resolve against the known catalogue — the
 * fabricated/stale references a grounded answer must never present as fact. `knownRefIds`
 * must be upper-cased by the caller; `knownFormNumbers` must be normalised via
 * normalizeFormNumber. Only refId-shaped and form-number-shaped tokens are checked;
 * anything else (a clause/section/coverage name) is descriptive and returned to no one.
 * Duplicates collapse to a single entry, in first-seen order.
 */
export function findUnverifiedCitations(
  text: string,
  knownRefIds: ReadonlySet<string>,
  knownFormNumbers: ReadonlySet<string>,
): string[] {
  return unverifiedFromTokens(extractBracketCitations(text), knownRefIds, knownFormNumbers)
}

// ─── Determination citation verification (the Claims card's grounding guard) ────
// The prose guard above checks a free-text answer. A structured coverage determination
// cites its sources across STRUCTURED fields (coverage/exclusion refIds + form numbers,
// limit sources, explicit citations[]) and [bracketed] reasoning. This applies the SAME
// resolve-against-the-catalogue rule to that shape, so a plausible-but-invented refId
// (e.g. PH.COV.999) or form number can never render on the card as if it were real.

/** The citation-bearing subset of a coverage determination (structural — no platform types). */
export interface DeterminationLike {
  citations?:   unknown
  coverages?:   unknown
  exclusions?:  unknown
  limits?:      unknown
  reasoning?:   unknown
  coverageGap?: unknown   // { note?: string; sources?: string[] } — the PM coverage-gap note
}

/** Every candidate citation token a determination points at: explicit citations[], each
 *  coverage/exclusion refId + formNumber, each limit source, and [bracketed] reasoning cites.
 *  The base `formNumber` footer is deliberately excluded — it is the ATTACHED form itself,
 *  which may be a user-uploaded form legitimately absent from the catalogue; the caller adds
 *  the attached form number to the known set instead. */
export function collectDeterminationCitationTokens(d: DeterminationLike): string[] {
  const out: string[] = []
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  for (const c of arr(d.citations)) { const s = str(c); if (s) out.push(s) }
  for (const c of arr(d.coverages))  { const o = c as Record<string, unknown>; const r = str(o.refId); const f = str(o.formNumber); if (r) out.push(r); if (f) out.push(f) }
  for (const e of arr(d.exclusions)) { const o = e as Record<string, unknown>; const r = str(o.refId); const f = str(o.formNumber); if (r) out.push(r); if (f) out.push(f) }
  for (const l of arr(d.limits))     { const o = l as Record<string, unknown>; const s = str(o.source); if (s) out.push(s) }
  for (const r of arr(d.reasoning))  out.push(...extractBracketCitations(str(r)))
  // The PM coverage-gap note: its named silent/ambiguous sources + any [bracketed] cite in the
  // note. A fabricated gap source must be caught like any other cited reference.
  const gap = (d.coverageGap && typeof d.coverageGap === 'object') ? d.coverageGap as Record<string, unknown> : null
  if (gap) {
    for (const s of arr(gap.sources)) { const v = str(s); if (v) out.push(v) }
    out.push(...extractBracketCitations(str(gap.note)))
  }
  return out
}

/** The cited refId/form tokens in a determination that do NOT resolve against the known
 *  catalogue — the fabricated/stale references the card must never present as authoritative.
 *  Same conservative shape rules as findUnverifiedCitations: only refId-shaped and
 *  form-number-shaped tokens are checked; descriptive names (a section/coverage name,
 *  "Declarations") are never flagged. */
export function findUnverifiedDeterminationCitations(
  d: DeterminationLike,
  knownRefIds: ReadonlySet<string>,
  knownFormNumbers: ReadonlySet<string>,
): string[] {
  return unverifiedFromTokens(collectDeterminationCitationTokens(d), knownRefIds, knownFormNumbers)
}
