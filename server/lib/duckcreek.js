'use strict'
// server/lib/duckcreek.js — Duck Creek Author export REST API v1.
// Mounted at /api/duckcreek/v1 in server.js.
//
// Endpoints:
//   POST /author/generate             — load product from Cosmos, build + validate, store bundle
//   POST /author/validate             — build + validate only (fail-closed report, no bundle stored)
//   GET  /author/bundle/:id/download  — stream the previously generated XML bundle
//
// Authentication (layered):
//   Production outer layer — Microsoft Entra ID via App Service authentication V2, configured
//     in the App Service resource: single-tenant, api://<AZURE_ENTRA_CLIENT_ID> audience,
//     user_impersonation scope. App Service validates the Bearer token and injects the
//     X-MS-CLIENT-PRINCIPAL-ID / X-MS-CLIENT-PRINCIPAL-NAME headers before the request
//     reaches Express. Requests that fail Entra validation are rejected by App Service
//     before they reach this code.
//   Inner layer (in-app) — platform JWT (auth.attachUser, already global in server.js)
//     enforces the EDITOR+ role requirement and the tenant scoping. VIEWER is explicitly
//     blocked: only EDITOR+ may trigger exports (CLAUDE.md binding invariant).
//
// Rate limiting: token-bucket per platform UID. 10 tokens/min by default.
//   Configurable via DC_RATE_LIMIT_CAP (tokens) and DC_RATE_LIMIT_RPS (tokens/sec).
//   Returns HTTP 429 with Retry-After on breach. Azure WAF / API Management is the
//   production-grade ceiling; this is the in-app guard per the task specification.
//
// Audit events: written directly to Cosmos (append-only, kind='duckcreek_audit') for every
//   generate, generate-rejected, validate, and download call, including the principal,
//   productRefId, bundleId, manuScriptID, and schemaVersion.
//
// Bundle store: in-memory Map, 1-hour TTL, not replicated across App Service instances.
//   Suitable for single-instance or sessions where generate + download happen on the same
//   instance. For multi-instance, replace storeBundle/getBundle with a Cosmos or Blob store.
//
// Conventions module:
//   ALL Duck Creek element names, attribute names, id-prefix letters, namespace URI,
//   manuScriptID token patterns, and lobTokens live in ONE file:
//   shared/src/duckcreek/mapping.ts  →  DEFAULT_DUCKCREEK_MAPPING.
//   When reconciling against a real Author sample, edit that object. No string literal
//   leaks into serialize.ts, validate.ts, or this file — all access is via dc.* calls.

const express  = require('express')
const crypto   = require('crypto')
const { requireAuth, requireRole, requireTenant, RANK } = require('./auth')

// ─── compiled DuckCreek shared module ─────────────────────────────────────────
// Built by: pnpm build:duckcreek  (scripts: package.json → esbuild)
// Source:   shared/src/duckcreek/api-server.ts
// The module is pure (no platform I/O); all named exports are functions/objects.
let dc = null
try {
  dc = require('./duckcreek-shared.cjs')
} catch {
  console.warn(
    '[duckcreek-api] duckcreek-shared.cjs.js not found — ' +
    'run `pnpm build:duckcreek` to generate it. Endpoints will return 503.',
  )
}

// ─── Lazy Cosmos handle ────────────────────────────────────────────────────────
let _cosmos = null
function getDocs() {
  if (_cosmos) return _cosmos
  try { _cosmos = require('./cosmos').docs } catch { /* offline or not yet wired */ }
  return _cosmos
}

const SCHEMA_VERSION = '1.0.0'
const API_VERSION    = 'v1'

// ─── Token-bucket rate limiter ────────────────────────────────────────────────
// Each platform UID gets an independent bucket. Tokens refill continuously.
const BUCKET_CAP = parseInt(process.env.DC_RATE_LIMIT_CAP  || '10',    10)
const REFILL_RPS = parseFloat(process.env.DC_RATE_LIMIT_RPS || '0.1667') // 10 tokens/min ≈ 0.1667/s
const _buckets   = new Map() // uid → { tokens: number, lastMs: number }

