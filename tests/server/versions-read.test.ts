// versions-read.test.ts — regression lock for ledger PCM-B (history read path).
//
// The version WRITE path has always worked (envelope() writes kind:'version'
// docs atomically — ledger F19/PCM-C, disproven). The READ path did not exist:
// the client subscribed 'versions' through POST /api/db/list, whose WHERE is
// hard-coded to kind='entity', so the history drawer received [] forever.
// This suite locks the dedicated read endpoint's wiring (guards + validation,
// which fire before any Cosmos I/O — Cosmos is a dummy in this environment).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='
process.env.BOOTSTRAP_USERS_ENABLED ??= 'true'

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign }  = _require('../../server/lib/auth') as { sign: (payload: Record<string, unknown>) => string }

function makeToken(role: string, tenantId = 'testco') {
  return sign({ sub: `test-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test`, name: role, role, tenantId })
}

describe('GET /api/db/versions (PCM-B history read path)', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await request(app).get('/api/db/versions?productId=PH.PROD.001')
    expect(res.status).toBe(401)
  })

  it('returns 400 productId_required before any Cosmos I/O', async () => {
    const res = await request(app)
      .get('/api/db/versions')
      .set('Authorization', `Bearer ${makeToken('VIEWER')}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('productId_required')
  })

  it('VIEWER holds product:read — never 403/404 (history is a read surface)', async () => {
    const res = await request(app)
      .get('/api/db/versions?productId=PH.PROD.001')
      .set('Authorization', `Bearer ${makeToken('VIEWER')}`)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(404)
    // Dummy Cosmos: a 5xx here is acceptable; guards already passed.
  })

  it('POLICYHOLDER (no product:read) is refused', async () => {
    const res = await request(app)
      .get('/api/db/versions?productId=PH.PROD.001')
      .set('Authorization', `Bearer ${makeToken('POLICYHOLDER')}`)
    expect(res.status).toBe(403)
  })
})
