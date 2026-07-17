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

// Session lifetime (8 h). Sessions are opaque and server-side (no JWT), so this
// module has no signing secret to manage. otp.js still enforces AUTH_JWT_SECRET for
// its own token hashing and is required above, so a missing secret still fails boot.
const TTL_SECONDS = 8 * 60 * 60

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
  POLICYHOLDER: 0,             // consumer persona; rank 0 so every rank-gated staff route rejects it
  UNDERWRITING: 1, COMPLIANCE: 1, CLAIMS: 1, ACTUARIAL: 1, ANALYST: 1,
  EDITOR: 2,
  TENANT_ADMIN: 3, ADMIN: 3,  // ADMIN is the legacy name; normalizeRole() maps it to TENANT_ADMIN
  SUPPORT: 0,                  // platform plane; rank 0 so rank checks reject it from all write routes
  SUPER_ADMIN: 4,
}

// Roles that a TENANT_ADMIN may assign. Never SUPER_ADMIN, SUPPORT, or legacy ADMIN.
// POLICYHOLDER is assignable so a carrier can provision its own end customers' portal accounts.
const MANAGED_TENANT_ROLES = ['VIEWER', 'UNDERWRITING', 'COMPLIANCE', 'CLAIMS', 'ACTUARIAL', 'ANALYST', 'EDITOR', 'TENANT_ADMIN', 'POLICYHOLDER']

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

// ─── Sign-in accounts — THE ONE PLACE TO EDIT (USER DIRECTIVE 2026-07-17) ─────
// Simple, always-on username → password sign-in. To add, remove, or change a login,
// edit THIS map and nothing else. Every account is granted SUPER_ADMIN and is checked
// by loginBootstrap() with a timing-safe compare.
//
// This is a deliberate LOCAL / non-deployed shortcut ("rewire later"): it retires the
// former fail-closed, env-gated door (DEF-0041) — passwords live in code and the
// accounts are always enabled. The azure deploy remote is disabled, so this ships
// nowhere; do NOT deploy it as-is.
const BOOTSTRAP_ADMINS = {
  admin: { password: 'admin',    name: 'Admin', email: 'admin@prodhub.local' },
  sal:   { password: 'scrudato', name: 'Sal',   email: 'sal@prodhub.local' },
}
// SECURITY: these bootstrap accounts use well-known default passwords and are always
// on — acceptable ONLY for local/dev use; never deploy them.
if (process.env.NODE_ENV !== 'test') {
  console.warn('[auth] SECURITY: bootstrap sign-in (admin/admin, sal/scrudato) is ENABLED with default passwords, always on — local/dev only, never deploy.')
}

// ─── Opaque, in-memory sessions (no JWT) ──────────────────────────────────────
// Sign-in mints a random 256-bit session id (NOT a signed token) and stores that
// session's claims in an in-process Map; verify() resolves the id back to its claims.
// There is no secret and nothing to decode client-side — the id is just an
// unguessable handle. Sessions live only in this process, so a host restart signs
// everyone out (dev already behaved this way: its JWT secret was ephemeral per boot).
// Single-instance by design — multi-instance hosting would need a shared store
// (e.g. Cosmos) in place of this Map.
const SESSIONS = new Map() // sid -> { ...claims, expiresAt }

const newSid = () => crypto.randomBytes(32).toString('hex')

// Timer-free memory bound: sweep expired entries only when the map grows past a soft
// cap, so this never keeps the process alive (matters for the test runner).
function sweepExpired() {
  const now = Date.now()
  for (const [sid, s] of SESSIONS) if (s.expiresAt <= now) SESSIONS.delete(sid)
}

// sign(claims): open a session, return its opaque id. Name kept for call-site
// compatibility — loginBootstrap / passkeys / impersonation / tests all call sign().
function sign(claims, ttlSeconds = TTL_SECONDS) {
  if (SESSIONS.size > 1000) sweepExpired()
  const sid = newSid()
  SESSIONS.set(sid, { ...claims, expiresAt: Date.now() + ttlSeconds * 1000 })
  return sid
}

// verify(sid): resolve an opaque session id to its claims, or null if unknown/expired.
function verify(sid) {
  if (!sid || typeof sid !== 'string') return null
  const s = SESSIONS.get(sid)
  if (!s) return null
  if (s.expiresAt <= Date.now()) { SESSIONS.delete(sid); return null }
  return s
}

// destroySession(sid): forget a session (sign-out / revocation).
function destroySession(sid) { if (sid) SESSIONS.delete(sid) }

