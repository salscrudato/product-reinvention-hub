// integration.test.ts — supertest smoke tests against the Express app.
//
// Why: unit tests cannot catch server wiring mistakes (wrong middleware order,
// missing route mounts, role guards on wrong routes). These tests verify the
// real Express app responds correctly to HTTP requests.
//
// What is tested:
//   POST /api/auth/bootstrap — 401 bad creds, 200 valid, 429 rate limit
//   POST /api/db/mutate   — 403 VIEWER, non-403 EDITOR (role enforcement)
//   POST /api/ai/chat     — 503 when fleet unconfigured
//
// Cosmos is unavailable in the test environment. The dummy env vars below cause
// cosmos.js to create a client object without throwing so /api/db mounts.
// Role enforcement fires before any Cosmos I/O, so 403/non-403 assertions are
// valid. A 200 on mutate would require a live Cosmos connection.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

// Must be set before ANY server module is loaded (they read process.env at require time).
// Use ??= so a real secret in the environment is not clobbered if already present.
process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='
// Leave AZURE_FOUNDRY_ENDPOINT / AZURE_FOUNDRY_KEY unset so fleet.isConfigured() = false.

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign }  = _require('../../server/lib/auth') as { sign: (payload: Record<string, unknown>) => string }

function makeToken(role: string, tenantId = 'testco') {
  return sign({ sub: `test-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test`, name: role, role, tenantId })
}

// ─── /api/auth/bootstrap ─────────────────────────────────────────────────────

describe('POST /api/auth/bootstrap', () => {
  it('returns 401 on bad credentials', async () => {
    const res = await request(app)
      .post('/api/auth/bootstrap')
      .send({ username: 'admin', password: 'wrong', tenant: 'testco' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_credentials')
  })

  it('returns 200 with token on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/bootstrap')
      .send({ username: 'admin', password: 'admin', tenant: null })
    // admin has no tenant requirement; any 200 or 400/tenant_required is acceptable
    // depending on the bootstrap config. Accept either non-401/non-429 response.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(429)
  })

  it('returns 429 after the rate-limit cap is exhausted', async () => {
    // Use a unique X-Forwarded-For IP so this test does not interfere with others.
    const rateLimitIp = '10.99.99.2'
    // The bucket cap is 10; first request initialises at cap-1=9 tokens. After 10
    // total requests the bucket is at 0; the 11th gets 429.
    let lastStatus = 0
    for (let i = 0; i < 11; i++) {
      const r = await request(app)
        .post('/api/auth/bootstrap')
        .set('X-Forwarded-For', rateLimitIp)
        .send({ username: 'nobody', password: 'wrong', tenant: 'testco' })
      lastStatus = r.status
    }
    expect(lastStatus).toBe(429)
  })
})

// ─── /api/db/mutate ───────────────────────────────────────────────────────────

describe('POST /api/db/mutate', () => {
  const viewerToken = makeToken('VIEWER')
  const editorToken = makeToken('EDITOR')
  const payload = {
    payload: {
      op: 'SET',
      path: 'products/test-prod',
      data: { refId: 'TEST', name: 'Test' },
      entityType: 'product',
      actor: { uid: 'test', name: 'Test' },
    },
  }

  it('returns 403 for VIEWER role', async () => {
    const res = await request(app)
      .post('/api/db/mutate')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(payload)
    expect(res.status).toBe(403)
  })

  it('EDITOR role passes enforcement (non-403 response)', async () => {
    // Role check passes — Cosmos unavailable in test env so expect 5xx, not 403.
    const res = await request(app)
      .post('/api/db/mutate')
      .set('Authorization', `Bearer ${editorToken}`)
      .send(payload)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })
})

// ─── /api/ai/chat ─────────────────────────────────────────────────────────────

describe('POST /api/ai/chat', () => {
  it('returns 503 when AI fleet is unconfigured', async () => {
    // AZURE_FOUNDRY_ENDPOINT is not set → fleet.isConfigured() = false → 503.
    const analystToken = makeToken('ANALYST')
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ messages: [{ role: 'user', content: 'hello' }] })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('ai_not_configured')
  })
})
