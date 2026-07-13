'use strict'
// auth.js — email OTP + SUPER_ADMIN bootstrap auth with a 5-tier role model.
//
// Tiers (rank): VIEWER < ANALYST < EDITOR < ADMIN < SUPER_ADMIN
//   VIEWER      — read only
//   ANALYST     — read + AI
//   EDITOR      — read + write + AI
//   ADMIN       — everything incl. tenant/user management
//   SUPER_ADMIN — platform-level, OTP-exempt, break-glass only; every use is audited
//
// Auth paths:
//   1. Email OTP  — POST /api/auth/otp/request + POST /api/auth/otp/verify
//                   Allowed domains: ALLOWED_EMAIL_DOMAINS (comma-separated env, server-side only)
//                   Tenant derived from domain via TENANT_DOMAIN_MAP (JSON env, server-side only)
//   2. Bootstrap  — POST /api/auth/bootstrap (username+password, SUPER_ADMIN only)
//                   NOTE: seed admins should migrate to normal admin management after the pilot.
//
// SSO seam: discoverHomeRealm(email) — unimplemented. See docs/IDENTITY.md.

const crypto = require('crypto')
const otpModule = require('./otp')
const emailAdapter = require('./email')

// AUTH_JWT_SECRET — fail-closed: server refuses to start without it.
const _secret = process.env.AUTH_JWT_SECRET
if (!_secret) throw new Error('[auth] AUTH_JWT_SECRET is required — set it in App Service config (production) or local env (dev/smoke)')
const SECRET = _secret
const TTL_SECONDS = 12 * 60 * 60

// Two-plane role model.
// Tenant plane: VIEWER, inquiry personas (UNDERWRITING/COMPLIANCE/CLAIMS/ACTUARIAL/ANALYST),
//               EDITOR, TENANT_ADMIN.  ADMIN is a legacy alias for TENANT_ADMIN.
// Platform plane: SUPPORT (read + impersonation), SUPER_ADMIN (break-glass).
// RANK is used only by requireRole() for backward-compatible route guards.
// New routes use requireCapability() from authz.js instead of rank checks.
// SUPPORT is rank 0 so it cannot bypass any rank-gated write route; capability checks
// in authz.js are the authoritative gate for what SUPPORT is allowed to do.
const RANK = {
  VIEWER: 0,
  UNDERWRITING: 1, COMPLIANCE: 1, CLAIMS: 1, ACTUARIAL: 1, ANALYST: 1,
  EDITOR: 2,
  TENANT_ADMIN: 3, ADMIN: 3,  // ADMIN is the legacy name; normalizeRole() maps it to TENANT_ADMIN
  SUPPORT: 0,                  // platform plane; rank 0 so rank checks reject it from all write routes
  SUPER_ADMIN: 4,
}

// Roles that a TENANT_ADMIN may assign. Never SUPER_ADMIN, SUPPORT, or legacy ADMIN.
const MANAGED_TENANT_ROLES = ['VIEWER', 'UNDERWRITING', 'COMPLIANCE', 'CLAIMS', 'ACTUARIAL', 'ANALYST', 'EDITOR', 'TENANT_ADMIN']

// normalizeRole: transparently migrates legacy 'ADMIN' JWTs to 'TENANT_ADMIN' at decode
// time so downstream capability checks always see the canonical role name.
function normalizeRole(role) {
  if (role === 'ADMIN') return 'TENANT_ADMIN'
  return role || 'VIEWER'
}

// DEFAULT_TENANT_ID: mirror of shared/src/types.ts DEFAULT_TENANT_ID.
// Floor for a principal with no explicit binding (pre-multi-tenant / seed actor).
const DEFAULT_TENANT_ID = 'default'

// ─── Domain allowlist + tenant mapping (server-side only) ────────────────────
// ALLOWED_EMAIL_DOMAINS: comma-separated permitted domains, e.g. "accenture.com,testco.com"
// TENANT_DOMAIN_MAP: JSON mapping domain → tenantId, e.g. {"accenture.com":"accenture"}
const _allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
const _domainMap = (() => {
  try { return JSON.parse(process.env.TENANT_DOMAIN_MAP || '{}') } catch { return {} }
})()

