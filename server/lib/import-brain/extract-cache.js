'use strict'
// server/lib/import-brain/extract-cache.js — CE3 Step 3(d): extraction result cache
// (backlog item 8 — "cache keyed by contentHash + prompt version + model").
//
// Key: sha256(deployment + '\n' + promptVersion + '\n' + contentHash + '\n' +
// systemPrompt + '\n' + userPrompt). The userPrompt embeds the extraction window
// verbatim AND the caller passes an explicit contentHash of the window cells —
// belt and suspenders: a cell change breaks the key even if a future prompt
// refactor stops embedding the window verbatim. Bump PROMPT_VERSION whenever a
// stage-4 prompt OR the cacheability contract changes shape (stale entries must
// never satisfy a new prompt).
//
// CACHEABILITY (the poisoning fix): a raw is stored ONLY when it parses (the
// caller's `validate`) AND finished with a clean stop reason — a truncated or
// refused raw is a diagnosis, not an answer, and replaying it re-poisons every
// warm run (certification re-runs are exactly the runs most likely to hit a
// warm cache). Entries persist {raw, stopReason} so a HIT carries the stop
// reason too and truncation detection (stage-4 batch halving) works identically
// on a warm cache. The one targeted retry bypasses the read path entirely — a
// retry that replays the bytes it is retrying is a structural no-op — and its
// fresh result, if it validates, overwrites the entry.
//
// Storage: in-memory LRU (process lifetime) + best-effort Blob persistence under
// import-cache/{tenant}/{key}.json via the same lazy client pattern as run-observatory.
// DELIBERATE DEVIATION (ledger CE3): the prompt named Cosmos kind importCache, but the
// DEF-0047 no-bare-writes census (app/src/__invariants__, CE4-owned) allowlists every
// Cosmos write site by file+count — adding one from this lane would require editing a
// forbidden test. Blob carries identical semantics (key -> {raw, stopReason}) and the
// no-bare-writes census does not govern Blob; CE4/CE5 can move the store to Cosmos by
// adding the allowlist row.
//
// A cache HIT returns the raw model output byte-for-byte, so parsing, reconciliation and
// ledger posting run identically — telemetry is never bypassed (hits are counted on the
// budget and reported via brain:cache + brain:spend.cacheHits).

const crypto = require('crypto')
const { TRUNCATED_STOP_REASONS, REFUSAL_STOP_REASONS } = require('./constants')

// v2: cacheability gating + persisted stopReason + explicit contentHash in the
// key — bumped ONCE to invalidate the v1 population, which was written before
// parse validation and without stop reasons (poisoned bytes replayed on every
// warm certification run).
const PROMPT_VERSION = 'stage4/v2'

const MAX_MEMORY_ENTRIES = 512
const memory = new Map() // key -> { raw, stopReason } (Map preserves insertion order — LRU by re-set)

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

/** sha256 of any JSON-serializable content — the explicit window-content key component. */
function contentHashOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
}

function cacheKey({ deployment, systemPrompt, userPrompt, promptVersion, contentHash }) {
  return crypto.createHash('sha256')
    .update(String(deployment)).update('\n')
    .update(String(promptVersion || PROMPT_VERSION)).update('\n')
    .update(String(contentHash || '')).update('\n')
    .update(String(systemPrompt)).update('\n')
    .update(String(userPrompt))
    .digest('hex')
}

function rememberInMemory(key, entry) {
  if (memory.has(key)) memory.delete(key)
  memory.set(key, entry)
  if (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value
    memory.delete(oldest)
  }
}

/** Look up a cached entry { raw, stopReason }. Memory first; Blob best-effort. */
async function cacheGet(key, tenantId) {
  if (memory.has(key)) {
    const entry = memory.get(key)
    rememberInMemory(key, entry) // LRU touch
    return entry
  }
  const container = getBlobContainer()
  if (!container) return null
  try {
    const blob = container.getBlockBlobClient(`${sanitizeTenant(tenantId)}/${key}.json`)
    const buf = await blob.downloadToBuffer()
    const parsed = JSON.parse(buf.toString('utf8'))
    if (parsed && typeof parsed.raw === 'string') {
      const entry = { raw: parsed.raw, stopReason: typeof parsed.stopReason === 'string' ? parsed.stopReason : null }
      rememberInMemory(key, entry)
      return entry
    }
  } catch { /* miss */ }
  return null
}

/** Store a raw + its stop reason. Memory always; Blob best-effort (never throws).
 *  This is the low-level store — CACHEABILITY gating lives in cachedCall. */
async function cachePut(key, tenantId, raw, meta) {
  if (typeof raw !== 'string' || raw === '') return
  const stopReason = meta && typeof meta.stopReason === 'string' ? meta.stopReason : null
  rememberInMemory(key, { raw, stopReason })
  const container = getBlobContainer()
  if (!container) return
  try {
    const body = JSON.stringify({ raw, ...meta, stopReason, promptVersion: (meta && meta.promptVersion) || PROMPT_VERSION })
    const blob = container.getBlockBlobClient(`${sanitizeTenant(tenantId)}/${key}.json`)
    await blob.upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: 'application/json' } })
  } catch { /* best-effort */ }
}

function sanitizeTenant(tenantId) {
  const t = String(tenantId || 'unscoped')
  return /^[A-Za-z0-9_-]{1,64}$/.test(t) ? t : 'unscoped'
}

/** A stop reason that means "the model finished on its own terms" — present,
 *  not a truncation, not a refusal. Only such results are cacheable. */
function isCleanStop(stopReason) {
  return typeof stopReason === 'string'
    && stopReason !== ''
    && !TRUNCATED_STOP_REASONS.has(stopReason)
    && !REFUSAL_STOP_REASONS.has(stopReason)
}

/**
 * Wrap a model-call thunk with the cache: returns { raw, stopReason } like the
 * underlying call. `budget` gains cacheHits/cacheMisses/cacheBypasses counters
 * (telemetry, surfaced in brain:spend).
 *
 * `validate(raw)` — cacheability probe (truthy = parseable); when omitted, only
 * the clean-stop gate applies.
 * `callOpts.bypassCache` — the targeted-retry switch: skip the READ (never
 * replay the bytes being retried) but still store a fresh result that
 * validates, overwriting any prior entry under the key.
 */
async function cachedCall({ deployment, systemPrompt, userPrompt, promptVersion, contentHash, budget, tenantId, call, validate }, callOpts) {
  const key = cacheKey({ deployment, systemPrompt, userPrompt, promptVersion, contentHash })
  const bypass = Boolean(callOpts && callOpts.bypassCache)
  if (bypass) {
    if (budget) budget.cacheBypasses = (budget.cacheBypasses || 0) + 1
  } else {
    const hit = await cacheGet(key, tenantId)
    if (hit !== null) {
      if (budget) budget.cacheHits = (budget.cacheHits || 0) + 1
      return { raw: hit.raw, stopReason: hit.stopReason, cached: true }
    }
    if (budget) budget.cacheMisses = (budget.cacheMisses || 0) + 1
  }
  const res = await call()
  const cacheable = res
    && typeof res.raw === 'string' && res.raw !== ''
    && isCleanStop(res.stopReason)
    && (typeof validate !== 'function' || (() => { try { return Boolean(validate(res.raw)) } catch { return false } })())
  if (cacheable) await cachePut(key, tenantId, res.raw, { deployment, promptVersion, stopReason: res.stopReason })
  return res
}

module.exports = {
  PROMPT_VERSION, cacheKey, contentHashOf, cacheGet, cachePut, cachedCall, isCleanStop,
  __setBlobClientForTests, __resetForTests,
}
