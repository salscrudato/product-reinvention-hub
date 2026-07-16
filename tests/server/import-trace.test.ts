// import-trace.test.ts — run-trace telemetry: the tracer derives a faithful,
// BOUNDED per-stage record from the SSE frame stream (steps, timings, payloads,
// spend, escalations, notices, outcome), the ring buffer serves reads with no
// store configured, and the /api/admin/import/runs surface is platform-gated.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createRequire } from 'module'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-import-trace-tests-min32chars!'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY     ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const runTrace = _require('../../server/lib/ai/run-trace') as {
  createRunTrace: (opts: Record<string, unknown>) => {
    trace: Record<string, any>
    observe: (ev: unknown) => void
    finish: () => void
    setPath: (p: string) => void
    setSource: (name: string, docs?: unknown[]) => void
  }
  listRunTraces: (opts?: { limit?: number; tenantId?: string | null }) => Promise<any[]>
  getRunTrace: (runId: string) => Promise<any | null>
  storageMode: () => string
  __clearForTests: () => void
  __setDocsForTests: (docs: unknown) => void
}

const tok = (role: string, tenantId = 'testco') =>
  sign({ sub: `t-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test`, name: role, role, tenantId })
const SA = tok('SUPER_ADMIN', 'default')
const EDITOR = tok('EDITOR')

// Memory-only store: deterministic, no network I/O against the dummy endpoint.
runTrace.__setDocsForTests(null)
afterAll(() => runTrace.__setDocsForTests(undefined))

beforeEach(() => runTrace.__clearForTests())

function playWorkbookRun(tracer: ReturnType<typeof runTrace.createRunTrace>) {
  tracer.setPath('workbook')
  tracer.setSource('hagerty-core.xlsx', [{ name: 'hagerty-core.xlsx', sizeKB: 412, mediaType: 'application/xlsx' }])
  tracer.observe({ t: 'tool', name: 'brain:stage0:route', phase: 'start', summary: 'Routing 1 document(s) by content' })
  tracer.observe({ t: 'tool', name: 'brain:stage0:route', phase: 'end', summary: '1 workbook(s), 0 filing PDF(s), 0 unrecognized' })
  tracer.observe({ t: 'json', key: 'brain:stage0', value: { workbooks: ['hagerty-core.xlsx'], filingDocs: [], unknown: [], warnings: [] } })
  tracer.observe({ t: 'json', key: 'brain:input', value: { sourceName: 'hagerty-core.xlsx', sheetCount: 3, sheetNames: ['A', 'B', 'C'] } })
  tracer.observe({ t: 'tool', name: 'brain:stage1:classify', phase: 'start', summary: 'Classifying 3 sheet(s)' })
  tracer.observe({ t: 'tool', name: 'brain:stage1:classify', phase: 'end', summary: '2 content sheet(s), 1 ignored' })
  tracer.observe({ t: 'json', key: 'brain:stage1', value: [{ sheetName: 'A', domain: 'product-framework', confidence: 0.97 }] })
  tracer.observe({ t: 'tool', name: 'brain:stage4:extract', phase: 'start', summary: 'Extracting rows' })
  tracer.observe({ t: 'tool', name: 'brain:stage4:extract', phase: 'progress', summary: 'batch 1/4' })
  tracer.observe({ t: 'json', key: 'brain:escalation', value: { fromRole: 'BULK_VERIFY', toRole: 'MID_REASONER', deployment: 'sonnet' } })
  tracer.observe({ t: 'tool', name: 'brain:stage4:extract', phase: 'end', summary: '120 entities extracted, 4 flagged' })
  tracer.observe({ t: 'json', key: 'brain:stage4', value: { entityCount: 120, flagged: 4 } })
  tracer.observe({ t: 'notice', level: 'warn', kind: 'incomplete-product', message: 'Forms-only upload' })
  tracer.observe({ t: 'json', key: 'brain:spend', value: { spendUsd: 1.2345, calls: 12, noCap: true, byDeployment: { haiku: { calls: 8, inputTokens: 1000, outputTokens: 200, usd: 0.4 } } } })
  tracer.observe({ t: 'json', key: 'bundle', value: {
    plan: { productId: 'PH.PROD.001', coverages: [{}, {}], forms: [{}], rules: [], rtTables: [], ldTables: [] },
    counts: { proposed: 10, accepted: 8, unresolved: 2 },
    review: { coverages: { items: [{}, {}] } },
    completeness: { assessment: 'PARTIAL' },
    importWarnings: [{ kind: 'duplicate-refId', detail: 'x' }],
    unresolved: [{ kind: 'low-confidence', name: 'Agreed Value' }],
    fingerprint: { detectedFormat: 'ISO_WORKBOOK' },
  } })
  tracer.observe({ t: 'done' })
}