function getDomainOf(email) {
  return String(email || '').toLowerCase().split('@')[1] || ''
}
function isAllowedDomain(email) {
  const domain = getDomainOf(email)
  return _allowedDomains.length > 0 && (_allowedDomains.includes(domain) || _allowedDomains.includes('*'))
}
function resolveTenantFromDomain(email) {
  const domain = getDomainOf(email)
  return _domainMap[domain] || domain.split('.').slice(0, -1).join('.') || domain
}

// ─── Bootstrap admins (config/env only, never in the client bundle) ──────────
// RISK-002: warn loudly when defaults are live.
// NOTE: seed admins should migrate to normal admin management after the pilot.
const BOOTSTRAP_ADMINS = {
  admin: {
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin',
    name: 'Admin',
    email: 'admin@prodhub.local',
  },
  sal: {
    password: process.env.BOOTSTRAP_SAL_PASSWORD || 'scrudato',
    name: 'Sal Scrudato',
    email: 'salvatore.scrudato@accenture.com',
  },
}
if (!process.env.BOOTSTRAP_ADMIN_PASSWORD || !process.env.BOOTSTRAP_SAL_PASSWORD) {
  console.warn('[auth] SECURITY: bootstrap admins are using default passwords. Set BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_SAL_PASSWORD in App Service config.')
}