// ─── HTTP-only session cookie ─────────────────────────────────────────────────
// The session JWT is ALSO set as an HTTP-only cookie so the browser never has to
// hold it in script-readable storage. Bearer remains accepted (existing clients,
// smoke harnesses); the cookie is the fallback when no Authorization header is
// present. Entra SSO can later mint the same cookie behind the same middleware.
const SESSION_COOKIE = 'pf_session'

function isSecureReq(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
}
function setSessionCookie(req, res, token) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${TTL_SECONDS}`]
  if (isSecureReq(req)) attrs.push('Secure')
  res.append('Set-Cookie', attrs.join('; '))
}
function clearSessionCookie(req, res) {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (isSecureReq(req)) attrs.push('Secure')
  res.append('Set-Cookie', attrs.join('; '))
}
function readSessionCookie(req) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of String(raw).split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null
  }
  return null
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

// isTenantSuspended: platform lifecycle enforcement at session mint. A suspended tenant
// blocks NEW tenant-plane logins (reversibly — reactivate restores it). Existing JWTs run
// out at the 8 h TTL (same semantics as a disabled member). Fail-OPEN on a read error so a
// Cosmos blip never locks everyone out; an explicit status:'suspended' always blocks.
async function isTenantSuspended(tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) return false
  const docs = systemContainer()
  if (!docs) return false
  try {
    const r = (await docs.item(`tenant:${tenantId}`, '__system__').read().catch(() => ({ resource: null }))).resource
    return !!(r && r.data && r.data.status === 'suspended')
  } catch { return false }
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

  // Magic link: a single-use companion token in the same email. The link targets the
  // SPA origin (the page the user is sitting on — Origin header; PUBLIC_APP_ORIGIN
  // pins it explicitly), carrying the token in the URL FRAGMENT so it never appears
  // in server access logs.
  const magicToken = otpModule.generateMagicToken()
  otpModule.storeMagic(normalized, magicToken, tenantId)
  const appOrigin = process.env.PUBLIC_APP_ORIGIN || String(req.headers.origin || '') || null
  const magicUrl = appOrigin ? `${appOrigin}/#ml=${magicToken}&email=${encodeURIComponent(normalized)}` : null

  try {
    await emailAdapter.sendOtp(normalized, code, magicUrl)
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
  return mintEmailSession(req, res, normalized, resolvedTenant, 'otp', ip, ua)
}

// ─── Shared email-identity session mint (OTP code + magic link) ───────────────
// Both email doors converge here: JIT-provision, disabled/suspended gates, JWT +
// HTTP-only cookie, audit trail. `method` lands in the JWT and the audit event.
async function mintEmailSession(req, res, normalized, resolvedTenant, method, ip, ua) {
  const user = await jitProvisionUser(normalized, resolvedTenant)
  if (user.disabled) {
    await writeLoginAudit('login_disabled', normalized, resolvedTenant, ip, ua)
    return res.status(403).json({ error: 'account_disabled' })
  }
  const effectiveTenant = resolvedTenant || DEFAULT_TENANT_ID
  // Platform lifecycle: a SUSPENDED tenant blocks login at session mint (reversible).
  if (await isTenantSuspended(effectiveTenant)) {
    await writeLoginAudit('login_tenant_suspended', normalized, effectiveTenant, ip, ua)
    return res.status(403).json({ error: 'tenant_suspended', detail: 'This workspace is suspended. Contact your platform administrator.' })
  }

  const token = sign({
    sub: user.username, name: user.name || user.username,
    email: normalized, role: user.role || 'VIEWER',
    tenantId: effectiveTenant, method,
  })

  await writeLoginAudit(`${method}_success`, normalized, effectiveTenant, ip, ua)
  setSessionCookie(req, res, token)
  return res.json({
    user: { uid: user.username, email: normalized, name: user.name || user.username, role: user.role || 'VIEWER', tenantId: effectiveTenant },
    token,
  })
}

// ─── Magic-link verify handler ────────────────────────────────────────────────
// POST /api/auth/otp/magic { email, token } — the one-click door. The token is
// single-use (a failed attempt burns it) and shares the OTP's 10-minute TTL.
async function verifyMagicLink(req, res) {
  const { email, token } = req.body || {}
  if (!email || !token) return res.status(400).json({ error: 'email_and_token_required' })
  const normalized = String(email).trim().toLowerCase()
  const ip = getIp(req); const ua = req.headers['user-agent'] || null

  const result = otpModule.verifyMagic(normalized, String(token))
  if (!result.ok) {
    const event = result.reason === 'expired' ? 'magic_expired'
      : result.reason === 'not_found' ? 'magic_not_found'
      : 'magic_failed'
    await writeLoginAudit(event, normalized, null, ip, ua)
    if (result.reason === 'expired') return res.status(400).json({ error: 'magic_expired' })
    return res.status(400).json({ error: 'magic_invalid' })
  }
  return mintEmailSession(req, res, normalized, result.tenantId, 'magic', ip, ua)
}