describe('createRunTrace derives a faithful run record from the frame stream', () => {
  it('captures steps, payloads, spend, escalations, notices and outcome', () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-test-0001', tenantId: 'testco', actor: { uid: 'u1', name: 'Sal', role: 'SUPER_ADMIN' } })
    playWorkbookRun(tracer)
    const t = tracer.trace

    expect(t.status).toBe('succeeded')
    expect(t.needsReview).toBe(true) // 2 unresolved + 1 warning
    expect(t.path).toBe('workbook')
    expect(t.sourceName).toBe('hagerty-core.xlsx')
    expect(t.durationMs).not.toBeNull()

    const names = t.steps.map((s: any) => s.name)
    expect(names).toEqual(['brain:stage0:route', 'brain:stage1:classify', 'brain:stage4:extract'])
    const extract = t.steps[2]
    expect(extract.status).toBe('done')
    expect(extract.result).toBe('120 entities extracted, 4 flagged')
    expect(extract.progress).toEqual(['batch 1/4'])
    expect(extract.durationMs).toBeGreaterThanOrEqual(0)

    expect(t.outputs['brain:stage1'].value[0].domain).toBe('product-framework')
    expect(t.outputs['brain:stage1'].truncated).toBe(false)
    expect(t.spend.spendUsd).toBe(1.2345)
    expect(t.escalations).toHaveLength(1)
    expect(t.escalations[0].toRole).toBe('MID_REASONER')
    expect(t.notices).toHaveLength(1)

    expect(t.outcome).toMatchObject({
      productId: 'PH.PROD.001', coverages: 2, forms: 1,
      proposed: 10, accepted: 8, unresolved: 2, reviewItems: 2,
      completeness: 'PARTIAL', importWarnings: 1, detectedFormat: 'ISO_WORKBOOK',
    })
    // Flag-not-invent carriers are kept on the trace for the inspector.
    expect(t.outputs['importWarnings'].value[0].kind).toBe('duplicate-refId')
    expect(t.outputs['unresolved'].value[0].name).toBe('Agreed Value')
  })

  it('an error frame marks the run failed and closes open steps as errored', () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-test-0002', tenantId: 'testco' })
    tracer.observe({ t: 'tool', name: 'brain:stage1:classify', phase: 'start' })
    tracer.observe({ t: 'error', message: 'Import error: boom' })
    tracer.observe({ t: 'done' })
    expect(tracer.trace.status).toBe('failed')
    expect(tracer.trace.error).toContain('boom')
    expect(tracer.trace.steps[0].status).toBe('error')
  })

  it('bounds oversized stage payloads to a sample and reports the original size', () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-test-0003', tenantId: 'testco' })
    const huge = Array.from({ length: 5000 }, (_, i) => ({ refId: `PH.COV.${i}`, name: 'Coverage '.repeat(10) + i }))
    tracer.observe({ t: 'json', key: 'brain:stage4', value: huge })
    const rec = tracer.trace.outputs['brain:stage4']
    expect(rec.truncated).toBe(true)
    expect(rec.bytes).toBeGreaterThan(48 * 1024)
    expect(rec.value.__sample).toBe(true)
    expect(rec.value.totalItems).toBe(5000)
    expect(rec.value.items.length).toBeGreaterThan(0)
    expect(rec.value.items.length).toBeLessThan(5000)
    // The bounded record itself must be small enough to persist.
    expect(JSON.stringify(rec).length).toBeLessThan(96 * 1024)
    // refIds in the sample stay byte-for-byte.
    expect(rec.value.items[0].refId).toBe('PH.COV.0')
  })

  it('a frame stream with no bundle and no error still finishes (failed, honest)', () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-test-0004', tenantId: 'testco' })
    tracer.observe({ t: 'done' })
    expect(tracer.trace.status).toBe('failed')
  })
})

describe('memory-ring read side', () => {
  it('lists newest-first summaries and fetches the full trace', async () => {
    const a = runTrace.createRunTrace({ runId: 'run-list-000a', tenantId: 'testco' })
    playWorkbookRun(a)
    const b = runTrace.createRunTrace({ runId: 'run-list-000b', tenantId: 'otherco' })
    b.observe({ t: 'done' })

    const all = await runTrace.listRunTraces({ limit: 10 })
    expect(all.map((r) => r.runId)).toContain('run-list-000a')
    expect(all.map((r) => r.runId)).toContain('run-list-000b')
    // Summaries are light: stage list without payloads.
    const summary = all.find((r) => r.runId === 'run-list-000a')!
    expect(summary.stages).toHaveLength(3)
    expect(summary.spendUsd).toBe(1.2345)
    expect((summary as any).outputs).toBeUndefined()

    const filtered = await runTrace.listRunTraces({ limit: 10, tenantId: 'otherco' })
    expect(filtered.map((r) => r.runId)).toEqual(['run-list-000b'])

    const full = await runTrace.getRunTrace('run-list-000a')
    expect(full.outputs['brain:stage1']).toBeDefined()
    expect(await runTrace.getRunTrace('run-nope-0000')).toBeNull()

    expect(runTrace.storageMode()).toBe('memory')
  })
})

describe('platform gating on /api/admin/import/runs', () => {
  const routes: Array<[string, string]> = [
    ['get', '/api/admin/import/runs'],
    ['get', '/api/admin/import/runs/run-test-0001'],
  ]
  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path} → 401 unauthenticated`, async () => {
      const res = await (request(app) as any)[method](path)
      expect(res.status).toBe(401)
    })
    it(`${method.toUpperCase()} ${path} → 403 for EDITOR (tenant plane)`, async () => {
      const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${EDITOR}`)
      expect(res.status).toBe(403)
    })
  }

  it('GET /api/admin/import/runs → 200 with run summaries for SUPER_ADMIN', async () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-http-0001', tenantId: 'testco' })
    playWorkbookRun(tracer)
    const res = await request(app).get('/api/admin/import/runs').set('Authorization', `Bearer ${SA}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.storage).toBe('memory')
    expect(res.body.runs.map((r: any) => r.runId)).toContain('run-http-0001')
  })

  it('GET /api/admin/import/runs/:runId → 200 full trace / 404 unknown', async () => {
    const tracer = runTrace.createRunTrace({ runId: 'run-http-0002', tenantId: 'testco' })
    playWorkbookRun(tracer)
    const ok = await request(app).get('/api/admin/import/runs/run-http-0002').set('Authorization', `Bearer ${SA}`)
    expect(ok.status).toBe(200)
    expect(ok.body.run.steps.length).toBeGreaterThan(0)
    const missing = await request(app).get('/api/admin/import/runs/run-nope-0001').set('Authorization', `Bearer ${SA}`)
    expect(missing.status).toBe(404)
  })
})
