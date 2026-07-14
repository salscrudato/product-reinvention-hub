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
const platformConfig = require('./platform-config')

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
  }, actor, '/api/tenant-admin/members')
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
  const alreadyInTenant = tenants === '*' || (Array.isArray(tenants) && tenants.includes(tid))
  // Per-tenant SEAT quota: adding a NEW member consumes a seat. An existing member being
  // updated does not. Server-enforced against the tenant's effective entitlements.
  if (!alreadyInTenant) {
    const seat = await platformConfig.checkSeatQuota(tid)
    if (!seat.ok) return res.status(403).json({ error: 'seat_quota_exceeded', used: seat.used, max: seat.max })
  }
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

// ─── disable / enable member ─────────────────────────────────────────────────
// Disabling blocks the member's next login (enforced at OTP verify); existing
// sessions expire at the 8 h JWT TTL. Append-only audit in the tenant partition.
router.patch('/members/:username/disabled', requireCapability('role:assign'), async (req, res) => {
  const u = userId(req.params.username)
  const disabled = !!(req.body || {}).disabled
  const tid = req.user.tenantId
  const actor = actorFor(req.user)

  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) return res.status(404).json({ error: 'user_not_found' })
  const tenants = existing.data.tenants
  if (tenants !== '*' && (!Array.isArray(tenants) || !tenants.includes(tid))) {
    return res.status(403).json({ error: 'user_not_in_tenant' })
  }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data: { ...existing.data, disabled } })
  await auditMemberOp(tid, 'update', u, { disabled, previousDisabled: !!existing.data.disabled }, actor)

  res.json({ ok: true, username: u, disabled })
})

// ─── audit trail for this tenant (read-only, searchable, paginated) ──────────
// ALL of the tenant's mutation audit events (products, coverages, members, …),
// filterable by entityType / actor / action / since, cursor-paginated via a
// Cosmos continuation token. Scope is ALWAYS the caller's own tenant.
router.get('/audit', requireCapability('audit:read'), async (req, res) => {
  const tid = req.user.tenantId
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const { resolveTenantStore } = require('./cosmos')
  const store = resolveTenantStore(tid).docs
  let sql = "SELECT c.id, c.op, c.entityType, c.entityPath, c.actor, c.rev, c.at FROM c WHERE c.kind='audit' AND c.tenantId=@tid"
  const params = [{ name: '@tid', value: tid }]
  if (req.query.entityType) { sql += ' AND c.entityType = @etype'; params.push({ name: '@etype', value: String(req.query.entityType) }) }
  if (req.query.action) { sql += ' AND c.op = @op'; params.push({ name: '@op', value: String(req.query.action) }) }
  if (req.query.actor) { sql += " AND (CONTAINS(LOWER(c.actor.uid ?? ''), @actor) OR CONTAINS(LOWER(c.actor.name ?? ''), @actor))"; params.push({ name: '@actor', value: String(req.query.actor).toLowerCase() }) }
  if (req.query.since) { sql += ' AND c.at >= @since'; params.push({ name: '@since', value: new Date(String(req.query.since)).toISOString() }) }
  sql += ' ORDER BY c.at DESC'
  const iterator = store.items.query(
    { query: sql, parameters: params },
    { maxItemCount: limit, continuationToken: req.query.cursor ? String(req.query.cursor) : undefined }
  )
  const page = await iterator.fetchNext()
  res.json({ events: page.resources, cursor: page.continuationToken || null, hasMore: !!page.continuationToken })
})

// ─── per-tenant config: read + feature-flag overrides (within the platform allowlist) ──
// A TENANT_ADMIN may override ONLY tenantOverridable flags, and only for their own org
// (requireSameTenant is applied router-wide). Entitlements + branding accent are platform-set
// and rejected here by the 'tenant' plane in validateConfigPatch. Schema-validated + audited.
router.get('/config', async (req, res) => {
  const tid = req.user.tenantId
  const [config, effectiveFlags] = await Promise.all([
    platformConfig.getTenantConfig(tid),
    platformConfig.getEffectiveFlags(tid),
  ])
  res.json({
    ok: true,
    config,
    effectiveFlags,
    // The subset a tenant admin is allowed to toggle (the platform allowlist).
    overridableKeys: platformConfig.TENANT_OVERRIDABLE_KEYS,
    registry: platformConfig.FEATURE_FLAGS,
  })
})

router.put('/flags', requireCapability('role:assign'), async (req, res) => {
  const tid = req.user.tenantId
  try {
    const merged = await platformConfig.setTenantConfig(tid, { flags: (req.body || {}).flags }, 'tenant', {
      uid: req.user.uid, name: req.user.name, ...(req.user._impersonatedBy ? { _impersonatedBy: req.user._impersonatedBy } : {}),
    })
    res.json({ ok: true, config: merged })
  } catch (e) {
    if (e.code === 'INVALID_CONFIG') return res.status(400).json({ error: 'invalid_config', detail: e.errors })
    if (e.code === 'TENANT_NOT_FOUND') return res.status(404).json({ error: 'tenant_not_found' })
    res.status(500).json({ error: 'config_write_failed', detail: String(e.message || e) })
  }
})

module.exports = router