// ─── Bootstrap admin login handler ───────────────────────────────────────────
// Server-validated only. A client can never assert BOOTSTRAP_ADMINS membership.
// Every attempt (success or failure) is audit-logged. Bootstrap grant is audited separately.
// passwordsMatch: constant-shape timing-safe compare (SHA-256 → equal-length buffers).
// `expected` may be null/undefined — a random UUID stands in so timing stays uniform.
function passwordsMatch(expected, submitted) {
  const expectedHash = crypto.createHash('sha256').update(expected != null ? String(expected) : crypto.randomUUID()).digest()
  const actualHash   = crypto.createHash('sha256').update(String(submitted)).digest()
  return expected != null && crypto.timingSafeEqual(expectedHash, actualHash)
}

// The password door: any account in the BOOTSTRAP_ADMINS map above (admin, sal).
// No user-record lookup happens here by design — the account list is the closed map, so
// an attacker cannot probe for provisioned usernames through this endpoint, and every
// attempt resolves in constant shape (timing-safe compare, uniform 401).
async function loginBootstrap(req, res) {
  const { username, password, tenant } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' })
  const ip = getIp(req); const ua = req.headers['user-agent'] || null
  const uKey = String(username).trim().toLowerCase()

  const admin = BOOTSTRAP_ADMINS[uKey]
  if (!admin || !passwordsMatch(admin ? admin.password : null, password)) {
    await writeLoginAudit('bootstrap_failed', uKey, null, ip, ua)
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  const tid = tenant ? String(tenant) : null
  const token = sign({ sub: uKey, name: admin.name, email: admin.email, role: 'SUPER_ADMIN', tenantId: tid, method: 'bootstrap' })

  await writeLoginAudit('bootstrap_success', uKey, tid, ip, ua)
  await writeLoginAudit('bootstrap_super_admin_granted', uKey, tid, ip, ua)

  setSessionCookie(req, res, token)
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
  // Ensure impersonation can never grant a platform role to a tenant user — the role
  // comes from the target user record, never from the SUPPORT actor.
  const targetRole = normalizeRole(targetUser.role)
  if (targetRole === 'SUPER_ADMIN' || targetRole === 'SUPPORT') {
    throw new Error('Cannot impersonate a platform-plane user')
  }
  const subject = targetUser.username || targetUser.uid
  const token = sign({
    sub: subject,
    name: targetUser.name,
    email: targetUser.email,
    role: targetRole,
    tenantId,
    method: 'impersonation',
    impersonatedBy: { uid: supportActor.uid, name: supportActor.name, email: supportActor.email },
  }, IMPERSONATION_TTL)
  return {
    token,
    expiresAt: new Date(Date.now() + IMPERSONATION_TTL * 1000).toISOString(),
    subject,
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

// ─── Login resolve (pre-auth, uniform, zero enumeration) ─────────────────────
// POST /api/auth/resolve — email in, { mode, tenantHint } out. The response is
// derived ONLY from server-side config (TENANT_DOMAIN_MAP / domain-minus-TLD) and
// the SSO home-realm seam; it NEVER touches the user or tenant store, so shape,
// timing, and error text are identical for known and unknown domains — an
// attacker cannot enumerate accounts or tenants through it. The legacy pre-auth
// /api/auth/tenants enumeration stays in place this wave; P4 removes it
// atomically with the client flip to this endpoint.
async function resolveLogin(req, res) {
  const email = String((req.body || {}).email || '').trim().toLowerCase()
  // Format check only — data-independent, so a 400 reveals nothing about tenants.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' })
  }
  const realm = discoverHomeRealm(email) // stubbed null until Entra SSO lands (docs/IDENTITY.md)
  return res.json({ mode: realm ? 'sso' : 'password', tenantHint: resolveTenantFromDomain(email) })
}

// ─── Memberships (post-auth, self only) ───────────────────────────────────────
// GET /api/auth/memberships — the caller's own tenants, for a multi-tenant
// chooser. Source of truth is the caller's user record `tenants` array ('*' or
// a platform-plane role → every tenant). The JWT-bound tenant is always
// included so a bootstrap/JIT principal with no record still sees its session
// tenant. Reads only — names come from the same system tenant records the
// login dropdown uses.
async function myMemberships(req, res) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
  try {
    const all = await listTenants() // [{ id, name }] sorted by name
    const nameOf = new Map(all.map((t) => [t.id, t.name]))
    const record = await findUser(req.user.uid)
    const platformPlane = req.user.role === 'SUPER_ADMIN' || req.user.role === 'SUPPORT'
    let ids
    if (platformPlane || record?.tenants === '*') {
      ids = all.map((t) => t.id)
    } else {
      ids = Array.isArray(record?.tenants) ? record.tenants.filter((t) => typeof t === 'string' && t) : []
    }
    if (req.user.tenantId && !ids.includes(req.user.tenantId)) ids.push(req.user.tenantId)
    const memberships = ids
      .map((id) => ({ tenantId: id, name: nameOf.get(id) || id, current: id === req.user.tenantId }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return res.json({ memberships })
  } catch {
    return res.status(503).json({ error: 'memberships_unavailable' })
  }
}

// ─── Misc handlers ────────────────────────────────────────────────────────────
// /me carries the caller's EFFECTIVE feature flags so the client can hide disabled
// surfaces from nav (server-side enforcement remains authoritative). Lazy-require of
// platform-config avoids a load-order cycle; flags are best-effort (null on any error).
async function me(req, res) {
  let flags = null
  try { flags = await require('./platform-config').getEffectiveFlags(resolveTenantForPrincipal(req.user)) }
  catch { /* best-effort: client falls back to all-enabled defaults */ }
  return res.json({ user: req.user, flags })
}

async function changePassword(req, res) {
  const next = String((req.body || {}).password ?? '')
  if (next.length < 12) return res.status(400).json({ error: 'password_too_short', detail: 'Password must be at least 12 characters.' })
  const docs = systemContainer()
  if (docs) {
    try {
      const u = await findUser(req.user.uid)
      // Spread the existing record so flags like `disabled` survive a password change.
      const { source: _src, ...uData } = u || {}
      await docs.items.upsert({
        id: `user:${req.user.uid}`, pk: '__system__', kind: 'user',
        data: {
          ...uData,
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
function attachUser(req, _res, next) {
  const h = req.headers.authorization || ''
  // Bearer first (existing clients, harnesses); HTTP-only session cookie fallback.
  // Both carry the same opaque session id.
  const sid = h.startsWith('Bearer ') ? h.slice(7) : readSessionCookie(req)
  const s = sid ? verify(sid) : null
  if (s) {
    const role = normalizeRole(s.role)
    let tenantId = s.tenantId || null
    // SUPER_ADMIN: per-request tenant override via X-Tenant-Id header. The platform
    // plane can scope its session to any tenant to administer it; every resulting data
    // change is still recorded in that tenant's audit log. Tenant-plane roles never
    // reach this branch — they are pinned to the tenantId in their session.
    if (role === 'SUPER_ADMIN') {
      const override = String(req.headers['x-tenant-id'] || '').trim()
      if (override) tenantId = override
    }
    req.user = { uid: s.sub, name: s.name, email: s.email, role, tenantId }
    // _sid is the session id itself (a bearer credential) — keep it readable for
    // revokeToken() but NON-enumerable so it never serializes into a response body
    // (/api/auth/me returns req.user) or an audit record spread.
    Object.defineProperty(req.user, '_sid', { value: sid, enumerable: false })
    // Impersonation session: dual-attributed; the real actor is in _impersonatedBy.
    // Every audit action must include both identities (see tenant-admin.js actorFor).
    if (s.impersonatedBy) {
      req.user._impersonatedBy = s.impersonatedBy
    }
  } else {
    req.user = null
  }
  next()
}

// Sign-out / revocation: forget the session so its id (and the cookie carrying it)
// can never be replayed. In-memory, so it takes effect immediately (process-local).
function revokeToken(req, _res, next) {
  destroySession(req.user?._sid)
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
  isTenantSuspended,
  normalizeRole, sign, verify, signImpersonation,
  requestOtp, verifyOtp, verifyMagicLink, loginBootstrap, me, changePassword, publicTenants, discoverHomeRealm,
  writeLoginAudit, passwordsMatch,
  resolveLogin, myMemberships,
  attachUser, requireAuth, requireRole, requireTenant, resolveTenantForPrincipal, revokeToken,
  setSessionCookie, clearSessionCookie,
}
