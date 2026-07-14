'use strict'
// platform-config.js — per-tenant + global platform configuration (server side).
//
// The SAME feature-flag registry + config validators the app uses (shared/src/platform,
// bundled to platform-shared.cjs) drive server-side enforcement here. This module owns:
//   • storage   — global flag defaults live in a __system__ doc (kind:'platformConfig');
//                 per-tenant config rides on the tenant record's data.config (admin.js).
//   • cache     — in-process, TTL + explicit fast-invalidate on every write (App Service
//                 is single-instance, so a write here invalidates the only reader).
//   • reads     — getGlobalConfig / getTenantConfig / getEffectiveFlags / getEffectiveEntitlements.
//   • writes    — setGlobalConfig / setTenantConfig (schema-validated, append-only audited).
//   • middleware— requireFlag(key): server-side route enforcement (the client hides nav;
//                 THIS is the authoritative deny). Fail-OPEN on infra error (a flag is a
//                 management convenience, never a security boundary — the capability gates
//                 in authz.js are the security boundary), but honor an explicit `false`.
//
// Every mutating write records an append-only platformAudit event (same kind the unified
// audit viewer streams), so config + lifecycle changes are always in the audit trail.

const crypto = require('crypto')
const pf = require('./platform-shared.cjs')

// ─── Cosmos handle (lazy — never throws at require time) ─────────────────────
function sysDocs() {
  try { return require('./cosmos').docs } catch { return null }
}
function resolveTenant(user) {
  try { return require('./auth').resolveTenantForPrincipal(user) } catch { return (user && user.tenantId) || 'default' }
}

const GLOBAL_ID = 'platformConfig:global'
const CACHE_TTL_MS = 30_000

// ─── append-only audit (fail-open; the config write itself already succeeded) ──
async function configAudit(action, actor, detail) {
  const docs = sysDocs()
  if (!docs) return
  try {
    await docs.items.create({
      id: `platformAudit:${Date.now().toString(36)}-${crypto.randomUUID()}`,
      pk: '__system__', kind: 'platformAudit',
      action,
      actor: { uid: actor.uid, name: actor.name || actor.uid, ...(actor._impersonatedBy ? { impersonatedBy: actor._impersonatedBy } : {}) },
      detail: detail || {},
      at: new Date().toISOString(),
    })
  } catch { /* fail-open */ }
}

// ─── global config ───────────────────────────────────────────────────────────
let _globalCache = null // { value:{flags}, at }
function invalidateGlobal() { _globalCache = null }

async function readGlobal() {
  const docs = sysDocs()
  if (!docs) return { flags: {} }
  try {
    const r = (await docs.item(GLOBAL_ID, '__system__').read().catch(() => ({ resource: null }))).resource
    const flags = (r && r.data && r.data.flags && typeof r.data.flags === 'object') ? r.data.flags : {}
    return { flags }
  } catch { return { flags: {} } }
}

async function getGlobalConfig() {
  if (_globalCache && Date.now() - _globalCache.at < CACHE_TTL_MS) return _globalCache.value
  const value = await readGlobal()
  _globalCache = { value, at: Date.now() }
  return value
}

/** SUPER_ADMIN: set the global (platform-wide) flag defaults. Validated + audited. */
async function setGlobalConfig(patch, actor) {
  const res = pf.validateConfigPatch({ flags: patch && patch.flags }, 'platform')
  if (!res.ok) { const e = new Error('invalid_config'); e.code = 'INVALID_CONFIG'; e.errors = res.errors; throw e }
  const docs = sysDocs()
  if (!docs) { const e = new Error('no_store'); e.code = 'NO_STORE'; throw e }
  const cur = await readGlobal()
  const merged = { flags: { ...cur.flags, ...(res.value.flags || {}) } }
  await docs.items.upsert({ id: GLOBAL_ID, pk: '__system__', kind: 'platformConfig', data: { ...merged, updatedAt: new Date().toISOString(), updatedBy: actor.uid } })
  invalidateGlobal()
  await configAudit('config:global:update', actor, { flags: res.value.flags || {} })
  return merged
}

