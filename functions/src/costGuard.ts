// costGuard.ts — the server side of the cost caps + circuit breaker (Part C). The pure
// decision logic (the cap ladder, the breaker state machine) lives in @pf/shared/cost; this
// module is its Firestore I/O: rolling per-day spend counters, per-session counters, and the
// provider breaker state, all in the server-only `costCounters` collection.
//
//   guardSpend()  — read the counters + breaker and return one action (allow | degrade | deny)
//                   the caller switches on BEFORE spending. Every read degrades safely to
//                   "allow" on error: a telemetry outage must never block a user's request.
//   bumpSpend()   — after a call, add its cost to the counters and fold the provider outcome
//                   into the breaker. Called from telemetry.recordUsage so EVERY feature keeps
//                   the counters + breaker current with no per-endpoint wiring.
//
// AWS-SWAP: `costCounters` → a DynamoDB counter table with TTL; the pure logic is unchanged.
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  DEFAULT_BUDGET, decideBudget, DEFAULT_BREAKER, CLOSED_BREAKER, isBreakerOpen, nextBreakerState,
} from '@pf/shared'
import type { BudgetPolicy, BudgetDecision, SpendSnapshot, BreakerState } from '@pf/shared'
import { log } from './logger'

const COLLECTION   = 'costCounters'
const BREAKER_DOC   = 'breaker-anthropic'
const POLICY_DOC    = 'config/costPolicy'   // optional ops override, read server-side only

/** Per-feature projected cost of one call (USD), from COST_BASELINE.md. Used to make the cap
 *  bite BEFORE the overspend. A missing feature falls back to a conservative estimate. */
const EST_COST_USD: Record<string, number> = {
  chat: 0.018, analyzeClaim: 0.021, extractCoverages: 0.031, scaffoldProduct: 0.020,
  draftRule: 0.014, summarizeProduct: 0.002, describeForm: 0.001, identifyBaseForm: 0.001,
}
export function estCostFor(feature: string): number {
  return EST_COST_USD[feature] ?? 0.02
}

/** UTC day bucket so read + write align on the same rolling window. */
function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)   // YYYY-MM-DD
}

/** Firestore-doc-id-safe session key (client sessionId or uid). */
function safeKey(k: string): string {
  return (k || 'anon').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
}

const dayDocId  = (now?: number) => `day-${dayKey(now)}`
const featDocId = (feature: string, now?: number) => `feat-${safeKey(feature)}-${dayKey(now)}`
const sessDocId = (sessionKey: string, now?: number) => `sess-${safeKey(sessionKey)}-${dayKey(now)}`

// ─── Policy (defaults, optional Firestore override, cached per instance) ─────────
let cachedPolicy: BudgetPolicy | null = null
export async function loadPolicy(): Promise<BudgetPolicy> {
  if (cachedPolicy) return cachedPolicy
  try {
    const snap = await getFirestore().doc(POLICY_DOC).get()
    const o = snap.exists ? (snap.data() as Partial<BudgetPolicy>) : {}
    cachedPolicy = {
      globalDailyUsd:       typeof o.globalDailyUsd === 'number' ? o.globalDailyUsd : DEFAULT_BUDGET.globalDailyUsd,
      perSessionUsd:        typeof o.perSessionUsd === 'number' ? o.perSessionUsd : DEFAULT_BUDGET.perSessionUsd,
      perFeatureDefaultUsd: typeof o.perFeatureDefaultUsd === 'number' ? o.perFeatureDefaultUsd : DEFAULT_BUDGET.perFeatureDefaultUsd,
      perFeatureDailyUsd:   { ...DEFAULT_BUDGET.perFeatureDailyUsd, ...(o.perFeatureDailyUsd ?? {}) },
    }
  } catch {
    cachedPolicy = DEFAULT_BUDGET
  }
  return cachedPolicy
}

// ─── Reads ───────────────────────────────────────────────────────────────────
async function readCounter(id: string): Promise<number> {
  try { const s = await getFirestore().doc(`${COLLECTION}/${id}`).get(); return (s.data()?.['usd'] as number | undefined) ?? 0 }
  catch { return 0 }
}

export async function readBreaker(): Promise<BreakerState> {
  try {
    const s = await getFirestore().doc(`${COLLECTION}/${BREAKER_DOC}`).get()
    if (!s.exists) return CLOSED_BREAKER
    const d = s.data() as Partial<BreakerState>
    return { consecutiveFailures: d.consecutiveFailures ?? 0, openUntil: d.openUntil ?? 0 }
  } catch { return CLOSED_BREAKER }
}

