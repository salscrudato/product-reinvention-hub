'use strict'
// auth.js — username/password + TENANT → JWT auth with a 4-tier role model.
//
// Roles (rank): VIEWER < ANALYST < EDITOR < ADMIN
//   VIEWER  — read only
//   ANALYST — read + AI (chat/claims)
//   EDITOR  — read + write + AI
//   ADMIN   — everything, incl. creating/managing tenants, users and roles
//
// Tenancy: every session is bound to a tenantId (carried in the JWT). The data
// layer scopes ALL reads/writes to that tenant, so companies are isolated.
// Bootstrap admins (admin / sal.scrudato) are on by default; set BOOTSTRAP_USERS_ENABLED=false to disable.
// Additional users live in Cosmos (kind:'user', pk:'__system__'), managed via /api/admin/users.

const crypto = require('crypto')

// AUTH_JWT_SECRET — fail-closed: no insecure default; server refuses to start without it.
const _secret = process.env.AUTH_JWT_SECRET
if (!_secret) throw new Error('[auth] AUTH_JWT_SECRET is required — set it in App Service config (production) or local env (dev/smoke)')
const SECRET = _secret
const TTL_SECONDS = 12 * 60 * 60

const RANK = { VIEWER: 0, ANALYST: 1, EDITOR: 2, ADMIN: 3 }

// Bootstrap accounts — enabled by default; set BOOTSTRAP_USERS_ENABLED=false to disable in hardened prod.
// Passwords sourced from env; defaults preserve hardening/smoke.mjs's admin/admin authentication.
const BOOTSTRAP_ENABLED = process.env.BOOTSTRAP_USERS_ENABLED !== 'false'
const BOOTSTRAP = BOOTSTRAP_ENABLED ? {
  admin: { password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@prodhub.local', tenants: '*' },
  'sal.scrudato': { password: process.env.BOOTSTRAP_SAL_PASSWORD || 'sal.scrudato', role: 'ADMIN', name: 'Sal Scrudato', email: 'salvatore.scrudato@accenture.com', tenants: '*' },
} : {}
const overrides = new Map() // in-process password cache for same-session after changePassword

// ─── base64url HS256 JWT ─────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(payload) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const data = `${head}.${b64url(JSON.stringify({ ...payload, iat: now, exp: now + TTL_SECONDS }))}`
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

// ─── user + tenant lookups (Cosmos overlay on bootstrap) ─────────────────────
function systemContainer() {
  try { return require('./cosmos').docs } catch { return null }
}
async function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase()
  // Cosmos users first (admin-created), then bootstrap.
  const docs = systemContainer()
  if (docs) {
    try {
      const { resources } = await docs.items.query({
        query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='user' AND (c.data.username=@id OR LOWER(c.data.email)=@id)",
        parameters: [{ name: '@id', value: id }],
      }).fetchAll()
      if (resources[0]) return { source: 'cosmos', ...resources[0].data }
    } catch { /* fall through to bootstrap */ }
  }
  if (BOOTSTRAP[id]) return { source: 'bootstrap', username: id, ...BOOTSTRAP[id] }
  for (const [u, v] of Object.entries(BOOTSTRAP)) if (v.email.toLowerCase() === id) return { source: 'bootstrap', username: u, ...v }
  return null
}
async function listTenants() {
  const docs = systemContainer()
  if (!docs) return []
  try {
    const { resources } = await docs.items.query({ query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'" }).fetchAll()
    return resources.map((r) => ({ id: r.data.tenantId, name: r.data.name })).sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

function allowedTenant(user, tenant) {
  if (user.tenants === '*') return true
  if (!tenant) return false
  return Array.isArray(user.tenants) && user.tenants.includes(tenant)
}
const currentPassword = (u) => (overrides.has(u.username) ? overrides.get(u.username) : u.password)
const toAuthUser = (u, tenantId) => ({ uid: u.username, email: u.email || null, name: u.name || u.username, role: u.role, tenantId: tenantId || null })

// ─── express handlers + middleware ──────────────────────────────────────────
async function login(req, res) {
  const { email, username, password, tenant } = req.body || {}
  const u = await findUser(email || username)
  if (!u || currentPassword(u) !== String(password ?? '')) return res.status(401).json({ error: 'invalid_credentials' })
  // Non-admins must select a tenant they belong to. Admins may sign in tenant-less to manage.
  const tid = tenant || null
  if (tid && !allowedTenant(u, tid)) return res.status(403).json({ error: 'tenant_forbidden' })
  if (!tid && u.role !== 'ADMIN') return res.status(400).json({ error: 'tenant_required' })
  const token = sign({ sub: u.username, name: u.name || u.username, email: u.email || null, role: u.role, tenantId: tid })
  return res.json({ user: toAuthUser(u, tid), token })
}

function me(req, res) { return res.json({ user: req.user }) }

async function changePassword(req, res) {
  const next = String((req.body || {}).password ?? '')
  if (next.length < 3) return res.status(400).json({ error: 'password_too_short' })
  // Persist to Cosmos so the change survives server restart.
  const docs = systemContainer()
  if (docs) {
    try {
      const u = await findUser(req.user.uid)
      await docs.items.upsert({
        id: `user:${req.user.uid}`,
        pk: '__system__',
        kind: 'user',
        data: {
          username: req.user.uid,
          email: u?.email || req.user.email || null,
          name: u?.name || req.user.name || req.user.uid,
          role: u?.role || req.user.role,
          tenants: u?.tenants ?? (req.user.tenantId ? [req.user.tenantId] : []),
          password: next,
        },
      })
    } catch { return res.status(500).json({ error: 'persist_failed' }) }
  }
  overrides.set(req.user.uid, next) // same-session cache
  return res.json({ ok: true })
}

// Public tenant list for the login dropdown (ids + names only — no data).
async function publicTenants(_req, res) { res.json({ tenants: await listTenants() }) }

function attachUser(req, _res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  const p = token ? verify(token) : null
  req.user = p ? { uid: p.sub, name: p.name, email: p.email, role: p.role, tenantId: p.tenantId || null } : null
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
// A tenant-scoped operation needs a tenant bound to the session.
function requireTenant(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
  if (!req.user.tenantId) return res.status(409).json({ error: 'no_tenant_selected' })
  next()
}

module.exports = {
  RANK, BOOTSTRAP, listTenants, findUser,
  sign, verify,
  login, me, changePassword, publicTenants,
  attachUser, requireAuth, requireRole, requireTenant,
}
