'use strict'
// portfolio.js — /api/portfolio/* : READ-ONLY tenant-scoped portfolio surfaces.
//
//   GET /pulse             { liveProducts, statesCovered, draftsAwaitingReview, lastImport, openTasks }
//   GET /suggested-queries { queries: string[] }  (3–4 deterministic strings, zero AI)
//
// Both derive strictly from data that is ALREADY persisted (products' lifecycle /
// states / lineage, coverages' formNumbers, tasks' done) via the pure read-model
// functions in shared/src/platform/portfolio.ts (bridged through
// platform-shared.cjs — `pnpm build:platform`). Zero model calls, zero writes.
//
// Tenant scoping follows the data.js discipline: the working tenant comes ONLY
// from the JWT principal (resolveTenantForPrincipal), every query filters the
// server-owned top-level c.tenantId, and results are cached per tenant for 60 s
// (the cache key IS the tenant id, so one tenant's snapshot can never serve
// another's request). Queries are TOP-bounded so a large tenant cannot turn a
// pulse call into a full-container scan.

const express = require('express')
const { resolveTenantStore } = require('./cosmos')
const { requireTenant, resolveTenantForPrincipal } = require('./auth')
const { requireCapability } = require('./authz')
const { computePortfolioPulse, buildSuggestedQueries } = require('./platform-shared.cjs')

const router = express.Router()

// Row bounds: products mirrors the admin summary scale; coverages/tasks mirror
// task-summary.js. A portfolio larger than these bounds yields a floor, not an error.
const MAX_PRODUCTS = 500
const MAX_COVERAGES = 500
const MAX_TASKS = 1000

// Per-tenant snapshot cache (both endpoints share one snapshot): tid → { at, facts }.
// 60 s TTL — pulse freshness, not a security boundary (isolation is the query + key).
const CACHE_TTL_MS = 60_000
const _cache = new Map()
const CACHE_MAX_TENANTS = 500 // in-process safety valve; reset wholesale if ever exceeded

const segs = (p) => String(p || '').split('/').filter(Boolean)

async function loadFacts(tid) {
  const hit = _cache.get(tid)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.facts

  const docs = resolveTenantStore(tid).docs
  const q = async (sql) => {
    const { resources } = await docs.items
      .query({ query: sql, parameters: [{ name: '@tid', value: tid }] }, { maxItemCount: 1000 })
      .fetchAll()
    return resources
  }
  const [productRows, coverageRows, taskRows] = await Promise.all([
    q(`SELECT TOP ${MAX_PRODUCTS} c.path, c.data.name, c.data.lifecycle, c.data.lifecycleState, c.data.reviewStatus, c.data.states, c.data.allStates, c.data.lob, c.data.lineage FROM c WHERE c.kind='entity' AND c.coll='products' AND c.tenantId=@tid`),
    q(`SELECT TOP ${MAX_COVERAGES} c.path, c.data.name, c.data.formNumbers FROM c WHERE c.kind='entity' AND c.entityType='coverage' AND c.tenantId=@tid`),
    q(`SELECT TOP ${MAX_TASKS} c.data.done FROM c WHERE c.kind='entity' AND c.coll='tasks' AND c.tenantId=@tid`),
  ])

  const products = productRows.map((r) => ({ id: segs(r.path).at(-1), ...r })).sort((a, b) => a.id.localeCompare(b.id))
  const productName = new Map(products.map((p) => [p.id, typeof p.name === 'string' ? p.name : p.id]))
  // coverage path: products/<pid>/coverages/<id> → join the owning product's name.
  const coverages = coverageRows
    .map((r) => ({ name: r.name, formNumbers: r.formNumbers, productName: productName.get(segs(r.path)[1]) ?? null }))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  const facts = { products, coverages, tasks: taskRows }
  if (_cache.size >= CACHE_MAX_TENANTS) _cache.clear()
  _cache.set(tid, { at: Date.now(), facts })
  return facts
}

router.get('/pulse', requireCapability('product:read'), requireTenant, async (req, res) => {
  try {
    const facts = await loadFacts(resolveTenantForPrincipal(req.user))
    res.set('Cache-Control', 'no-store').json(computePortfolioPulse(facts.products, facts.tasks))
  } catch {
    res.status(503).json({ error: 'pulse_unavailable' })
  }
})

router.get('/suggested-queries', requireCapability('product:read'), requireTenant, async (req, res) => {
  try {
    const facts = await loadFacts(resolveTenantForPrincipal(req.user))
    res.set('Cache-Control', 'no-store').json({ queries: buildSuggestedQueries(facts.products, facts.coverages) })
  } catch {
    res.status(503).json({ error: 'suggested_queries_unavailable' })
  }
})

module.exports = router
