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
// Every mutation on this router writes an append-only platformAudit record
// (pk='__system__', kind='platformAudit') — tenant create/update/delete, user
// create/update/delete, impersonation.
//
// SUPER_ADMIN cross-tenant data access is via the X-Tenant-Id session override
// (auth.js); every resulting data change is recorded in that tenant's audit log.

const express = require('express')
const crypto = require('crypto')
const { docs, presence, resolveTenantStore } = require('./cosmos')
const { MANAGED_TENANT_ROLES, findUser, signImpersonation, normalizeRole } = require('./auth')
const { requirePlatform, CAP_PLATFORM_TENANTS, CAP_PLATFORM_USERS, CAP_PLATFORM_IMPERSONATE, CAP_PLATFORM_AUDIT } = require('./authz')
const platformConfig = require('./platform-config')
const metering = require('./metering')

const router = express.Router()

// Gate: ALL /api/admin/* routes require platform-plane membership (SUPER_ADMIN or SUPPORT).
router.use(requirePlatform())

const PAGE_MAX = 200            // hard cap per page on every platform list read
const AUDIT_PAGE_MAX = 200
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const userId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')
const clampInt = (v, def, max) => Math.min(Math.max(parseInt(v, 10) || def, 1), max)

// ─── platform audit (append-only, fail-open) ─────────────────────────────────
async function platformAudit(action, actor, detail) {
  try {
    await docs.items.create({
      id: `platformAudit:${Date.now().toString(36)}-${crypto.randomUUID()}`,
      pk: '__system__', kind: 'platformAudit',
      action,
      actor: { uid: actor.uid, name: actor.name || actor.uid, ...(actor._impersonatedBy ? { impersonatedBy: actor._impersonatedBy } : {}) },
      detail: detail || {},
      at: new Date().toISOString(),
    })
  } catch { /* fail-open: the admin operation itself already succeeded */ }
}

// ─── tenants (SUPER_ADMIN only) ──────────────────────────────────────────────
// Searchable + cursor-paginated: ?q= substring on id/name, ?after=<tenantId>,
// ?limit (<= PAGE_MAX). Alphabetical by tenantId for a stable cursor.
router.get('/tenants', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const limit = clampInt(req.query.limit, PAGE_MAX, PAGE_MAX)
  const q = String(req.query.q || '').trim().toLowerCase()
  const after = req.query.after ? String(req.query.after).toLowerCase() : null
  let query = `SELECT TOP ${limit} c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'`
  const params = []
  if (q) { query += " AND (CONTAINS(LOWER(c.data.name), @q) OR CONTAINS(c.data.tenantId, @q))"; params.push({ name: '@q', value: q }) }
  if (after) { query += ' AND c.data.tenantId > @after'; params.push({ name: '@after', value: after }) }
  query += ' ORDER BY c.data.tenantId'
  const { resources } = await docs.items.query({ query, parameters: params }, { maxItemCount: limit }).fetchAll()
  res.json({ tenants: resources.map((r) => r.data), hasMore: resources.length === limit })
})

// Lazy mutateInternal (data.js) — deferred to avoid a require cycle at module init
// (data.js and admin.js are both loaded by server.js). Used only to seed a provisioned
// tenant's starter workspace through the SAME atomic, audited, correctly-partitioned envelope.
function getMutateInternal() { return require('./data').mutateInternal }

// A minimal, correctly-partitioned starter workspace: one draft product so a freshly
// provisioned tenant is non-empty and demonstrable. Written through the tenant's mutate
// envelope (pk = `${tid}|products`), so it is atomic + audited + tenant-isolated like any
// other write — never a bare data-store insert.
async function seedStarterWorkspace(tid, actor) {
  const mutateInternal = getMutateInternal()
  await mutateInternal(tid, {
    op: 'create',
    path: 'products/getting-started',
    entityType: 'product',
    data: {
      refId: `${tid.toUpperCase()}.PROD.001`,
      name: 'Getting Started',
      lob: { refId: 'PH', name: 'Personal Home' },
      description: 'Starter product created at provisioning. Edit or delete it once your first real product is imported.',
      lifecycleState: 'draft',
      states: [], allStates: false,
    },
  }, actor, '/api/admin/tenants:provision')
}