// ─── base64url HS256 JWT ──────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(payload) {
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const data = `${head}.${b64url(JSON.stringify({ ...payload, jti, iat: now, exp: now + TTL_SECONDS }))}`
  return `${data}.${b64url(crypto.createHmac('sha256', SECRET).update(data).digest())}`
}
function verify(token) {
  const p = String(token || '').split('.')
  if (p.length !== 3) return null
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${p[0]}.${p[1]}`).digest())
  const a = Buffer.from(p[2]), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload; try { payload = JSON.parse(fromB64url(p[1]).toString('utf8')) } catch { return null }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

// ─── JWT revocation (RISK-006) ────────────────────────────────────────────────
const _revokedCache = new Map()
const REVOKE_CACHE_TTL = 5 * 60 * 1000

async function isRevoked(jti) {
  const cached = _revokedCache.get(jti)
  if (cached && Date.now() - cached.cachedAt < REVOKE_CACHE_TTL) return cached.revoked
  const docs = systemContainer()
  if (!docs) return false
  try {
    const { resources } = await docs.items.query({
      query: "SELECT c.id FROM c WHERE c.pk='__system__' AND c.kind='revokedToken' AND c.data.jti=@jti",
      parameters: [{ name: '@jti', value: jti }],
    }).fetchAll()
    const revoked = resources.length > 0
    _revokedCache.set(jti, { revoked, cachedAt: Date.now() })
    return revoked
  } catch { return false }
}

// ─── Cosmos helpers ───────────────────────────────────────────────────────────
function systemContainer() {
  try { return require('./cosmos').docs } catch { return null }
}

// ─── Immutable login audit trail ──────────────────────────────────────────────
// Every auth event writes an append-only Cosmos record (Create, not Upsert).
// Fail-open: a Cosmos outage does not block authentication.
function getIp(req) {
  const fwd = req.headers['x-forwarded-for'] || ''
  return (fwd ? fwd.split(',')[0] : (req.socket?.remoteAddress || '')).trim() || null
}
async function writeLoginAudit(event, actor, tenantId, ip, ua) {
  const docs = systemContainer()
  if (!docs) return
  try {
    await docs.items.create({
      id: `loginAudit:${Date.now().toString(36)}-${crypto.randomUUID()}`,
      pk: '__system__',
      kind: 'loginAudit',
      tenantId: tenantId || '__unknown__',
      event,
      actor: actor || null,
      at: new Date().toISOString(),
      ip: ip || null,
      userAgent: ua || null,
    })
  } catch { /* fail-open: auth proceeds even if audit write fails */ }
}

// ─── User lookup + JIT provisioning ──────────────────────────────────────────
async function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase()
  const docs = systemContainer()
  if (docs) {
    try {
      const { resources } = await docs.items.query({
        query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='user' AND (c.data.username=@id OR LOWER(c.data.email)=@id)",
        parameters: [{ name: '@id', value: id }],
      }).fetchAll()
      if (resources[0]) return { source: 'cosmos', ...resources[0].data }
    } catch { /* fall through */ }
  }
  return null
}

async function jitProvisionUser(email, tenantId) {
  const username = email.toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '_').slice(0, 64)
  const existing = await findUser(email)
  if (existing) {
    // Ensure the resolved tenantId is in the user's tenants list
    const docs = systemContainer()
    if (docs && tenantId && Array.isArray(existing.tenants) && !existing.tenants.includes(tenantId)) {
      try {
        await docs.items.upsert({
          id: `user:${existing.username}`, pk: '__system__', kind: 'user',
          data: { ...existing, tenants: [...existing.tenants, tenantId], source: undefined },
        })
      } catch { /* best-effort */ }
    }
    return existing
  }
  // JIT-create at the lowest role (VIEWER)
  const newUser = {
    username, email, name: username,
    role: 'VIEWER',
    tenants: tenantId ? [tenantId] : [],
    createdAt: new Date().toISOString(),
  }
  const docs = systemContainer()
  if (docs) {
    try {
      await docs.items.upsert({ id: `user:${username}`, pk: '__system__', kind: 'user', data: newUser })
    } catch { /* best-effort: in-memory fallback */ }
  }
  return newUser
}

async function listTenants() {
  const docs = systemContainer()
  if (!docs) return []
  try {
    const { resources } = await docs.items.query({ query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'" }).fetchAll()
    return resources.map((r) => ({ id: r.data.tenantId, name: r.data.name })).sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

// ─── OTP request handler ──────────────────────────────────────────────────────
async function requestOtp(req, res) {
  const { email } = req.body || {}
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email_required' })
  const normalized = email.trim().toLowerCase()
  const ip = getIp(req); const ua = req.headers['user-agent'] || null

  if (!isAllowedDomain(normalized)) {
    await writeLoginAudit('otp_domain_rejected', normalized, null, ip, ua)
    // Return generic success to prevent email enumeration
    return res.json({ ok: true })
  }

  const tenantId = resolveTenantFromDomain(normalized)
  const code = otpModule.generate6Digit()
  otpModule.store(normalized, code, tenantId)
  await writeLoginAudit('otp_requested', normalized, tenantId, ip, ua)

  try {
    await emailAdapter.sendOtp(normalized, code)
  } catch (err) {
    console.error('[auth] OTP send failed:', err.message)  // log the error, NOT the code
    return res.status(500).json({ error: 'otp_send_failed' })
  }

  return res.json({ ok: true })
}

// ─── OTP verify handler ───────────────────────────────────────────────────────
async function verifyOtp(req, res) {
  const { email, code, tenant } = req.body || {}
  if (!email || !code) return res.status(400).json({ error: 'email_and_code_required' })
  const normalized = email.trim().toLowerCase()
  const ip = getIp(req); const ua = req.headers['user-agent'] || null

  const result = otpModule.verify(normalized, String(code).trim())

  if (!result.ok) {
    const event = result.lockout ? 'otp_locked_out'
      : result.reason === 'expired'   ? 'otp_expired'
      : result.reason === 'not_found' ? 'otp_not_found'
      : 'otp_failed'
    await writeLoginAudit(event, normalized, null, ip, ua)
    if (result.reason === 'locked')    return res.status(429).json({ error: 'otp_locked' })
    if (result.reason === 'expired')   return res.status(400).json({ error: 'otp_expired' })
    if (result.reason === 'not_found') return res.status(400).json({ error: 'otp_not_found' })
    return res.status(400).json({ error: 'otp_invalid', attemptsLeft: result.attemptsLeft })
  }

  const resolvedTenant = result.tenantId || (tenant ? String(tenant) : null)
  const user = await jitProvisionUser(normalized, resolvedTenant)
  const effectiveTenant = resolvedTenant || DEFAULT_TENANT_ID

  const token = sign({
    sub: user.username, name: user.name || user.username,
    email: normalized, role: user.role || 'VIEWER',
    tenantId: effectiveTenant, method: 'otp',
  })

  await writeLoginAudit('otp_success', normalized, effectiveTenant, ip, ua)
  return res.json({
    user: { uid: user.username, email: normalized, name: user.name || user.username, role: user.role || 'VIEWER', tenantId: effectiveTenant },
    token,
  })
}

// ─── Bootstrap admin login handler ───────────────────────────────────────────
// Server-validated only. A client can never assert BOOTSTRAP_ADMINS membership.
// Every attempt (success or failure) is audit-logged. Bootstrap grant is audited separately.
async function loginBootstrap(req, res) {
  const { username, password, tenant } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' })
  const ip = getIp(req); const ua = req.headers['user-agent'] || null
  const uKey = String(username).trim().toLowerCase()

  const admin = BOOTSTRAP_ADMINS[uKey]
  // Timing-safe compare via SHA-256 hashes (equal-length buffers always)
  const expectedHash = crypto.createHash('sha256').update(admin ? admin.password : crypto.randomUUID()).digest()
  const actualHash   = crypto.createHash('sha256').update(String(password)).digest()
  const match = admin && crypto.timingSafeEqual(expectedHash, actualHash)

  if (!match) {
    await writeLoginAudit('bootstrap_failed', uKey, null, ip, ua)
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  const tid = tenant ? String(tenant) : null
  const token = sign({ sub: uKey, name: admin.name, email: admin.email, role: 'SUPER_ADMIN', tenantId: tid, method: 'bootstrap' })

  await writeLoginAudit('bootstrap_success', uKey, tid, ip, ua)
  await writeLoginAudit('bootstrap_super_admin_granted', uKey, tid, ip, ua)

  return res.json({ user: { uid: uKey, email: admin.email, name: admin.name, role: 'SUPER_ADMIN', tenantId: tid }, token })
}

// ─── Impersonation token (SUPPORT only, platform:impersonate capability) ─────
// Creates a short-lived (1 h) JWT that carries the target user's identity AND a
// dual-attribution field (_impersonatedBy) so every audit event shows both actors.
// The token carries the target's tenant-plane role — a platform role can NEVER be
// granted through impersonation (the role field comes from the target user record,
// never from the SUPPORT actor).
const IMPERSONATION_TTL = 60 * 60  // 1 hour

function signImpersonation(targetUser, supportActor, tenantId) {
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  // Ensure impersonation can never grant a platform role to a tenant user.
  const targetRole = normalizeRole(targetUser.role)
  if (targetRole === 'SUPER_ADMIN' || targetRole === 'SUPPORT') {
    throw new Error('Cannot impersonate a platform-plane user')
  }
  const payload = {
    sub: targetUser.username || targetUser.uid,
    name: targetUser.name,
    email: targetUser.email,
    role: targetRole,
    tenantId,
    method: 'impersonation',
    impersonatedBy: { uid: supportActor.uid, name: supportActor.name, email: supportActor.email },
    jti, iat: now, exp: now + IMPERSONATION_TTL,
  }
  const data = `${head}.${b64url(JSON.stringify(payload))}`
  return {
    token: `${data}.${b64url(crypto.createHmac('sha256', SECRET).update(data).digest())}`,
    expiresAt: new Date((now + IMPERSONATION_TTL) * 1000).toISOString(),
    subject: payload.sub,
    tenantId,
  }
}

// ─── SSO seam (unimplemented) — see docs/IDENTITY.md ─────────────────────────
// eslint-disable-next-line no-unused-vars
function discoverHomeRealm(_email) {
  // TODO: implement home-realm discovery for enterprise SSO (docs/IDENTITY.md).
  // Return: { provider: 'oidc'|'saml', entityId: string, redirectUrl: string } | null
  return null
}

// ─── Misc handlers ────────────────────────────────────────────────────────────
function me(req, res) { return res.json({ user: req.user }) }

async function changePassword(req, res) {
  const next = String((req.body || {}).password ?? '')
  if (next.length < 12) return res.status(400).json({ error: 'password_too_short', detail: 'Password must be at least 12 characters.' })
  const docs = systemContainer()
  if (docs) {
    try {
      const u = await findUser(req.user.uid)
      await docs.items.upsert({
        id: `user:${req.user.uid}`, pk: '__system__', kind: 'user',
        data: {
          username: req.user.uid, email: u?.email || req.user.email || null,
          name: u?.name || req.user.name || req.user.uid,
          role: u?.role || req.user.role,
          tenants: u?.tenants ?? (req.user.tenantId ? [req.user.tenantId] : []),
          password: next,
        },
      })
    } catch { return res.status(500).json({ error: 'persist_failed' }) }
  }
  return res.json({ ok: true })
}

async function publicTenants(_req, res) { res.json({ tenants: await listTenants() }) }

// ─── Per-request middleware ───────────────────────────────────────────────────
async function attachUser(req, _res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  const p = token ? verify(token) : null
  if (p) {
    if (p.jti && await isRevoked(p.jti)) {
      req.user = null
    } else {
      const role = normalizeRole(p.role)
      let tenantId = p.tenantId || null
      // SUPER_ADMIN: allow per-request tenant override via X-Tenant-Id header.
      // This lets admin/sal switch between any tenant without re-authenticating.
      if (role === 'SUPER_ADMIN') {
        const override = String(req.headers['x-tenant-id'] || '').trim()
        if (override) tenantId = override
      }
      req.user = { uid: p.sub, name: p.name, email: p.email, role, tenantId, _jti: p.jti || null }
      // Impersonation token: dual-attributed; the real actor is in _impersonatedBy.
      // Every audit action must include both identities (see tenant-admin.js actorFor).
      if (p.impersonatedBy) {
        req.user._impersonatedBy = p.impersonatedBy
      }
    }
  } else {
    req.user = null
  }
  next()
}

async function revokeToken(req, _res, next) {
  const jti = req.user?._jti
  if (jti) {
    _revokedCache.set(jti, { revoked: true, cachedAt: Date.now() })
    const docs = systemContainer()
    if (docs) {
      try {
        await docs.items.upsert({
          id: `revokedToken:${jti}`, pk: '__system__', kind: 'revokedToken',
          data: { jti, uid: req.user.uid, revokedAt: Date.now() },
        })
      } catch { /* best-effort */ }
    }
  }
  next()
}

function requireAuth(req, res, next) { if (!req.user) return res.status(401).json({ error: 'unauthenticated' }); next() }
function requireRole(min) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
    if ((RANK[req.user.role] ?? -1) < RANK[min]) return res.status(403).json({ error: 'forbidden', need: min, have: req.user.role })
    next()
  }
}
function requireTenant(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
  // SUPER_ADMIN can work across all tenants; if no tenantId is set they default to 'default'.
  // SUPPORT is NOT exempt — it must operate within a tenantId (set via impersonation token).
  if (req.user.role === 'SUPER_ADMIN') return next()
  if (!req.user.tenantId) return res.status(409).json({ error: 'no_tenant_selected' })
  next()
}

// resolveTenantForPrincipal: maps an authenticated principal to its working tenant.
// tenantId is domain-derived at OTP verify time and baked into the signed JWT; this seam
// reads it server-side. DEFAULT_TENANT_ID is the floor for non-interactive / seed actors.
// requireTenant is the interactive gate (session without tenantId → 409 before this is called).
function resolveTenantForPrincipal(principal) {
  return (principal && principal.tenantId) || DEFAULT_TENANT_ID
}

module.exports = {
  RANK, DEFAULT_TENANT_ID, BOOTSTRAP_ADMINS, MANAGED_TENANT_ROLES, listTenants, findUser,
  normalizeRole, sign, verify, signImpersonation,
  requestOtp, verifyOtp, loginBootstrap, me, changePassword, publicTenants, discoverHomeRealm,
  attachUser, requireAuth, requireRole, requireTenant, resolveTenantForPrincipal, revokeToken,
}
