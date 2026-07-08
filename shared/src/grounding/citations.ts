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
 *  HO.COV.001.001, HO.FORM.RU.003, GL.RAT.1, RTTable.001, LDTable.002 — but not a plain
 *  word, a phrase with spaces, or a bare "Section I". */
function isRefIdShaped(token: string): boolean {
  return /^[A-Za-z]{2,}(?:\.[A-Za-z0-9]+)+$/.test(token) && /\d/.test(token)
}

/** Every [bracketed] citation token in a block of markdown/prose, trimmed. */
export function extractBracketCitations(text: string): string[] {
  return [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]!.trim())
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
  const unresolved: string[] = []
  const seen = new Set<string>()
  for (const token of extractBracketCitations(text)) {
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