// Provision a new tenant (SUPER_ADMIN). Creates the tenant record with default
// entitlements, optionally the first TENANT_ADMIN, and optionally a starter workspace.
// Everything is correctly partitioned (the workspace goes through the tenant's mutate
// envelope) and every step is append-only audited.
router.post('/tenants', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const { id, name, adminEmail, adminUsername, adminPassword, workspace } = req.body || {}
  const tid = slug(id || name)
  if (!tid) return res.status(400).json({ error: 'tenant_id_required' })
  if (tid === '__system__' || tid === 'default') return res.status(400).json({ error: 'reserved_tenant_id', tenantId: tid })
  const seedMode = workspace === 'blank' ? 'blank' : 'starter'
  const existing = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (existing) return res.status(409).json({ error: 'tenant_exists', tenantId: tid })

  const data = {
    tenantId: tid, name: name || tid, status: 'active',
    createdAt: new Date().toISOString(), createdBy: req.user.uid,
    // Default entitlements at provision time so quotas/budget apply from t0.
    config: { entitlements: platformConfig.DEFAULT_ENTITLEMENTS },
  }
  await docs.items.upsert({ id: `tenant:${tid}`, pk: '__system__', kind: 'tenant', data })
  await platformAudit('tenant:provision', req.user, { tenantId: tid, name: data.name, workspace: seedMode })

  // First TENANT_ADMIN (optional). A platform record in __system__; role is fixed to
  // TENANT_ADMIN so the first admin can immediately manage their own org.
  let admin = null
  const uRaw = adminUsername || (adminEmail ? String(adminEmail).split('@')[0] : '')
  const u = userId(uRaw)
  if (u) {
    const existingUser = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
    const tenants = existingUser?.data?.tenants
    const tenantList = Array.isArray(tenants) ? (tenants.includes(tid) ? tenants : [...tenants, tid]) : [tid]
    const adminData = {
      username: u, role: 'TENANT_ADMIN', tenants: tenantList,
      email: adminEmail || existingUser?.data?.email || `${u}@${tid}.local`,
      name: existingUser?.data?.name || u,
      disabled: false,
      password: adminPassword || existingUser?.data?.password || u,
    }
    await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data: adminData })
    await platformAudit('tenant:admin_provision', req.user, { tenantId: tid, username: u, role: 'TENANT_ADMIN' })
    const { password: _p, ...safe } = adminData
    admin = safe
  }

  // Starter workspace (default) — one draft product, correctly partitioned + audited.
  let seeded = false
  if (seedMode === 'starter') {
    try { await seedStarterWorkspace(tid, { uid: req.user.uid, name: req.user.name }); seeded = true }
    catch (e) { console.warn('[admin] starter workspace seed failed:', e.message) }
  }

  res.json({ ok: true, tenant: data, admin, workspace: seedMode, seeded })
})

// Configure a tenant: rename and/or suspend/reactivate.
router.patch('/tenants/:id', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const { name, status } = req.body || {}
  if (status !== undefined && !['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'invalid_status', valid: ['active', 'suspended'] })
  }
  const existing = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) return res.status(404).json({ error: 'tenant_not_found' })
  const before = { name: existing.data.name, status: existing.data.status || 'active' }
  const data = { ...existing.data }
  if (name !== undefined && String(name).trim()) data.name = String(name).trim()
  if (status !== undefined) data.status = status
  data.updatedAt = new Date().toISOString()
  data.updatedBy = req.user.uid
  await docs.items.upsert({ id: `tenant:${tid}`, pk: '__system__', kind: 'tenant', data })
  await platformAudit('tenant:update', req.user, { tenantId: tid, before, after: { name: data.name, status: data.status } })
  res.json({ ok: true, tenant: data })
})

router.delete('/tenants/:id', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  try { await docs.item(`tenant:${tid}`, '__system__').delete() } catch { /* idempotent */ }
  await platformAudit('tenant:delete', req.user, { tenantId: tid })
  res.json({ ok: true })
})

