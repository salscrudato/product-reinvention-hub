'use strict'
// metering.js — per-tenant AI metering + cost attribution + a per-tenant budget throttle
// that LAYERS ON TOP of the global cost guard/breaker in fleet.js (which stays fully intact).
//
// Every AI call already records its token usage through fleet.record() (the global rolling
// breaker). This module attributes the SAME usage to the calling TENANT so cost is billable
// per customer, and enforces a per-tenant MONTHLY token budget independently of the global
// breaker. Tenant context is threaded via AsyncLocalStorage (set once in the AI router), so
// every fleet.record() site meters per-tenant with a single meterCurrent() call — no need to
// thread a tenantId through every handler signature.
//
// Two throttles, independent by design:
//   • fleet.guard()          — GLOBAL rolling-window $ ceiling (unchanged; trips for everyone).
//   • checkTenantBudget(tid) — PER-TENANT monthly token budget (this module; trips one tenant).
// The import path is EXEMPT from the per-tenant budget (import no-cap invariant); it is metered
// but never throttled here (the AI router skips the budget check for unifiedImport).
//
// Also records lightweight per-tenant REQUEST telemetry (count / errors / latency) for the ops
// dashboard. All state is per host instance (single-instance App Service); monthly token totals
// are persisted to a tenantMeter doc so they survive a restart (deploys reset in-process state).

const { AsyncLocalStorage } = require('async_hooks')

const als = new AsyncLocalStorage()

function sysDocs() { try { return require('./cosmos').docs } catch { return null } }
function estimateCost(deployment, inTok, outTok) {
  try { return require('./fleet').estimateCostUsd(deployment, inTok || 0, outTok || 0) } catch { return 0 }
}
async function effectiveEntitlements(tid) {
  try { return await require('./platform-config').getEffectiveEntitlements(tid) }
  catch { return { monthlyAiTokenBudget: Infinity } }
}

// Calendar-month period (UTC). A tenant's budget resets each month.
function currentPeriod() { return new Date().toISOString().slice(0, 7) } // YYYY-MM

// ─── per-tenant monthly meter ────────────────────────────────────────────────
const _meters = new Map() // `${tid}:${period}` -> bucket
const key = (tid, period) => `${tid}:${period}`

// Get (or create + seed-from-persisted) the current-period bucket for a tenant.
async function bucket(tid) {
  const period = currentPeriod()
  const k = key(tid, period)
  let b = _meters.get(k)
  if (b) return b
  b = { tid, period, inTok: 0, outTok: 0, costUsd: 0, calls: 0, byDeployment: {} }
  _meters.set(k, b)
  // Seed from the persisted monthly total so a restart (every deploy) doesn't zero the budget.
  try {
    const docs = sysDocs()
    if (docs) {
      const r = (await docs.item(`tenantMeter:${tid}:${period}`, '__system__').read().catch(() => ({ resource: null }))).resource
      if (r && r.data) {
        b.inTok = r.data.inTok || 0; b.outTok = r.data.outTok || 0
        b.costUsd = r.data.costUsd || 0; b.calls = r.data.calls || 0
        b.byDeployment = r.data.byDeployment || {}
      }
    }
  } catch { /* best-effort seed */ }
  return b
}

async function persist(b) {
  const docs = sysDocs()
  if (!docs) return
  try {
    await docs.items.upsert({
      id: `tenantMeter:${b.tid}:${b.period}`, pk: '__system__', kind: 'tenantMeter',
      data: { tid: b.tid, period: b.period, inTok: b.inTok, outTok: b.outTok, costUsd: b.costUsd, calls: b.calls, byDeployment: b.byDeployment, updatedAt: new Date().toISOString() },
    })
  } catch { /* best-effort */ }
}

// Attribute one AI call's usage to a tenant. Async; callers fire-and-forget.
async function meter(tid, deployment, inTok, outTok) {
  if (!tid) return
  const b = await bucket(tid)
  b.inTok += inTok || 0
  b.outTok += outTok || 0
  b.calls += 1
  b.costUsd += estimateCost(deployment, inTok, outTok)
  if (deployment) b.byDeployment[deployment] = (b.byDeployment[deployment] || 0) + (inTok || 0) + (outTok || 0)
  await persist(b)
}

// ─── AsyncLocalStorage tenant context ────────────────────────────────────────
function withTenant(tid, fn) { return als.run({ tid }, fn) }
function currentTenant() { const s = als.getStore(); return s && s.tid }

// Called right after every fleet.record() site. Reads the ambient tenant from ALS and meters.
// Never throws — metering must not break an AI response.
function meterCurrent(deployment, inTok, outTok) {
  const tid = currentTenant()
  if (!tid) return
  meter(tid, deployment, inTok, outTok).catch(() => {})
}

// ─── per-tenant monthly budget throttle (independent of the global breaker) ──
async function checkTenantBudget(tid) {
  const [b, ent] = await Promise.all([bucket(tid), effectiveEntitlements(tid)])
  const used = b.inTok + b.outTok
  const budget = ent.monthlyAiTokenBudget
  return { ok: used < budget, used, budget, costUsd: Math.round(b.costUsd * 1e4) / 1e4 }
}

async function snapshotTenant(tid) {
  const [b, ent] = await Promise.all([bucket(tid), effectiveEntitlements(tid)])
  const used = b.inTok + b.outTok
  return {
    period: b.period,
    inputTokens: b.inTok, outputTokens: b.outTok, totalTokens: used,
    costUsd: Math.round(b.costUsd * 1e4) / 1e4,
    calls: b.calls, byDeployment: b.byDeployment,
    budget: ent.monthlyAiTokenBudget,
    budgetUsedPct: ent.monthlyAiTokenBudget > 0 && Number.isFinite(ent.monthlyAiTokenBudget)
      ? Math.round((used / ent.monthlyAiTokenBudget) * 1000) / 10 : 0,
    throttled: used >= ent.monthlyAiTokenBudget,
  }
}

// ─── per-tenant request telemetry (count / errors / latency) ─────────────────
const _requests = new Map() // tid -> { count, errors, latencyMsSum, byStatusClass }
function recordRequest(tid, status, ms) {
  if (!tid) return
  let r = _requests.get(tid)
  if (!r) { r = { count: 0, errors: 0, latencyMsSum: 0, byStatusClass: {} }; _requests.set(tid, r) }
  r.count += 1
  r.latencyMsSum += ms || 0
  const cls = `${Math.floor(status / 100)}xx`
  r.byStatusClass[cls] = (r.byStatusClass[cls] || 0) + 1
  if (status >= 500) r.errors += 1
}
function requestSnapshot(tid) {
  const r = _requests.get(tid) || { count: 0, errors: 0, latencyMsSum: 0, byStatusClass: {} }
  return {
    count: r.count,
    errors: r.errors,
    errorRatePct: r.count ? Math.round((r.errors / r.count) * 1000) / 10 : 0,
    avgLatencyMs: r.count ? Math.round(r.latencyMsSum / r.count) : 0,
    byStatusClass: r.byStatusClass,
  }
}

module.exports = {
  withTenant, currentTenant, meter, meterCurrent,
  checkTenantBudget, snapshotTenant,
  recordRequest, requestSnapshot,
  currentPeriod,
}
