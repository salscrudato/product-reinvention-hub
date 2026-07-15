/**
 * hardening-f23-run-results.test.ts — regression lock for ledger F23 (the durable
 * bundle slice).
 *
 * A CORE import runs ~110 minutes over one SSE socket. Every observed live failure
 * (client timeout, App Service restart, transport drop) discarded a finished —
 * and paid-for — bundle: the run was request-bound, so a result computed with
 * nobody listening evaporated. The fix under lock:
 *
 *   1. unifiedImport persists the completed bundle server-side, keyed by the
 *      client-supplied run id, tenant-scoped, EVEN WHEN THE LISTENER IS DEAD
 *      (every res.write throws) — persistence happens at completion, not at emit.
 *   2. A reconnecting client fetches it via POST /api/ai/unifiedImportResult.
 *   3. The store is honest: unconfigured → explicit reason; persistence failure
 *      never kills the run; ids are sanitized before touching blob paths.
 *
 * Offline: fleet env is stubbed, global fetch answers minimal-valid AI shapes
 * (the import-enumerate harness pattern), blob storage is an in-memory fake.
 */
import { describe, it, expect, beforeEach } from 'vitest'

process.env.AZURE_FOUNDRY_ENDPOINT ||= 'https://offline-stub.local'
process.env.AZURE_FOUNDRY_KEY ||= 'offline-stub'
process.env.AUTH_JWT_SECRET ??= 'test-secret-f23-run-results-minimum-32ch'

// ─── In-memory fake of the @azure/storage-blob subset run-results uses ─────────
class FakeContainer {
  blobs = new Map<string, Buffer>()
  failUploads = false
  createIfNotExists() { return Promise.resolve() }
  getBlockBlobClient(path: string) {
    const store = this
    return {
      async uploadData(buf: Buffer) {
        if (store.failUploads) throw new Error('upload exploded')
        store.blobs.set(path, Buffer.from(buf))
      },
      async downloadToBuffer() {
        const b = store.blobs.get(path)
        if (!b) {
          const e = new Error('The specified blob does not exist.') as Error & { statusCode: number }
          e.statusCode = 404
          throw e
        }
        return b
      },
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rr = require('../../server/lib/ai/run-results.js')
const fake = new FakeContainer()
beforeEach(() => { fake.blobs.clear(); fake.failUploads = false; rr.__setClientForTests(fake) })

const BUNDLE = { plan: { productId: 'X', coverages: [] }, counts: { proposed: 0, accepted: 0, unresolved: 0 } }

describe('F23: run-results store', () => {
  it('persist → fetch round-trips the bundle, tenant-scoped', async () => {
    const p = await rr.persistRunResult({ tenantId: 'accenture-test', runId: 'run-abc-123', bundle: BUNDLE })
    expect(p.ok).toBe(true)
    const f = await rr.fetchRunResult({ tenantId: 'accenture-test', runId: 'run-abc-123' })
    expect(f.status).toBe('ok')
    expect(f.envelope.bundle).toEqual(BUNDLE)
    expect(f.envelope.runId).toBe('run-abc-123')
    expect(typeof f.envelope.finishedAt).toBe('string')
  })

  it('another tenant cannot fetch the result', async () => {
    await rr.persistRunResult({ tenantId: 'accenture-test', runId: 'run-abc-123', bundle: BUNDLE })
    const f = await rr.fetchRunResult({ tenantId: 'testco', runId: 'run-abc-123' })
    expect(f.status).toBe('not_found')
  })

  it('hostile ids never reach the blob path', async () => {
    for (const bad of ['../../etc/x', 'a/b', 'a\\b', 'x', '', null, 'run id with spaces']) {
      const p = await rr.persistRunResult({ tenantId: 'accenture-test', runId: bad, bundle: BUNDLE })
      expect(p).toEqual({ ok: false, reason: 'invalid_id' })
    }
    expect(fake.blobs.size).toBe(0)
    const f = await rr.fetchRunResult({ tenantId: 'accenture-test', runId: '../../etc/x' })
    expect(f.status).toBe('invalid_id')
  })

  it('unconfigured storage answers honestly — never a fake success', async () => {
    rr.__setClientForTests(null)
    const p = await rr.persistRunResult({ tenantId: 't', runId: 'run-abc-123', bundle: BUNDLE })
    expect(p).toEqual({ ok: false, reason: 'storage_not_configured' })
    const f = await rr.fetchRunResult({ tenantId: 't', runId: 'run-abc-123' })
    expect(f.status).toBe('storage_not_configured')
  })

  it('a persistence failure is reported, never thrown', async () => {
    fake.failUploads = true
    const p = await rr.persistRunResult({ tenantId: 't1', runId: 'run-abc-123', bundle: BUNDLE })
    expect(p.ok).toBe(false)
    expect(String(p.reason)).toMatch(/exploded/)
  })
})

// ─── Route level: the headless-listener fixture ────────────────────────────────
// Minimal-valid AI stub (import-enumerate pattern): forced tools get {}, text gets '{}'.
function stubGlobalFetch() {
  globalThis.fetch = (async (url: string, opts?: { body?: string }) => {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(opts?.body ?? '{}') } catch { /* ignore */ }
    const toolName = (body?.tool_choice as { name?: string } | undefined)?.name
    const content = toolName
      ? [{ type: 'tool_use', name: toolName, input: {} }]
      : [{ type: 'text', text: '{}' }]
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content, usage: { input_tokens: 1, output_tokens: 1 } }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }) as unknown as typeof fetch
}

type Ev = { t: string; key?: string; value?: unknown; code?: number }
function makeRes(events: Ev[], { deadSocket = false } = {}) {
  const closeHandlers: Array<() => void> = []
  return {
    closeHandlers,
    setHeader() {}, flushHeaders() {},
    on(ev: string, fn: () => void) { if (ev === 'close') closeHandlers.push(fn) },
    status(code: number) { return { json: (o: unknown) => events.push({ t: 'http', code, value: o }) } },
    write(chunk: unknown) {
      if (deadSocket) throw new Error('write EPIPE (client is gone)')
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('data: ')) continue
        try { events.push(JSON.parse(line.slice(6))) } catch { /* :hb */ }
      }
      return true
    },
    end() { for (const fn of closeHandlers) { try { fn() } catch { /* ignore */ } } },
  }
}

