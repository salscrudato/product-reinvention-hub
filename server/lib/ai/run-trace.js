'use strict'
// run-trace.js — per-run import pipeline telemetry (the admin debugging surface).
//
// The unified import pipeline already narrates itself over SSE: every stage emits
// tool start/end frames, a JSON payload per stage output, spend, escalations and
// notices. Those frames were transient — log + SSE only — so a finished run left
// no inspectable record of WHAT each step saw and produced. This module tails the
// SAME emit seam (observe() is called on every frame before it hits the wire) and
// derives a durable RunTrace: ordered steps with timings, bounded stage payloads,
// spend by deployment, escalations, notices and the final outcome.
//
// Storage follows metering.js conventions: an in-memory ring buffer (works with no
// Cosmos configured; running runs are always served from memory) plus best-effort
// Cosmos persistence under pk='__system__', kind='importRunTrace' — a telemetry
// record, not a governed entity, so it does not go through the mutation envelope
// (same rationale as tenantMeter). Persistence failures never break an import.
//
// Payload bounding: stage outputs can be huge (stage 4 extracts thousands of
// entities). Each recorded payload is capped — arrays keep a structural sample
// plus totals, oversized scalars keep a preview — so a trace document stays far
// under the Cosmos 2 MB item limit. The FULL bundle already has a durable home
// (run-results.js / Azure Blob); this trace is the debugging index over it.

const crypto = require('crypto')

const RING_MAX = 100                  // in-memory traces kept (newest win)
const MAX_PAYLOAD_BYTES = 48 * 1024   // per recorded stage payload
const MAX_PROGRESS_LINES = 40         // per step
const MAX_NOTICES = 100
const MAX_ESCALATIONS = 50
const CHECKPOINT_MS = 5_000           // min gap between mid-run persists
const TRACE_TTL_SECONDS = 60 * 24 * 3600 // honored only if container TTL is enabled

let _docsOverride // test seam: undefined = live resolution, anything else wins
function sysDocs() {
  if (_docsOverride !== undefined) return _docsOverride
  try { return require('../cosmos').docs } catch { return null }
}

// ─── payload bounding ─────────────────────────────────────────────────────────

function safeStringify(v) {
  try { return JSON.stringify(v) ?? 'null' } catch { return '"<unserializable>"' }
}

/** Prune a value to roughly fit `budget` bytes while keeping real structure for
 *  the leading items (debuggers want to SEE representative rows, not a byte count). */
function prune(v, budget) {
  if (Array.isArray(v)) {
    const sample = []
    let used = 64
    for (const item of v) {
      const s = safeStringify(item)
      if (s.length > budget / 2) { sample.push(prune(item, Math.floor(budget / 4))); used += budget / 4 }
      else { sample.push(item); used += s.length + 1 }
      if (used >= budget || sample.length >= 200) break
    }
    return { __sample: true, totalItems: v.length, shownItems: sample.length, items: sample }
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    const per = Math.max(512, Math.floor(budget / Math.max(1, keys.length)))
    const out = {}
    for (const k of keys) {
      const s = safeStringify(v[k])
      out[k] = s.length <= per ? v[k] : prune(v[k], per)
    }
    return out
  }
  if (typeof v === 'string') return `${v.slice(0, Math.max(256, budget))}… (${v.length} chars)`
  return v
}

/** Record wrapper: { value, truncated, bytes } — bytes is the ORIGINAL size. */
function bound(v) {
  const s = safeStringify(v)
  if (s.length <= MAX_PAYLOAD_BYTES) return { value: v, truncated: false, bytes: s.length }
  return { value: prune(v, MAX_PAYLOAD_BYTES), truncated: true, bytes: s.length }
}

// ─── in-memory ring ───────────────────────────────────────────────────────────

const _ring = new Map() // runId -> trace (insertion order = age)

function ringPut(trace) {
  _ring.delete(trace.runId)
  _ring.set(trace.runId, trace)
  while (_ring.size > RING_MAX) {
    // Evict the oldest FINISHED trace first; never evict a running one if avoidable.
    let evict = null
    for (const t of _ring.values()) { if (t.status !== 'running') { evict = t.runId; break } }
    if (!evict) evict = _ring.keys().next().value
    _ring.delete(evict)
  }
}