function consumeToken(uid) {
  const now = Date.now()
  let b = _buckets.get(uid)
  if (!b) {
    b = { tokens: BUCKET_CAP - 1, lastMs: now }
    _buckets.set(uid, b)
    return { allowed: true, retryAfter: 0 }
  }
  b.tokens = Math.min(BUCKET_CAP, b.tokens + (now - b.lastMs) / 1000 * REFILL_RPS)
  b.lastMs = now
  if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, retryAfter: 0 } }
  const retryAfter = Math.ceil((1 - b.tokens) / REFILL_RPS)
  return { allowed: false, retryAfter }
}

// ─── In-memory bundle store (generate → download) ────────────────────────────
const BUNDLE_TTL_MS = 60 * 60 * 1000 // 1 hour
const _bundles      = new Map() // bundleId → BundleEntry

function storeBundle(id, entry) {
  _bundles.set(id, { ...entry, createdAt: Date.now() })
  if (_bundles.size > 1000) {          // lazy eviction on size pressure
    const cut = Date.now() - BUNDLE_TTL_MS
    for (const [k, v] of _bundles) { if (v.createdAt < cut) _bundles.delete(k) }
  }
}

function getBundle(id) {
  const b = _bundles.get(id)
  if (!b) return null
  if (Date.now() - b.createdAt > BUNDLE_TTL_MS) { _bundles.delete(id); return null }
  return b
}

// ─── Audit event writer ───────────────────────────────────────────────────────
// Writes directly to Cosmos (no transactional envelope — audit is append-only).
// Partition key uses a dedicated "__duckcreek_api__" base so these events live in
// their own partition, not in any product partition.
async function emitAudit(tenantId, action, payload) {
  const docs = getDocs()
  if (!docs) return  // offline dev — skip silently
  const pk = `${tenantId || '__system__'}|__duckcreek_api__`
  try {
    await docs.items.upsert({
      id:       `dkaud:${Date.now().toString(36)}-${crypto.randomUUID()}`,
      pk,
      tenantId: tenantId || null,
      kind:     'duckcreek_audit',
      action,
      ...payload,
      at:       new Date().toISOString(),
    })
  } catch (e) {
    console.error('[duckcreek-api] audit write error:', e.message)
  }
}

// ─── Cosmos product bundle loader ─────────────────────────────────────────────
// Queries all sub-collections the PDM builder needs. The data layer stores entities
// at paths like `products/{refId}/coverages/{covRefId}`, all in the partition
// `${tenantId}|${productRefId}` (same partition-key scheme as data.js).
async function loadBundle(tenantId, productRefId) {
  const docs = getDocs()
  if (!docs) throw Object.assign(new Error('Data store unavailable'), { code: 'NO_COSMOS' })

  const pk  = `${tenantId}|${productRefId}`

  // list all entities in a collection path within the product's partition
  async function listColl(coll) {
    const { resources } = await docs.items.query(
      {
        query: 'SELECT c.data, c.path FROM c WHERE c.kind=@kind AND c.coll=@coll AND c.tenantId=@tid',
        parameters: [
          { name: '@kind', value: 'entity' },
          { name: '@coll', value: coll },
          { name: '@tid',  value: tenantId },
        ],
      },
      { partitionKey: pk },
    ).fetchAll()
    return resources
  }

  // read a single entity by its full path
  async function readEnt(path) {
    const id = `ent:${path}`
    try {
      const { resource } = await docs.item(id, pk).read()
      return resource && resource.tenantId === tenantId ? resource.data : null
    } catch { return null }
  }

  const base = `products/${productRefId}`
  const [product, covDocs, formDocs, ruleDocs, formRuleDocs, ratProgDocs, ldDocs, rtDocs] =
    await Promise.all([
      readEnt(base),
      listColl(`${base}/coverages`),
      listColl(`${base}/forms`),
      listColl(`${base}/rules`),
      listColl(`${base}/formRules`),
      listColl(`${base}/ratingPrograms`),
      listColl(`${base}/ldTables`),
      listColl(`${base}/rtTables`),
    ])

  if (!product) {
    throw Object.assign(new Error(`Product "${productRefId}" not found`), { code: 'NOT_FOUND' })
  }
  if (!ratProgDocs.length) {
    throw Object.assign(
      new Error(`Product "${productRefId}" has no rating program — required for PDM build`),
      { code: 'NO_RATING_PROGRAM' },
    )
  }

  // Tables are keyed by the last path segment (the table refId, e.g. "PH.LD.001").
  const pathTail = (path) => String(path || '').split('/').at(-1) || ''
  const ldTables = Object.fromEntries(ldDocs.map((r) => [pathTail(r.path), r.data]))
  const rtTables = Object.fromEntries(rtDocs.map((r) => [pathTail(r.path), r.data]))

  // Resolve the LobDefinition from the product's lob.refId via the bundled LOB_REGISTRY.
  const lobRefId = product.lob?.refId
  const lob      = lobRefId ? dc.LOB_REGISTRY[lobRefId] : null
  if (!lob) {
    throw Object.assign(new Error(`Unknown LOB "${lobRefId}"`), { code: 'UNKNOWN_LOB' })
  }

  return {
    product,
    lob,
    coverages:     covDocs.map((r) => r.data),
    forms:         formDocs.map((r) => r.data),
    rules:         ruleDocs.map((r) => r.data),
    formRules:     formRuleDocs.map((r) => r.data),
    ratingProgram: ratProgDocs[0].data,  // primary program (first by insertion order)
    ldTables,
    rtTables,
  }
}

