// gapFeedback.ts — turn a coverage-gap determination into a prefilled product-feedback capture.
// Pure + unit-tested: given a NOT_ADDRESSED / PARTIAL determination (which carries a coverageGap),
// it composes the raw feedback the capture drawer shapes into a story — title from the gap note,
// detail carrying the scenario + verdict + cited clauses so the shaped story is grounded — plus
// the context (base form number + the product the cited clauses point at). Type is IDEA: a
// coverage gap is a product-improvement idea, not a bug.
import { resolveLobByRefId } from '@pf/shared'
import type { Determination } from './determination'

export interface GapFeedbackPrefill {
  note:    string
  type:    'IDEA'
  context: { label: string; route: string; baseFormNumber?: string; matchedProductId?: string }
}

// An internal refId (PH.COV.001, GL.RU.007): dotted, no space. Form numbers (HO 00 03) have a
// space and never match, so a form number is never mistaken for a product-bearing refId.
const INTERNAL_REFID = /^[A-Za-z]{2,4}\.[A-Za-z0-9]/

/** The product a determination's cited refIds point at, by LOB prefix (e.g. `PH.PROD.001`).
 *  Best-effort + deterministic: the first cited INTERNAL refId whose prefix is a registered
 *  line resolves to that line's seed product id. Returns undefined when nothing resolves. */
export function matchedProductId(d: Determination): string | undefined {
  const refIds = [
    ...(d.coverages ?? []).map(c => c.refId),
    ...(d.exclusions ?? []).map(e => e.refId),
    ...(d.limits ?? []).map(l => l.source),
    ...(d.coverageGap?.sources ?? []),
    ...(d.citations ?? []),
  ].filter((r): r is string => !!r && INTERNAL_REFID.test(r))
  for (const r of refIds) {
    const lob = resolveLobByRefId(r)
    if (lob) return `${lob.prefix}.PROD.001`
  }
  return undefined
}

/** Compose the prefilled feedback capture from a coverage-gap determination. */
export function buildGapFeedbackPrefill(
  d: Determination,
  opts: { scenario?: string; baseFormNumber?: string; route?: string } = {},
): GapFeedbackPrefill {
  const gapNote = d.coverageGap?.note?.trim() || 'Coverage gap identified during claim analysis'
  const title = gapNote.length > 100 ? `${gapNote.slice(0, 99)}…` : gapNote
  const verdict = d.verdict.replace(/_/g, ' ').toLowerCase()

  // Cited clauses: the gap's own sources first, then the determination's coverage/citation refs.
  const clauses = [
    ...(d.coverageGap?.sources ?? []),
    ...(d.coverages ?? []).map(c => c.refId ?? c.formNumber).filter((r): r is string => !!r),
    ...(d.citations ?? []),
  ]
  const citedClauses = [...new Set(clauses)]

  // First line becomes the shaped story's title; the rest is the grounded detail.
  const note = [
    title,
    '',
    opts.scenario ? `Scenario: ${opts.scenario.trim()}` : '',
    `Verdict: ${verdict}.`,
    d.summary?.trim() ? `Summary: ${d.summary.trim()}` : '',
    d.coverageGap?.note?.trim() ? `Coverage gap: ${d.coverageGap.note.trim()}` : '',
    citedClauses.length ? `Cited clauses: ${citedClauses.join(', ')}` : '',
    '',
    'Suggested: close this gap in the product (add/clarify the coverage or wording so the form addresses this scenario).',
  ].filter(Boolean).join('\n')

  const mpid = matchedProductId(d)
  return {
    note,
    type: 'IDEA',
    context: {
      label: 'Claims · Coverage gap',
      route: opts.route ?? '/app/claims',
      ...(opts.baseFormNumber ? { baseFormNumber: opts.baseFormNumber } : {}),
      ...(mpid ? { matchedProductId: mpid } : {}),
    },
  }
}
