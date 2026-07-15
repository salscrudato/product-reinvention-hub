/**
 * hardening-f23-client-recovery.test.ts — F23 client half.
 *
 * (1) Retry policy: full-run re-runs are a ~$70 bill, not a recovery — OPT-IN
 *     via IMPORT_EVAL_MAX_ATTEMPTS, default 1, clamped to [1, 3].
 * (2) Stream-loss recovery: after a severed SSE the client polls the durable
 *     result endpoint — surviving 404s (server still computing) and network
 *     errors (App Service restarting) — and returns the persisted bundle.
 */
import { describe, it, expect } from 'vitest'
import { resolveRetryPolicy, recoverRunResult, mintRunId } from '../../scripts/lib/run-recovery.mts'

describe('F23: retry policy is opt-in', () => {
  it('defaults to 1 attempt (no automatic re-runs)', () => {
    expect(resolveRetryPolicy({})).toEqual({ maxAttempts: 1 })
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: undefined })).toEqual({ maxAttempts: 1 })
  })
  it('honors the env within [1, 3]', () => {
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: '3' })).toEqual({ maxAttempts: 3 })
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: '2' })).toEqual({ maxAttempts: 2 })
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: '99' })).toEqual({ maxAttempts: 3 })
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: '0' })).toEqual({ maxAttempts: 1 })
    expect(resolveRetryPolicy({ IMPORT_EVAL_MAX_ATTEMPTS: 'garbage' })).toEqual({ maxAttempts: 1 })
  })
})

describe('F23: mintRunId matches the server sanitizer', () => {
  it('mints ids the server accepts', () => {
    const id = mintRunId('core-gate')
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/)
  })
})

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
function seq(responses: Array<FakeResponse | Error>): typeof fetch {
  let i = 0
  return (async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r instanceof Error) throw r
    return r
  }) as unknown as typeof fetch
}
const ok = (body: unknown): FakeResponse => ({ ok: true, status: 200, json: async () => body })
const http = (status: number): FakeResponse => ({ ok: false, status, json: async () => ({}) })

const BASE = { baseUrl: 'http://x', token: 't', runId: 'run-test-1234', pollIntervalMs: 1, maxWaitMs: 500 }

describe('F23: recoverRunResult', () => {
  it('recovers the bundle through a restart-shaped sequence (network error → 404 → 200)', async () => {
    const fetchImpl = seq([
      new Error('fetch failed'),          // app restarting
      http(404),                          // up again, run still computing
      ok({ bundle: { plan: { productId: 'X' } }, finishedAt: '2026-07-15T00:00:00Z' }),
    ])
    const r = await recoverRunResult({ ...BASE, fetchImpl })
    expect(r).not.toBeNull()
    expect((r!.bundle as { plan: { productId: string } }).plan.productId).toBe('X')
  })

  it('stops immediately on a structural answer (403), never burning the wait budget', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return http(403) }) as unknown as typeof fetch
    const r = await recoverRunResult({ ...BASE, fetchImpl })
    expect(r).toBeNull()
    expect(calls).toBe(1)
  })

  it('stops immediately when storage is unconfigured (503)', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return http(503) }) as unknown as typeof fetch
    const r = await recoverRunResult({ ...BASE, fetchImpl })
    expect(r).toBeNull()
    expect(calls).toBe(1)
  })

  it('gives up honestly when the result never appears (run died mid-computation)', async () => {
    const fetchImpl = seq([http(404)])
    const r = await recoverRunResult({ ...BASE, fetchImpl, maxWaitMs: 20 })
    expect(r).toBeNull()
  })
})
