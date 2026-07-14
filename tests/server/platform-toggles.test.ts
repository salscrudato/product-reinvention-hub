// platform-toggles.test.ts — F5 Wave 3: per-tenant rate limiting, tenant-admin feature-flag
// overrides (within the platform allowlist), and gating. Against the REAL Express app. The
// per-tenant rate cap is forced low via env BEFORE the app module loads so the 429 path is
// deterministic. Cosmos absent → gate + validation assertions fire before external I/O.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-platform-toggles-tests-min32ch'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='
process.env.TENANT_RL_CAP = '2'          // 2 tokens burst
process.env.TENANT_RL_PER_SEC = '0.001'  // effectively no refill during the test

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }

const tok = (role: string, tenantId: string) =>
  sign({ sub: `t-${role.toLowerCase()}-${tenantId}`, email: `${role}@${tenantId}`, name: role, role, tenantId })

// ─── per-tenant rate limiter (layered on top of per-IP + global breaker) ─────
describe('per-tenant rate limiter', () => {
  it('sheds a tenant that exceeds its per-tenant burst with 429 tenant_rate_limited', async () => {
    const editor = tok('EDITOR', 'rl-tenant-a')
    const hit = () => request(app).post('/api/db/mutate').set('Authorization', `Bearer ${editor}`)
      .send({ payload: { op: 'update', path: 'products/x', data: {}, entityType: 'product' } })
    // cap=2 → first two pass the limiter (fail later at Cosmos), the third is limited.
    await hit(); await hit()
    const third = await hit()
    expect(third.status).toBe(429)
    expect(third.body.error).toBe('tenant_rate_limited')
    expect(third.headers['retry-after']).toBeDefined()
  })
  it('is keyed per tenant — a second tenant is unaffected by the first tenant\'s burst', async () => {
    const other = tok('EDITOR', 'rl-tenant-b')
    const res = await request(app).post('/api/db/mutate').set('Authorization', `Bearer ${other}`)
      .send({ payload: { op: 'update', path: 'products/x', data: {}, entityType: 'product' } })
    // fresh tenant bucket → NOT rate-limited (it fails downstream at Cosmos instead).
    expect(res.status).not.toBe(429)
  })
})

// ─── tenant-admin feature-flag overrides (own org, within the allowlist) ─────
describe('tenant-admin flag override gating + allowlist', () => {
  it('PUT /api/tenant-admin/flags → 401 unauthenticated', async () => {
    const res = await request(app).put('/api/tenant-admin/flags').send({ flags: { 'page.rating': false } })
    expect(res.status).toBe(401)
  })
  it('EDITOR (no member:manage) → 403', async () => {
    const res = await request(app).put('/api/tenant-admin/flags').set('Authorization', `Bearer ${tok('EDITOR', 'acme')}`).send({ flags: {} })
    expect(res.status).toBe(403)
  })
  it('VIEWER → 403', async () => {
    const res = await request(app).put('/api/tenant-admin/flags').set('Authorization', `Bearer ${tok('VIEWER', 'acme')}`).send({ flags: {} })
    expect(res.status).toBe(403)
  })
  it('TENANT_ADMIN overriding a PLATFORM-ONLY flag (page.pricing) → 400 (rejected before write)', async () => {
    const res = await request(app).put('/api/tenant-admin/flags')
      .set('Authorization', `Bearer ${tok('TENANT_ADMIN', 'acme')}`).send({ flags: { 'page.pricing': false } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_config')
    expect(String(JSON.stringify(res.body.detail))).toMatch(/not tenant-overridable/)
  })
  it('TENANT_ADMIN overriding an ALLOWED flag passes schema (not a 400; only fails on missing tenant)', async () => {
    const res = await request(app).put('/api/tenant-admin/flags')
      .set('Authorization', `Bearer ${tok('TENANT_ADMIN', 'acme')}`).send({ flags: { 'page.rating': false } })
    expect(res.status).not.toBe(400) // schema accepted the overridable flag
    expect([404, 500]).toContain(res.status) // dummy Cosmos: tenant record absent
  })
  it('GET /api/tenant-admin/config returns the registry + the overridable allowlist', async () => {
    const res = await request(app).get('/api/tenant-admin/config').set('Authorization', `Bearer ${tok('TENANT_ADMIN', 'acme')}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.registry)).toBe(true)
    expect(res.body.overridableKeys).toContain('page.rating')
    expect(res.body.overridableKeys).not.toContain('page.pricing')
  })
})
