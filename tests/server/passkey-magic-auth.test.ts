// passkey-magic-auth.test.ts — the two new sign-in doors: WebAuthn passkeys
// (usernameless) and the single-use email magic link.
//
// Against the REAL Express app (supertest); Cosmos is absent (dummy endpoint), so
// every assertion here fires on the pre-I/O guards: challenge lifecycle, body
// validation, auth gating, and the public-surface contract. The otp.js magic-token
// store is exercised directly (pure in-memory logic, no I/O).
//
// NOTE on rate limits: all pre-auth login endpoints share ONE per-IP token bucket
// (cap 10/hour). This file stays well under that — do not add loops of requests.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-passkey-magic-tests-min32ch'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const otp = _require('../../server/lib/otp') as {
  generateMagicToken: () => string
  storeMagic: (email: string, token: string, tenantId: string | null) => void
  verifyMagic: (email: string, token: string) => { ok: boolean; reason?: string; tenantId?: string | null }
}

const EDITOR = sign({ sub: 'pk-editor', email: 'pk-editor@test', name: 'PK Editor', role: 'EDITOR', tenantId: 'testco' })

// ─── magic-link token store (otp.js) — hashed, single-use, TTL'd ─────────────
describe('otp.js magic-link tokens', () => {
  it('round-trips a stored token exactly once (single-use)', () => {
    const token = otp.generateMagicToken()
    otp.storeMagic('magic1@test.io', token, 'testco')
    const first = otp.verifyMagic('magic1@test.io', token)
    expect(first).toEqual({ ok: true, tenantId: 'testco' })
    // Second use: the token is burned.
    expect(otp.verifyMagic('magic1@test.io', token).ok).toBe(false)
  })

  it('a wrong token fails AND burns the pending link (no retry surface for a URL token)', () => {
    const token = otp.generateMagicToken()
    otp.storeMagic('magic2@test.io', token, null)
    expect(otp.verifyMagic('magic2@test.io', 'not-the-token').ok).toBe(false)
    // The real token no longer works either — a failed attempt invalidates the link.
    const replay = otp.verifyMagic('magic2@test.io', token)
    expect(replay.ok).toBe(false)
    expect(replay.reason).toBe('not_found')
  })

  it('tokens are high-entropy base64url (no URL-hostile characters)', () => {
    const token = otp.generateMagicToken()
    expect(token.length).toBeGreaterThanOrEqual(40)  // 32 random bytes → 43 b64url chars
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

// ─── magic-link endpoint ──────────────────────────────────────────────────────
describe('POST /api/auth/otp/magic', () => {
  it('rejects a missing email/token pair with 400', async () => {
    const res = await request(app).post('/api/auth/otp/magic').send({ email: 'x@y.z' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('email_and_token_required')
  })

  it('rejects an unknown token with a uniform 400 (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/otp/magic').send({ email: 'nobody@test.io', token: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('magic_invalid')
  })
})

// ─── passkey endpoints: public sign-in surface ───────────────────────────────
describe('passkey authentication (public, usernameless)', () => {
  it('POST /api/auth/passkey/options issues a challenge with NO auth (pre-auth by definition)', async () => {
    const res = await request(app).post('/api/auth/passkey/options').send({})
    expect(res.status).toBe(200)
    expect(typeof res.body.requestId).toBe('string')
    expect(typeof res.body.options?.challenge).toBe('string')
    // Usernameless: the browser offers whatever discoverable credentials it holds.
    expect(res.body.options.allowCredentials ?? []).toEqual([])
  })

  it('POST /api/auth/passkey/verify rejects a malformed body with 400', async () => {
    const res = await request(app).post('/api/auth/passkey/verify').send({})
    expect(res.status).toBe(400)
  })

  it('POST /api/auth/passkey/verify rejects an unknown/expired challenge with 400 (single-use)', async () => {
    const res = await request(app).post('/api/auth/passkey/verify')
      .send({ requestId: 'never-issued', response: { id: 'AAAA' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('challenge_expired')
  })
})

// ─── passkey endpoints: enrollment requires a session ────────────────────────
describe('passkey enrollment (authed only)', () => {
  it('register/options → 401 without a session', async () => {
    const res = await request(app).post('/api/auth/passkey/register/options').send({})
    expect(res.status).toBe(401)
  })

  it('register/options → 200 with a session, challenge bound to the caller', async () => {
    const res = await request(app).post('/api/auth/passkey/register/options')
      .set('Authorization', `Bearer ${EDITOR}`).send({})
    expect(res.status).toBe(200)
    expect(typeof res.body.requestId).toBe('string')
    expect(typeof res.body.options?.challenge).toBe('string')
    expect(res.body.options.user?.name).toBe('pk-editor@test')
    // Discoverable credential demanded — that is what makes usernameless sign-in work.
    expect(res.body.options.authenticatorSelection?.residentKey).toBe('required')
  })

  it('register/verify → 400 when the challenge was never issued (or expired)', async () => {
    const res = await request(app).post('/api/auth/passkey/register/verify')
      .set('Authorization', `Bearer ${EDITOR}`)
      .send({ requestId: 'never-issued', response: { id: 'AAAA' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('challenge_expired')
  })

  it('a register challenge cannot be spent by a DIFFERENT user (uid-bound)', async () => {
    const opt = await request(app).post('/api/auth/passkey/register/options')
      .set('Authorization', `Bearer ${EDITOR}`).send({})
    expect(opt.status).toBe(200)
    const OTHER = sign({ sub: 'pk-other', email: 'pk-other@test', name: 'Other', role: 'EDITOR', tenantId: 'testco' })
    const res = await request(app).post('/api/auth/passkey/register/verify')
      .set('Authorization', `Bearer ${OTHER}`)
      .send({ requestId: opt.body.requestId, response: { id: 'AAAA' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('challenge_expired')
  })

  it('GET /api/auth/passkey/mine → 401 without a session', async () => {
    const res = await request(app).get('/api/auth/passkey/mine')
    expect(res.status).toBe(401)
  })
})