// Per-tenant drill-down: user count, entity counts by type, recent activity.
// Read-only, bounded (GROUP BY aggregation + TOP 15 activity), tenant-scoped via
// the SILO_READY store seam + c.tenantId filter (isolation re-checked per read).
router.get('/tenants/:id/summary', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!tenantDoc) return res.status(404).json({ error: 'tenant_not_found' })
  const store = resolveTenantStore(tid).docs
  const [userCountRes, entityCountsRes, activityRes] = await Promise.all([
    docs.items.query({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.pk='__system__' AND c.kind='user' AND (ARRAY_CONTAINS(c.data.tenants, @tid) OR c.data.tenants='*')",
      parameters: [{ name: '@tid', value: tid }],
    }).fetchAll(),
    store.items.query({
      query: "SELECT c.entityType, COUNT(1) AS cnt FROM c WHERE c.tenantId=@tid AND c.kind='entity' GROUP BY c.entityType",
      parameters: [{ name: '@tid', value: tid }],
    }).fetchAll(),
    store.items.query({
      query: "SELECT TOP 15 c.op, c.entityType, c.entityPath, c.actor, c.at FROM c WHERE c.tenantId=@tid AND c.kind='audit' ORDER BY c.at DESC",
      parameters: [{ name: '@tid', value: tid }],
    }).fetchAll(),
  ])
  const entityCounts = {}
  for (const r of entityCountsRes.resources) if (r.entityType) entityCounts[r.entityType] = r.cnt
  res.json({
    tenant: tenantDoc.data,
    userCount: userCountRes.resources[0] ?? 0,
    entityCounts,
    recentActivity: activityRes.resources,
  })
})

// ─── offboarding: export bundle + partition-scoped hard delete ───────────────
// A tenant's domain data lives in `${tid}|<base>` partitions of the pooled docs
// container. Every such doc carries a top-level `tenantId` (defense-in-depth), so a
// single `c.tenantId = @tid` query returns EXACTLY this tenant's docs and NOTHING from
// any other partition. Deletes target (id, pk) drawn from that filtered set, so the
// blast radius is provably one tenant. The tenant __system__ record + presence rows are
// handled explicitly; users are DETACHED (not deleted — they may belong to other orgs).
const OFFBOARD_PAGE = 1000
const OFFBOARD_MAX = 200_000 // safety backstop; logged if hit

// Partition-scoped hard delete of a tenant's data store. The ONLY docs it can ever touch
// are those returned by `WHERE c.tenantId = @tid` — Cosmos applies that filter, so no other
// tenant's partition is reachable — and each delete targets the (id, pk) OF A ROW IN THAT
// FILTERED SET. Re-queries from the start each sweep (deletes invalidate continuation
// tokens) until a query returns nothing. Injectable `store` so the isolation invariant is
// unit-testable without Cosmos. Returns the number of docs deleted.
async function deleteTenantData(store, tid) {
  let deleted = 0
  let guard = 0
  for (;;) {
    const it = store.items.query(
      { query: 'SELECT c.id, c.pk FROM c WHERE c.tenantId = @tid', parameters: [{ name: '@tid', value: tid }] },
      { maxItemCount: OFFBOARD_PAGE },
    )
    const page = await it.fetchNext()
    const rows = page.resources || []
    if (rows.length === 0) break
    for (const row of rows) {
      try { await store.item(row.id, row.pk).delete(); deleted++ }
      catch (e) { if (Number(e?.code) !== 404) throw e }
    }
    if (++guard > OFFBOARD_MAX / OFFBOARD_PAGE + 5) { console.warn('[admin] offboard guard hit for', tid); break }
  }
  return deleted
}

