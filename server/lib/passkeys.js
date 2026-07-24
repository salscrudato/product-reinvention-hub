'use strict'
// passkeys.js — WebAuthn passkey authentication (usernameless, discoverable credentials).
//
// The frictionless sign-in path: a user with an enrolled passkey signs in with one
// biometric tap (Windows Hello / Face ID) and ZERO typed fields. Enrollment happens
// post-auth (any session minted by OTP, magic link, or bootstrap can add a passkey),
// so the email flow is the ramp and the passkey is the daily path.
//
// Endpoints (mounted in server.js):
//   POST /api/auth/passkey/options           — public: authentication challenge (usernameless)
//   POST /api/auth/passkey/verify            — public: verify assertion → session (JWT + cookie)
//   POST /api/auth/passkey/register/options  — authed: registration challenge for the caller
//   POST /api/auth/passkey/register/verify   — authed: verify attestation → store credential
//   GET  /api/auth/passkey/mine              — authed: caller's own enrolled passkeys
//
// Storage: credential public keys are __system__ identity-plane Cosmos docs
// (kind 'passkeyCredential'), the same class as user records (DEF-0017 / DEF-0047
// allowlisted — not tenant entities, no version-history obligation). Challenges are
// in-memory per-instance with a 5-minute TTL (same posture as otp.js pending codes).
//
// Role at session mint comes from the LIVE user record (never a snapshot on the
// credential), so a role change or disable takes effect on the next sign-in. The one
// exception is bootstrap accounts (no Cosmos record): their role is granted ONLY while
// the account still exists in BOOTSTRAP_ADMINS (env-controlled) — removing the env
// entry kills the passkey's power too.

const crypto = require('crypto')
const auth = require('./auth')

const RP_NAME = 'Product Reinvention Hub'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

// Lazy-load the WebAuthn library so a missing optional dep degrades this surface
// to 501 instead of failing the whole host boot (same posture as email.js providers).
function webauthn() {
  try { return require('@simplewebauthn/server') } catch { return null }
}

function systemContainer() {
  try { return require('./cosmos').docs } catch { return null }
}

