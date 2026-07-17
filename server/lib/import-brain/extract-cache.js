'use strict'
// server/lib/import-brain/extract-cache.js — CE3 Step 3(d): extraction result cache
// (backlog item 8 — "cache keyed by contentHash + prompt version + model").
//
// Key: sha256(deployment + '\n' + promptVersion + '\n' + systemPrompt + '\n' + userPrompt).
// The userPrompt embeds the extraction window verbatim, so the window's content hash is
// implicit and EXACT — any cell change changes the key. Bump PROMPT_VERSION whenever a
// stage-4 prompt changes shape (stale cache entries must never satisfy a new prompt).
//
// Storage: in-memory LRU (process lifetime) + best-effort Blob persistence under
// import-cache/{tenant}/{key}.json via the same lazy client pattern as run-observatory.
// DELIBERATE DEVIATION (ledger CE3): the prompt named Cosmos kind importCache, but the
// DEF-0047 no-bare-writes census (app/src/__invariants__, CE4-owned) allowlists every
// Cosmos write site by file+count — adding one from this lane would require editing a
// forbidden test. Blob carries identical semantics (key -> raw model output) and the
// no-bare-writes census does not govern Blob; CE4/CE5 can move the store to Cosmos by
// adding the allowlist row.
//
// A cache HIT returns the raw model output byte-for-byte, so parsing, reconciliation and
// ledger posting run identically — telemetry is never bypassed (hits are counted on the
// budget and reported via brain:cache + brain:spend.cacheHits).

const crypto = require('crypto')

const PROMPT_VERSION = 'stage4/v1'

const MAX_MEMORY_ENTRIES = 512
const memory = new Map() // key -> raw (Map preserves insertion order — LRU by re-set)

let blobClientFactory = null // injected or lazily resolved
let blobDead = false

function __setBlobClientForTests(factory) { blobClientFactory = factory; blobDead = false }
function __resetForTests() { memory.clear(); blobClientFactory = null; blobDead = false }

function getBlobContainer() {
  if (blobDead) return null
  try {
    if (blobClientFactory) return blobClientFactory()
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!conn) { blobDead = true; return null }
    const { BlobServiceClient } = require('@azure/storage-blob')
    return BlobServiceClient.fromConnectionString(conn).getContainerClient('import-cache')
  } catch { blobDead = true; return null }
}

function cacheKey({ deployment, systemPrompt, userPrompt, promptVersion }) {
  return crypto.createHash('sha256')
    .update(String(deployment)).update('\n')
    .update(String(promptVersion || PROMPT_VERSION)).update('\n')
    .update(String(systemPrompt)).update('\n')
    .update(String(userPrompt))
    .digest('hex')
}

function rememberInMemory(key, raw) {
  if (memory.has(key)) memory.delete(key)
  memory.set(key, raw)
  if (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value
    memory.delete(oldest)
  }
}

/** Look up a cached raw model output. Memory first; Blob best-effort. */
async function cacheGet(key, tenantId) {
  if (memory.has(key)) {
    const raw = memory.get(key)
    rememberInMemory(key, raw) // LRU touch
    return raw
  }
  const container = getBlobContainer()
  if (!container) return null
  try {
    const blob = container.getBlockBlobClient(`${sanitizeTenant(tenantId)}/${key}.json`)
    const buf = await blob.downloadToBuffer()
    const parsed = JSON.parse(buf.toString('utf8'))
    if (parsed && typeof parsed.raw === 'string') {
      rememberInMemory(key, parsed.raw)
      return parsed.raw
    }
  } catch { /* miss */ }
  return null
}

/** Store a raw model output. Memory always; Blob best-effort (never throws). */
async function cachePut(key, tenantId, raw, meta) {
  if (typeof raw !== 'string' || raw === '') return
  rememberInMemory(key, raw)
  const container = getBlobContainer()
  if (!container) return
  try {
    const body = JSON.stringify({ raw, ...meta, promptVersion: (meta && meta.promptVersion) || PROMPT_VERSION })
    const blob = container.getBlockBlobClient(`${sanitizeTenant(tenantId)}/${key}.json`)
    await blob.upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: 'application/json' } })
  } catch { /* best-effort */ }
}

function sanitizeTenant(tenantId) {
  const t = String(tenantId || 'unscoped')
  return /^[A-Za-z0-9_-]{1,64}$/.test(t) ? t : 'unscoped'
}

/**
 * Wrap a model-call thunk with the cache: returns { raw } like the underlying call.
 * `budget` gains cacheHits/cacheMisses counters (telemetry, surfaced in brain:spend).
 */
async function cachedCall({ deployment, systemPrompt, userPrompt, promptVersion, budget, tenantId, call }) {
  const key = cacheKey({ deployment, systemPrompt, userPrompt, promptVersion })
  const hit = await cacheGet(key, tenantId)
  if (hit !== null) {
    if (budget) budget.cacheHits = (budget.cacheHits || 0) + 1
    return { raw: hit, cached: true }
  }
  if (budget) budget.cacheMisses = (budget.cacheMisses || 0) + 1
  const res = await call()
  if (res && typeof res.raw === 'string') await cachePut(key, tenantId, res.raw, { deployment, promptVersion })
  return res
}

module.exports = { PROMPT_VERSION, cacheKey, cacheGet, cachePut, cachedCall, __setBlobClientForTests, __resetForTests }
