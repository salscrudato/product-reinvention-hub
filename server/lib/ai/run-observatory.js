'use strict'
// run-observatory.js — CE3 Step 8: the import-run evidence graph + read API.
//
// An import run is expensive and, until now, forensically opaque: once the SSE
// stream closed you could not ask "what did run X do, stage by stage, and what
// did it cost?" This module persists, per run, a compact INDEX doc + per-stage
// BLOB artifacts, and exposes three READ-shaped routes so an operator (and CE4's
// Import Runs admin surface) can replay a run without re-buying it.
//
// Storage: Azure Blob, same conventions as run-results.js (AZURE_BLOB_CONNECTION
// + AZURE_BLOB_CONTAINER, path-sanitized ids, tenant-scoped, honest
// storage_not_configured). The INDEX doc is a small JSON blob per run; a
// tenant-prefixed listing yields "newest N". (A Cosmos `importRun` container
// would make listing query-able; Blob keeps this self-contained and testable
// and matches the existing durable-result store — promote later if needed.)
// 30-day retention is a TODO on the container lifecycle policy (R8 growth risk).
//
// NOTHING here calls a model or writes a canonical entity — it is telemetry.

const { sanitizeRunId } = require('./run-results')

const CONN = process.env.AZURE_BLOB_CONNECTION
const CONTAINER = process.env.AZURE_BLOB_CONTAINER || 'uploads'

let containerClient = null
let clientResolved = false
function getClient() {
  if (clientResolved) return containerClient
  clientResolved = true
  if (!CONN) return null
  try {
    const { BlobServiceClient } = require('@azure/storage-blob')
    containerClient = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER)
    containerClient.createIfNotExists().catch(() => {})
  } catch (e) {
    console.warn('[run-observatory] @azure/storage-blob unavailable:', e.message)
    containerClient = null
  }
  return containerClient
}

function sanitizeTenantId(t) {
  const s = String(t || '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : null
}
// A stage key is a short slug ("stage1", "sweeper", "0-router") — never a path.
function sanitizeStage(s) {
  const v = String(s || '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(v) && !v.includes('..') ? v : null
}

const indexPrefix = (tid) => `import-runs/${tid}/`
const indexPath = (tid, rid) => `import-runs/${tid}/${rid}.index.json`
const artifactPath = (tid, rid, stage) => `import-runs/${tid}/${rid}/${stage}.json`

// ─── Write side (called by the import pipeline at run close) ──────────────────

/** Persist / upsert the run INDEX doc. Never throws (telemetry must not fail a
 *  run). `indexDoc` is the caller's summary; we stamp runId/tenantId/updatedAt. */
async function persistImportRun({ tenantId, runId, indexDoc }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  if (!rid || !tid) return { ok: false, reason: 'invalid_id' }
  const client = getClient()
  if (!client) return { ok: false, reason: 'storage_not_configured' }
  try {
    const doc = { kind: 'importRun', runId: rid, tenantId: tid, updatedAt: new Date().toISOString(), ...(indexDoc || {}) }
    const body = Buffer.from(JSON.stringify(doc))
    await client.getBlockBlobClient(indexPath(tid, rid)).uploadData(body, { blobHTTPHeaders: { blobContentType: 'application/json' } })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 160) }
  }
}

/** Persist one per-stage artifact blob. Never throws. */
async function persistStageArtifact({ tenantId, runId, stage, artifact }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  const st = sanitizeStage(stage)
  if (!rid || !tid || !st) return { ok: false, reason: 'invalid_id' }
  const client = getClient()
  if (!client) return { ok: false, reason: 'storage_not_configured' }
  try {
    const body = Buffer.from(JSON.stringify({ runId: rid, tenantId: tid, stage: st, at: new Date().toISOString(), artifact: artifact ?? null }))
    await client.getBlockBlobClient(artifactPath(tid, rid, st)).uploadData(body, { blobHTTPHeaders: { blobContentType: 'application/json' } })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 160) }
  }
}

// ─── Read side (the three routes) ─────────────────────────────────────────────

/** List the tenant's newest `limit` run index docs (default 50). Returns
 *  { status:'ok', runs } | { status:'storage_not_configured' }. */
