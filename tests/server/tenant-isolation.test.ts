// tenant-isolation.test.ts — H6: a cross-tenant READ and a cross-tenant WRITE both fail
// CLOSED. This is a deploy-gate test (wired into azure-pipelines.yml via `pnpm test:gates`)
// because the CI canary step only runs @pf/shared. Isolation is enforced four ways, each
// proven here: (1) the working tenant is derived from the JWT, never the body/query;
// (2) a SUPER_ADMIN-only X-Tenant-Id override — tenant-plane roles are pinned to their JWT;
// (3) every write's partition key + tenantId are SERVER-derived (a client can't smuggle a
// foreign tenant); (4) every read is pk-scoped AND filters c.tenantId, with a defense-in-depth
// `doc.tenantId === tid` drop. Cosmos is a dummy here, so the behavioral proofs use the pure
// assembleEnvelope + resolveTenantForPrincipal, and the query/strip guarantees are proven by a
// source audit of the exact enforcement code (the repo's server-invariants convention).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='
process.env.BOOTSTRAP_USERS_ENABLED ??= 'true'

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const auth = _require('../../server/lib/auth') as { resolveTenantForPrincipal: (p: unknown) => string }
const data = _require('../../server/lib/data') as {
  assembleEnvelope: (a: Record<string, unknown>) => { ops: Array<{ resourceBody?: Record<string, unknown> }>; rev: number }
  scopeDoc: (doc: unknown, tid: string) => unknown
}

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.resolve(here, '../../server/lib')
const dataSrc = readFileSync(path.join(libDir, 'data.js'), 'utf8')
const authSrc = readFileSync(path.join(libDir, 'auth.js'), 'utf8')
// The WHOLE server library — so a NEW route in ANY file that reads the working tenant from
// the request (not the principal) is caught, not just data.js.
const allLibSrc = readdirSync(libDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(libDir, f), 'utf8')).join('\n')
const token = (role: string, tid: string) => sign({ sub: `t-${role}-${tid}`, email: `${role}@t`, name: role, role, tenantId: tid })

describe('H6 — cross-tenant WRITE fails closed', () => {
  it('a smuggled foreign tenantId/pk cannot escape the caller\'s partition (authoritative fields are server-derived)', () => {
    // A malicious client tries to plant a doc in tenant B while authenticated as tenant A.
    const env = data.assembleEnvelope({
      tid: 'tenantA', path: 'products/P1', entityType: 'product', op: 'create',
      data: { tenantId: 'tenantB', pk: 'tenantB|products', name: 'x' },
      actor: { uid: 'u', name: 'N' }, source: '/api/db/mutate', now: '2026-07-15T00:00:00Z', current: null, head: null,
    })
    // EVERY op — entity, audit, version, searchIndex, chainHead, chunk — is stamped with the
    // SERVER tenant (queries filter c.tenantId; Cosmos partitions on pk). Both say tenantA.
    for (const op of env.ops) {
      const b = op.resourceBody
      if (!b) continue
      expect(b.tenantId).toBe('tenantA')
      expect(String(b.pk).startsWith('tenantA|')).toBe(true)
    }
  })

  it('the mutation envelope STRIPS client-supplied envelope keys (tenantId, pk) from data', () => {
    // RESERVED_ENVELOPE_KEYS + the strip loop are the belt to the assembleEnvelope braces.
    expect(dataSrc).toMatch(/RESERVED_ENVELOPE_KEYS\s*=\s*\[[^\]]*'tenantId'[^\]]*'pk'/)
    expect(dataSrc).toMatch(/for \(const k of RESERVED_ENVELOPE_KEYS\) delete data\[k\]/)
  })

  it('NO server route (anywhere in server/lib) derives its working tenant from the request body/query', () => {
    // The working tenant must come from the JWT-derived principal, never a client-chosen value.
    expect(allLibSrc).not.toMatch(/req\.body\.tenantId|req\.query\.tenantId/)
    // mutate / mutateBatch / restore all derive tid via resolveTenantForPrincipal(req.user).
    for (const route of ["'/mutate'", "'/mutateBatch'", "'/restore'"]) {
      const idx = dataSrc.indexOf(`router.post(${route}`)
      expect(idx).toBeGreaterThan(-1)
      expect(dataSrc.slice(idx, idx + 400)).toMatch(/resolveTenantForPrincipal\(req\.user\)/)
    }
  })
})

