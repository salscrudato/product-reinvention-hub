// versions-write.test.ts — H1: prove the WRITE side of the version/history model.
//
// The version READ path is locked by versions-read.test.ts (PCM-B). This suite locks
// the WRITE side: every governed mutation must emit a hash-chained `kind:'version'`
// doc (actor, diff, rev, effective date `at`) in the SAME op batch as the entity, the
// audit event and the chainHead. Both write paths — POST /api/db/mutate (single) and
// POST /api/db/mutateBatch (the import bulk path) — route through the SAME `envelope()`,
// so an imported entity carries a genesis ("version zero") version doc exactly like an
// interactive create.
//
// Cosmos is a dummy in this environment (integration.test.ts:12), so the op assembly
// is tested directly against the pure, Cosmos-free `assembleEnvelope` helper that
// `envelope()`'s async closure calls once its reads resolve. That helper is what BOTH
// write paths converge on, so proving it emits a version op proves both paths do.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

process.env.AUTH_JWT_SECRET ??= 'test-secret-hardening-integration-tests-min32'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const data = _require('../../server/lib/data') as {
  assembleEnvelope: (a: Record<string, unknown>) => { pk: string; ops: Array<{ resourceBody?: Record<string, unknown>; operationType: string; id?: string }>; rev: number }
}
const { computeAuditHash } = _require('../../server/lib/audit-chain-shared.cjs') as {
  computeAuditHash: (e: Record<string, unknown>) => string
}

const NOW = '2026-07-15T00:00:00.000Z'
const ACTOR = { uid: 'u1', name: 'Ada' }

function byKind(ops: Array<{ resourceBody?: Record<string, unknown> }>, kind: string) {
  return ops.map(o => o.resourceBody).filter((b): b is Record<string, unknown> => !!b && b.kind === kind)
}
// The governed entity op is kind:'entity' in its own collection; the grounding chunk is
// ALSO kind:'entity' but in coll:'groundingChunks' — exclude it when counting entities.
function govEntities(ops: Array<{ resourceBody?: Record<string, unknown> }>) {
  return byKind(ops, 'entity').filter(b => b.coll !== 'groundingChunks')
}

describe('H1 version WRITE side — assembleEnvelope emits a hash-chained version doc', () => {
  it('a fresh create (import genesis / "version zero") emits a version doc at rev 1', () => {
    const { ops, rev } = data.assembleEnvelope({
      tid: 't1', path: 'products/P1', entityType: 'product', op: 'create',
      data: { refId: 'P1', name: 'X' }, actor: ACTOR, source: '/api/db/mutateBatch',
      now: NOW, current: null, head: null,
    })
    expect(rev).toBe(1)
    const versions = byKind(ops, 'version')
    expect(versions).toHaveLength(1)
    const v = versions[0]
    expect(v.rev).toBe(1)
    expect(v.op).toBe('create')
    expect(v.entityPath).toBe('products/P1')
    expect(v.actor).toEqual(ACTOR)
    expect(v.at).toBe(NOW)          // effective date recorded on the version
    expect(v.diff).toBeTruthy()     // create diff (before empty, changed = the doc)

    // Same batch also carries entity + audit + chainHead + searchIndex.
    expect(govEntities(ops)).toHaveLength(1)
    expect(govEntities(ops)[0].rev).toBe(1)
    expect(byKind(ops, 'searchIndex')).toHaveLength(1)
    const audit = byKind(ops, 'audit')
    expect(audit).toHaveLength(1)
    expect(audit[0].prevHash).toBeNull()        // genesis: no predecessor
    const chainHead = byKind(ops, 'chainHead')
    expect(chainHead).toHaveLength(1)
    // The audit hash seals the event and matches the chainHead anchor (tamper-evident link).
    const recomputed = computeAuditHash({ tenantId: 't1', ...audit[0] })
    expect(audit[0].hash).toBe(recomputed)
    expect(chainHead[0].hash).toBe(audit[0].hash)
  })

  it('an update advances rev and records the before/after field diff + prevHash link', () => {
    const { ops, rev } = data.assembleEnvelope({
      tid: 't1', path: 'products/P1', entityType: 'product', op: 'update',
      data: { name: 'Y' }, actor: ACTOR, source: '/api/db/mutate',
      now: NOW, current: { data: { refId: 'P1', name: 'X', lob: 'GL' }, rev: 3 }, head: { hash: 'deadbeef' },
    })
    expect(rev).toBe(4)
    const v = byKind(ops, 'version')[0]
    expect(v.rev).toBe(4)
    expect(v.op).toBe('update')
    const diff = v.diff as { before: Record<string, unknown>; changed: Record<string, unknown> }
    expect(diff.before.name).toBe('X')
    expect(diff.changed.name).toBe('Y')
    // Partial-update merge preserves untouched fields (lob) — no accidental wipe.
    const entity = govEntities(ops)[0].data as Record<string, unknown>
    expect(entity.lob).toBe('GL')
    expect(entity.name).toBe('Y')
    // Chain link: this event's prevHash is the prior chainHead.
    expect(byKind(ops, 'audit')[0].prevHash).toBe('deadbeef')
  })

  it('a delete emits a version doc (null diff) and deletes the entity, chain still extends', () => {
    const { ops } = data.assembleEnvelope({
      tid: 't1', path: 'products/P1', entityType: 'product', op: 'delete',
      data: {}, actor: ACTOR, source: '/api/db/mutate',
      now: NOW, current: { data: { refId: 'P1' }, rev: 5 }, head: { hash: 'cafe' },
    })
    const v = byKind(ops, 'version')[0]
    expect(v.rev).toBe(6)
    expect(v.op).toBe('delete')
    expect(v.diff).toBeNull()
    // Entity op is a Delete (not an Upsert).
    expect(ops.some(o => o.operationType === 'Delete')).toBe(true)
    // chainHead still advances so a delete + re-create keeps ONE unbroken chain.
    expect(byKind(ops, 'chainHead')[0].rev).toBe(6)
  })
})

