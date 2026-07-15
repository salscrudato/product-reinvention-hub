// hitl.test.ts — H6: human-in-the-loop for AI-authored governed changes. An AI/voice-authored
// governed mutation must attest a RESOLVABLE citation (non-empty, non-placeholder) or the
// mutation envelope refuses it (422 citation_required) — no silent auto-commit of ungrounded AI
// governance. Enforced at the ENVELOPE (server/lib/data.js) so it holds for EVERY write path (a
// script, a modified client, or a future agent — not just the human-reviewed import UI). Human
// edits and import writes carry no such provenance and are unaffected; a restore is
// authoredBy:'restore' (a deterministic rewind, exempt). A deploy-gate test (pnpm test:gates).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const data = _require('../../server/lib/data') as {
  requiresCitation: (prov: unknown) => boolean
  hasResolvableCitation: (prov: unknown) => boolean
}
const editor = sign({ sub: 'e', email: 'e@t', name: 'E', role: 'EDITOR', tenantId: 'testco' })

function mutate(body: unknown) {
  return request(app).post('/api/db/mutate').set('Authorization', `Bearer ${editor}`).send(body)
}
const gov = (provenance: unknown) => ({ payload: { op: 'update', path: 'products/P1/coverages/C1', data: { limit: 100 }, entityType: 'coverage', provenance } })

describe('H6 HITL — the citation predicates (pure)', () => {
  it('requiresCitation is true ONLY for ai/voice authoring', () => {
    expect(data.requiresCitation({ authoredBy: 'ai' })).toBe(true)
    expect(data.requiresCitation({ authoredBy: 'voice' })).toBe(true)
    expect(data.requiresCitation({ authoredBy: 'human' })).toBe(false)
    expect(data.requiresCitation({ authoredBy: 'restore' })).toBe(false)   // restore is a rewind
    expect(data.requiresCitation(undefined)).toBe(false)                    // human edits / import
  })

  it('hasResolvableCitation needs a non-empty, non-placeholder reference', () => {
    expect(data.hasResolvableCitation({ citations: ['GL.COV.001'] })).toBe(true)
    expect(data.hasResolvableCitation({ citations: [] })).toBe(false)
    expect(data.hasResolvableCitation({ citations: ['', '   '] })).toBe(false)
    expect(data.hasResolvableCitation({ citations: ['unknown', 'N/A', 'TBD', 'none', '-'] })).toBe(false)  // fabricated placeholders
    expect(data.hasResolvableCitation({})).toBe(false)
    expect(data.hasResolvableCitation({ citations: ['n/a', 'PA.RULE.007'] })).toBe(true)  // one real is enough
  })
})

describe('H6 HITL — the envelope refuses an ungrounded AI governed write (422, pre-Cosmos)', () => {
  it('AI-authored with NO citation → 422 citation_required', async () => {
    const res = await mutate(gov({ authoredBy: 'ai', model: 'claude-opus-4-8', citations: [] }))
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('citation_required')
  })

  it('AI-authored with a PLACEHOLDER citation → 422 (fabrication is not grounding)', async () => {
    const res = await mutate(gov({ authoredBy: 'ai', citations: ['unknown'] }))
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('citation_required')
  })

  it('AI-authored WITH a resolvable citation → passes the HITL gate (not 422)', async () => {
    // Cosmos is absent, so a 5xx AFTER the gate is fine — the point is it is NOT 422.
    const res = await mutate(gov({ authoredBy: 'ai', model: 'claude-opus-4-8', citations: ['GL.COV.001'] }))
    expect(res.status).not.toBe(422)
  })

  it('an AI-authored DELETE with no citation is also blocked (deletion is a governed change too)', async () => {
    const res = await request(app).post('/api/db/mutate').set('Authorization', `Bearer ${editor}`)
      .send({ payload: { op: 'delete', path: 'products/P1/coverages/C1', entityType: 'coverage', provenance: { authoredBy: 'ai', citations: [] } } })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('citation_required')
  })

  it('a HUMAN edit (no provenance) is never blocked by the citation gate', async () => {
    const res = await mutate(gov(undefined))
    expect(res.status).not.toBe(422)
  })

  it('a VIEWER is stopped by the role floor BEFORE the citation gate (403, not 422)', async () => {
    const viewer = sign({ sub: 'v', email: 'v@t', name: 'V', role: 'VIEWER', tenantId: 'testco' })
    const res = await request(app).post('/api/db/mutate').set('Authorization', `Bearer ${viewer}`).send(gov({ authoredBy: 'ai', citations: [] }))
    expect(res.status).toBe(403)
  })
})
