/**
 * CE3 Step 8 lock: the import-run observatory persists an index doc + per-stage
 * artifacts to a tenant-scoped, path-sanitized store, lists newest-first, honors
 * an unconfigured store honestly, and refuses id traversal. A fake in-memory
 * blob client stands in for Azure Blob (no network).
 */
import { describe, it, expect, beforeEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const obs = require('../../server/lib/ai/run-observatory.js') as {
  persistImportRun: (a: { tenantId: string; runId: string; indexDoc: unknown }) => Promise<{ ok: boolean; reason?: string }>
  persistStageArtifact: (a: { tenantId: string; runId: string; stage: string; artifact: unknown }) => Promise<{ ok: boolean; reason?: string }>
  listImportRuns: (a: { tenantId: string; limit?: unknown }) => Promise<{ status: string; runs?: Record<string, unknown>[] }>
  getImportRun: (a: { tenantId: string; runId: string }) => Promise<{ status: string; run?: Record<string, unknown> }>
  getStageArtifact: (a: { tenantId: string; runId: string; stage: string }) => Promise<{ status: string; artifact?: Record<string, unknown> }>
  censusEvent: (p: unknown) => { t: string; key: string; value: unknown }
  sweeperEvent: (s: string, a: number, b: number) => { key: string; value: { swept: number; reviewed: number } }
  cacheEvent: (h: number, m: number) => { key: string; value: { hits: number; misses: number } }
  __setClientForTests: (c: unknown | null) => void
}

// ── in-memory blob container fake ─────────────────────────────────────────────
class FakeBlob {
  constructor(private store: Map<string, Buffer>, private name: string) {}
  async uploadData(body: Buffer) { this.store.set(this.name, Buffer.from(body)) }
  async downloadToBuffer() {
    const b = this.store.get(this.name)
    if (!b) { const e = new Error('not found') as Error & { statusCode: number }; e.statusCode = 404; throw e }
    return b
  }
}
function fakeClient() {
  const store = new Map<string, Buffer>()
  return {
    store,
    getBlockBlobClient: (name: string) => new FakeBlob(store, name),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listBlobsFlat: ({ prefix }: { prefix: string }) => (async function* () {
      for (const name of store.keys()) if (name.startsWith(prefix)) yield { name }
    })(),
  }
}

describe('run-observatory (CE3 Step 8)', () => {
  beforeEach(() => obs.__setClientForTests(fakeClient()))

  it('persists an index doc + artifact and reads them back tenant-scoped', async () => {
    expect((await obs.persistImportRun({ tenantId: 'testco', runId: 'run-aaaaaaaa-1', indexDoc: { status: 'ok', metrics: { coverages: 7 } } })).ok).toBe(true)
    expect((await obs.persistStageArtifact({ tenantId: 'testco', runId: 'run-aaaaaaaa-1', stage: 'stage1', artifact: { classified: 4 } })).ok).toBe(true)
    const got = await obs.getImportRun({ tenantId: 'testco', runId: 'run-aaaaaaaa-1' })
    expect(got.status).toBe('ok')
    expect(got.run).toMatchObject({ kind: 'importRun', runId: 'run-aaaaaaaa-1', tenantId: 'testco', status: 'ok' })
    const art = await obs.getStageArtifact({ tenantId: 'testco', runId: 'run-aaaaaaaa-1', stage: 'stage1' })
    expect(art.status).toBe('ok')
    expect(art.artifact).toMatchObject({ stage: 'stage1', artifact: { classified: 4 } })
  })

  it('lists newest-first, capped', async () => {
    await obs.persistImportRun({ tenantId: 'testco', runId: 'run-old-0001', indexDoc: { updatedAt: '2026-07-16T01:00:00.000Z' } })
    await obs.persistImportRun({ tenantId: 'testco', runId: 'run-new-0002', indexDoc: { updatedAt: '2026-07-16T09:00:00.000Z' } })
    const list = await obs.listImportRuns({ tenantId: 'testco' })
    expect(list.status).toBe('ok')
    expect(list.runs!.map(r => r.runId)).toEqual(['run-new-0002', 'run-old-0001'])
    // cross-tenant isolation: another tenant sees nothing.
    const other = await obs.listImportRuns({ tenantId: 'rival' })
    expect(other.runs).toEqual([])
  })

  it('is honest when the store is unconfigured', async () => {
    obs.__setClientForTests(null)
    expect((await obs.persistImportRun({ tenantId: 'testco', runId: 'run-aaaaaaaa-1', indexDoc: {} })).reason).toBe('storage_not_configured')
    expect((await obs.listImportRuns({ tenantId: 'testco' })).status).toBe('storage_not_configured')
    expect((await obs.getImportRun({ tenantId: 'testco', runId: 'run-aaaaaaaa-1' })).status).toBe('storage_not_configured')
  })

  it('refuses id / stage traversal', async () => {
    expect((await obs.persistImportRun({ tenantId: '../etc', runId: 'run-aaaaaaaa-1', indexDoc: {} })).reason).toBe('invalid_id')
    expect((await obs.getStageArtifact({ tenantId: 'testco', runId: 'run-aaaaaaaa-1', stage: '../../secret' })).status).toBe('invalid_id')
    expect((await obs.getImportRun({ tenantId: 'testco', runId: 'x' })).status).toBe('invalid_id')  // too short
  })

  it('SSE event builders carry the pinned shapes', () => {
    expect(obs.censusEvent([{ sheet: 'A', nonEmpty: 3 }])).toEqual({ t: 'json', key: 'brain:census', value: { perSheet: [{ sheet: 'A', nonEmpty: 3 }] } })
    expect(obs.sweeperEvent('S', 5, 2)).toMatchObject({ key: 'brain:sweeper', value: { swept: 5, reviewed: 2 } })
    expect(obs.cacheEvent(9, 1)).toMatchObject({ key: 'brain:cache', value: { hits: 9, misses: 1 } })
  })
})