// ─── Relying-party identity ──────────────────────────────────────────────────
// WebAuthn binds credentials to the PAGE origin. The SPA may be served same-origin
// (App Service, local Vite proxy) or cross-origin (an allowed origin → local API via
// the env-gated CORS shim), so the rpID/origin derive from the request's Origin
// header when present, else the Host header. PASSKEY_RP_ID / PASSKEY_ORIGINS env
// vars pin them explicitly when set (recommended for a stable deployed hostname).
function rpFrom(req) {
  const envRpId = process.env.PASSKEY_RP_ID || null
  const envOrigins = (process.env.PASSKEY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const originHdr = String(req.headers.origin || '')
  let origin = originHdr
  if (!origin) {
    const proto = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http'
    origin = `${proto}://${req.headers.host || 'localhost'}`
  }
  let rpID = envRpId
  if (!rpID) {
    try { rpID = new URL(origin).hostname } catch { rpID = String(req.headers.host || 'localhost').split(':')[0] }
  }
  const expectedOrigin = envOrigins.length > 0 ? envOrigins : [origin]
  return { rpID, expectedOrigin }
}

// ─── In-memory challenge store (single-instance, TTL, single-use) ────────────
const _challenges = new Map() // requestId -> { challenge, uid|null, expiresAt }

function putChallenge(challenge, uid) {
  // Opportunistic prune keeps the map bounded without a timer.
  const now = Date.now()
  for (const [k, v] of _challenges) if (v.expiresAt < now) _challenges.delete(k)
  const requestId = crypto.randomUUID()
  _challenges.set(requestId, { challenge, uid: uid || null, expiresAt: now + CHALLENGE_TTL_MS })
  return requestId
}
function takeChallenge(requestId) {
  const rec = _challenges.get(String(requestId || ''))
  if (!rec) return null
  _challenges.delete(String(requestId))            // single-use
  if (rec.expiresAt < Date.now()) return null
  return rec
}

// ─── Credential store (__system__ identity plane) ────────────────────────────
// Cosmos ids must avoid '/', '\', '#', '?' — base64url credential ids are safe as-is.
const credDocId = (credentialId) => `passkey:${credentialId}`

async function readCredential(credentialId) {
  const docs = systemContainer()
  if (!docs) return null
  try {
    const { resource } = await docs.item(credDocId(credentialId), '__system__').read()
    return resource?.data || null
  } catch { return null }
}

async function listCredentialsFor(username) {
  const docs = systemContainer()
  if (!docs) return []
  try {
    const { resources } = await docs.items.query({
      query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='passkeyCredential' AND c.data.username=@u",
      parameters: [{ name: '@u', value: String(username || '').toLowerCase() }],
    }).fetchAll()
    return resources.map((r) => r.data)
  } catch { return [] }
}

async function upsertCredential(data) {
  const docs = systemContainer()
  if (!docs) throw new Error('credential_store_unavailable')
  await docs.items.upsert({ id: credDocId(data.credentialId), pk: '__system__', kind: 'passkeyCredential', data })
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'] || ''
  return (fwd ? fwd.split(',')[0] : (req.socket?.remoteAddress || '')).trim() || null
}

// ─── Registration (authed: any minted session can enroll a passkey) ──────────
async function registerOptions(req, res) {
  const wa = webauthn()
  if (!wa) return res.status(501).json({ error: 'passkeys_unavailable' })
  const { rpID } = rpFrom(req)
  const uid = String(req.user.uid).toLowerCase()
  const existing = await listCredentialsFor(uid)
  const options = await wa.generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: Buffer.from(uid, 'utf8'),
    userName: req.user.email || uid,
    userDisplayName: req.user.name || uid,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  const requestId = putChallenge(options.challenge, uid)
  return res.json({ requestId, options })
}

async function registerVerify(req, res) {
  const wa = webauthn()
  if (!wa) return res.status(501).json({ error: 'passkeys_unavailable' })
  const { requestId, response, deviceName } = req.body || {}
  if (!requestId || !response) return res.status(400).json({ error: 'request_id_and_response_required' })
  const rec = takeChallenge(requestId)
  const uid = String(req.user.uid).toLowerCase()
  if (!rec || rec.uid !== uid) return res.status(400).json({ error: 'challenge_expired' })

  const { rpID, expectedOrigin } = rpFrom(req)
  let verification
  try {
    verification = await wa.verifyRegistrationResponse({
      response,
      expectedChallenge: rec.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch (err) {
    return res.status(400).json({ error: 'registration_invalid', detail: err.message })
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'registration_not_verified' })
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  try {
    await upsertCredential({
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || response?.response?.transports || [],
      username: uid,
      email: req.user.email || null,
      name: req.user.name || uid,
      tenantId: req.user.tenantId || null,
      deviceType: credentialDeviceType || null,
      backedUp: !!credentialBackedUp,
      deviceName: typeof deviceName === 'string' ? deviceName.slice(0, 64) : null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    })
  } catch {
    return res.status(503).json({ error: 'credential_store_unavailable' })
  }
  await auth.writeLoginAudit('passkey_enrolled', uid, req.user.tenantId || null, getIp(req), req.headers['user-agent'] || null)
  return res.json({ ok: true })
}

async function listMine(req, res) {
  const creds = await listCredentialsFor(req.user.uid)
  return res.json({
    passkeys: creds.map((c) => ({
      credentialId: c.credentialId, deviceName: c.deviceName, deviceType: c.deviceType,
      backedUp: c.backedUp, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt,
    })),
  })
}

// ─── Authentication (public: usernameless, discoverable-credential flow) ─────
async function authOptions(req, res) {
  const wa = webauthn()
  if (!wa) return res.status(501).json({ error: 'passkeys_unavailable' })
  const { rpID } = rpFrom(req)
  const options = await wa.generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [],  // empty → the browser offers whatever passkeys it holds for this rpID
  })
  const requestId = putChallenge(options.challenge, null)
  return res.json({ requestId, options })
}

async function authVerify(req, res) {
  const wa = webauthn()
  if (!wa) return res.status(501).json({ error: 'passkeys_unavailable' })
  const { requestId, response } = req.body || {}
  const ip = getIp(req); const ua = req.headers['user-agent'] || null
  if (!requestId || !response || !response.id) return res.status(400).json({ error: 'request_id_and_response_required' })
  const rec = takeChallenge(requestId)
  if (!rec) return res.status(400).json({ error: 'challenge_expired' })

  const cred = await readCredential(String(response.id))
  if (!cred) {
    await auth.writeLoginAudit('passkey_unknown_credential', null, null, ip, ua)
    return res.status(401).json({ error: 'passkey_not_recognized' })
  }

  const { rpID, expectedOrigin } = rpFrom(req)
  let verification
  try {
    verification = await wa.verifyAuthenticationResponse({
      response,
      expectedChallenge: rec.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, 'base64url'),
        counter: cred.counter || 0,
        transports: cred.transports,
      },
      requireUserVerification: false,
    })
  } catch (err) {
    await auth.writeLoginAudit('passkey_failed', cred.username, cred.tenantId, ip, ua)
    return res.status(401).json({ error: 'passkey_invalid', detail: err.message })
  }
  if (!verification.verified) {
    await auth.writeLoginAudit('passkey_failed', cred.username, cred.tenantId, ip, ua)
    return res.status(401).json({ error: 'passkey_not_verified' })
  }

  // Live identity: role/disabled state come from the CURRENT user record. Bootstrap
  // accounts (no record) are honoured only while still present in BOOTSTRAP_ADMINS.
  const user = await auth.findUser(cred.username)
  let identity
  if (user) {
    if (user.disabled) {
      await auth.writeLoginAudit('login_disabled', cred.username, cred.tenantId, ip, ua)
      return res.status(403).json({ error: 'account_disabled' })
    }
    identity = { uid: user.username, name: user.name || user.username, email: user.email || cred.email, role: user.role || 'VIEWER' }
  } else if (auth.BOOTSTRAP_ADMINS[cred.username]) {
    const admin = auth.BOOTSTRAP_ADMINS[cred.username]
    identity = { uid: cred.username, name: admin.name, email: admin.email, role: 'SUPER_ADMIN' }
  } else {
    await auth.writeLoginAudit('passkey_orphaned', cred.username, cred.tenantId, ip, ua)
    return res.status(401).json({ error: 'account_not_found' })
  }

  const tenantId = cred.tenantId || auth.DEFAULT_TENANT_ID
  if (await auth.isTenantSuspended(tenantId)) {
    await auth.writeLoginAudit('login_tenant_suspended', identity.uid, tenantId, ip, ua)
    return res.status(403).json({ error: 'tenant_suspended', detail: 'This workspace is suspended. Contact your platform administrator.' })
  }

  // Best-effort counter bump (clone detection) + last-used stamp; never blocks sign-in.
  try {
    await upsertCredential({ ...cred, counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() })
  } catch { /* best-effort */ }

  const token = auth.sign({
    sub: identity.uid, name: identity.name, email: identity.email,
    role: identity.role, tenantId, method: 'passkey',
  })
  await auth.writeLoginAudit('passkey_success', identity.uid, tenantId, ip, ua)
  auth.setSessionCookie(req, res, token)
  return res.json({
    user: { uid: identity.uid, email: identity.email, name: identity.name, role: identity.role, tenantId },
    token,
  })
}

module.exports = { registerOptions, registerVerify, listMine, authOptions, authVerify }