// Build a complete export bundle (all tenant docs + the tenant record + member list) and
// a SHA-256 content hash over a canonical serialization, so an offboard can name exactly
// what it exported before deleting. Read-only.
async function buildExportBundle(tid) {
  const store = resolveTenantStore(tid).docs
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  const all = []
  let cursor = null
  do {
    const it = store.items.query(
      { query: 'SELECT * FROM c WHERE c.tenantId = @tid', parameters: [{ name: '@tid', value: tid }] },
      { maxItemCount: OFFBOARD_PAGE, continuationToken: cursor || undefined },
    )
    const page = await it.fetchNext()
    for (const r of page.resources) all.push(r)
    cursor = page.continuationToken || null
    if (all.length > OFFBOARD_MAX) break
  } while (cursor)
  const { resources: members } = await docs.items.query({
    query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='user' AND ARRAY_CONTAINS(c.data.tenants, @tid)",
    parameters: [{ name: '@tid', value: tid }],
  }).fetchAll()
  const byKind = {}
  for (const d of all) byKind[d.kind] = (byKind[d.kind] || 0) + 1
  const bundle = {
    tenantId: tid,
    exportedAt: new Date().toISOString(),
    tenant: tenantDoc ? tenantDoc.data : null,
    members: members.map((m) => { const { password, ...safe } = m.data; return safe }),
    docs: all,
    manifest: { totalDocs: all.length, byKind, memberCount: members.length },
  }
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ tid, manifest: bundle.manifest, ids: all.map((d) => d.id).sort() }))
    .digest('hex')
  bundle.manifest.contentHash = hash
  return bundle
}

// GET the export bundle so an operator can VERIFY it before offboarding. Read-only, no delete.
router.get('/tenants/:id/export', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!tenantDoc) return res.status(404).json({ error: 'tenant_not_found' })
  const bundle = await buildExportBundle(tid)
  await platformAudit('tenant:export', req.user, { tenantId: tid, manifest: bundle.manifest })
  // Return the manifest always; the full doc payload only when explicitly requested
  // (?full=1) — a large tenant's bundle should stream to blob in production.
  if (String(req.query.full || '') === '1') return res.json({ ok: true, bundle })
  const { docs: _omit, ...manifestOnly } = bundle
  res.json({ ok: true, bundle: { ...manifestOnly, docsIncluded: false } })
})

// Offboard: confirmation-gated. Builds the export manifest, then partition-scoped hard
// delete. Requires body.confirm === tenantId (a typo can never erase the wrong tenant).
router.post('/tenants/:id/offboard', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const confirm = String((req.body || {}).confirm || '')
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!tenantDoc) return res.status(404).json({ error: 'tenant_not_found' })
  if (confirm !== tid) {
    return res.status(400).json({ error: 'confirmation_required', detail: `POST { "confirm": "${tid}" } to offboard this tenant.` })
  }

  // 1) Export manifest (the accountable record of what is being deleted).
  const bundle = await buildExportBundle(tid)

  // 2) Partition-scoped hard delete of the tenant's data store (id, pk both drawn from a
  //    c.tenantId=@tid filtered set — no other partition can be touched).
  const store = resolveTenantStore(tid).docs
  const deletedDocs = await deleteTenantData(store, tid)

  // 3) Presence rows (separate container, keyed by `${tid}:${pid}:${uid}`).
  let deletedPresence = 0
  try {
    const { resources: pres } = await presence.items.query(
      { query: 'SELECT c.id, c.pid FROM c WHERE STARTSWITH(c.pid, @prefix)', parameters: [{ name: '@prefix', value: `${tid}:` }] },
    ).fetchAll()
    for (const p of pres) { try { await presence.item(p.id, p.pid).delete(); deletedPresence++ } catch { /* idempotent */ } }
  } catch { /* presence is best-effort */ }

  // 4) Detach members (users are cross-org platform records — never hard-delete a user who
  //    still belongs to another tenant; a now-orphaned user is disabled).
  let detached = 0
  for (const m of bundle.members) {
    try {
      const u = (await docs.item(`user:${m.username}`, '__system__').read()).resource
      if (!u || !Array.isArray(u.data.tenants)) continue
      const tenants = u.data.tenants.filter((t) => t !== tid)
      await docs.items.upsert({ id: `user:${m.username}`, pk: '__system__', kind: 'user', data: { ...u.data, tenants, disabled: tenants.length === 0 ? true : !!u.data.disabled } })
      detached++
    } catch { /* best-effort */ }
  }

  // 5) The tenant __system__ record itself.
  try { await docs.item(`tenant:${tid}`, '__system__').delete() } catch { /* idempotent */ }

  const result = { tenantId: tid, deletedDocs, deletedPresence, membersDetached: detached, exportManifest: bundle.manifest }
  await platformAudit('tenant:offboard', req.user, result)
  res.json({ ok: true, ...result })
})

