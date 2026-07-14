// platform.test.ts — F5 ops plane: platform-gating, schema-validated config (rejected
// before any write), and the PARTITION-SCOPED delete isolation invariant. Against the REAL
// Express app (supertest); Cosmos/Foundry absent, so gate + validation assertions fire
// before any external I/O. The delete-isolation invariant is proven against a mock store
// injected into admin.js's extracted deleteTenantData (deployment-independent).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-platform-ops-plane-tests-min32ch'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const admin = _require('../../server/lib/admin') as {
  _internals: { deleteTenantData: (store: unknown, tid: string) => Promise<number> }
}

const tok = (role: string, tenantId = 'testco') =>
  sign({ sub: `t-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test`, name: role, role, tenantId })

const SA = tok('SUPER_ADMIN', 'default')
const EDITOR = tok('EDITOR')
const VIEWER = tok('VIEWER')

// ─── every platform-plane route rejects non-platform roles + unauth ──────────
describe('platform gating on the ops-plane routes', () => {
  const routes: Array<[string, string]> = [
    ['post', '/api/admin/tenants'],
    ['get', '/api/admin/tenants/acme/export'],
    ['post', '/api/admin/tenants/acme/offboard'],
    ['get', '/api/admin/config/global'],
    ['put', '/api/admin/config/global'],
    ['get', '/api/admin/tenants/acme/config'],
    ['put', '/api/admin/tenants/acme/config'],
    ['get', '/api/admin/tenants/acme/telemetry'],
  ]
  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path} → 401 unauthenticated`, async () => {
      const res = await (request(app) as any)[method](path).send({})
      expect(res.status).toBe(401)
    })
    it(`${method.toUpperCase()} ${path} → 403 for EDITOR (tenant plane)`, async () => {
      const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${EDITOR}`).send({})
      expect(res.status).toBe(403)
    })
    it(`${method.toUpperCase()} ${path} → 403 for VIEWER`, async () => {
      const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${VIEWER}`).send({})
      expect(res.status).toBe(403)
    })
  }
})

// ─── invalid config is rejected by schema BEFORE any write (no audit noise) ──
describe('schema-validated config rejects bad values before persisting', () => {
  it('PUT /config/global with an unknown flag → 400 invalid_config', async () => {
    const res = await request(app).put('/api/admin/config/global')
      .set('Authorization', `Bearer ${SA}`).send({ flags: { 'page.bogus': true } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_config')
  })
  it('PUT /config/global with a non-boolean flag → 400', async () => {
    const res = await request(app).put('/api/admin/config/global')
      .set('Authorization', `Bearer ${SA}`).send({ flags: { 'page.rating': 'yes' } })
    expect(res.status).toBe(400)
  })
  it('PUT /tenants/:id/config with entitlement over the platform cap → 400', async () => {
    const res = await request(app).put('/api/admin/tenants/acme/config')
      .set('Authorization', `Bearer ${SA}`).send({ entitlements: { maxSeats: 999_999_999 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_config')
    expect(String(JSON.stringify(res.body.detail))).toMatch(/cap/)
  })
  it('PUT /tenants/:id/config with an unknown top-level key → 400 (typo protection)', async () => {
    const res = await request(app).put('/api/admin/tenants/acme/config')
      .set('Authorization', `Bearer ${SA}`).send({ entitlement: { maxSeats: 5 } })
    expect(res.status).toBe(400)
  })
  it('PUT /tenants/:id/config with an unknown model role → 400', async () => {
    const res = await request(app).put('/api/admin/tenants/acme/config')
      .set('Authorization', `Bearer ${SA}`).send({ entitlements: { aiModelRoles: ['claude-fable-5'] } })
    expect(res.status).toBe(400)
  })
})

// ─── partition-scoped delete: touches ONLY the target tenant's partitions ────
// A mock store that applies the Cosmos `c.tenantId = @tid` filter the same way the
// service does. Offboarding tenant A must delete every A doc and leave EVERY B doc.
function mockStore(initial: Array<{ id: string; pk: string; tenantId: string }>) {
  let docsArr = initial.slice()
  const deleted: Array<{ id: string; pk: string }> = []
  return {
    remaining: () => docsArr,
    deleted: () => deleted,
    items: {
      query({ parameters }: { parameters: Array<{ name: string; value: string }> }) {
        const tid = parameters.find((p) => p.name === '@tid')!.value
        let served = false
        return {
          fetchNext: async () => {
            if (served) return { resources: [], continuationToken: null }
            served = true
            const rows = docsArr.filter((d) => d.tenantId === tid).slice(0, 1000).map((d) => ({ id: d.id, pk: d.pk }))
            return { resources: rows, continuationToken: null }
          },
        }
      },
    },
    item(id: string, pk: string) {
      return {
        delete: async () => {
          const i = docsArr.findIndex((d) => d.id === id && d.pk === pk)
          if (i === -1) { const e: any = new Error('not_found'); e.code = 404; throw e }
          docsArr.splice(i, 1)
          deleted.push({ id, pk })
        },
      }
    },
  }
}

describe('offboard delete is partition-scoped (isolation invariant)', () => {
  it('deletes only tenant A docs; every tenant B doc survives', async () => {
    const store = mockStore([
      { id: 'ent:products~a1', pk: 'acme|products', tenantId: 'acme' },
      { id: 'aud:1', pk: 'acme|products', tenantId: 'acme' },
      { id: 'ent:coverages~c1', pk: 'acme|coverages', tenantId: 'acme' },
      { id: 'chn:products~a1', pk: 'acme|products', tenantId: 'acme' },
      { id: 'ent:products~b1', pk: 'beta|products', tenantId: 'beta' },
      { id: 'aud:2', pk: 'beta|products', tenantId: 'beta' },
      { id: 'ent:coverages~b1', pk: 'beta|coverages', tenantId: 'beta' },
    ])
    const deleted = await admin._internals.deleteTenantData(store, 'acme')
    expect(deleted).toBe(4)
    const remaining = store.remaining()
    expect(remaining.every((d) => d.tenantId === 'beta')).toBe(true)
    expect(remaining.length).toBe(3)
    // Every delete targeted a pk in acme's partitions — never a beta partition.
    expect(store.deleted().every((d) => d.pk.startsWith('acme|'))).toBe(true)
  })
  it('is a no-op when the tenant has no docs (idempotent)', async () => {
    const store = mockStore([{ id: 'ent:x', pk: 'beta|products', tenantId: 'beta' }])
    const deleted = await admin._internals.deleteTenantData(store, 'ghost')
    expect(deleted).toBe(0)
    expect(store.remaining().length).toBe(1)
  })
})

// ─── suspend blocks login: enforcement lives at OTP verify (auth.js) ─────────
// The read path needs Cosmos; here we pin the fast-path contract (DEFAULT tenant is never
// suspended) and document that the full block is proven in the deferred live test.
describe('tenant suspension gate (auth.js)', () => {
  it('exports isTenantSuspended and never suspends the DEFAULT tenant', async () => {
    const auth = _require('../../server/lib/auth') as { isTenantSuspended: (t: string) => Promise<boolean>; DEFAULT_TENANT_ID: string }
    expect(typeof auth.isTenantSuspended).toBe('function')
    expect(await auth.isTenantSuspended(auth.DEFAULT_TENANT_ID)).toBe(false)
  })
})
