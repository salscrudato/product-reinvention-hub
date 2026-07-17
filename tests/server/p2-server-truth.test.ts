// p2-server-truth.test.ts — the P2 wave's server surfaces:
//   GET  /api/db/drafts/dedup          (contentHash dedup lookup, product:read)
//   GET  /api/portfolio/pulse          (tenant pulse, product:read, 60s cache)
//   GET  /api/portfolio/suggested-queries (deterministic strings, product:read)
//   POST /api/auth/resolve             (pre-auth, uniform — NO enumeration)
//   GET  /api/auth/memberships         (caller's own tenants)
// plus the derived draft-identity projection on /api/db/get + /api/db/list.
//
// Cosmos is a dummy here (repo convention: guards fire BEFORE any I/O), so role
// and validation gates are proven over HTTP, tenant discipline is proven by the
// same source-audit style tenant-isolation.test.ts uses, and the resolve
// endpoint's no-enumeration property is proven BOTH behaviorally (identical
// shape/status for mapped and unmapped domains, live Cosmos not required
// because the handler is config-pure) AND by source audit (no data-store call).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='
process.env.BOOTSTRAP_USERS_ENABLED ??= 'true'
// Domain→tenant mapping is parsed at auth.js load time — set BEFORE the require.
process.env.TENANT_DOMAIN_MAP = '{"mappedco.com":"mapped-tenant"}'
process.env.ALLOWED_EMAIL_DOMAINS = 'mappedco.com'

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.resolve(here, '../../server/lib')
const authSrc = readFileSync(path.join(libDir, 'auth.js'), 'utf8')
const dataSrc = readFileSync(path.join(libDir, 'data.js'), 'utf8')
const portfolioSrc = readFileSync(path.join(libDir, 'portfolio.js'), 'utf8')

const token = (role: string, tid = 'tenantA') => sign({ sub: `u-${role}`, email: `${role}@t`, name: role, role, tenantId: tid })

const READ_ROUTES = [
  '/api/db/drafts/dedup?contentHash=sha256%3Aabcdef123456',
  '/api/portfolio/pulse',
  '/api/portfolio/suggested-queries',
]

describe('P2 routes — role floor (401/403 fire before any Cosmos I/O)', () => {
  it.each(READ_ROUTES)('%s → 401 unauthenticated', async (route) => {
    expect((await request(app).get(route)).status).toBe(401)
  })

  it.each(READ_ROUTES)('%s → 403 for POLICYHOLDER (no product:read — portal persona stays fenced)', async (route) => {
    const res = await request(app).get(route).set('Authorization', `Bearer ${token('POLICYHOLDER')}`)
    expect(res.status).toBe(403)
    expect(res.body.need).toBe('product:read')
  })

  it.each(READ_ROUTES)('%s → passes the gates for VIEWER (read-only role can read)', async (route) => {
    // Dummy Cosmos: success is "not rejected by a guard" (401/403), not a 200.
    const res = await request(app).get(route).set('Authorization', `Bearer ${token('VIEWER')}`)
    expect([401, 403]).not.toContain(res.status)
  })

  it('GET /api/auth/memberships → 401 unauthenticated, never 403 for any staff role', async () => {
    expect((await request(app).get('/api/auth/memberships')).status).toBe(401)
    const res = await request(app).get('/api/auth/memberships').set('Authorization', `Bearer ${token('VIEWER')}`)
    expect([401, 403]).not.toContain(res.status)
  })
})