// ─── Shared PDM + XML builder ─────────────────────────────────────────────────
function buildAndSerialize(bundle) {
  const pdm         = dc.buildPdm(bundle)
  const xml         = dc.serializePdmToDuckCreek(pdm)
  const report      = dc.validateDuckCreek(pdm, xml)
  const manuScriptID = dc.composeManuscriptId(
    dc.DEFAULT_DUCKCREEK_MAPPING, bundle.lob.prefix, 'viewModel',
  )
  return { pdm, xml, report, manuScriptID }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireDcReady(_req, res, next) {
  if (!dc) {
    return res.status(503).json({
      error:  'service_unavailable',
      detail: 'DuckCreek shared module not available. Run: pnpm build:duckcreek',
    })
  }
  next()
}

function rateLimitMiddleware(req, res, next) {
  const { allowed, retryAfter } = consumeToken(req.user.uid)
  if (!allowed) {
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({ error: 'rate_limit_exceeded', retryAfter, apiVersion: API_VERSION })
  }
  next()
}

// ─── Router ───────────────────────────────────────────────────────────────────
const router = express.Router()

// Every DuckCreek API endpoint requires: module ready, Entra+JWT auth (EDITOR+), tenant, rate limit.
const guards = [requireDcReady, requireAuth, requireRole('EDITOR'), requireTenant, rateLimitMiddleware]

// POST /author/generate
// Body: { productRefId: string }
// Response 200: { bundleId, schemaVersion, manuScriptID, productRefId, fileName, expiresAt, apiVersion, validation }
// Response 422: validation failed (fail-closed — no bundle stored)
router.post('/author/generate', ...guards, async (req, res) => {
  const { productRefId } = req.body || {}
  if (!productRefId || typeof productRefId !== 'string') {
    return res.status(400).json({ error: 'bad_request', detail: 'productRefId (string) is required' })
  }

  const tid    = req.user.tenantId
  const actor  = { uid: req.user.uid, name: req.user.name }

  let domainBundle
  try {
    domainBundle = await loadBundle(tid, productRefId)
  } catch (e) {
    if (e.code === 'NOT_FOUND')          return res.status(404).json({ error: 'not_found',          detail: e.message })
    if (e.code === 'NO_COSMOS')          return res.status(503).json({ error: 'service_unavailable', detail: e.message })
    if (e.code === 'UNKNOWN_LOB')        return res.status(422).json({ error: 'unknown_lob',         detail: e.message })
    if (e.code === 'NO_RATING_PROGRAM')  return res.status(422).json({ error: 'no_rating_program',   detail: e.message })
    return res.status(500).json({ error: 'load_error', detail: String(e.message) })
  }

  let pdm, xml, report, manuScriptID
  try {
    ;({ pdm, xml, report, manuScriptID } = buildAndSerialize(domainBundle))
  } catch (e) {
    return res.status(500).json({ error: 'serialize_error', detail: String(e.message) })
  }

  // Fail-closed: emit a rejection audit and return 422 if validation fails.
  // A bundle with validation errors is never stored or emittable.
  if (!report.ok) {
    await emitAudit(tid, 'api-duckcreek-generate-rejected', {
      actor, productRefId, manuScriptID, schemaVersion: SCHEMA_VERSION,
      reason: 'validation_failed', issues: report.issues,
    })
    return res.status(422).json({
      error:         'validation_failed',
      detail:        'Manuscript failed fail-closed validation — no bundle stored.',
      manuScriptID,  schemaVersion: SCHEMA_VERSION,
      validation:    report, apiVersion: API_VERSION,
    })
  }

  const bundleId  = crypto.randomUUID()
  const safeRef   = productRefId.replace(/[^A-Za-z0-9._-]+/g, '_')
  const fileName  = `${safeRef}_duckcreek.xml`
  const expiresAt = new Date(Date.now() + BUNDLE_TTL_MS).toISOString()

  storeBundle(bundleId, { xml, report, manuScriptID, productRefId, fileName, schemaVersion: SCHEMA_VERSION })

  await emitAudit(tid, 'api-duckcreek-generate', {
    actor, productRefId, bundleId, manuScriptID, schemaVersion: SCHEMA_VERSION,
  })

  return res.json({
    bundleId,      schemaVersion: SCHEMA_VERSION,
    manuScriptID,  productRefId,
    fileName,      expiresAt,
    apiVersion:    API_VERSION,
    validation: {
      ok:     report.ok,
      counts: report.counts,
      issues: report.issues,
    },
  })
})

// POST /author/validate
// Body: { productRefId: string }
// Response 200: { schemaVersion, manuScriptID, productRefId, apiVersion, validation: ValidationReport }
// No bundle is stored; all dimensions of the fail-closed report are returned.
router.post('/author/validate', ...guards, async (req, res) => {
  const { productRefId } = req.body || {}
  if (!productRefId || typeof productRefId !== 'string') {
    return res.status(400).json({ error: 'bad_request', detail: 'productRefId (string) is required' })
  }

  const tid   = req.user.tenantId
  const actor = { uid: req.user.uid, name: req.user.name }

  let domainBundle
  try {
    domainBundle = await loadBundle(tid, productRefId)
  } catch (e) {
    if (e.code === 'NOT_FOUND')         return res.status(404).json({ error: 'not_found',          detail: e.message })
    if (e.code === 'NO_COSMOS')         return res.status(503).json({ error: 'service_unavailable', detail: e.message })
    if (e.code === 'UNKNOWN_LOB')       return res.status(422).json({ error: 'unknown_lob',         detail: e.message })
    if (e.code === 'NO_RATING_PROGRAM') return res.status(422).json({ error: 'no_rating_program',   detail: e.message })
    return res.status(500).json({ error: 'load_error', detail: String(e.message) })
  }

  let xml, report, manuScriptID
  try {
    ;({ xml, report, manuScriptID } = buildAndSerialize(domainBundle))
  } catch (e) {
    return res.status(500).json({ error: 'serialize_error', detail: String(e.message) })
  }

  await emitAudit(tid, 'api-duckcreek-validate', {
    actor, productRefId, manuScriptID, schemaVersion: SCHEMA_VERSION,
    ok: report.ok,
  })

  return res.json({
    schemaVersion: SCHEMA_VERSION, manuScriptID,
    productRefId,  apiVersion: API_VERSION,
    validation:    report,
  })
})

// GET /author/bundle/:id/download
// Response 200: application/xml with Content-Disposition attachment
// Response 404: bundle not found or expired
router.get('/author/bundle/:id/download', ...guards, async (req, res) => {
  const bundle = getBundle(req.params.id)
  if (!bundle) {
    return res.status(404).json({
      error:  'not_found',
      detail: 'Bundle not found or expired. Re-generate via POST /author/generate.',
    })
  }

  const tid   = req.user.tenantId
  const actor = { uid: req.user.uid, name: req.user.name }

  await emitAudit(tid, 'api-duckcreek-download', {
    actor,
    bundleId:      req.params.id,
    productRefId:  bundle.productRefId,
    manuScriptID:  bundle.manuScriptID,
    schemaVersion: bundle.schemaVersion,
  })

  return res
    .set('Content-Type',                   'application/xml; charset=utf-8')
    .set('Content-Disposition',            `attachment; filename="${bundle.fileName}"`)
    .set('X-DuckCreek-Schema-Version',     bundle.schemaVersion)
    .set('X-DuckCreek-ManuScript-ID',      bundle.manuScriptID)
    .set('X-DuckCreek-Api-Version',        API_VERSION)
    .set('Cache-Control',                  'no-store')
    .send(bundle.xml)
})

module.exports = router
