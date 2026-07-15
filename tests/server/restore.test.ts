// restore.test.ts — H2 / HI-01..HI-04: finish the dormant restore.
//
// Restore is a FORWARD mutation that rewinds an entity's state to a past rev — never a
// history rewrite (HISTORY_SPEC §2). The server reconstructs the target state by
// reverse-applying the recorded before/changed diffs from current back to target; the
// CLIENT never sends a snapshot (so it can't forge one). Three layers are tested:
//   1. reconstructStateAtRev — the pure reverse-apply (unreconstructable → 422 signal).
//   2. POST /api/db/restore — guards that fire before Cosmos I/O (401/403/400).
//   3. HI-04 — the audit chain stays verifiable across a restore (op:'restore' event).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='
process.env.BOOTSTRAP_USERS_ENABLED ??= 'true'

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const data = _require('../../server/lib/data') as {
  reconstructStateAtRev: (
    currentData: Record<string, unknown>,
    versionsByRev: Map<number, { op: string; diff: { before?: Record<string, unknown>; changed?: Record<string, unknown> } | null }>,
    currentRev: number, targetRev: number,
  ) => { state?: Record<string, unknown>; error?: string; firstMissingRev?: number }
  assembleEnvelope: (a: Record<string, unknown>) => { ops: Array<{ resourceBody?: Record<string, unknown> }>; rev: number }
}
const { verifyAuditChain } = _require('../../server/lib/audit-chain-shared.cjs') as {
  verifyAuditChain: (events: unknown[], heads?: Map<string, string>) => { ok: boolean; breaks: unknown[] }
}

const token = (role: string, tid = 'testco') => sign({ sub: `t-${role}`, email: `${role}@t`, name: role, role, tid: tid, tenantId: tid })

// A realistic 3-rev history for one coverage. `diff` mirrors the server's fieldDiff shape.
function history() {
  return new Map<number, { op: string; diff: { before?: Record<string, unknown>; changed?: Record<string, unknown> } | null }>([
    [1, { op: 'create', diff: { before: {}, changed: { name: 'A', limit: 100 } } }],
    [2, { op: 'update', diff: { before: { limit: 100 }, changed: { limit: 200 } } }],
    [3, { op: 'update', diff: { before: { name: 'A' }, changed: { name: 'B' } } }],
  ])
}

describe('H2 reconstructStateAtRev — reverse-apply diffs, honest gaps', () => {
  it('reconstructs the exact state at an older rev (full rewind)', () => {
    const current = { name: 'B', limit: 200 }
    expect(data.reconstructStateAtRev(current, history(), 3, 1).state).toEqual({ name: 'A', limit: 100 })
  })

  it('reconstructs an intermediate rev (partial rewind)', () => {
    const current = { name: 'B', limit: 200 }
    expect(data.reconstructStateAtRev(current, history(), 3, 2).state).toEqual({ name: 'A', limit: 200 })
  })

  it('undoes an ADDED field (delete it) and a REMOVED field (restore it)', () => {
    const versions = new Map<number, { op: string; diff: { before?: Record<string, unknown>; changed?: Record<string, unknown> } | null }>([
      [1, { op: 'create', diff: { before: {}, changed: { name: 'A', limit: 100 } } }],
      [2, { op: 'update', diff: { before: {}, changed: { tier: 'gold' } } }],          // added tier
      [3, { op: 'update', diff: { before: { limit: 100 }, changed: {} } }],            // removed limit
    ])
    const current = { name: 'A', tier: 'gold' }                                        // state at rev 3
    // rewind to rev 1: tier removed, limit restored → the original create state.
    expect(data.reconstructStateAtRev(current, versions, 3, 1).state).toEqual({ name: 'A', limit: 100 })
  })

  it('a MISSING intermediate version is unreconstructable (→ 422 firstMissingRev), never a best-guess', () => {
    const gapped = history(); gapped.delete(2)
    const r = data.reconstructStateAtRev({ name: 'B', limit: 200 }, gapped, 3, 1)
    expect(r.state).toBeUndefined()
    expect(r.error).toBe('unreconstructable')
    expect(r.firstMissingRev).toBe(2)
  })

  it('a DELETE in the range is unreconstructable (pre-delete values are unknowable)', () => {
    const withDelete = history()
    withDelete.set(2, { op: 'delete', diff: null })
    const r = data.reconstructStateAtRev({ name: 'B' }, withDelete, 3, 1)
    expect(r.error).toBe('unreconstructable')
    expect(r.firstMissingRev).toBe(2)
  })

  it('does not mutate the caller\'s current-state object', () => {
    const current = { name: 'B', limit: 200 }
    data.reconstructStateAtRev(current, history(), 3, 1)
    expect(current).toEqual({ name: 'B', limit: 200 })
  })
})