describe('H4 — a provenance-bearing write seals provenance into the audit hash + version doc', () => {
  const PROV = { authoredBy: 'ai', model: 'claude-opus-4-8', citations: ['GL.COV.001'], confidence: 0.9 }
  const args = { tid: 't1', path: 'products/P1', entityType: 'product', op: 'create', data: { refId: 'P1' }, actor: ACTOR, source: '/api/db/mutateBatch', now: NOW, current: null, head: null } as const

  it('provenance rides the audit + version docs and CHANGES the hash (vs an un-provenanced write)', () => {
    const plain = data.assembleEnvelope({ ...args })
    const attested = data.assembleEnvelope({ ...args, provenance: PROV })
    const auditPlain = byKind(plain.ops, 'audit')[0]
    const auditAttested = byKind(attested.ops, 'audit')[0]
    // provenance is carried on BOTH the audit event and the version doc
    expect(auditAttested.provenance).toEqual(PROV)
    expect(byKind(attested.ops, 'version')[0].provenance).toEqual(PROV)
    // sealed: the hash differs from the un-provenanced write and recomputes correctly
    expect(auditAttested.hash).not.toBe(auditPlain.hash)
    expect(computeAuditHash({ tenantId: 't1', ...auditAttested })).toBe(auditAttested.hash)
    // no fork: the un-provenanced write carries NO provenance key at all
    expect('provenance' in auditPlain).toBe(false)
    expect('provenance' in (byKind(plain.ops, 'version')[0])).toBe(false)
  })
})

describe('H1 — BOTH write paths converge on envelope(); READ is the dedicated versions endpoint', () => {
  const src = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/lib/data.js'),
    'utf8',
  )
  it('POST /api/db/mutate builds its op batch through envelope()', () => {
    expect(src).toMatch(/router\.post\('\/mutate'[\s\S]*?envelope\(tid, payload, actor/)
  })
  it('POST /api/db/mutateBatch (import bulk path) builds each payload through envelope()', () => {
    expect(src).toMatch(/router\.post\('\/mutateBatch'[\s\S]*?envelope\(tid, p, actor/)
  })
  it('the version READ is the dedicated /versions endpoint (kind=version), never /list (kind=entity)', () => {
    // /list can never return versions — its WHERE is hard-coded to kind='entity'.
    expect(src).toMatch(/router\.get\('\/versions'[\s\S]*?c\.kind = 'version'/)
    expect(src).toMatch(/router\.post\('\/list'[\s\S]*?c\.kind = 'entity'/)
  })
})
