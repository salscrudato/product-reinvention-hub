// Pure refId allocation helpers — no Firebase imports, fully unit-testable.
// The adapter (firebase.adapter.ts) holds all Firestore mechanics; these functions
// compute counter keys and refId strings from entity context.
//
// Counter key scheme — underscores only (Firestore interprets dots in field names as
// nested-field path separators, which would corrupt a flat counter doc):
//   PRJ                   — global project counter
//   {LOB}_PROD            — per-LOB product counter         e.g. PH_PROD
//   {LOB}_{SEG}_{pid}     — per-product sub-entity counter  e.g. PH_COV_PH_PROD_001

/** Replace Firestore nested-path separator characters with underscore. */
export const safeCk = (s: string) => s.replace(/[.-]/g, '_')

/** Escape a string for use inside a RegExp literal. */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Segment token embedded in the refId string for each entity type. */
export const REFID_SEGMENT: Readonly<Record<string, string>> = {
  product:       'PROD',
  coverage:      'COV',
  rule:          'RU',
  formRule:      'FORM.RU',
  ratingProgram: 'RAT',
}

/** Counter key for the global project sequence. */
export const PRJ_COUNTER_KEY = 'PRJ'

/** Counter key for products within a single LOB (e.g. "PH_PROD"). */
export function productCounterKey(lob: string): string {
  return `${safeCk(lob)}_PROD`
}

/**
 * Counter key for a sub-entity collection scoped to one product.
 * segment may contain dots (e.g. "FORM.RU") — safeCk converts them to underscores.
 */
export function subEntityCounterKey(lob: string, segment: string, productId: string): string {
  return `${safeCk(lob)}_${safeCk(segment)}_${safeCk(productId)}`
}

/**
 * Format a refId string from its components.
 * @param nopad — when true, the sequence number is not zero-padded (used for ratingProgram).
 */
export function buildRefId(prefix: string, segment: string, seq: number, nopad = false): string {
  return `${prefix}.${segment}.${nopad ? String(seq) : String(seq).padStart(3, '0')}`
}

/**
 * Find the highest sequence number among a set of existing refIds that match
 * `<prefix>.<segment>.<digits>`.  Returns `floor` when none match (the next sequence
 * will be `floor + 1`).
 *
 * Sub-entity refIds (e.g. PH.COV.001.001) share the same `COV` segment token but have
 * an extra dot-delimited suffix.  The regex anchors only the first numeric group, so a
 * sub-coverage contributes its parent's sequence (e.g. 1) to the max calculation —
 * preserving the same behaviour as the legacy sibling scan.
 */
export function maxSeqIn(
  existing: (string | null | undefined)[],
  prefix: string,
  segment: string,
  floor = 0,
): number {
  const re = new RegExp(`^${escapeRe(prefix)}\\.${escapeRe(segment)}\\.(\\d+)`, 'i')
  return existing.reduce((m, r) => {
    const n = Number(re.exec(r ?? '')?.[1] ?? 0)
    return Number.isFinite(n) && n > m ? n : m
  }, floor)
}