describe('POST /api/db/restore — guards that fire before Cosmos I/O', () => {
  const body = { path: 'products/PH.PROD.001/coverages/PH-COV-001', targetRev: 1, expectedRev: 3 }
  it('401 unauthenticated', async () => {
    expect((await request(app).post('/api/db/restore').send(body)).status).toBe(401)
  })
  it('403 for VIEWER (restore is a write — product:write, EDITOR+)', async () => {
    const res = await request(app).post('/api/db/restore').set('Authorization', `Bearer ${token('VIEWER')}`).send(body)
    expect(res.status).toBe(403)
  })
  it('400 when path is missing', async () => {
    const res = await request(app).post('/api/db/restore').set('Authorization', `Bearer ${token('EDITOR')}`).send({ targetRev: 1 })
    expect(res.status).toBe(400)
  })
  it('400 when targetRev is missing or not a positive integer', async () => {
    for (const t of [undefined, 0, -1, 1.5, 'x']) {
      const res = await request(app).post('/api/db/restore').set('Authorization', `Bearer ${token('EDITOR')}`).send({ path: body.path, targetRev: t })
      expect(res.status).toBe(400)
    }
  })
  it('EDITOR passes the guards (non-401/403/400 — Cosmos unavailable so 5xx is acceptable)', async () => {
    const res = await request(app).post('/api/db/restore').set('Authorization', `Bearer ${token('EDITOR')}`).send(body)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(400)
  })
})

describe('HI-04 — the audit chain stays verifiable across a restore cycle', () => {
  it('a restore emits a forward op:\'restore\' event that chains + verifies green', () => {
    // Build create → update via assembleEnvelope, then a restore as its own forward event.
    const NOW = ['2026-07-15T00:00:00Z', '2026-07-15T00:01:00Z', '2026-07-15T00:02:00Z']
    const actor = { uid: 'u', name: 'Ada' }
    const path = 'products/P1/coverages/C1'
    const e1 = data.assembleEnvelope({ tid: 't1', path, entityType: 'coverage', op: 'create', data: { name: 'A', limit: 100 }, actor, source: 's', now: NOW[0], current: null, head: null })
    const a1 = auditOf(e1); const head1 = { hash: a1.hash, etag: 'e1' }
    const e2 = data.assembleEnvelope({ tid: 't1', path, entityType: 'coverage', op: 'update', data: { limit: 200 }, actor, source: 's', now: NOW[1], current: { data: { name: 'A', limit: 100 }, rev: 1 }, head: head1 })
    const a2 = auditOf(e2); const head2 = { hash: a2.hash, etag: 'e2' }
    // Restore to rev 1 = a forward mutation (op:'restore', reconstructed state, provenance).
    const e3 = data.assembleEnvelope({
      tid: 't1', path, entityType: 'coverage', op: 'restore', data: { name: 'A', limit: 100 },
      actor, source: '/api/db/restore', now: NOW[2], current: { data: { name: 'A', limit: 200 }, rev: 2 }, head: head2,
      provenance: { authoredBy: 'restore', restoredFrom: 1 },
    })
    const a3 = auditOf(e3)
    expect(a3.op).toBe('restore')
    expect((a3.provenance as { restoredFrom: number }).restoredFrom).toBe(1)
    // The full chain — including the restore event — verifies with the tail anchor.
    const heads = new Map([[`t1 ${path}`, a3.hash as string]])
    const v = verifyAuditChain([a1, a2, a3], heads)
    expect(v.ok).toBe(true)
    expect(v.breaks).toEqual([])
    // And the restore's provenance is genuinely sealed (tamper it → the chain breaks).
    const tampered = { ...a3, provenance: { authoredBy: 'restore', restoredFrom: 999 } }
    expect(verifyAuditChain([a1, a2, tampered], heads).ok).toBe(false)
  })

  function auditOf(env: { ops: Array<{ resourceBody?: Record<string, unknown> }> }): Record<string, unknown> {
    return env.ops.map(o => o.resourceBody).find(b => b?.kind === 'audit') as Record<string, unknown>
  }
})