async function listImportRuns({ tenantId, limit = 50 }) {
  const tid = sanitizeTenantId(tenantId)
  if (!tid) return { status: 'invalid_id' }
  const client = getClient()
  if (!client) return { status: 'storage_not_configured' }
  const cap = Math.max(1, Math.min(200, Number(limit) || 50))
  try {
    const names = []
    for await (const item of client.listBlobsFlat({ prefix: indexPrefix(tid) })) {
      if (item.name.endsWith('.index.json')) names.push(item.name)
    }
    // Newest first: read docs, sort by updatedAt/startedAt desc, cap.
    const docs = []
    for (const name of names) {
      try {
        const buf = await client.getBlockBlobClient(name).downloadToBuffer()
        docs.push(JSON.parse(buf.toString('utf8')))
      } catch { /* skip a corrupt index blob */ }
    }
    docs.sort((a, b) => String(b.updatedAt || b.startedAt || '').localeCompare(String(a.updatedAt || a.startedAt || '')))
    return { status: 'ok', runs: docs.slice(0, cap) }
  } catch (e) {
    return { status: 'error', reason: String((e && e.message) || e).slice(0, 160) }
  }
}

/** Fetch one run's index doc. */
async function getImportRun({ tenantId, runId }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  if (!rid || !tid) return { status: 'invalid_id' }
  const client = getClient()
  if (!client) return { status: 'storage_not_configured' }
  try {
    const buf = await client.getBlockBlobClient(indexPath(tid, rid)).downloadToBuffer()
    return { status: 'ok', run: JSON.parse(buf.toString('utf8')) }
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === 'BlobNotFound')) return { status: 'not_found' }
    return { status: 'not_found' }
  }
}

/** List a run's persisted stage-artifact keys (CE3 Step 7 resume discovery). */
async function listStageArtifacts({ tenantId, runId }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  if (!rid || !tid) return { status: 'invalid_id' }
  const client = getClient()
  if (!client) return { status: 'storage_not_configured' }
  try {
    const prefix = `import-runs/${tid}/${rid}/`
    const stages = []
    for await (const item of client.listBlobsFlat({ prefix })) {
      if (item.name.endsWith('.json')) stages.push(item.name.slice(prefix.length, -'.json'.length))
    }
    return { status: 'ok', stages }
  } catch (e) {
    return { status: 'error', reason: String((e && e.message) || e).slice(0, 160) }
  }
}

/** Fetch one stage artifact (JSON passthrough). */
async function getStageArtifact({ tenantId, runId, stage }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  const st = sanitizeStage(stage)
  if (!rid || !tid || !st) return { status: 'invalid_id' }
  const client = getClient()
  if (!client) return { status: 'storage_not_configured' }
  try {
    const buf = await client.getBlockBlobClient(artifactPath(tid, rid, st)).downloadToBuffer()
    return { status: 'ok', artifact: JSON.parse(buf.toString('utf8')) }
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === 'BlobNotFound')) return { status: 'not_found' }
    return { status: 'not_found' }
  }
}

// ─── SSE event shapes (Step 8: additive brain events) ─────────────────────────
// Pure builders so the pipeline and its tests agree on the wire shape; the caller
// emits them over the existing SSE channel exactly like brain:spend / brain:escalation.

const censusEvent = (perSheet) => ({ t: 'json', key: 'brain:census', value: { perSheet: perSheet || [] } })
const sweeperEvent = (sheet, swept, reviewed) => ({ t: 'json', key: 'brain:sweeper', value: { sheet, swept: swept || 0, reviewed: reviewed || 0 } })
const cacheEvent = (hits, misses) => ({ t: 'json', key: 'brain:cache', value: { hits: hits || 0, misses: misses || 0 } })
const checkpointEvent = (stage, sheet, blobRef) => ({ t: 'json', key: 'brain:checkpoint', value: { stage, sheet: sheet ?? null, blobRef: blobRef ?? null } })

/** Test seam: inject a fake container client. */
function __setClientForTests(client) { containerClient = client; clientResolved = true }

/** Encode a per-sheet stage-4 checkpoint into a valid stage slug (<= 32 chars,
 *  no slash): "stage4." + squashed sheet name + short FNV hash (collision-safe;
 *  resume recovers the true sheet name from the artifact body, never the slug). */
function sheetStageSlug(sheetName) {
  const squashed = String(sheetName || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'sheet'
  let h = 0x811c9dc5
  for (const ch of String(sheetName || '')) { h ^= ch.charCodeAt(0); h = (h * 0x01000193) >>> 0 }
  return `stage4.${squashed}-${h.toString(16)}`
}

module.exports = {
  persistImportRun, persistStageArtifact,
  listImportRuns, listStageArtifacts, getImportRun, getStageArtifact,
  censusEvent, sweeperEvent, cacheEvent, checkpointEvent,
  __setClientForTests, sanitizeStage, sheetStageSlug,
}
