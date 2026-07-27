'use strict'
const express = require('express')
const { requireRole, requireTenant, resolveTenantForPrincipal } = require('../auth')
const { requireCapability } = require('../authz')
const fleet = require('../fleet')
const metering = require('../metering')

const { chat }            = require('./chat')
const { summarizeProduct } = require('./summarize-product')
const { scaffoldProduct }  = require('./scaffold-product')
const { draftRule }        = require('./draft-rule')
const { analyzeClaim }     = require('./analyze-claim')
const { unifiedImport, unifiedImportResult } = require('./unified-import')
const observatory = require('./run-observatory')
const { registerReindexRoute } = require('./reindex-product')
const { identifyBaseForm } = require('./identify-base-form')
const { proposeMapping }   = require('./propose-mapping')
const { shapeFeedback }    = require('./shape-feedback')
const { refreshNews }      = require('./refresh-news')
const { taskSummary }      = require('./task-summary')
const { dailyBrief }       = require('./daily-brief')
const { formRiskReport }   = require('./form-risk-report')

console.log(`[prodhub-host] AI configured=${fleet.isConfigured()}`)

const router = express.Router()

registerReindexRoute(router)

// ─── CE3 Step 8: import-run observatory (READ-shaped, product:read, tenant-scoped) ──
// SUPER_ADMIN break-glass tenant (X-Tenant-Id) is honored through
// resolveTenantForPrincipal, exactly like every other tenant-scoped read. These
// are GET routes (no AI, no metering) so they sit ahead of the POST /:name
// dispatcher and never collide with it.
function tenantOf(req) { return resolveTenantForPrincipal(req.user) }
// In-flight imports + drain state. The unauthenticated /api/health carries the
// COUNTS for a deploy pipeline to gate on; this is the tenant-scoped detail —
// which runs are at risk, how long they have been going, what they have spent.
// Declared before /importRun/:runId so the literal path is not swallowed by it.
router.get('/importRuns/active', requireCapability('product:read'), requireTenant, (req, res) => {
  const drain = require('./drain')
  const tid = tenantOf(req)
  return res.json({ ...drain.drainStatus(), runs: drain.activeImports().filter(r => r.tenantId === tid) })
})
router.get('/importRuns', requireCapability('product:read'), requireTenant, async (req, res) => {
  const r = await observatory.listImportRuns({ tenantId: tenantOf(req), limit: req.query.limit })
  if (r.status === 'storage_not_configured') return res.status(503).json({ error: 'storage_not_configured', detail: 'Set AZURE_BLOB_CONNECTION to enable the import-run observatory.' })
  if (r.status !== 'ok') return res.status(500).json({ error: 'observatory_error', reason: r.reason })
  return res.json({ runs: r.runs })
})
router.get('/importRun/:runId', requireCapability('product:read'), requireTenant, async (req, res) => {
  const r = await observatory.getImportRun({ tenantId: tenantOf(req), runId: req.params.runId })
  if (r.status === 'storage_not_configured') return res.status(503).json({ error: 'storage_not_configured' })
  if (r.status === 'invalid_id') return res.status(400).json({ error: 'invalid_run_id' })
  if (r.status !== 'ok') return res.status(404).json({ error: 'run_not_found', runId: req.params.runId })
  return res.json({ run: r.run })
})
router.get('/importRun/:runId/artifact/:stage', requireCapability('product:read'), requireTenant, async (req, res) => {
  const r = await observatory.getStageArtifact({ tenantId: tenantOf(req), runId: req.params.runId, stage: req.params.stage })
  if (r.status === 'storage_not_configured') return res.status(503).json({ error: 'storage_not_configured' })
  if (r.status === 'invalid_id') return res.status(400).json({ error: 'invalid_id' })
  if (r.status !== 'ok') return res.status(404).json({ error: 'artifact_not_found', runId: req.params.runId, stage: req.params.stage })
  return res.json(r.artifact)
})

router.post('/:name', requireCapability('ai:invoke'), requireTenant, async (req, res) => {
  const name = req.params.name
  const tid = resolveTenantForPrincipal(req.user)
  // Per-tenant MONTHLY AI budget throttle — layered ON TOP of the global cost breaker
  // (fleet.guard, still checked inside each handler). Import is EXEMPT (no-cap invariant):
  // it is metered but never throttled here. unifiedImportResult is part of the same
  // path (F23 recovery fetch, zero AI calls) — a 429 here would break exactly the
  // reconnect the persistence exists for.
  if (name !== 'unifiedImport' && name !== 'unifiedImportResult') {
    try {
      const b = await metering.checkTenantBudget(tid)
      if (!b.ok) return res.status(429).json({ error: 'tenant_ai_budget_exhausted', used: b.used, budget: b.budget })
    } catch { /* fail-open: a metering read error must not block AI */ }
  }
  // Thread tenant context so every fleet.record() site meters this call per-tenant.
  return metering.withTenant(tid, () => {
    // identifyBaseForm has its own AI-not-configured fallback (regex extraction still works).
    if (name === 'identifyBaseForm') return identifyBaseForm(req, res)
    // F23 recovery fetch: no AI involved — must work even when AI is unconfigured.
    if (name === 'unifiedImportResult') return unifiedImportResult(req, res)
    if (!fleet.isConfigured()) return res.status(503).json({ error: 'ai_not_configured', name })
    if (name === 'chat')            return chat(req, res)
    if (name === 'summarizeProduct') return summarizeProduct(req, res)
    if (name === 'unifiedImport')    return unifiedImport(req, res)
    if (name === 'scaffoldProduct')  return scaffoldProduct(req, res)
    if (name === 'draftRule')        return draftRule(req, res)
    if (name === 'analyzeClaim')     return analyzeClaim(req, res)
    if (name === 'proposeMapping')   return proposeMapping(req, res)
    if (name === 'shapeFeedback')    return shapeFeedback(req, res)
    if (name === 'refreshNews')      return refreshNews(req, res)
    if (name === 'taskSummary')      return taskSummary(req, res)
    if (name === 'dailyBrief')       return dailyBrief(req, res)
    if (name === 'formRiskReport')   return formRiskReport(req, res)
    return res.status(501).json({ error: 'ai_handler_not_ported', name })
  })
})

module.exports = router