export interface GuardResult {
  action:      BudgetDecision['action']
  reason:      string
  breakerOpen: boolean
  decision:    BudgetDecision
}

/**
 * Decide whether the pending call may proceed. Reads the three spend windows + the breaker,
 * runs the pure cap ladder, then folds in the breaker: an OPEN breaker downgrades a clean
 * `allow` to `degrade` (serve cached/reduced, don't hammer a stalled provider) — but never
 * relaxes a budget `deny`. All I/O degrades to `allow` on error so telemetry can't block a call.
 */
export async function guardSpend(params: { feature: string; sessionKey: string; estCostUsd?: number }): Promise<GuardResult> {
  const feature = params.feature
  const est = params.estCostUsd ?? estCostFor(feature)
  const now = Date.now()
  try {
    const policy = await loadPolicy()
    const [globalDayUsd, featureDayUsd, sessionUsd, breaker] = await Promise.all([
      readCounter(dayDocId(now)),
      readCounter(featDocId(feature, now)),
      readCounter(sessDocId(params.sessionKey, now)),
      readBreaker(),
    ])
    const spend: SpendSnapshot = { globalDayUsd, sessionUsd, featureDayUsd }
    const decision = decideBudget(policy, feature, spend, est)
    const breakerOpen = isBreakerOpen(breaker, now)

    let action = decision.action
    let reason = decision.reason
    if (breakerOpen && action === 'allow') {
      action = 'degrade'
      reason = 'AI provider temporarily unavailable (circuit breaker open) — serving a reduced/cached response.'
    }
    // Structured log for alerting — stable event names match OBSERVABILITY.md alert anchors.
    if (action === 'deny')    log({ severity: 'WARNING', feature, event: 'deny',    sessionKey: params.sessionKey })
    if (action === 'degrade') log({ severity: 'INFO',    feature, event: 'degrade', sessionKey: params.sessionKey })
    return { action, reason, breakerOpen, decision }
  } catch {
    // Never let a counter read fail a request — fail open to allow.
    return { action: 'allow', reason: 'budget check skipped', breakerOpen: false, decision: { action: 'allow', reason: 'skipped' } }
  }
}

// ─── Writes (fire-and-forget, from telemetry.recordUsage) ────────────────────────

/**
 * Add a call's cost to the day / feature / session counters and fold its provider outcome into
 * the breaker. `providerCalled: false` (a cache hit or a budget denial made no upstream call)
 * still books the tiny cost but leaves the breaker untouched — a cache hit must not "heal" a
 * breaker tripped by real faults, and a denial must not count as a provider success/failure.
 */
export async function bumpSpend(params: {
  feature: string; sessionKey: string; usd: number; ok: boolean; providerCalled?: boolean
}): Promise<void> {
  const now = Date.now()
  const db = getFirestore()
  try {
    const usd = Number.isFinite(params.usd) ? params.usd : 0
    const batch = db.batch()
    const inc = FieldValue.increment(usd)
    const stamp = { usd: inc, updatedAt: FieldValue.serverTimestamp() }
    batch.set(db.doc(`${COLLECTION}/${dayDocId(now)}`), stamp, { merge: true })
    batch.set(db.doc(`${COLLECTION}/${featDocId(params.feature, now)}`), { ...stamp, feature: params.feature }, { merge: true })
    batch.set(db.doc(`${COLLECTION}/${sessDocId(params.sessionKey, now)}`), { ...stamp, sessionKey: safeKey(params.sessionKey) }, { merge: true })
    await batch.commit()
  } catch { /* counters are best-effort */ }

  // Breaker: only real provider attempts move it (read-modify-write in a tiny transaction).
  if (params.providerCalled === false) return
  try {
    const ref = db.doc(`${COLLECTION}/${BREAKER_DOC}`)
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref)
      const prev: BreakerState = s.exists
        ? { consecutiveFailures: (s.data()?.['consecutiveFailures'] as number) ?? 0, openUntil: (s.data()?.['openUntil'] as number) ?? 0 }
        : CLOSED_BREAKER
      const next = nextBreakerState(prev, params.ok, now, DEFAULT_BREAKER)
      // Log the breaker.open transition (closed → open) with ERROR severity so it surfaces
      // as an alert. Only fires on the state TRANSITION, not on every call while open.
      if (!isBreakerOpen(prev, now) && isBreakerOpen(next, now)) {
        log({ severity: 'ERROR', feature: params.feature, event: 'breaker.open',
              sessionKey: params.sessionKey })
      }
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
  } catch { /* breaker update is best-effort */ }
}