// ─── trace shape helpers ──────────────────────────────────────────────────────

function stageOf(name) {
  const m = /^brain:stage(\d+)/.exec(String(name || ''))
  return m ? Number(m[1]) : null
}

function toSummary(t) {
  const noticeCounts = { info: 0, warn: 0, error: 0 }
  for (const n of t.notices) noticeCounts[n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info'] += 1
  return {
    runId: t.runId, tenantId: t.tenantId, actor: t.actor,
    sourceName: t.sourceName, documents: t.documents,
    startedAt: t.startedAt, finishedAt: t.finishedAt, durationMs: t.durationMs,
    status: t.status, needsReview: t.needsReview, path: t.path,
    spendUsd: t.spend ? t.spend.spendUsd : null,
    calls: t.spend ? t.spend.calls : 0,
    escalations: t.escalations.length,
    stages: t.steps.map((s) => ({ name: s.name, stage: s.stage, status: s.status, durationMs: s.durationMs })),
    noticeCounts,
    outcome: t.outcome,
    error: t.error,
  }
}

// ─── persistence (best-effort, metering.js discipline) ────────────────────────

async function persist(t) {
  const docs = sysDocs()
  if (!docs) return
  try {
    await docs.items.upsert({
      id: `importRunTrace:${t.tenantId}:${t.runId}`,
      pk: '__system__', kind: 'importRunTrace',
      ttl: TRACE_TTL_SECONDS,
      summary: toSummary(t),
      data: t,
    })
  } catch { /* telemetry must never break an import */ }
}

// ─── the tracer ───────────────────────────────────────────────────────────────

function createRunTrace({ runId, tenantId, actor } = {}) {
  const trace = {
    runId: String(runId || `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`),
    tenantId: String(tenantId || 'unknown'),
    actor: actor ? { uid: actor.uid || null, name: actor.name || null, role: actor.role || null } : null,
    sourceName: null,
    documents: [],           // [{ name, sizeKB, mediaType }]
    path: null,              // workbook | filing | fallback | structural
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    status: 'running',       // running | succeeded | failed
    needsReview: false,
    steps: [],               // ordered tool-frame steps (see observe)
    outputs: {},             // json key -> bounded payload record
    notices: [],
    escalations: [],
    spend: null,             // { spendUsd, calls, noCap, byDeployment }
    outcome: null,           // derived from the bundle frame
    error: null,
    resultPersisted: null,   // run-results.js blob persistence outcome, if requested
  }

  const startedMs = Date.now()
  let lastCheckpoint = 0
  let sawError = false
  let sawBundle = false
  let finished = false

  const stepsByName = new Map()

  function onTool(ev) {
    const name = String(ev.name || '')
    let step = stepsByName.get(name)
    if (ev.phase === 'start' || !step) {
      if (step && step.status === 'running') return onToolProgress(step, ev) // duplicate start
      step = {
        name, stage: stageOf(name),
        startedAt: new Date().toISOString(),
        endedAt: null, durationMs: null,
        status: 'running',
        detail: ev.summary != null ? String(ev.summary) : null,
        result: null,
        progress: [],
        _t0: Date.now(),
      }
      stepsByName.set(name, step)
      trace.steps.push(step)
      if (ev.phase !== 'start') onToolProgress(step, ev)
      return
    }
    if (ev.phase === 'progress') return onToolProgress(step, ev)
    if (ev.phase === 'end') {
      step.endedAt = new Date().toISOString()
      step.durationMs = Date.now() - step._t0
      step.status = 'done'
      if (ev.summary != null) step.result = String(ev.summary)
      checkpoint()
    }
  }

  function onToolProgress(step, ev) {
    if (ev.summary == null) return
    if (step.progress.length < MAX_PROGRESS_LINES) step.progress.push(String(ev.summary))
    else if (step.progress.length === MAX_PROGRESS_LINES) step.progress.push('… (further progress truncated)')
  }

  function onJson(ev) {
    const key = String(ev.key || '')
    const v = ev.value
    if (key === 'brain:spend' || key === 'import:spend') { trace.spend = v || null; return }
    if (key === 'brain:escalation') {
      if (trace.escalations.length < MAX_ESCALATIONS) trace.escalations.push({ ...(v || {}), at: new Date().toISOString() })
      return
    }
    if (key === 'run:id') return
    if (key === 'run:persisted') { trace.resultPersisted = v || null; return }
    if (key === 'bundle') { onBundle(v); return }
    if (key === 'brain:input') { trace.outputs[key] = bound(v); if (v && v.sourceName && !trace.sourceName) trace.sourceName = String(v.sourceName); return }
    // Stage payloads and anything else additive: record bounded.
    trace.outputs[key] = bound(v)
  }

  function onBundle(b) {
    sawBundle = true
    if (!b || typeof b !== 'object') return
    const plan = b.plan || {}
    const review = b.review || {}
    const reviewItems = ['product', 'coverages', 'tables', 'rules', 'rating']
      .reduce((n, k) => n + (Array.isArray(review[k]?.items) ? review[k].items.length : 0), 0)
    trace.outcome = {
      productId: plan.productId ?? null,
      coverages: Array.isArray(plan.coverages) ? plan.coverages.length : 0,
      forms: Array.isArray(plan.forms) ? plan.forms.length : 0,
      rules: Array.isArray(plan.rules) ? plan.rules.length : 0,
      rtTables: Array.isArray(plan.rtTables) ? plan.rtTables.length : 0,
      ldTables: Array.isArray(plan.ldTables) ? plan.ldTables.length : 0,
      proposed: b.counts?.proposed ?? null,
      accepted: b.counts?.accepted ?? null,
      unresolved: b.counts?.unresolved ?? null,
      reviewItems,
      completeness: b.completeness?.assessment ?? null,
      importWarnings: Array.isArray(b.importWarnings) ? b.importWarnings.length : 0,
      detectedFormat: b.fingerprint?.detectedFormat ?? null,
    }
    trace.needsReview = (trace.outcome.unresolved || 0) > 0 || (trace.outcome.importWarnings || 0) > 0
    // The inspector's most-asked debugging questions, kept on the trace (bounded);
    // the full bundle lives in run-results blob storage when a runId was supplied.
    if (Array.isArray(b.importWarnings) && b.importWarnings.length > 0) trace.outputs['importWarnings'] = bound(b.importWarnings)
    if (Array.isArray(b.unresolved) && b.unresolved.length > 0) trace.outputs['unresolved'] = bound(b.unresolved)
  }

  function checkpoint() {
    const now = Date.now()
    if (now - lastCheckpoint < CHECKPOINT_MS) return
    lastCheckpoint = now
    persist(trace).catch(() => {})
  }

  function finish() {
    if (finished) return
    finished = true
    trace.finishedAt = new Date().toISOString()
    trace.durationMs = Date.now() - startedMs
    trace.status = sawError ? 'failed' : sawBundle ? 'succeeded' : 'failed'
    for (const s of trace.steps) {
      if (s.status === 'running') {
        s.status = sawError ? 'error' : 'done'
        s.endedAt = trace.finishedAt
        s.durationMs = Date.now() - s._t0
      }
      delete s._t0
    }
    persist(trace).catch(() => {})
  }

  const tracer = {
    trace,
    setPath(p) { trace.path = String(p) },
    setSource(sourceName, documents) {
      if (sourceName) trace.sourceName = String(sourceName)
      if (Array.isArray(documents)) {
        trace.documents = documents.slice(0, 20).map((d) => ({
          name: String(d.name || 'document'),
          sizeKB: typeof d.sizeKB === 'number' ? d.sizeKB : (d.base64 ? Math.round((d.base64.length * 3) / 4 / 1024) : null),
          mediaType: d.mediaType ? String(d.mediaType) : null,
        }))
      }
    },
    /** Observe one SSE frame. Never throws — telemetry must never break the run. */
    observe(ev) {
      try {
        if (!ev || typeof ev !== 'object' || finished) return
        if (ev.t === 'tool') return onTool(ev)
        if (ev.t === 'json') return onJson(ev)
        if (ev.t === 'notice') {
          if (trace.notices.length < MAX_NOTICES) {
            trace.notices.push({ level: ev.level || 'info', kind: ev.kind || null, message: String(ev.message || ''), at: new Date().toISOString() })
          }
          return
        }
        if (ev.t === 'error') { sawError = true; trace.error = String(ev.message || 'import failed').slice(0, 400); return }
        if (ev.t === 'done') return finish()
      } catch { /* never break the emit path */ }
    },
    finish,
  }

  ringPut(trace)
  return tracer
}

// ─── read side (admin surface) ────────────────────────────────────────────────

function storageMode() { return sysDocs() ? 'cosmos' : 'memory' }

/** Newest-first run summaries: in-memory traces merged over persisted ones
 *  (memory wins per runId — it is at least as fresh). Store failures degrade to
 *  memory-only, honestly. */
async function listRunTraces({ limit = 50, tenantId = null } = {}) {
  const byId = new Map()
  const docs = sysDocs()
  if (docs) {
    try {
      let query = `SELECT TOP ${Math.min(Math.max(limit, 1), 200)} c.summary FROM c WHERE c.pk='__system__' AND c.kind='importRunTrace'`
      const parameters = []
      if (tenantId) { query += ' AND c.summary.tenantId = @tid'; parameters.push({ name: '@tid', value: tenantId }) }
      query += ' ORDER BY c.summary.startedAt DESC'
      const { resources } = await docs.items.query({ query, parameters }).fetchAll()
      for (const r of resources) if (r && r.summary) byId.set(r.summary.runId, r.summary)
    } catch { /* degrade to memory */ }
  }
  for (const t of _ring.values()) {
    if (tenantId && t.tenantId !== tenantId) continue
    byId.set(t.runId, toSummary(t))
  }
  return [...byId.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, limit)
}

/** In-flight runs, synchronously. A RUNNING trace lives ONLY in the in-memory ring
 *  (mid-run persists are checkpoints of a still-running doc), so this needs no I/O
 *  and cannot fail — which is what makes it usable from a SIGTERM handler, where
 *  awaiting Cosmos is not an option. This is the drain guard's input: a redeploy
 *  that restarts the container silently destroys a ~$70 / ~110-minute import, and
 *  the pipeline had no way to ask whether one was in flight. */
function activeRuns() {
  const out = []
  for (const t of _ring.values()) {
    if (t.status !== 'running') continue
    out.push({
      runId: t.runId, tenantId: t.tenantId, sourceName: t.sourceName,
      startedAt: t.startedAt, elapsedMs: Date.now() - Date.parse(t.startedAt),
      spendUsd: t.spend ? t.spend.spendUsd : null,
      stage: t.steps.length > 0 ? t.steps[t.steps.length - 1].name : null,
    })
  }
  return out
}

/** Full trace for one run: memory first (running runs live only there), then store. */
async function getRunTrace(runId) {
  const rid = String(runId || '')
  const mem = _ring.get(rid)
  if (mem) {
    const t = { ...mem, steps: mem.steps.map(({ _t0, ...s }) => s) }
    return t
  }
  const docs = sysDocs()
  if (!docs) return null
  try {
    const { resources } = await docs.items.query({
      query: "SELECT TOP 1 c.data FROM c WHERE c.pk='__system__' AND c.kind='importRunTrace' AND c.data.runId=@rid",
      parameters: [{ name: '@rid', value: rid }],
    }).fetchAll()
    return resources[0]?.data ?? null
  } catch { return null }
}

/** Test seams: clear the in-memory ring / force the store (null = memory-only). */
function __clearForTests() { _ring.clear() }
function __setDocsForTests(docs) { _docsOverride = docs }

module.exports = { createRunTrace, listRunTraces, getRunTrace, activeRuns, storageMode, __clearForTests, __setDocsForTests }