describe('H6 — cross-tenant READ fails closed', () => {
  it('resolveTenantForPrincipal returns the JWT-derived tenant, never a client-chosen value', () => {
    expect(auth.resolveTenantForPrincipal({ tenantId: 'tenantA', role: 'EDITOR' })).toBe('tenantA')
    expect(auth.resolveTenantForPrincipal({ tenantId: 'tenantB', role: 'VIEWER' })).toBe('tenantB')
  })

  it('the X-Tenant-Id override is SUPER_ADMIN-only — tenant-plane roles are pinned to their JWT', () => {
    // The only place the working tenant can differ from the JWT is this guarded override.
    expect(authSrc).toMatch(/if \(role === 'SUPER_ADMIN'\)\s*\{[\s\S]{0,160}x-tenant-id/i)
  })

  it('FUNCTIONAL: scopeDoc (the real read-side defense-in-depth) drops a cross-tenant doc', () => {
    // This is the EXACT predicate readEntity + readChainHead run on every read. A doc that
    // somehow surfaced from another tenant's partition is returned as null, never leaked.
    expect(data.scopeDoc({ tenantId: 'tenantB', data: { secret: 1 } }, 'tenantA')).toBeNull()
    expect(data.scopeDoc(undefined, 'tenantA')).toBeNull()
    const own = { tenantId: 'tenantA', data: { ok: 1 } }
    expect(data.scopeDoc(own, 'tenantA')).toBe(own)
    // …and the production readers actually route through it (not a copy).
    expect(dataSrc).toMatch(/return scopeDoc\(r, tid\)/)
    expect(dataSrc).toMatch(/scopeDoc\(\(await storeFor\(tid\)\.item\(idFor\('chn'/)
  })

  it('isolation depends on the SERVER-owned top-level c.tenantId, never a client-writable c.data.tenantId', () => {
    // /list, /versions, /audit/verify all constrain the TOP-LEVEL c.tenantId = @tid…
    expect((dataSrc.match(/c\.tenantId = @tid/g) || []).length).toBeGreaterThanOrEqual(3)
    // …and NO query ever filters on c.data.tenantId (which a client could smuggle).
    expect(dataSrc).not.toMatch(/c\.data\.tenantId/)
    // the partition key itself embeds the tenant, so even a cross-partition query is bounded.
    expect(dataSrc).toMatch(/pkFor = \(tid, path\) => `\$\{tid\}\|/)
  })
})

describe('H6 — the guards that keep isolation closed (runtime, pre-Cosmos)', () => {
  it('an unauthenticated read is refused (401)', async () => {
    expect((await request(app).get('/api/db/versions?productId=PH.PROD.001')).status).toBe(401)
  })
  it('a VIEWER cannot write (403) — role floor holds before any tenant I/O', async () => {
    const res = await request(app).post('/api/db/mutate')
      .set('Authorization', `Bearer ${token('VIEWER', 'tenantA')}`)
      .send({ payload: { op: 'update', path: 'products/P1', data: { name: 'x' }, entityType: 'product' } })
    expect(res.status).toBe(403)
  })
  it('a tenant-plane EDITOR cannot reach another tenant\'s data through the platform plane (403)', async () => {
    const res = await request(app).get('/api/admin/tenants/tenantB/export')
      .set('Authorization', `Bearer ${token('EDITOR', 'tenantA')}`)
    expect(res.status).toBe(403)
  })
})
