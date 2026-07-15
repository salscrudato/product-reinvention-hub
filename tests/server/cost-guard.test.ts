// cost-guard.test.ts — H6 observability: the AI cost guard now TALLIES trips (hard-ceiling
// denials) + degrades (soft-threshold signals) so a fuzz/soak run can PROVE the guard fired,
// and a platform-plane admin diagnostics read (GET /api/admin/ai/cost-guard) exposes the
// counters. Import stays exempt (never contributes a trip). A deploy-gate test (pnpm test:gates).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const fleet = _require('../../server/lib/fleet') as {
  guard: (ctx?: string) => { allow: boolean; degrade: boolean; reason: string }
  record: (dep: string, i: number, o: number) => void
  snapshot: () => { windowSpendUsd: number; ceilingUsd: number; callCount: number; trips: number; degrades: number; windowRemainingMs: number }
  DEPLOY_OPUS: string
  IMPORT_CONTEXT: string
}

describe('fleet cost-guard counters (trips / degrades)', () => {
  it('counts a hard-ceiling denial as a trip, and import never trips', () => {
    const base = fleet.snapshot()
    expect(base.trips).toBeGreaterThanOrEqual(0)
    expect(fleet.guard().allow).toBe(true)               // under the ceiling → allowed

    // Push spend well over the ceiling, then a guarded (non-import) call is DENIED + tripped.
    fleet.record(fleet.DEPLOY_OPUS, 0, 3_000_000)        // ~$225 >> the $25 default ceiling
    const g = fleet.guard()
    expect(g.allow).toBe(false)
    expect(g.reason).toBe('ai_budget_ceiling')

    const s = fleet.snapshot()
    expect(s.trips).toBeGreaterThanOrEqual(base.trips + 1)
    expect(s.windowSpendUsd).toBeGreaterThan(s.ceilingUsd)
    expect(s.callCount).toBeGreaterThanOrEqual(1)        // record() bumped callCount
    expect(typeof s.degrades).toBe('number')
    expect(typeof s.windowRemainingMs).toBe('number')

    // The import path's named exemption is NEVER denied and NEVER counted as a trip.
    const beforeImport = fleet.snapshot().trips
    const gi = fleet.guard(fleet.IMPORT_CONTEXT)
    expect(gi.allow).toBe(true)
    expect(gi.reason).toBe('import_no_cap')
    expect(fleet.snapshot().trips).toBe(beforeImport)
  })
})

describe('GET /api/admin/ai/cost-guard (platform-plane diagnostics read)', () => {
  const tok = (role: string, tid = 'testco') => sign({ sub: `t-${role}`, email: `${role}@t`, name: role, role, tenantId: tid })
  it('401 unauthenticated', async () => {
    expect((await request(app).get('/api/admin/ai/cost-guard')).status).toBe(401)
  })
  it('403 for a tenant-plane EDITOR (platform plane only)', async () => {
    expect((await request(app).get('/api/admin/ai/cost-guard').set('Authorization', `Bearer ${tok('EDITOR')}`)).status).toBe(403)
  })
  it('403 for VIEWER', async () => {
    expect((await request(app).get('/api/admin/ai/cost-guard').set('Authorization', `Bearer ${tok('VIEWER')}`)).status).toBe(403)
  })
  it('SUPER_ADMIN gets the live counters (calls, spend, trips, degrades)', async () => {
    const res = await request(app).get('/api/admin/ai/cost-guard').set('Authorization', `Bearer ${sign({ sub: 'sa', email: 'sa@t', name: 'SA', role: 'SUPER_ADMIN', tenantId: 'default' })}`)
    expect(res.status).toBe(200)
    expect(res.body.costGuard).toMatchObject({
      ceilingUsd: expect.any(Number), callCount: expect.any(Number),
      trips: expect.any(Number), degrades: expect.any(Number), windowSpendUsd: expect.any(Number),
    })
  })
})