// ─── per-tenant + global config (SUPER_ADMIN plane) ──────────────────────────
router.get('/config/global', requirePlatform(CAP_PLATFORM_TENANTS), async (_req, res) => {
  const global = await platformConfig.getGlobalConfig()
  res.json({ ok: true, global, registry: platformConfig.FEATURE_FLAGS })
})

router.put('/config/global', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  try {
    const merged = await platformConfig.setGlobalConfig({ flags: (req.body || {}).flags }, req.user)
    res.json({ ok: true, global: merged })
  } catch (e) {
    if (e.code === 'INVALID_CONFIG') return res.status(400).json({ error: 'invalid_config', detail: e.errors })
    res.status(500).json({ error: 'config_write_failed', detail: String(e.message || e) })
  }
})

router.get('/tenants/:id/config', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!tenantDoc) return res.status(404).json({ error: 'tenant_not_found' })
  const [config, effectiveFlags] = await Promise.all([
    platformConfig.getTenantConfig(tid),
    platformConfig.getEffectiveFlags(tid),
  ])
  res.json({ ok: true, config, effectiveFlags, registry: platformConfig.FEATURE_FLAGS })
})

router.put('/tenants/:id/config', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  try {
    const merged = await platformConfig.setTenantConfig(tid, req.body || {}, 'platform', req.user)
    res.json({ ok: true, config: merged })
  } catch (e) {
    if (e.code === 'INVALID_CONFIG') return res.status(400).json({ error: 'invalid_config', detail: e.errors })
    if (e.code === 'TENANT_NOT_FOUND') return res.status(404).json({ error: 'tenant_not_found' })
    res.status(500).json({ error: 'config_write_failed', detail: String(e.message || e) })
  }
})

// ─── per-tenant telemetry dashboard (real data only) ─────────────────────────
// Seats vs entitlement, products vs entitlement, AI tokens + cost vs monthly budget,
// request count / error rate / latency, successful-login count, and audit-event volume.
// Everything here is observed/queried — no synthetic figures.
router.get('/tenants/:id/telemetry', requirePlatform(CAP_PLATFORM_TENANTS), async (req, res) => {
  const tid = slug(req.params.id)
  const tenantDoc = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!tenantDoc) return res.status(404).json({ error: 'tenant_not_found' })
  const store = resolveTenantStore(tid).docs
  const [seats, products, ai, loginRes, auditRes] = await Promise.all([
    platformConfig.checkSeatQuota(tid),
    platformConfig.checkProductQuota(tid),
    metering.snapshotTenant(tid),
    docs.items.query({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.pk='__system__' AND c.kind='loginAudit' AND c.tenantId=@tid AND c.event='otp_success'",
      parameters: [{ name: '@tid', value: tid }],
    }).fetchAll(),
    store.items.query({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.kind='audit' AND c.tenantId=@tid",
      parameters: [{ name: '@tid', value: tid }],
    }).fetchAll(),
  ])
  const requests = metering.requestSnapshot(tid)
  res.json({
    ok: true,
    tenant: tenantDoc.data,
    telemetry: {
      seats: { used: seats.used, max: seats.max, withinEntitlement: seats.ok },
      products: { used: products.used, max: products.max, withinEntitlement: products.ok },
      ai,
      requests,
      logins: { successfulTotal: loginRes.resources[0] ?? 0 },
      auditEvents: auditRes.resources[0] ?? 0,
    },
  })
})

