'use strict'
// data.js — /api/db/* : Cosmos-backed data layer replacing Firestore.
//
// Preserves the app's BackendAdapter contract and the atomic mutate() envelope:
// every governed write commits entity + auditEvent + version + searchIndex in a
// SINGLE Cosmos transactional batch (they share pk = the entity's product/root
// partition, so the batch is genuinely atomic). Role matrix is enforced here,
// server-side, mirroring the old Firestore rules.

const express = require('express')
const crypto = require('crypto')
const { docs, presence } = require('./cosmos')
const { requireAuth, requireRole } = require('./auth')

const router = express.Router()
const MAX_LIST = 1000
const BATCH_OPS = 96 // 4 ops/payload → ≤24 payloads per transactional batch (limit 100)

// ─── path helpers ────────────────────────────────────────────────────────────
const segs = (p) => String(p || '').split('/').filter(Boolean)
function pkFor(path) { const s = segs(path); return (s[0] === 'products' && s[1]) ? s[1] : (s[0] || 'root') }
function collOf(path) { return segs(path).slice(0, -1).join('/') }
function lastSeg(path) { const s = segs(path); return s[s.length - 1] }
const idFor = (prefix, key) => `${prefix}:${String(key).replace(/[/\\?#]/g, '~')}`
const auditId = () => `aud:${Date.now().toString(36)}-${crypto.randomUUID()}`
function searchText(data) {
  return Object.values(data || {}).filter((v) => typeof v === 'string').join(' ').slice(0, 4000)
}

async function readEntity(path) {
  try { return (await docs.item(idFor('ent', path), pkFor(path)).read()).resource } catch { return null }
}

// Build the 4-op atomic envelope for one mutation (all share pk).
function envelopeOps(payload, actor) {
  const { op, path, data = {}, entityType } = payload
  const pk = pkFor(path)
  const now = new Date().toISOString()
  return async () => {
    const current = await readEntity(path)
    const curRev = current?.rev ?? 0
    if (payload.expectedRev !== undefined && current && curRev !== payload.expectedRev) {
      const e = new Error('conflict'); e.code = 'CONFLICT'; throw e
    }
    const rev = curRev + 1
    const entityData = { ...data, rev, updatedAt: now, updatedBy: actor }
    const ops = []
    if (op === 'delete') ops.push({ operationType: 'Delete', id: idFor('ent', path) })
    else ops.push({ operationType: 'Upsert', resourceBody: { id: idFor('ent', path), pk, kind: 'entity', path, coll: collOf(path), entityType, rev, data: entityData, updatedAt: now } })
    ops.push({ operationType: 'Create', resourceBody: { id: auditId(), pk, kind: 'audit', entityPath: path, entityType, op, actor, rev, at: now } })
    ops.push({ operationType: 'Upsert', resourceBody: { id: idFor('ver', `${path}:${rev}`), pk, kind: 'version', entityPath: path, rev, op, data: op === 'delete' ? null : entityData, actor, at: now } })
    ops.push({ operationType: 'Upsert', resourceBody: { id: idFor('idx', path), pk, kind: 'searchIndex', entityPath: path, entityType, deleted: op === 'delete', text: searchText(data), at: now } })
    return { pk, ops, rev }
  }
}

// ─── reads (any authenticated role) ──────────────────────────────────────────
router.get('/get', requireAuth, async (req, res) => {
  const ent = await readEntity(req.query.path)
  res.json({ data: ent ? ent.data : null })
})

