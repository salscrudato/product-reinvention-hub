'use strict'
// run-results.js — F23: a result computed with nobody listening must be persisted,
// not discarded. A CORE import runs ~110 minutes over one SSE socket; every observed
// failure mode (client timeout, App Service restart, transport drop) discarded a
// finished — and paid-for — bundle. This module gives a completed unifiedImport run
// a durable home: the bundle is written to Azure Blob at completion, keyed by the
// CLIENT-SUPPLIED run id, tenant-scoped, and a reconnecting client fetches it via
// POST /api/ai/unifiedImportResult. Best-effort by design: persistence failures are
// reported (never thrown), and an unconfigured store answers honestly — never a
// fake success.
//
// Storage conventions follow storage.js: AZURE_BLOB_CONNECTION + AZURE_BLOB_CONTAINER
// (default "uploads"), path sanitation before anything reaches the SDK.

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
    console.warn('[run-results] @azure/storage-blob unavailable:', e.message)
    containerClient = null
  }
  return containerClient
}

/** RISK-004 discipline: ids become blob path segments — accept a conservative
 *  charset only (no traversal, no separators), 8–64 chars. */
function sanitizeRunId(id) {
  const s = String(id || '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(s) && !s.includes('..') ? s : null
}
function sanitizeTenantId(t) {
  const s = String(t || '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : null
}
const blobPath = (tenantId, runId) => `import-results/${tenantId}/${runId}.json`

/** Persist a finished bundle. Never throws — the import run must not fail because
 *  its safety net did. Returns { ok } or { ok:false, reason }. */
async function persistRunResult({ tenantId, runId, bundle }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  if (!rid || !tid) return { ok: false, reason: 'invalid_id' }
  const client = getClient()
  if (!client) return { ok: false, reason: 'storage_not_configured' }
  try {
    const envelope = { runId: rid, tenantId: tid, finishedAt: new Date().toISOString(), bundle }
    const body = Buffer.from(JSON.stringify(envelope))
    await client.getBlockBlobClient(blobPath(tid, rid)).uploadData(body, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 160) }
  }
}

/** Fetch a persisted bundle for THIS tenant. Returns
 *  { status:'ok', envelope } | { status:'not_found' } |
 *  { status:'storage_not_configured' } | { status:'invalid_id' }. */
async function fetchRunResult({ tenantId, runId }) {
  const rid = sanitizeRunId(runId)
  const tid = sanitizeTenantId(tenantId)
  if (!rid || !tid) return { status: 'invalid_id' }
  const client = getClient()
  if (!client) return { status: 'storage_not_configured' }
  try {
    const buf = await client.getBlockBlobClient(blobPath(tid, rid)).downloadToBuffer()
    return { status: 'ok', envelope: JSON.parse(buf.toString('utf8')) }
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === 'BlobNotFound')) return { status: 'not_found' }
    return { status: 'not_found' }
  }
}

/** Test seam: inject a fake container client (unit tests run with no Azure). */
function __setClientForTests(client) { containerClient = client; clientResolved = true }

module.exports = { persistRunResult, fetchRunResult, sanitizeRunId, __setClientForTests }
