'use strict'
// tenant-admin.js — /api/tenant-admin/* : self-service org administration.
//
// Scope: the CALLER'S OWN tenant only. Every route is gated by:
//   requireCapability('member:manage')   — TENANT_ADMIN+ in the capability matrix
//   requireSameTenant()                  — cross-tenant writes are rejected with 403
//
// Audit trail: every member mutation uses mutateInternal() to write an append-only
// AuditEvent + Version record into the tenant's Cosmos partition, alongside a
// mirror entity (kind:'entity', entityType:'member'). The authoritative user
// identity (password, global role) lives in __system__ via docs.items.upsert.
// These are TWO separate writes (not atomic across partitions), which is acceptable
// for administrative operations.
//
// Impersonation context: when the caller is operating under an impersonation token,
// actorFor() attaches both the real actor and the impersonated subject to every audit
// record so the dual-attribution invariant is always met.

const express = require('express')
const { docs } = require('./cosmos')
const { requireAuth, MANAGED_TENANT_ROLES, normalizeRole } = require('./auth')
const { requireCapability, requireSameTenant } = require('./authz')

const router = express.Router()

const MAX_PAGE = 200
const userId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')

// actorFor: builds the audit actor, including impersonation dual-attribution when present.
function actorFor(user) {
  const actor = { uid: user.uid, name: user.name }
  if (user._impersonatedBy) actor.impersonatedBy = user._impersonatedBy
  return actor
}

// Lazy-load mutateInternal from data.js to avoid a circular dependency at module init.
// data.js and tenant-admin.js are both loaded by server.js; the require() is deferred
// to first use (after all modules have initialised).
function getMutateInternal() {
  return require('./data').mutateInternal
}

// Write an append-only member audit record into the tenant's Cosmos partition.
async function auditMemberOp(tid, op, username, data, actor) {
  const mutateInternal = getMutateInternal()
  await mutateInternal(tid, {
    op,
    path: `members/${username}`,
    data: { ...data, username, tenantId: tid },
    entityType: 'member',
    actor,
  }, actor)
}

// ─── requireCapability + requireSameTenant for all routes ───────────────────
router.use(requireCapability('member:manage'))
router.use(requireSameTenant())  // non-SUPER_ADMIN callers locked to their own tenantId

// ─── list members (paginated) ────────────────────────────────────────────────
// Returns members whose tenants array includes the caller's tenantId.
// Supports cursor-based pagination via ?after=<username> (alphabetical order).
router.get('/members', async (req, res) => {
  const tid = req.user.tenantId
  const limit = Math.min(parseInt(req.query.limit, 10) || MAX_PAGE, MAX_PAGE)
  const after = req.query.after ? String(req.query.after).toLowerCase() : null

  let query = `SELECT TOP ${limit} c.data FROM c WHERE c.pk='__system__' AND c.kind='user' AND (ARRAY_CONTAINS(c.data.tenants, @tid) OR c.data.tenants='*')`
  const params = [{ name: '@tid', value: tid }]
  if (after) {
    query += ' AND c.data.username > @after'
    params.push({ name: '@after', value: after })
  }
  query += ' ORDER BY c.data.username'

  const { resources } = await docs.items.query({ query, parameters: params }, { maxItemCount: limit }).fetchAll()
  const members = resources.map(r => { const { password, ...safe } = r.data; return safe })
  res.json({ members, hasMore: members.length === limit })
})

// ─── invite / create member ──────────────────────────────────────────────────
// Creates or updates a user record in __system__ with the caller's tenantId in
// their tenants array, then writes an audited AuditEvent+Version into the tenant partition.
router.post('/members', requireCapability('role:assign'), async (req, res) => {
  const { username, email, name, role, password } = req.body || {}
  const u = userId(username || email?.split('@')[0] || '')
  if (!u) return res.status(400).json({ error: 'username_required' })
  if (!MANAGED_TENANT_ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_role', valid: MANAGED_TENANT_ROLES })
  }
  const tid = req.user.tenantId
  const actor = actorFor(req.user)

  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  const tenants = existing?.data?.tenants
  const tenantList = Array.isArray(tenants)
    ? (tenants.includes(tid) ? tenants : [...tenants, tid])
    : [tid]

  const data = {
    username: u,
    role: normalizeRole(role),
    tenants: tenantList,
    email: email || existing?.data?.email || `${u}@prodhub.local`,
    name: name || existing?.data?.name || u,
    password: password || existing?.data?.password || u,
    invitedBy: actor.uid,
    invitedAt: new Date().toISOString(),
  }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data })
  await auditMemberOp(tid, existing ? 'update' : 'create', u, { role: data.role, email: data.email, name: data.name }, actor)

  const { password: _p, ...safe } = data
  res.json({ ok: true, member: safe })
})

// ─── change role ─────────────────────────────────────────────────────────────
// Changes a member's role within the caller's tenant. Append-only audit.
router.patch('/members/:username/role', requireCapability('role:assign'), async (req, res) => {
  const u = userId(req.params.username)
  const { role } = req.body || {}
  if (!MANAGED_TENANT_ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_role', valid: MANAGED_TENANT_ROLES })
  }
  const tid = req.user.tenantId
  const actor = actorFor(req.user)

  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) return res.status(404).json({ error: 'user_not_found' })
  const tenants = existing.data.tenants
  if (tenants !== '*' && !Array.isArray(tenants) || (Array.isArray(tenants) && !tenants.includes(tid))) {
    return res.status(403).json({ error: 'user_not_in_tenant' })
  }
  const newRole = normalizeRole(role)
  const updated = { ...existing.data, role: newRole }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data: updated })
  await auditMemberOp(tid, 'update', u, { role: newRole, previousRole: normalizeRole(existing.data.role) }, actor)

  res.json({ ok: true, username: u, role: newRole })
})

// ─── remove member ───────────────────────────────────────────────────────────
// Removes the caller's tenantId from the member's tenants array. Does NOT delete
// the user globally — that is a platform-level operation (admin.js DELETE /users/:id).
router.delete('/members/:username', async (req, res) => {
  const u = userId(req.params.username)
  const tid = req.user.tenantId
  const actor = actorFor(req.user)

  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) return res.status(404).json({ error: 'user_not_found' })
  const tenants = existing.data.tenants
  if (Array.isArray(tenants)) {
    const updated = { ...existing.data, tenants: tenants.filter(t => t !== tid) }
    await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data: updated })
  }
  await auditMemberOp(tid, 'delete', u, { removedFrom: tid, previousRole: normalizeRole(existing.data.role) }, actor)

  res.json({ ok: true })
})

// ─── list audit trail for this tenant ────────────────────────────────────────
// Returns member audit events (entityType:'member') from the tenant's Cosmos partition.
router.get('/audit', requireCapability('audit:read'), async (req, res) => {
  const tid = req.user.tenantId
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 200)
  const { resolveTenantStore } = require('./cosmos')
  const store = resolveTenantStore(tid).docs
  const sql = `SELECT TOP ${limit} * FROM c WHERE c.kind='audit' AND c.entityType='member' AND c.tenantId=@tid ORDER BY c.at DESC`
  const params = [{ name: '@tid', value: tid }]
  const { resources } = await store.items.query({ query: sql, parameters: params }, { maxItemCount: limit }).fetchAll()
  res.json({ events: resources })
})

module.exports = router
