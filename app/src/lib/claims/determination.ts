// determination.ts — the canonical shape of a grounded coverage determination plus the
// single citation guard the Claims copilot leans on. Platform-free so it is unit-testable
// in the gate. `isDeterminationCited` MIRRORS the authoritative guard on the server
// (functions/src/claims.ts, same rule): a substantive verdict (COVERED / NOT_COVERED /
// PARTIAL) must point at a real source or it never reaches the card. NOT_ADDRESSED is the
// honest exception — the form is silent on the scenario, so there is nothing to cite.

export type Verdict = 'COVERED' | 'NOT_COVERED' | 'PARTIAL' | 'NOT_ADDRESSED'

export interface DeterminationCoverage { name: string; refId?: string; formNumber?: string; definition: string }
export interface DeterminationLimit    { label: string; value: string; source?: string; note?: string }
// The specific exclusions / carve-outs that shaped the verdict — what is NOT covered and
// why (e.g. the failed pipe itself, gradual seepage, mold conditions, a Coverage A/B
// exclusion). `source` is the cited section / refId / form number it comes from.
export interface DeterminationExclusion { name: string; refId?: string; formNumber?: string; note?: string }

export interface Determination {
  verdict:     Verdict
  summary:     string
  coverages:   DeterminationCoverage[]
  exclusions?: DeterminationExclusion[]
  limits:      DeterminationLimit[]
  reasoning:   string[]
  openItems?:  string[]
  citations?:  string[]
  formNumber?: string
}

// Verdicts that assert coverage either way — these MUST be grounded in a cited source.
// NOT_ADDRESSED is deliberately excluded: "the form doesn't address this" is an absence,
// so demanding a citation for it would punish the honest answer.
export const SUBSTANTIVE_VERDICTS: Verdict[] = ['COVERED', 'NOT_COVERED', 'PARTIAL']

const hasBracketCitation = (s: string): boolean => /\[[^\]]+\]/.test(s)
const filled = (s?: string): boolean => !!s && s.trim().length > 0

/** True when the determination points at ≥1 specific source: an explicit citation, a
 *  coverage refId / form number, a limit source, or a [bracketed] reasoning cite. The
 *  always-present base `formNumber` footer does NOT count on its own — counting it would
 *  make every determination trivially "cited" and defeat the guard. */
export function isDeterminationCited(d: Determination): boolean {
  const explicit  = (d.citations ?? []).some(filled)
  const coverage  = (d.coverages ?? []).some(c => filled(c.refId) || filled(c.formNumber))
  const exclusion = (d.exclusions ?? []).some(e => filled(e.refId) || filled(e.formNumber))
  const limit     = (d.limits ?? []).some(l => filled(l.source))
  const reasoning = (d.reasoning ?? []).some(r => hasBracketCitation(r ?? ''))
  return explicit || coverage || exclusion || limit || reasoning
}

/** The gate the UI applies before rendering a determination card: a substantive verdict
 *  must be cited; NOT_ADDRESSED is always allowed (it is the "form is silent" answer). */
export function shouldRenderDetermination(d: Determination): boolean {
  return !SUBSTANTIVE_VERDICTS.includes(d.verdict) || isDeterminationCited(d)
}
