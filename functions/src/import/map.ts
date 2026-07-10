// import/map.ts — confidence-scored field mapping.
// Every mapped field carries { value, confidence, citation, sanitizerVerdict }.
// Anything below the confidence threshold, missing a verbatim citation, or failing the
// sanitizer becomes UNRESOLVED and is never guessed. This mirrors the existing sanitize.ts
// guards in shared/src/insurance/filing/sanitize.ts (which operate on the AI extraction
// output); map.ts applies the same provenance contract to deterministic paths.
// Pure functions — no I/O, no AI calls.

import type { MappedField, FieldCitation, SanitizerVerdict } from '@pf/shared'

// The minimum confidence that a field must meet to be accepted (PASS).
// Registry-configurable in principle; 0.6 is the default matching the existing
// sanitize.ts confidence threshold convention.
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6

/** Build a MappedField from a raw extracted value + provenance metadata.
 *  A field is UNRESOLVED when:
 *   - confidence < threshold, OR
 *   - verbatim is absent (citation cannot be verified against source text), OR
 *   - sanitizerVerdict is explicitly forced to FAIL by the caller.
 *  A field is PASS when confidence ≥ threshold AND verbatim is present.
 *  A field is FAIL when the caller's sanitizer check fails (fabrication detected). */
export function mapField<T>(
  value:         T,
  sourceDoc:     string,
  locus:         string,
  verbatim:      string | undefined,
  confidence:    number,
  opts?: {
    threshold?:    number
    forceVerdict?: SanitizerVerdict
  },
): MappedField<T> {
  const threshold = opts?.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  const citation: FieldCitation = { sourceDoc, locus, ...(verbatim ? { verbatim } : {}) }

  let verdict: SanitizerVerdict
  if (opts?.forceVerdict) {
    verdict = opts.forceVerdict
  } else if (confidence < threshold || !verbatim) {
    verdict = 'UNRESOLVED'
  } else {
    verdict = 'PASS'
  }

  return { value, confidence, citation, sanitizerVerdict: verdict }
}

/** Return true when a MappedField needs human review (UNRESOLVED or FAIL). */
export function needsReview<T>(field: MappedField<T>): boolean {
  return field.sanitizerVerdict !== 'PASS'
}

/** Verify that a value appears verbatim in the source text (mirrors
 *  cellValueAppearsInText from tableParser.ts for non-table fields).
 *  Strips surrounding whitespace and checks case-insensitively. */
export function valueAppearsInSource(value: unknown, sourceText: string): boolean {
  const str = String(value ?? '').trim()
  if (str === '') return false
  return sourceText.toLowerCase().includes(str.toLowerCase())
}
