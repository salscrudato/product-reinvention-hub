// cost/budget.ts — the pure cost-cap decision. Given the spend already booked (globally
// today, in this session, and for this feature today) plus the estimated cost of the call
// about to be made, decide whether to ALLOW it, DEGRADE it (cheaper model / cached answer /
// reduced work) or DENY it (a clear "temporarily limited" message, no spend).
//
// The Firestore counters + the actual enforcement live in functions/src/costGuard.ts; this
// module is the platform-free brain so the ladder is unit-tested in the gate and shared by
// every enforcement site. Zero platform imports.

/** The tunable caps. Defaults live in DEFAULT_BUDGET; ops may override per-feature via a
 *  Firestore `config/costPolicy` doc read server-side (functions/src/costGuard.ts). All
 *  values are USD over a rolling window (day for global/feature, the session for perSession). */
export interface BudgetPolicy {
  /** HARD global ceiling across ALL features for the day. A breach DENIES — the "spend
   *  without bound" backstop, paired with an ADMIN alarm. */
  globalDailyUsd:       number
  /** SOFT per-session ceiling across one user's session. A breach DEGRADES (cheaper /
   *  cached / reduced) rather than failing hard, so one heavy session can't run away. */
  perSessionUsd:        number
  /** SOFT per-feature-per-day ceilings. A breach DEGRADES. Missing feature → the default. */
  perFeatureDailyUsd:   Record<string, number>
  perFeatureDefaultUsd: number
}

/** Conservative defaults for a demo/single-tenant workbench. Tunable without a deploy via
 *  `config/costPolicy` (functions/src/costGuard.loadPolicy). Kept modest so the caps are
 *  reachable in a real session, not theoretical. */
export const DEFAULT_BUDGET: BudgetPolicy = {
  globalDailyUsd:       25,
  perSessionUsd:        2,
  perFeatureDefaultUsd: 8,
  perFeatureDailyUsd: {
    chat:            8,
    analyzeClaim:    8,
    extractCoverages: 6,
    scaffoldProduct: 4,
    draftRule:       3,
    summarizeProduct: 2,
    describeForm:    1,
  },
}

export type BudgetAction = 'allow' | 'degrade' | 'deny'

export interface BudgetDecision {
  action:  BudgetAction
  /** Which ceiling drove the decision (undefined for a clean allow). */
  scope?:  'global' | 'session' | 'feature'
  /** Short human explanation, safe to log / surface in an admin banner. */
  reason:  string
}

/** Spend already booked in each window (USD), as read from the counters. */
export interface SpendSnapshot {
  globalDayUsd:  number
  sessionUsd:    number
  featureDayUsd: number
}

/** The effective per-day cap for a feature (its own, else the default). */
export function featureCap(policy: BudgetPolicy, feature: string): number {
  return policy.perFeatureDailyUsd[feature] ?? policy.perFeatureDefaultUsd
}

/**
 * Decide the action for a call. Order matters and is deliberate:
 *   1. HARD global ceiling first — if today's total plus this call would exceed the global
 *      cap, DENY (never spend past the ceiling; raise the ADMIN alarm instead).
 *   2. SOFT session cap — DEGRADE (serve a cached answer / cheaper model / reduced work).
 *   3. SOFT feature cap — DEGRADE.
 *   4. Otherwise ALLOW.
 * `estCostUsd` is the projected cost of the pending call (a per-feature estimate); it is
 * added to the current window spend so the cap bites BEFORE the overspend, not after.
 */
export function decideBudget(
  policy: BudgetPolicy,
  feature: string,
  spend: SpendSnapshot,
  estCostUsd: number,
): BudgetDecision {
  if (spend.globalDayUsd + estCostUsd > policy.globalDailyUsd) {
    return { action: 'deny', scope: 'global', reason: `Global daily AI budget ($${policy.globalDailyUsd}) would be exceeded.` }
  }
  if (spend.sessionUsd + estCostUsd > policy.perSessionUsd) {
    return { action: 'degrade', scope: 'session', reason: `Session AI budget ($${policy.perSessionUsd}) reached — serving a reduced/cached response.` }
  }
  const cap = featureCap(policy, feature)
  if (spend.featureDayUsd + estCostUsd > cap) {
    return { action: 'degrade', scope: 'feature', reason: `Daily budget for ${feature} ($${cap}) reached — serving a reduced/cached response.` }
  }
  return { action: 'allow', reason: 'within budget' }
}
