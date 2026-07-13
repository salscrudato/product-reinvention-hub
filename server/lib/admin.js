'use strict'
// admin.js — /api/admin/* : PLATFORM administration (SUPER_ADMIN and SUPPORT only).
//
// These routes operate ACROSS tenants. TENANT_ADMIN users do not reach this router;
// they use /api/tenant-admin/* (tenant-admin.js) for within-org operations.
//
// Tenant + user records are PLATFORM records: they live in the docs container under
// pk='__system__' so the tenant-scoped data layer never sees them and no tenant can
// read another's users. Only platform-plane roles (SUPER_ADMIN, SUPPORT) reach here.
//
// Impersonation (POST /api/admin/impersonate) is gated to platform:impersonate.
// SUPER_ADMIN additionally has platform:tenants and platform:users for global CRUD.

const express = require('express')
const { docs } = require('./cosmos')
const { requireAuth, MANAGED_TENANT_ROLES, findUser, signImpersonation } = require('./auth')
const { requirePlatform, CAP_PLATFORM_TENANTS, CAP_PLATFORM_USERS, CAP_PLATFORM_IMPERSONATE, CAP_AUDIT_READ } = require('./authz')

const router = express.Router()

// Gate: ALL /api/admin/* routes require platform-plane membership (SUPER_ADMIN or SUPPORT).
router.use(requirePlatform())

const MAX_PLATFORM = 1000  // bound platform list reads
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const userId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')

// ─── tenants (SUPER_ADMIN only) ──────────────────────────────────────────────
router.get('/tenants', requirePlatform(CAP_PLATFORM_TENANTS), async (_req, res) => {
  const { resources } = await docs.items.query(
    { query: `SELECT TOP ${MAX_PLATFORM} c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'` },
    { maxItemCount: MAX_PLATFORM }
  ).fetchAll()
  res.json({ tenants: resources.map((r) => r.data).sort((a, b) => a.name.localeCompare(b.name)) })
})

router.post('/tenants', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const { id, name } = req.body || {}
  const tid = slug(id || name)
  if (!tid) return res.status(400).json({ error: 'tenant_id_required' })
  const data = { tenantId: tid, name: name || tid, createdAt: new Date().toISOString(), createdBy: req.user.uid }
  await docs.items.upsert({ id: `tenant:${tid}`, pk: '__system__', kind: 'tenant', data })
  res.json({ ok: true, tenant: data })
})

router.delete('/tenants/:id', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  try { await docs.item(`tenant:${slug(req.params.id)}`, '__system__').delete() } catch { /* idempotent */ }
  res.json({ ok: true })
})

// ─── users (SUPER_ADMIN only) ─────────────────────────────────────────────────
router.get('/users', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || MAX_PLATFORM, MAX_PLATFORM)
  const after = req.query.after ? String(req.query.after).toLowerCase() : null
  let query = `SELECT TOP ${limit} c.data FROM c WHERE c.pk='__system__' AND c.kind='user'`
  const params = []
  if (after) {
    query += ' AND c.data.username > @after'
    params.push({ name: '@after', value: after })
  }
  query += ' ORDER BY c.data.username'
  const { resources } = await docs.items.query({ query, parameters: params }, { maxItemCount: limit }).fetchAll()
  res.json({
    users: resources.map((r) => { const { password, ...safe } = r.data; return safe }),
    hasMore: resources.length === limit,
  })
})

router.post('/users', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  const { username, password, role, tenants, email, name } = req.body || {}
  const u = userId(username)
  if (!u) return res.status(400).json({ error: 'username_required' })
  if (!MANAGED_TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role', valid: MANAGED_TENANT_ROLES })
  if (tenants !== '*' && !Array.isArray(tenants)) return res.status(400).json({ error: 'tenants_must_be_array_or_star' })
  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  const data = {
    username: u, role,
    tenants: tenants ?? [],
    email: email || `${u}@prodhub.local`,
    name: name || u,
    password: password || existing?.data?.password || u,
  }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data })
  const { password: _p, ...safe } = data
  res.json({ ok: true, user: safe })
})

router.delete('/users/:username', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  try { await docs.item(`user:${userId(req.params.username)}`, '__system__').delete() } catch { /* idempotent */ }
  res.json({ ok: true })
})

// ─── impersonation (platform:impersonate — SUPER_ADMIN and SUPPORT) ──────────
// Creates a short-lived (1 h) token that carries the target user's tenant-plane role.
// Dual-attributed: every audit record written during the impersonation session will
// contain both the real actor (the SUPPORT user) and the impersonated subject.
// No path can grant a platform role through this endpoint (signImpersonation throws).
router.post('/impersonate', requirePlatform(CAP_PLATFORM_IMPERSONATE), async (req, res) => {
  const { targetUid, tenantId, reason } = req.body || {}
  if (!targetUid || !tenantId) return res.status(400).json({ error: 'targetUid_and_tenantId_required' })
  if (!reason) return res.status(400).json({ error: 'reason_required', detail: 'Impersonation requires a stated reason for audit.' })

  const targetUser = await findUser(targetUid)
  if (!targetUser) return res.status(404).json({ error: 'user_not_found' })
  // Verify the target belongs to the requested tenant
  const tenants = targetUser.tenants
  if (tenants !== '*' && Array.isArray(tenants) && !tenants.includes(tenantId)) {
    return res.status(403).json({ error: 'user_not_in_tenant' })
  }

  try {
    const result = signImpersonation(targetUser, { uid: req.user.uid, name: req.user.name, email: req.user.email }, tenantId)
    // Write an immutable audit record in __system__ for the impersonation event.
    const { docs: sysDocs } = require('./cosmos')
    const crypto = require('crypto')
    await sysDocs.items.create({
      id: `impersonateAudit:${Date.now().toString(36)}-${crypto.randomUUID()}`,
      pk: '__system__', kind: 'impersonateAudit',
      actor: { uid: req.user.uid, name: req.user.name, email: req.user.email },
      targetUid: targetUser.username,
      targetRole: targetUser.role,
      tenantId, reason,
      at: new Date().toISOString(),
      expiresAt: result.expiresAt,
    })
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: 'impersonation_refused', detail: String(e.message) })
  }
})

module.exports = router