// ─── per-tenant config ─────────────────────────────────────────────────────
const _tenantCache = new Map() // tid -> { value:TenantConfig, at }
function invalidateTenant(tid) { _tenantCache.delete(tid) }

async function readTenantConfig(tid) {
  const docs = sysDocs()
  if (!docs) return {}
  try {
    const r = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
    return (r && r.data && r.data.config && typeof r.data.config === 'object') ? r.data.config : {}
  } catch { return {} }
}

async function getTenantConfig(tid) {
  const hit = _tenantCache.get(tid)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await readTenantConfig(tid)
  _tenantCache.set(tid, { value, at: Date.now() })
  return value
}

/**
 * Write a validated config patch to a tenant.
 *   plane='platform' (SUPER_ADMIN) — branding + entitlements + any flag.
 *   plane='tenant'   (TENANT_ADMIN) — branding text + overridable-flag overrides only.
 * Schema-validated (throws INVALID_CONFIG with .errors), merged onto stored config on the
 * tenant record, cache-invalidated, and append-only audited. Returns the merged config.
 */
async function setTenantConfig(tid, patch, plane, actor) {
  const res = pf.validateConfigPatch(patch, plane)
  if (!res.ok) { const e = new Error('invalid_config'); e.code = 'INVALID_CONFIG'; e.errors = res.errors; throw e }
  const docs = sysDocs()
  if (!docs) { const e = new Error('no_store'); e.code = 'NO_STORE'; throw e }
  const existing = (await docs.item(`tenant:${tid}`, '__system__').read().catch(() => ({ resource: null }))).resource
  if (!existing) { const e = new Error('tenant_not_found'); e.code = 'TENANT_NOT_FOUND'; throw e }
  const merged = pf.mergeConfig(existing.data.config, res.value)
  const data = { ...existing.data, config: merged, updatedAt: new Date().toISOString(), updatedBy: actor.uid }
  await docs.items.upsert({ id: `tenant:${tid}`, pk: '__system__', kind: 'tenant', data })
  invalidateTenant(tid)
  await configAudit('config:tenant:update', actor, { tenantId: tid, plane, patch: res.value })
  return merged
}

// ─── effective resolution ────────────────────────────────────────────────────
async function getEffectiveFlags(tid) {
  const [g, t] = await Promise.all([getGlobalConfig(), getTenantConfig(tid)])
  return pf.resolveFlags(g.flags, t && t.flags)
}

async function getEffectiveEntitlements(tid) {
  const t = await getTenantConfig(tid)
  return pf.effectiveEntitlements(t)
}

// ─── requireFlag(key) middleware ──────────────────────────────────────────────
// Server-side surface enforcement. A disabled surface (global floor OR tenant override)
// returns 403 feature_disabled. Fail-OPEN on infra error so a Cosmos outage never takes
// a feature down; an explicit `false` always denies.
function requireFlag(key) {
  return async (req, res, next) => {
    try {
      const tid = resolveTenant(req.user)
      const flags = await getEffectiveFlags(tid)
      if (flags[key] === false) {
        return res.status(403).json({ error: 'feature_disabled', flag: key })
      }
      return next()
    } catch {
      return next() // fail-open: flags are a convenience, not the security boundary
    }
  }
}

module.exports = {
  getGlobalConfig, setGlobalConfig, invalidateGlobal,
  getTenantConfig, setTenantConfig, invalidateTenant,
  getEffectiveFlags, getEffectiveEntitlements,
  requireFlag, configAudit,
  FLAG_KEYS: pf.FLAG_KEYS, FEATURE_FLAGS: pf.FEATURE_FLAGS,
  DEFAULT_ENTITLEMENTS: pf.DEFAULT_ENTITLEMENTS,
}
