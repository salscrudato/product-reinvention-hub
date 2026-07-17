'use strict'
// otp.js — server-side OTP generation, hashing, and verification.
//
// Codes are NEVER stored in plaintext or logged. Only a SHA-256 HMAC hash is kept.
// Storage is in-memory per-instance: acceptable for the pilot (single-instance App Service).
// Follow-up: migrate to Cosmos TTL documents for multi-instance readiness.

const crypto = require('crypto')

const _jwtSecret = process.env.AUTH_JWT_SECRET
if (!_jwtSecret) throw new Error('[otp] AUTH_JWT_SECRET is required')

// Derive an OTP-specific sub-key so the JWT signing key is never used directly for OTP hashing.
const OTP_HMAC_KEY = crypto.createHmac('sha256', _jwtSecret).update('otp-hmac-context-v1').digest()

const OTP_TTL_MS       = 10 * 60 * 1000   // 10 minutes
const OTP_MAX_ATTEMPTS = 5
const OTP_LOCKOUT_MS   = 15 * 60 * 1000   // 15-minute lockout after exhausting attempts

// In-memory pending OTP store.
// key: normalized email string
// value: { codeHash: Buffer, expiresAt: number, tenantId: string|null, attempts: number, lockedUntil?: number }
const _pending = new Map()

function _hashCode(code) {
  return crypto.createHmac('sha256', OTP_HMAC_KEY).update(String(code)).digest()
}

// Cryptographically random 6-digit code (000000–999999), zero-padded.
function generate6Digit() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

// Store a pending OTP for the given email key. The code itself is hashed immediately and the
// plaintext is not retained. Overwrites any prior pending code for the same email.
function store(emailKey, code, tenantId) {
  _pending.set(emailKey, {
    codeHash:  _hashCode(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    tenantId:  tenantId || null,
    attempts:  0,
  })
}

// Verify a submitted code against the stored hash.
// Returns:
//   { ok: true,  tenantId }                                                 on success
//   { ok: false, reason: 'not_found'|'expired'|'locked'|'invalid',
//                attemptsLeft?: number, lockout?: true }                    on failure
function verify(emailKey, code) {
  const rec = _pending.get(emailKey)
  if (!rec) return { ok: false, reason: 'not_found' }

  const now = Date.now()
  if (rec.lockedUntil && now < rec.lockedUntil) return { ok: false, reason: 'locked' }
  if (now > rec.expiresAt) { _pending.delete(emailKey); return { ok: false, reason: 'expired' } }

  rec.attempts++
  const submitted = _hashCode(code)
  let match = false
  try {
    const a = rec.codeHash, b = submitted
    match = a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { match = false }

  if (!match) {
    if (rec.attempts >= OTP_MAX_ATTEMPTS) {
      rec.lockedUntil = now + OTP_LOCKOUT_MS
      _pending.delete(emailKey)
      return { ok: false, reason: 'locked', lockout: true }
    }
    return { ok: false, reason: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - rec.attempts }
  }

  const tenantId = rec.tenantId
  _pending.delete(emailKey)
  return { ok: true, tenantId }
}

// ─── Magic-link tokens ────────────────────────────────────────────────────────
// Same posture as OTP codes: hashed at rest, in-memory, TTL'd, single-use. A magic
// token is issued ALONGSIDE the 6-digit code in the same email — clicking the link
// and typing the code are two doors into the same pending sign-in.
const _pendingMagic = new Map() // emailKey -> { tokenHash: Buffer, expiresAt, tenantId }

function generateMagicToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function storeMagic(emailKey, token, tenantId) {
  _pendingMagic.set(emailKey, {
    tokenHash: _hashCode(token),
    expiresAt: Date.now() + OTP_TTL_MS,
    tenantId:  tenantId || null,
  })
}

function verifyMagic(emailKey, token) {
  const rec = _pendingMagic.get(emailKey)
  if (!rec) return { ok: false, reason: 'not_found' }
  if (Date.now() > rec.expiresAt) { _pendingMagic.delete(emailKey); return { ok: false, reason: 'expired' } }
  const submitted = _hashCode(token)
  let match = false
  try {
    const a = rec.tokenHash, b = submitted
    match = a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { match = false }
  // Single-use either way: a failed attempt burns the link (it arrives by URL, so
  // there is no legitimate retry path — the user requests a fresh email instead).
  _pendingMagic.delete(emailKey)
  if (!match) return { ok: false, reason: 'invalid' }
  return { ok: true, tenantId: rec.tenantId }
}

module.exports = { generate6Digit, store, verify, generateMagicToken, storeMagic, verifyMagic }