describe('P2 routes — input validation precedes I/O', () => {
  it('dedup rejects a malformed contentHash with 400 (allow-listed charset, bounded length)', async () => {
    for (const bad of ['', 'short', 'has spaces here!', `x'; DROP--${'a'.repeat(8)}`, 'a'.repeat(200)]) {
      const res = await request(app)
        .get(`/api/db/drafts/dedup?contentHash=${encodeURIComponent(bad)}`)
        .set('Authorization', `Bearer ${token('EDITOR')}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_content_hash')
    }
  })
})

describe('POST /api/auth/resolve — uniform, zero enumeration', () => {
  it('is pre-auth (no 401) and returns { mode, tenantHint } for a mapped domain', async () => {
    const res = await request(app).post('/api/auth/resolve').send({ email: 'user@mappedco.com' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ mode: 'password', tenantHint: 'mapped-tenant' })
  })

  it('responds IDENTICALLY in status + shape for unknown domains (hint is derived, never a DB assertion)', async () => {
    const known = await request(app).post('/api/auth/resolve').send({ email: 'user@mappedco.com' })
    const unknown = await request(app).post('/api/auth/resolve').send({ email: 'user@no-such-tenant-domain.example' })
    expect(unknown.status).toBe(known.status)
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort())
    expect(unknown.body.mode).toBe(known.body.mode)
    // Derived fallback (domain minus TLD) — a plausible hint for EVERY domain, so a
    // mapped answer is indistinguishable from an unmapped one.
    expect(unknown.body.tenantHint).toBe('no-such-tenant-domain')
  })

  it('rejects only on FORMAT (data-independent 400), identically for any malformed input', async () => {
    for (const bad of ['', 'not-an-email', 'a@b', '@x.com']) {
      const res = await request(app).post('/api/auth/resolve').send({ email: bad })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'invalid_email' })
    }
  })

  it('SOURCE AUDIT: the resolve handler performs NO data-store access (uniform timing by construction)', () => {
    const fn = authSrc.slice(authSrc.indexOf('async function resolveLogin'), authSrc.indexOf('async function myMemberships'))
    expect(fn.length).toBeGreaterThan(100)
    for (const needle of ['systemContainer', 'docs.', '.query', 'findUser', 'listTenants', 'isTenantSuspended']) {
      expect(fn).not.toContain(needle)
    }
  })
})

describe('P2 routes — tenant discipline (same conventions tenant-isolation.test.ts pins repo-wide)', () => {
  it('every new tenant-scoped route derives its tenant via resolveTenantForPrincipal(req.user)', () => {
    for (const [src, route] of [
      [dataSrc, "'/drafts/dedup'"],
      [portfolioSrc, "'/pulse'"],
      [portfolioSrc, "'/suggested-queries'"],
    ] as const) {
      const idx = src.indexOf(`router.get(${route}`)
      expect(idx).toBeGreaterThan(-1)
      expect(src.slice(idx, idx + 400)).toMatch(/resolveTenantForPrincipal\(req\.user\)/)
    }
  })

  it('every new Cosmos query filters the server-owned top-level c.tenantId and is TOP-bounded', () => {
    expect(dataSrc).toMatch(/TOP 20 c\.path, c\.data FROM c WHERE c\.kind='entity' AND c\.coll='products' AND c\.tenantId=@tid AND c\.data\.contentHash=@hash/)
    expect((portfolioSrc.match(/c\.tenantId=@tid/g) || []).length).toBe(3)
    expect((portfolioSrc.match(/SELECT TOP \$\{MAX_(PRODUCTS|COVERAGES|TASKS)\}/g) || []).length).toBe(3)
    expect(portfolioSrc).not.toMatch(/c\.data\.tenantId/)
  })

  it('the 60s pulse cache is KEYED by tenant id — one tenant\'s snapshot can never serve another', () => {
    expect(portfolioSrc).toMatch(/_cache\.get\(tid\)/)
    expect(portfolioSrc).toMatch(/_cache\.set\(tid,/)
  })

  it('the portfolio surface is read-only and model-free (zero AI spend by construction)', () => {
    for (const needle of ['fleet', 'mutate', 'upsert', '.create(', 'items.batch', 'anthropic']) {
      expect(portfolioSrc.toLowerCase()).not.toContain(needle)
    }
  })
})

describe('draft identity — server-derived read model on product rows', () => {
  const { deriveDraftIdentity } = _require('../../server/lib/platform-shared.cjs') as {
    deriveDraftIdentity: (d: Record<string, unknown> | null) => { displayName: string | null; sourceFileName: string | null; importedAt: string | null; contentHash: string | null }
  }

  it('the committed bridge exports the SAME projection the shared tests pin (bridge regenerated, not hand-edited)', () => {
    const idn = deriveDraftIdentity({
      lob: { refId: 'PH' },
      lineage: { kind: 'IMPORT', sources: [{ type: 'file', ref: 'HO3_Countrywide_2026.xlsx' }], at: '2026-07-15T14:30:00.000Z' },
    })
    expect(idn.displayName).toBe('HO3_Countrywide_2026 - PH - Jul 15')
    expect(idn.contentHash).toBeNull()
  })

  it('SOURCE AUDIT: /get and /list attach identity + readiness to product rows at READ time (derived last — a stored field cannot spoof them; nothing is persisted)', () => {
    // P3 extends the projection: readiness rides next to identity, same spoof-proof
    // spread order (row first, projections last) and the same read-time-only rule.
    expect(dataSrc).toMatch(/withIdentity = \(row, data\) => \(\{ \.\.\.row, identity: deriveDraftIdentity\(data\), readiness: deriveDraftReadiness\(data\) \}\)/)
    expect(dataSrc).toMatch(/isProductDoc\(ent\.path\) \? withIdentity\(row, ent\.data\) : row/)
    expect(dataSrc).toMatch(/isProducts \? withIdentity\(row, r\.data\) : row/)
  })
})

// ─── P3 — promote verdict + envelope enforcement ─────────────────────────────

describe('P3 promote — POST /api/db/drafts/:id/promote', () => {
  it('401 unauthenticated; 403 for read-only roles (product:write floor)', async () => {
    expect((await request(app).post('/api/db/drafts/d1/promote').send({})).status).toBe(401)
    for (const role of ['VIEWER', 'POLICYHOLDER']) {
      const res = await request(app).post('/api/db/drafts/d1/promote')
        .set('Authorization', `Bearer ${token(role)}`).send({})
      expect(res.status).toBe(403)
    }
  })

  it('passes the gates for EDITOR (guards fire before any Cosmos I/O)', async () => {
    const res = await request(app).post('/api/db/drafts/d1/promote')
      .set('Authorization', `Bearer ${token('EDITOR')}`).send({})
    expect([401, 403]).not.toContain(res.status)
  })

  it('SOURCE AUDIT: the route is capability- + tenant-gated and derives the tenant like every P2 route', () => {
    const idx = dataSrc.indexOf("router.post('/drafts/:id/promote'")
    expect(idx).toBeGreaterThan(-1)
    const fn = dataSrc.slice(idx, idx + 700)
    expect(fn).toMatch(/requireCapability\('product:write'\)/)
    expect(fn).toMatch(/requireTenant/)
    expect(fn).toMatch(/resolveTenantForPrincipal\(req\.user\)/)
  })

  it('SOURCE AUDIT: the envelope NOT_PROMOTABLE guard consults the PERSISTED summary (laundering in the same write is impossible — readiness is also write-once) AND the effective post-write state (create-as-LAUNCHED is gated too)', () => {
    const idx = dataSrc.indexOf("data.lifecycle === 'LAUNCHED'")
    expect(idx).toBeGreaterThan(-1)
    const guard = dataSrc.slice(idx, idx + 900)
    expect(guard).toMatch(/deriveDraftReadiness\(current\?\.data\)/)
    expect(guard).toMatch(/deriveDraftReadiness\(effectiveData\)/)
    expect(guard).toMatch(/NOT_PROMOTABLE/)
    // EVERY route that reaches the envelope surfaces the verdict as a structured 409:
    // /mutate, /mutateBatch, /drafts/:id/promote AND /restore (a restore forward to a
    // LAUNCHED state is still a promotion of a currently-blocked draft).
    expect((dataSrc.match(/status\(409\)\.json\(\{ error: 'not_promotable', blockers: e\.blockers \|\| \[\] \}\)/g) || []).length).toBeGreaterThanOrEqual(4)
  })

  it('SOURCE AUDIT: the readiness summary is WRITE-ONCE — the envelope refuses any later mutation (no laundering channel), mapped to a structured 422 on both write routes', () => {
    expect(dataSrc).toMatch(/'readiness' in data/)
    expect(dataSrc).toMatch(/READINESS_IMMUTABLE/)
    expect((dataSrc.match(/status\(422\)\.json\(\{ error: 'readiness_immutable'/g) || []).length).toBe(2)
  })
})

describe('P3 readiness — server-derived read model on product rows', () => {
  const { deriveDraftReadiness } = _require('../../server/lib/platform-shared.cjs') as {
    deriveDraftReadiness: (d: Record<string, unknown> | null) => { blockers: string[]; validation: string | null; promotable: boolean; source: string }
  }

  it('the committed bridge exports the SAME projection the shared tests pin (bridge regenerated, not hand-edited)', () => {
    const blocked = deriveDraftReadiness({ readiness: { v: 1, counts: { proposed: 3, accepted: 1, unresolved: 2 }, blockers: ['Coverage X: dropped row'], validation: 'fail', importWarnings: 0, completeness: null } })
    expect(blocked.promotable).toBe(false)
    expect(blocked.blockers).toEqual(['Coverage X: dropped row'])
    // Legacy rows: no summary → no verdict → NOT blocked (flag-not-invent).
    const legacy = deriveDraftReadiness({})
    expect(legacy).toEqual({ citations: null, blockers: [], validation: null, promotable: true, source: 'none' })
  })
})