const CSV_DOC = {
  name: 'mini-framework.csv',
  text: [
    'PRODUCT FRAMEWORK - GENERAL LIABILITY',
    'STATUS,PRODUCT FRAMEWORK ID,PRODUCT,LINE OF BUSINESS,COVERAGE,FORM NUMBER(S)',
    'Active,GL.PROD.001,Monoline GL,Commercial General Liability,,CG 00 01',
    'Active,GL.COV.001,Monoline GL,Commercial General Liability,Premises Liability,CG 00 01',
  ].join('\n'),
  mediaType: 'text/csv',
}

async function runImport({ runId, deadSocket }: { runId?: string; deadSocket?: boolean }) {
  stubGlobalFetch()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unifiedImport } = require('../../server/lib/ai/unified-import.js')
  const events: Ev[] = []
  const res = makeRes(events, { deadSocket })
  const req = { user: { role: 'ADMIN', sub: 'f23-test', tenantId: 'accenture-test' }, body: { documents: [CSV_DOC], ...(runId ? { runId } : {}) } }
  try {
    await Promise.race([
      unifiedImport(req as never, res as never),
      new Promise((_, rej) => setTimeout(() => rej(new Error('harness timeout 60s')), 60_000)),
    ])
  } finally {
    for (const fn of res.closeHandlers) { try { fn() } catch { /* ignore */ } }
  }
  return events
}

describe('F23: unifiedImport persists the finished bundle', () => {
  it('persists at completion keyed by the client run id (live listener)', async () => {
    const events = await runImport({ runId: 'f23-live-listener-1' })
    expect(events.some(e => e.t === 'json' && e.key === 'bundle')).toBe(true)
    const persisted = events.find(e => e.t === 'json' && e.key === 'run:persisted')?.value as { ok?: boolean } | undefined
    expect(persisted?.ok).toBe(true)
    const f = await rr.fetchRunResult({ tenantId: 'accenture-test', runId: 'f23-live-listener-1' })
    expect(f.status).toBe('ok')
    expect(f.envelope.bundle).toBeTruthy()
  }, 90_000)

  it('THE HEADLESS FIXTURE: the bundle survives a dead listener (every write throws)', async () => {
    await runImport({ runId: 'f23-dead-listener-1', deadSocket: true })
    const f = await rr.fetchRunResult({ tenantId: 'accenture-test', runId: 'f23-dead-listener-1' })
    expect(f.status).toBe('ok')
    expect(f.envelope.bundle).toBeTruthy()
  }, 90_000)

  it('no run id → no persistence (opt-in), and the run still completes', async () => {
    const events = await runImport({})
    expect(events.some(e => e.t === 'json' && e.key === 'bundle')).toBe(true)
    expect(fake.blobs.size).toBe(0)
  }, 90_000)
})

describe('F23: unifiedImportResult endpoint', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unifiedImportResult } = require('../../server/lib/ai/unified-import.js')

  function call(user: Record<string, unknown>, body: Record<string, unknown>) {
    let code = 200; let out: unknown = null
    const res = {
      status(c: number) { code = c; return this },
      json(o: unknown) { out = o; return this },
    }
    return Promise.resolve(unifiedImportResult({ user, body } as never, res as never)).then(() => ({ code, out }))
  }

  it('returns the persisted bundle for the caller tenant', async () => {
    await rr.persistRunResult({ tenantId: 'accenture-test', runId: 'run-fetch-1', bundle: BUNDLE })
    const { code, out } = await call({ role: 'ADMIN', tenantId: 'accenture-test' }, { runId: 'run-fetch-1' })
    expect(code).toBe(200)
    expect((out as { bundle: unknown }).bundle).toEqual(BUNDLE)
  })

  it('404 for an unknown id and for another tenant\'s id', async () => {
    await rr.persistRunResult({ tenantId: 'accenture-test', runId: 'run-fetch-2', bundle: BUNDLE })
    expect((await call({ role: 'ADMIN', tenantId: 'accenture-test' }, { runId: 'run-nope-1' })).code).toBe(404)
    expect((await call({ role: 'ADMIN', tenantId: 'testco' }, { runId: 'run-fetch-2' })).code).toBe(404)
  })

  it('403 without product:write (VIEWER), 400 on a hostile id', async () => {
    expect((await call({ role: 'VIEWER', tenantId: 'accenture-test' }, { runId: 'run-fetch-2' })).code).toBe(403)
    expect((await call({ role: 'ADMIN', tenantId: 'accenture-test' }, { runId: '../../x' })).code).toBe(400)
  })

  it('503 when storage is unconfigured — honest, never a fake 404', async () => {
    rr.__setClientForTests(null)
    expect((await call({ role: 'ADMIN', tenantId: 'accenture-test' }, { runId: 'run-fetch-2' })).code).toBe(503)
  })
})
