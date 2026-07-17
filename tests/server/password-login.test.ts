// password-login.test.ts — the simple bootstrap password door.
//
// /api/auth/bootstrap validates EXACTLY the accounts in the BOOTSTRAP_ADMINS map
// (admin, sal) — no user-record lookup, so the account list is closed and the
// endpoint cannot be used to probe for provisioned usernames. Both accounts are
// always-on (USER DIRECTIVE 2026-07-17) and granted SUPER_ADMIN.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-password-login-tests-min32c'
process.env.BOOTSTRAP_USERS_ENABLED = 'true'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const auth = _require('../../server/lib/auth') as {
  BOOTSTRAP_ADMINS: Record<string, { password: string }>
  passwordsMatch: (expected: string | null | undefined, submitted: string) => boolean
}

describe('passwordsMatch — timing-safe credential compare', () => {
  it('accepts the exact password and rejects everything else', () => {
    expect(auth.passwordsMatch('s3cret-passphrase', 's3cret-passphrase')).toBe(true)
    expect(auth.passwordsMatch('s3cret-passphrase', 's3cret-passphrase ')).toBe(false)
    expect(auth.passwordsMatch('s3cret-passphrase', '')).toBe(false)
  })

  it('a missing stored credential NEVER matches (no password ≠ any password)', () => {
    expect(auth.passwordsMatch(null, '')).toBe(false)
    expect(auth.passwordsMatch(undefined, 'undefined')).toBe(false)
  })
})

describe('the sign-in accounts (admin + sal), nothing else', () => {
  it('exactly the two bootstrap accounts exist', () => {
    expect(Object.keys(auth.BOOTSTRAP_ADMINS).sort()).toEqual(['admin', 'sal'])
  })

  it('sal/scrudato signs in (SUPER_ADMIN)', async () => {
    const res = await request(app).post('/api/auth/bootstrap')
      .send({ username: 'sal', password: 'scrudato', tenant: 'testco' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ uid: 'sal', role: 'SUPER_ADMIN', tenantId: 'testco' })
    expect(typeof res.body.token).toBe('string')
  })

  it('admin/admin signs in (SUPER_ADMIN)', async () => {
    const res = await request(app).post('/api/auth/bootstrap')
      .send({ username: 'admin', password: 'admin', tenant: 'testco' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ uid: 'admin', role: 'SUPER_ADMIN', tenantId: 'testco' })
    expect(typeof res.body.token).toBe('string')
  })

  it('a wrong password → uniform 401', async () => {
    const res = await request(app).post('/api/auth/bootstrap')
      .send({ username: 'sal', password: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_credentials')
  })

  it('any other username → the SAME uniform 401 (no account probing)', async () => {
    const res = await request(app).post('/api/auth/bootstrap')
      .send({ username: 'someone-else', password: 'whatever' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_credentials')
  })

  it('missing fields → 400', async () => {
    const res = await request(app).post('/api/auth/bootstrap').send({ username: 'admin' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('username_and_password_required')
  })
})