// ─── users (SUPER_ADMIN only) ─────────────────────────────────────────────────
router.get('/users', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  const limit = clampInt(req.query.limit, PAGE_MAX, PAGE_MAX)
  const q = String(req.query.q || '').trim().toLowerCase()
  const tenant = String(req.query.tenant || '').trim()
  const after = req.query.after ? String(req.query.after).toLowerCase() : null
  let query = `SELECT TOP ${limit} c.data FROM c WHERE c.pk='__system__' AND c.kind='user'`
  const params = []
  if (q) { query += ' AND (CONTAINS(c.data.username, @q) OR CONTAINS(LOWER(c.data.email), @q))'; params.push({ name: '@q', value: q }) }
  if (tenant) { query += " AND (ARRAY_CONTAINS(c.data.tenants, @tenant) OR c.data.tenants='*')"; params.push({ name: '@tenant', value: tenant }) }
  if (after) { query += ' AND c.data.username > @after'; params.push({ name: '@after', value: after }) }
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
  // New users default to the lowest role (VIEWER) unless an explicit managed role is given.
  const effectiveRole = role === undefined || role === null || role === '' ? 'VIEWER' : role
  if (!MANAGED_TENANT_ROLES.includes(effectiveRole)) return res.status(400).json({ error: 'invalid_role', valid: MANAGED_TENANT_ROLES })
  if (tenants !== undefined && tenants !== '*' && !Array.isArray(tenants)) return res.status(400).json({ error: 'tenants_must_be_array_or_star' })
  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  const data = {
    username: u, role: normalizeRole(effectiveRole),
    tenants: tenants ?? existing?.data?.tenants ?? [],
    email: email || existing?.data?.email || `${u}@prodhub.local`,
    name: name || existing?.data?.name || u,
    disabled: existing?.data?.disabled ?? false,
    password: password || existing?.data?.password || u,
  }
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data })
  await platformAudit(existing ? 'user:update' : 'user:create', req.user, { username: u, role: data.role, tenants: data.tenants })
  const { password: _p, ...safe } = data
  res.json({ ok: true, user: safe })
})

