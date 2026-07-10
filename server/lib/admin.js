'use strict'
// admin.js — /api/admin/* : tenant + user management (ADMIN only).
//
// Tenants and users are PLATFORM records, not tenant data: they live in the docs
// container under pk='__system__' so the tenant-scoped data layer never sees them
// and no tenant can read another's users. Only ADMIN reaches these routes.

const express = require('express')
const { docs } = require('./cosmos')
const { requireRole, RANK } = require('./auth')

const router = express.Router()
router.use(requireRole('ADMIN'))

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
// Usernames preserve dots/underscores (e.g. sal.scrudato) so the login identifier
// matches what's stored — only lowercase + strip disallowed chars.
const userId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')

// ─── tenants ─────────────────────────────────────────────────────────────────
router.get('/tenants', async (_req, res) => {
  const { resources } = await docs.items.query({ query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'" }).fetchAll()
  res.json({ tenants: resources.map((r) => r.data).sort((a, b) => a.name.localeCompare(b.name)) })
})
router.post('/tenants', async (req, res) => {
  const { id, name } = req.body || {}
  const tid = slug(id || name)
  if (!tid) return res.status(400).json({ error: 'tenant_id_required' })
  const data = { tenantId: tid, name: name || tid, createdAt: new Date().toISOString(), createdBy: req.user.uid }
  await docs.items.upsert({ id: `tenant:${tid}`, pk: '__system__', kind: 'tenant', data })
  res.json({ ok: true, tenant: data })
})
router.delete('/tenants/:id', async (req, res) => {
  // Removes the tenant record only (its data remains partitioned + orphaned; a hard
  // data purge is a separate, deliberate op). Confirm intent in the UI.
  try { await docs.item(`tenant:${slug(req.params.id)}`, '__system__').delete() } catch { /* idempotent */ }
  res.json({ ok: true })
})

// ─── users ───────────────────────────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  const { resources } = await docs.items.query({ query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='user'" }).fetchAll()
  res.json({ users: resources.map((r) => { const { password, ...safe } = r.data; return safe }) })
})
router.post('/users', async (req, res) => {
  const { username, password, role, tenants, email, name } = req.body || {}
  const u = userId(username)
  if (!u) return res.status(400).json({ error: 'username_required' })
  if (RANK[role] === undefined) return res.status(400).json({ error: 'invalid_role', valid: Object.keys(RANK) })
  if (tenants !== '*' && !Array.isArray(tenants)) return res.status(400).json({ error: 'tenants_must_be_array_or_star' })
  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  const data = {
    username: u, role,
    tenants: tenants ?? [],
    email: email || `${u}@prodhub.local`,
    name: name || u,
    password: password || existing?.data?.password || u, // keep existing on edit; default = username
  }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data })
  const { password: _p, ...safe } = data
  res.json({ ok: true, user: safe })
})
router.delete('/users/:username', async (req, res) => {
  try { await docs.item(`user:${userId(req.params.username)}`, '__system__').delete() } catch { /* idempotent */ }
  res.json({ ok: true })
})

module.exports = router
