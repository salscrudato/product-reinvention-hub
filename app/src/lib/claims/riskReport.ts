// riskReport.ts — the insured-centric form risk report's client contract (E6).
// Platform-free (determination.ts precedent): the ONE place the report shape lives
// client-side. The server (server/lib/ai/form-risk-report.js) is the source of truth;
// version parity is pinned by tests/server/form-risk-report.test.ts. The predicate
// gates every render: a v1 blob hydrating off the live baseForms subscription must
// never reach the dialog — it fetches fresh instead (the server regenerates).

/** Mirrors server REPORT_VERSION — bump both together (parity test enforces). */
export const RISK_REPORT_VERSION = 2

export interface FormRiskReport {
  reportVersion: number
  /** 2-3 plain-English sentences addressed to the insured ("you"). */
  plainSummary: string
  /** What you're covered for — each cites its granting clause in [brackets]. */
  protections: string[]
  /** Risks, gaps, sublimits, duties — each cites its clause in [brackets]. */
  watchouts: string[]
  /** Questions to ask / steps to take — each tied to a cited clause. */
  actions: string[]
  generatedAt?: string
  deployment?: string
}

/** True only for a CURRENT, renderable report — old cached shapes fail closed. */
export function isRenderableRiskReport(x: unknown): x is FormRiskReport {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return r.reportVersion === RISK_REPORT_VERSION
    && typeof r.plainSummary === 'string' && r.plainSummary.length > 0
    && Array.isArray(r.protections) && Array.isArray(r.watchouts) && Array.isArray(r.actions)
    && [...(r.protections as unknown[]), ...(r.watchouts as unknown[]), ...(r.actions as unknown[])]
      .every(s => typeof s === 'string')
}

/** Pure question composer for the report's "Ask the copilot" affordance — the copilot
 *  re-reads the actual form server-side, so the question carries the item verbatim
 *  (citations intact) and asks only for explanation, never new facts. */
export function buildReportAsk(item: string): string {
  return `From the risk report: "${item.trim()}" — what does this mean for me under this policy, in practical terms?`
}