// Update a user: change role, disable/enable, reassign tenants, reset password.
router.patch('/users/:username', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  const u = userId(req.params.username)
  const { role, tenants, disabled, password, name, email } = req.body || {}
  const existing = (await docs.item(`user:${u}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) return res.status(404).json({ error: 'user_not_found' })
  if (role !== undefined && !MANAGED_TENANT_ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_role', valid: MANAGED_TENANT_ROLES })
  }
  if (tenants !== undefined && tenants !== '*' && !Array.isArray(tenants)) {
    return res.status(400).json({ error: 'tenants_must_be_array_or_star' })
  }
  const before = { role: normalizeRole(existing.data.role), tenants: existing.data.tenants, disabled: !!existing.data.disabled }
  const data = { ...existing.data }
  if (role !== undefined) data.role = normalizeRole(role)
  if (tenants !== undefined) data.tenants = tenants
  if (disabled !== undefined) data.disabled = !!disabled
  if (password) data.password = String(password)
  if (name !== undefined) data.name = String(name)
  if (email !== undefined) data.email = String(email)
  await docs.items.upsert({ id: `user:${u}`, pk: '__system__', kind: 'user', data })
  await platformAudit('user:update', req.user, {
    username: u, before,
    after: { role: data.role, tenants: data.tenants, disabled: !!data.disabled },
    passwordReset: !!password,
  })
  const { password: _p, ...safe } = data
  res.json({ ok: true, user: safe })
})

router.delete('/users/:username', requirePlatform(CAP_PLATFORM_USERS), async (req, res) => {
  const u = userId(req.params.username)
  try { await docs.item(`user:${u}`, '__system__').delete() } catch { /* idempotent */ }
  await platformAudit('user:delete', req.user, { username: u })
  res.json({ ok: true })
})

// ─── audit viewer (platform:audit — read-only, searchable, paginated) ────────
// POST body (read-only search — body carries filters + a Cosmos continuation
// token that can exceed URL length limits):
//   { source: 'all'|'data'|'platform', tenant?, actor?, entityType?, action?,
//     since?, until?, limit?, cursor? }
// source='all'  (default) → one unified stream: tenant data mutations (kind='audit')
//                           AND platform-plane events (platformAudit/loginAudit/
//                           impersonateAudit). This is EVERY change, including bulk
//                           data seeding, so nothing is hidden behind a source toggle.
// source='data'      → kind='audit' mutation events only (optionally one tenant)
// source='platform'  → __system__ platformAudit + loginAudit + impersonateAudit
router.post('/audit/search', requirePlatform(CAP_PLATFORM_AUDIT), async (req, res) => {
  const b = req.body || {}
  const limit = clampInt(b.limit, 50, AUDIT_PAGE_MAX)
  const source = b.source === 'platform' ? 'platform' : b.source === 'data' ? 'data' : 'all'
  const params = []
  let query
  let container = docs
  if (source === 'platform') {
    query = "SELECT c.id, c.kind, c.action, c.event, c.actor, c.detail, c.tenantId, c.targetUid, c.reason, c.at FROM c WHERE c.pk='__system__' AND c.kind IN ('platformAudit','loginAudit','impersonateAudit')"
    if (b.actor) { query += ' AND (CONTAINS(LOWER(c.actor.uid ?? c.actor ?? ""), @actor) OR CONTAINS(LOWER(c.actor.name ?? ""), @actor))'; params.push({ name: '@actor', value: String(b.actor).toLowerCase() }) }
    if (b.action) { query += ' AND (c.action = @action OR c.event = @action)'; params.push({ name: '@action', value: String(b.action) }) }
    if (b.tenant) { query += ' AND (c.tenantId = @tenant OR c.detail.tenantId = @tenant)'; params.push({ name: '@tenant', value: String(b.tenant) }) }
  } else if (source === 'data') {
    query = "SELECT c.id, c.kind, c.op, c.entityType, c.entityPath, c.actor, c.tenantId, c.rev, c.at FROM c WHERE c.kind='audit'"
    if (b.tenant) {
      container = resolveTenantStore(String(b.tenant)).docs  // SILO_READY seam — isolation follows the store
      query += ' AND c.tenantId = @tenant'; params.push({ name: '@tenant', value: String(b.tenant) })
    }
    if (b.actor) { query += ' AND (CONTAINS(LOWER(c.actor.uid ?? ""), @actor) OR CONTAINS(LOWER(c.actor.name ?? ""), @actor))'; params.push({ name: '@actor', value: String(b.actor).toLowerCase() }) }
    if (b.entityType) { query += ' AND c.entityType = @etype'; params.push({ name: '@etype', value: String(b.entityType) }) }
    if (b.action) { query += ' AND c.op = @action'; params.push({ name: '@action', value: String(b.action) }) }
  } else {
    // Unified stream over the pooled container: data mutations live in tenant
    // partitions, platform events under __system__ — a single cross-partition,
    // c.at-ordered query returns them interleaved. Filters match either shape.
    query = "SELECT c.id, c.kind, c.op, c.action, c.event, c.entityType, c.entityPath, c.actor, c.tenantId, c.detail, c.targetUid, c.reason, c.rev, c.at FROM c WHERE c.kind IN ('audit','platformAudit','loginAudit','impersonateAudit')"
    if (b.actor) { query += ' AND (CONTAINS(LOWER(c.actor.uid ?? c.actor ?? ""), @actor) OR CONTAINS(LOWER(c.actor.name ?? ""), @actor))'; params.push({ name: '@actor', value: String(b.actor).toLowerCase() }) }
    if (b.action) { query += ' AND (c.op = @action OR c.action = @action OR c.event = @action)'; params.push({ name: '@action', value: String(b.action) }) }
    if (b.tenant) { query += ' AND (c.tenantId = @tenant OR c.detail.tenantId = @tenant)'; params.push({ name: '@tenant', value: String(b.tenant) }) }
    if (b.entityType) { query += ' AND c.entityType = @etype'; params.push({ name: '@etype', value: String(b.entityType) }) }
  }
  if (b.since) { query += ' AND c.at >= @since'; params.push({ name: '@since', value: new Date(b.since).toISOString() }) }
  if (b.until) { query += ' AND c.at <= @until'; params.push({ name: '@until', value: new Date(b.until).toISOString() }) }
  query += ' ORDER BY c.at DESC'
  const iterator = container.items.query(
    { query, parameters: params },
    { maxItemCount: limit, continuationToken: b.cursor || undefined }
  )
  const page = await iterator.fetchNext()
  res.json({ events: page.resources, cursor: page.continuationToken || null, hasMore: !!page.continuationToken })
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
    await docs.items.create({
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

// _internals exposed for deployment-independent unit tests (mirrors portal.js). The
// partition-scoped delete's isolation invariant is proven against an injected mock store.
module.exports = Object.assign(router, { _internals: { deleteTenantData, buildExportBundle } })
