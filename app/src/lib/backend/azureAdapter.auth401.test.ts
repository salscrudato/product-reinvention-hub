// @vitest-environment jsdom
/**
 * azureAdapter.auth401.test.ts — regression lock for the 401 session-expiry storm.
 *
 * A 401 used to clear only the TOKEN: currentUser stayed set, AppShell kept
 * rendering the authed app, and every smart-polling subscription rescheduled
 * forever — an endless console storm of unauthenticated /api/db/* calls.
 * The lock: a 401 performs the full LOCAL sign-out (user listeners see null,
 * caches cleared) and an unauthenticated poller never reschedules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const FAKE_JWT = `${b64url({ alg: 'none' })}.${b64url({ sub: 'admin', email: 'admin@x', role: 'ADMIN', tenantId: 't1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

function res401() { return { status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) } }
function res200(data: unknown) { return { status: 200, ok: true, json: async () => ({ data }) } }

describe('azure adapter — 401 means local sign-out, never a polling storm', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.setItem('pf.azure.token', FAKE_JWT)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('a 401 on any api call signs the session out locally (user -> null, token cleared)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res401()))
    const { adapter } = await import('./azure.adapter')
    const seen: Array<unknown> = []
    adapter.auth.onUser((u) => seen.push(u))
    await expect(adapter.db.get('users/admin')).rejects.toThrow('unauthenticated')
    // The decoded token fired first (signed-in), then the 401 flipped it to null
    // (onUser's /auth/me validation also 401s — same terminal state).
    await vi.waitFor(() => { expect(seen[seen.length - 1]).toBeNull() })
    expect(localStorage.getItem('pf.azure.token')).toBeNull()
  })

  it('an unauthenticated poller stops rescheduling for good', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/auth/me')) return { status: 200, ok: true, json: async () => ({ user: { uid: 'admin', email: 'admin@x', role: 'ADMIN', tenantId: 't1' } }) }
      return res401()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter } = await import('./azure.adapter')
    const errors: unknown[] = []
    const unsub = adapter.db.subscribe('products', () => {}, (e) => errors.push(e))
    await vi.advanceTimersByTimeAsync(50)                    // first tick → 401
    const callsAfterFirstTick = fetchMock.mock.calls.filter(c => String(c[0]).includes('/db/')).length
    expect(callsAfterFirstTick).toBeGreaterThanOrEqual(1)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(30 * 60_000)           // half an hour of fake time
    const callsAfterHalfHour = fetchMock.mock.calls.filter(c => String(c[0]).includes('/db/')).length
    expect(callsAfterHalfHour, 'poller must not reschedule after unauthenticated').toBe(callsAfterFirstTick)
    unsub()
  })

  it('a healthy poller keeps polling (the stop is 401-specific)', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/auth/me')) return { status: 200, ok: true, json: async () => ({ user: { uid: 'admin', email: 'admin@x', role: 'ADMIN', tenantId: 't1' } }) }
      return res200([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter } = await import('./azure.adapter')
    const unsub = adapter.db.subscribe('products', () => {})
    await vi.advanceTimersByTimeAsync(50)
    const first = fetchMock.mock.calls.filter(c => String(c[0]).includes('/db/')).length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const later = fetchMock.mock.calls.filter(c => String(c[0]).includes('/db/')).length
    expect(later).toBeGreaterThan(first)
    unsub()
  })
})
