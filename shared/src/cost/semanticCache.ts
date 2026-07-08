// cost/semanticCache.ts — the pure decision logic behind the semantic response cache.
//
// The cache reuses a previously-computed grounded answer for a NEW question when three
// independent gates all pass:
//   1. FRESHNESS  — every refId / form number the cached answer cited still resolves against
//                   the live catalogue. This gate is checked FIRST and is absolute: a cached
//                   answer whose citations have gone stale (an entity was edited/deleted) is
//                   NEVER served, however similar the query. ("Never serve a stale answer
//                   whose cited refIds no longer resolve.")
//   2. SIMILARITY — the nearest cached query is within a CONSERVATIVE cosine threshold of the
//                   new query. High on purpose: we only reuse for a near-identical question.
//   3. VERIFIER   — a cheap model check agrees the cached answer actually fits the new
//                   question (runs server-side in functions/, gated after 1 + 2 pass).
//
// This module owns gates 1 + 2 (pure, unit-tested in the gate) and the anchor bookkeeping;
// the embedding, vector KNN, verifier call and persistence live in functions/src/semanticCache.ts.
// Zero platform imports.
import { normalizeFormNumber } from '../insurance/extraction'
import { extractBracketCitations } from '../grounding/citations'

/** Conservative cosine-similarity floor for a cache hit. Reusing an answer for a merely
 *  "related" question is the failure mode we must avoid, so the bar is high — near-duplicate
 *  questions only. Raise it to be stricter; a hit still requires the verifier to agree. */
export const SEMANTIC_CACHE_THRESHOLD = 0.93

/** refId shape (mirrors grounding/citations): a 2+ letter prefix + dotted segments, with a
 *  digit — HO.COV.001, PH.RU.006, RTTable.001. Distinguishes a refId anchor from a (dot-less)
 *  normalized form number so freshness checks hit the right catalogue set. */
function isRefIdShaped(token: string): boolean {
  return /^[A-Za-z]{2,}(?:\.[A-Za-z0-9]+)+$/.test(token) && /\d/.test(token)
}

/** A normalized form number: letters then digits, no separators (HO0003, CG0001). */
function isFormShaped(token: string): boolean {
  return /^[A-Z]{2,}\d{4,}$/.test(token)
}

/**
 * The citation anchors a grounded answer relies on, normalized for storage + later freshness
 * checks: refIds UPPER-cased, form numbers run through normalizeFormNumber. Only anchors that
 * RESOLVE against the live catalogue at write time are kept (an answer never caches an
 * unverified reference), and only refId- or form-shaped tokens are considered — descriptive
 * brackets ([Section I – Exclusions]) are not citations and are ignored. Mirror-opposite of
 * findUnverifiedCitations: that returns what DOESN'T resolve, this returns what DOES.
 */
export function verifiedCitedAnchors(
  text: string,
  knownRefIds: ReadonlySet<string>,
  knownFormNumbers: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of extractBracketCitations(text)) {
    const token = raw.trim()
    if (!token) continue
    if (isRefIdShaped(token)) {
      const up = token.toUpperCase()
      if (!seen.has(up) && knownRefIds.has(up)) { seen.add(up); out.push(up) }
      continue
    }
    const norm = normalizeFormNumber(token)
    if (isFormShaped(norm) && !seen.has(norm) && knownFormNumbers.has(norm)) { seen.add(norm); out.push(norm) }
  }
  return out
}

/**
 * Of a cached answer's stored anchors, return those that NO LONGER resolve — the references
 * that make the cached answer stale. `anchors` are the already-normalized values produced by
 * verifiedCitedAnchors (refIds upper-cased, form numbers normalized), so the comparison is a
 * direct set membership against the same-shaped live sets. A non-empty result forbids serving.
 */
export function staleCitedAnchors(
  anchors: readonly string[],
  knownRefIds: ReadonlySet<string>,
  knownFormNumbers: ReadonlySet<string>,
): string[] {
  const stale: string[] = []
  for (const a of anchors) {
    if (!a) continue
    if (isRefIdShaped(a)) { if (!knownRefIds.has(a)) stale.push(a) }
    else if (isFormShaped(a)) { if (!knownFormNumbers.has(a)) stale.push(a) }
  }
  return stale
}

export type SemanticCacheOutcome = 'hit' | 'below-threshold' | 'stale-citation'

/**
 * Decide gates 1 + 2 for a cache candidate. Freshness is checked BEFORE similarity so a stale
 * candidate is rejected even at similarity 1.0. A 'hit' here means "eligible to serve" — the
 * caller must still run the cheap verifier (gate 3) before actually returning the cached answer.
 */
export function decideSemanticCache(opts: {
  similarity:   number
  staleAnchors: readonly string[]
  threshold?:   number
}): SemanticCacheOutcome {
  if (opts.staleAnchors.length > 0) return 'stale-citation'
  if (opts.similarity < (opts.threshold ?? SEMANTIC_CACHE_THRESHOLD)) return 'below-threshold'
  return 'hit'
}
