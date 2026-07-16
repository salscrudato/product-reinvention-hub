// metering.test.ts — F5 Wave 4: per-tenant AI metering + cost attribution + monthly budget
// throttle + request telemetry. Tests the metering module directly (Cosmos persistence is
// best-effort and no-ops when absent, so results are deterministic regardless of Cosmos).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

process.env.AUTH_JWT_SECRET ??= 'test-secret-metering-tests-minimum-32chars'
// Cosmos must be ABSENT for this suite: metering persistence is best-effort and no-ops
// without it (sysDocs() -> null), which is what makes these results deterministic. A dummy
// endpoint here used to force every meter()/snapshot through a failing network call whose
// latency was load-dependent and intermittently blew the 5s default test timeout.
delete process.env.COSMOS_ENDPOINT
delete process.env.COSMOS_KEY

const _require = createRequire(import.meta.url)
const metering = _require('../../server/lib/metering') as {
  meter: (tid: string, deployment: string, i: number, o: number) => Promise<void>
  meterCurrent: (deployment: string, i: number, o: number) => void
  snapshotTenant: (tid: string) => Promise<{ totalTokens: number; calls: number; costUsd: number; budget: number; throttled: boolean; byDeployment: Record<string, number> }>
  checkTenantBudget: (tid: string) => Promise<{ ok: boolean; used: number; budget: number }>
  withTenant: <T>(tid: string, fn: () => T) => T
  currentTenant: () => string | undefined
  recordRequest: (tid: string, status: number, ms: number) => void
  requestSnapshot: (tid: string) => { count: number; errors: number; errorRatePct: number; avgLatencyMs: number; byStatusClass: Record<string, number> }
}

const HAIKU = 'claude-haiku-4-5'

describe('per-tenant AI metering + cost attribution', () => {
  it('accumulates tokens + cost per tenant, isolated from other tenants', async () => {
    await metering.meter('mt-a', HAIKU, 1000, 500)
    await metering.meter('mt-a', HAIKU, 2000, 1000)
    const snap = await metering.snapshotTenant('mt-a')
    expect(snap.totalTokens).toBe(4500)
    expect(snap.calls).toBe(2)
    expect(snap.costUsd).toBeGreaterThan(0)
    expect(snap.byDeployment[HAIKU]).toBe(4500)
    // a different tenant is untouched
    const other = await metering.snapshotTenant('mt-z')
    expect(other.totalTokens).toBe(0)
  })
})

describe('per-tenant monthly budget throttle (independent of the global breaker)', () => {
  it('a tenant under its monthly token budget is not throttled', async () => {
    await metering.meter('mt-under', HAIKU, 1000, 500)
    const b = await metering.checkTenantBudget('mt-under')
    expect(b.ok).toBe(true)
    expect(b.budget).toBeGreaterThan(0)
  })
  it('a tenant over its monthly token budget IS throttled', async () => {
    // Default entitlement is 20M tokens/month; blow past it in one attributed call.
    await metering.meter('mt-over', HAIKU, 21_000_000, 0)
    const b = await metering.checkTenantBudget('mt-over')
    expect(b.ok).toBe(false)
    expect(b.used).toBeGreaterThanOrEqual(b.budget)
    const snap = await metering.snapshotTenant('mt-over')
    expect(snap.throttled).toBe(true)
  })
})

describe('AsyncLocalStorage tenant context', () => {
  it('withTenant sets the ambient tenant for the duration', () => {
    const seen = metering.withTenant('ctx-tenant', () => metering.currentTenant())
    expect(seen).toBe('ctx-tenant')
    // outside any context, there is no ambient tenant
    expect(metering.currentTenant()).toBeUndefined()
  })
  it('meterCurrent outside a tenant context is a silent no-op (never throws)', () => {
    expect(() => metering.meterCurrent(HAIKU, 10, 10)).not.toThrow()
  })
})

describe('per-tenant request telemetry', () => {
  it('tracks count / errors / latency / status classes', () => {
    metering.recordRequest('rt-a', 200, 10)
    metering.recordRequest('rt-a', 200, 30)
    metering.recordRequest('rt-a', 503, 50)
    const s = metering.requestSnapshot('rt-a')
    expect(s.count).toBe(3)
    expect(s.errors).toBe(1)
    expect(s.errorRatePct).toBeCloseTo(33.3, 0)
    expect(s.avgLatencyMs).toBe(30)
    expect(s.byStatusClass).toEqual({ '2xx': 2, '5xx': 1 })
  })
})