router.post('/list', requireAuth, async (req, res) => {
  const { path, query } = req.body || {}
  const params = [{ name: '@coll', value: String(path || '') }]
  let where = "c.kind = 'entity' AND c.coll = @coll"
  const opMap = { '==': '=', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' }
  ;(query?.where || []).forEach((w, i) => {
    const p = `@w${i}`
    params.push({ name: p, value: w.value })
    if (w.op === 'array-contains') where += ` AND ARRAY_CONTAINS(c.data.${w.field}, ${p})`
    else where += ` AND c.data.${w.field} ${opMap[w.op] || '='} ${p}`
  })
  let sql = `SELECT c.data FROM c WHERE ${where}`
  ;(query?.orderBy || []).forEach((o, i) => { sql += `${i === 0 ? ' ORDER BY' : ','} c.data.${o.field} ${(o.dir || 'asc').toUpperCase()}` })
  const limit = Math.min(query?.limit || MAX_LIST, MAX_LIST)
  const { resources } = await docs.items.query({ query: sql, parameters: params }, { maxItemCount: limit }).fetchAll()
  res.json({ data: resources.slice(0, limit).map((r) => r.data) })
})

// ─── mutations (EDITOR or ADMIN — VIEWER is read-only) ───────────────────────
router.post('/mutate', requireRole('EDITOR'), async (req, res) => {
  const payload = (req.body || {}).payload || req.body
  const actor = { uid: req.user.uid, name: req.user.name } // server-derived, never client-supplied
  try {
    const { pk, ops, rev } = await envelopeOps(payload, actor)()
    const r = await docs.items.batch(ops, pk)
    if (r.result?.some((o) => o.statusCode >= 400)) return res.status(500).json({ error: 'batch_failed', detail: r.result })
    res.json({ ok: true, rev })
  } catch (e) {
    if (e.code === 'CONFLICT') return res.status(409).json({ error: 'conflict' })
    res.status(500).json({ error: 'mutate_failed', detail: String(e.message || e) })
  }
})

router.post('/mutateBatch', requireRole('EDITOR'), async (req, res) => {
  const payloads = (req.body || {}).payloads || []
  const actor = { uid: req.user.uid, name: req.user.name }
  try {
    // Group by partition; chunk each group so a batch never exceeds the 100-op limit.
    const byPk = new Map()
    for (const p of payloads) {
      const built = await envelopeOps(p, actor)()
      if (!byPk.has(built.pk)) byPk.set(built.pk, [])
      byPk.get(built.pk).push(built.ops)
    }
    for (const [pk, opsList] of byPk) {
      let chunk = []
      for (const ops of opsList) {
        if (chunk.length + ops.length > BATCH_OPS) { await docs.items.batch(chunk, pk); chunk = [] }
        chunk.push(...ops)
      }
      if (chunk.length) await docs.items.batch(chunk, pk)
    }
    res.json({ ok: true, count: payloads.length })
  } catch (e) {
    if (e.code === 'CONFLICT') return res.status(409).json({ error: 'conflict' })
    res.status(500).json({ error: 'batch_failed', detail: String(e.message || e) })
  }
})

// ─── narrow un-audited writes ────────────────────────────────────────────────
// VIEWER-allowed vote: arrayUnion uid + count++ (matches the old votes-only rule).
router.post('/vote', requireAuth, async (req, res) => {
  const { path } = req.body || {}
  const uid = req.user.uid
  const ent = await readEntity(path)
  if (!ent) return res.status(404).json({ error: 'not_found' })
  const votes = ent.data.votes || { voters: [], count: 0 }
  if (!votes.voters.includes(uid)) { votes.voters = [...votes.voters, uid]; votes.count = (votes.count || 0) + 1 }
  ent.data.votes = votes
  await docs.item(idFor('ent', path), pkFor(path)).replace(ent)
  res.json({ ok: true, count: votes.count })
})

// Owner-only news pins (per-user, un-enveloped, merges).
router.post('/setNewsPins', requireAuth, async (req, res) => {
  const { uid, pinnedHashes } = req.body || {}
  if (uid !== req.user.uid) return res.status(403).json({ error: 'forbidden' })
  const path = `newsPrefs/${uid}`
  const existing = await readEntity(path)
  const data = { ...(existing?.data || {}), pinnedHashes: pinnedHashes || [] }
  await docs.items.upsert({ id: idFor('ent', path), pk: pkFor(path), kind: 'entity', path, coll: collOf(path), entityType: 'newsPrefs', rev: (existing?.rev ?? 0) + 1, data, updatedAt: new Date().toISOString() })
  res.json({ ok: true })
})

// ─── presence (heartbeat; TTL container auto-expires) ────────────────────────
router.post('/presence/join', requireAuth, async (req, res) => {
  const { pid } = req.body || {}
  await presence.items.upsert({ id: `${pid}:${req.user.uid}`, pid, uid: req.user.uid, name: req.user.name, at: Date.now() })
  res.json({ ok: true })
})
router.post('/presence/watch', requireAuth, async (req, res) => {
  const { pid } = req.body || {}
  const { resources } = await presence.items.query({ query: 'SELECT c.uid FROM c WHERE c.pid = @pid', parameters: [{ name: '@pid', value: pid }] }).fetchAll()
  res.json({ viewers: [...new Set(resources.map((r) => r.uid))] })
})

module.exports = router
