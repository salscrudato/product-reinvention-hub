'use strict'
// auth.js — fast username/password → JWT auth for the Azure host.
//
// Replaces Firebase Auth. Hardcoded users (dev-grade, sandbox) with the same
// VIEWER/EDITOR/ADMIN role matrix the app already enforces. HS256 JWTs are
// signed/verified here with node:crypto — no external dependency, no GCloud.
//
// Change users or the signing secret in ONE place: the USERS map below and the
// AUTH_JWT_SECRET app setting. Passwords are intentionally simple for the
// sandbox; rotate before any real use.

const crypto = require('crypto')

const SECRET = process.env.AUTH_JWT_SECRET || 'dev-insecure-secret-change-me'
const TTL_SECONDS = 12 * 60 * 60 // 12h

// username → { password, role, name, email }. Also matchable by email.
const USERS = {
  admin: { password: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@prodhub.local' },
  'sal.scrudato': { password: 'sal.scrudato', role: 'ADMIN', name: 'Sal Scrudato', email: 'salvatore.scrudato@accenture.com' },
  'rebecca.freeman': { password: 'rebecca.freeman', role: 'EDITOR', name: 'Rebecca Freeman', email: 'rebecca.freeman@accenture.com' },
  viewer: { password: 'viewer', role: 'VIEWER', name: 'Viewer', email: 'viewer@prodhub.local' },
}
// In-process password overrides (changePassword). Non-persistent by design.
const overrides = new Map()

const RANK = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }

// ─── base64url + HS256 JWT (hand-rolled) ────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = (obj) => b64url(JSON.stringify(obj))
function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') }

function sign(payload) {
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + TTL_SECONDS }
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const data = `${head}.${b64urlJson(body)}`
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(data).digest())
  return `${data}.${sig}`
}

function verify(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest())
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload
  try { payload = JSON.parse(fromB64url(body).toString('utf8')) } catch { return null }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

// ─── user lookup ────────────────────────────────────────────────────────────
function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase()
  if (USERS[id]) return { username: id, ...USERS[id] }
  for (const [username, u] of Object.entries(USERS)) {
    if (u.email.toLowerCase() === id) return { username, ...u }
  }
  return null
}
function currentPassword(username) {
  return overrides.has(username) ? overrides.get(username) : USERS[username]?.password
}

// ─── express handlers + middleware ──────────────────────────────────────────
function login(req, res) {
  const { email, username, password } = req.body || {}
  const u = findUser(email || username)
  if (!u || currentPassword(u.username) !== String(password ?? '')) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }
  const token = sign({ sub: u.username, name: u.name, email: u.email, role: u.role })
  return res.json({ user: toAuthUser(u), token })
}

function me(req, res) {
  return res.json({ user: req.user })
}

function changePassword(req, res) {
  const next = String((req.body || {}).password ?? '')
  if (next.length < 3) return res.status(400).json({ error: 'password_too_short' })
  overrides.set(req.user.uid, next)
  return res.json({ ok: true })
}

function toAuthUser(u) {
  return { uid: u.username, email: u.email, name: u.name, role: u.role }
}

// Attach req.user if a valid Bearer token is present; else req.user = null.
function attachUser(req, _res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  const payload = token ? verify(token) : null
  req.user = payload ? { uid: payload.sub, name: payload.name, email: payload.email, role: payload.role } : null
  next()
}

// Require a verified caller (any role).
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
  next()
}

// Require role >= min (VIEWER < EDITOR < ADMIN). Mirrors the Firestore-rule matrix.
function requireRole(min) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
    if (RANK[req.user.role] === undefined || RANK[req.user.role] < RANK[min]) {
      return res.status(403).json({ error: 'forbidden', need: min, have: req.user.role })
    }
    next()
  }
}

module.exports = {
  RANK, USERS,
  sign, verify, findUser,
  login, me, changePassword,
  attachUser, requireAuth, requireRole,
}
