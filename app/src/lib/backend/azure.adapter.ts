// azure.adapter.ts — the Azure implementation of BackendAdapter.
//
// Talks ONLY to the same-origin Azure host API (/api/*): JWT auth, Cosmos-backed
// data, and Foundry-Claude AI. No Firebase, no GCloud. This is the swap target
// for src/lib/backend/index.ts. The React app is unchanged — it depends only on
// this contract (see types.ts).
//
// Real-time: Firestore onSnapshot has no Cosmos equivalent in the browser, so
// subscribe() degrades to SMART POLLING (see the "smart polling" block below).
// Semantics match the Firebase adapter: string paths only, even segments =
// document, odd = collection, degrade to null/[] + onError on failure.

import type { Unsubscribe } from '@pf/shared'
import type { AuthUser, BackendAdapter, ManagedUser, TenantMember, MutationPayload, Query, Session, TenantInfo } from './types'
import { MutationConflictError } from './types'

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const TOKEN_KEY = 'pf.azure.token'

// ─── token + fetch helpers ───────────────────────────────────────────────────
let token: string | null = (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || null

function decode(tok: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(tok.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null
    return { uid: p.sub, email: p.email ?? null, name: p.name ?? null, role: p.role ?? null, tenantId: p.tenantId ?? null }
  } catch { return null }
}

let currentUser: AuthUser | null = token ? decode(token) : null
const userListeners = new Set<(u: AuthUser | null) => void>()
function setUser(u: AuthUser | null) { currentUser = u; userListeners.forEach((cb) => cb(u)) }

// Active tenant override for SUPER_ADMIN: sent as X-Tenant-Id on every request.
let activeTenantOverride: string | null = null

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const extraHeaders: Record<string, string> = {}
  if (activeTenantOverride && currentUser?.role === 'SUPER_ADMIN') {
    extraHeaders['X-Tenant-Id'] = activeTenantOverride
  }
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
      ...(init.headers || {}),
    },
  })
  if (res.status === 409) throw new MutationConflictError()
  if (res.status === 401) { setToken(null); throw new Error('unauthenticated') }
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function setToken(t: string | null) {
  token = t
  if (typeof localStorage !== 'undefined') {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }
}

/** Set or clear the active tenant for a SUPER_ADMIN session.
 *  Clears all cached data so the next poll loads from the new tenant. */
export function setSuperAdminTenant(id: string | null): void {
  activeTenantOverride = id
  snapshotCache.clear()
  dataCache.clear()
  for (const p of pollers) { p.reset(); p.tick() }
}

const isDoc = (path: string) => path.split('/').filter(Boolean).length % 2 === 0

// ─── smart polling ─────────────────────────────────────────────────────────────
// Cosmos has no browser onSnapshot, so subscribe() polls. Naive fixed-interval
// polling hammers Cosmos (RU cost) for every tab left open, so the poller:
//   1. PAUSES entirely when the tab is hidden (Page Visibility API) and resumes
//      with an immediate fresh fetch on visibility/focus — a backgrounded tab
//      issues ZERO reads.
//   2. BACKS OFF geometrically while data is unchanged (POLL_MIN → POLL_MAX) and
//      snaps back to POLL_MIN on any change or right after a local mutation.
//   3. DEDUPES — never overlaps a fetch for the same subscription (in-flight guard).
//   4. Serves the last value for a path from an in-memory cache instantly on a new
//      subscription (stale-while-revalidate), and invokes the callback ONLY when the
//      payload actually changed — cutting wasted React renders on idle re-delivery.
// Optimistic-concurrency (mutate() expectedRev → 409) is unaffected; this is read-path
// only. Policy is documented in docs/reviews/POLLING.md.
const POLL_MIN = 3500
const POLL_MAX = 30_000
const BACKOFF = 1.6

interface Poller { tick: () => void; stop: () => void; reset: () => void }
const pollers = new Set<Poller>()
const snapshotCache = new Map<string, string>()    // path -> last JSON (change detection)
const dataCache = new Map<string, unknown>()        // path -> last value (instant SWR paint)
const pathFetches = new Map<string, Promise<unknown>>() // path -> in-flight coalesced fetch
let tabHidden = typeof document !== 'undefined' && document.hidden

/** Wipe every client-held cache on logout so a subsequent sign-in on the same tab can never see
 *  the previous session's data. Clears the in-memory SWR maps (keyed by path, not tenant — the
 *  real cross-tenant risk) and, defensively, any service-worker Cache Storage (the SW never caches
 *  authenticated data, but this also drops the cached public tenant list and the app shell). */
function clearClientCaches(): void {
  snapshotCache.clear()
  dataCache.clear()
  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {})
  }
  if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_ALL_CACHES' })
}

/** Called after every local write so active views reflect the change immediately
 *  (reset to the fast interval + an instant fetch) rather than waiting out a backoff. */
function pokeAll() { for (const p of pollers) { p.reset(); p.tick() } }

if (typeof document !== 'undefined') {
  const resume = () => { if (document.hidden) return; tabHidden = false; for (const p of pollers) { p.reset(); p.tick() } }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { tabHidden = true; for (const p of pollers) p.stop() }
    else resume()
  })
  window.addEventListener('focus', resume)
}

export const adapter: BackendAdapter = {
  auth: {
    async requestOtp(email: string): Promise<void> {
      await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) })
    },

    async verifyOtp(email: string, code: string, tenant?: string): Promise<Session> {
      const { user, token: tok } = await api<{ user: AuthUser; token: string }>('/auth/otp/verify', {
        method: 'POST', body: JSON.stringify({ email, code, tenant }),
      })
      setToken(tok)
      setUser(user)
      return { user, token: tok }
    },

    async loginBootstrap(username: string, password: string, tenant?: string): Promise<Session> {
      const { user, token: tok } = await api<{ user: AuthUser; token: string }>('/auth/bootstrap', {
        method: 'POST', body: JSON.stringify({ username, password, tenant }),
      })
      setToken(tok)
      setUser(user)
      return { user, token: tok }
    },

    async listTenants(): Promise<TenantInfo[]> {
      const { tenants } = await api<{ tenants: TenantInfo[] }>('/auth/tenants')
      return tenants
    },

    async signOut(): Promise<void> {
      try { await api('/auth/logout', { method: 'POST' }) } catch { /* best-effort */ }
      setToken(null)
      setUser(null)
      clearClientCaches()
    },

    onUser(cb: (user: AuthUser | null) => void): Unsubscribe {
      userListeners.add(cb)
      // Fire immediately with the decoded token, then validate against the server.
      queueMicrotask(() => cb(currentUser))
      if (token) {
        api<{ user: AuthUser }>('/auth/me')
          .then(({ user }) => setUser(user))
          .catch(() => setUser(null))
      }
      return () => { userListeners.delete(cb) }
    },

    async changePassword(next: string): Promise<void> {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ password: next }) })
    },
  },

  db: {
    async get<T>(path: string): Promise<T | null> {
      const { data } = await api<{ data: T | null }>(`/db/get?path=${encodeURIComponent(path)}`)
      return data
    },

    async list<T>(path: string, q?: Query): Promise<T[]> {
      const { data } = await api<{ data: T[] }>('/db/list', { method: 'POST', body: JSON.stringify({ path, query: q }) })
      return data
    },

    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void, onError?: (err: unknown) => void): Unsubscribe {
      if (typeof pathOrQuery !== 'string') throw new Error('subscribe() with a Query object requires a string path')
      const path = pathOrQuery
      const doc = isDoc(path)
      let stopped = false
      let inFlight = false
      let deliveredOnce = false
      let interval = POLL_MIN
      let timer: ReturnType<typeof setTimeout> | null = null

      const deliver = (data: T | T[]) => { if (!stopped) cb(data) }
      const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
      const schedule = (ms: number) => { if (stopped || tabHidden) return; clear(); timer = setTimeout(() => void tick(), ms) }

      const tick = async () => {
        if (stopped || inFlight) return   // dedupe: never overlap a fetch
        inFlight = true
        try {
          // Coalesce: concurrent subscribers to the same path share one HTTP request.
          let rawFetch = pathFetches.get(path) as Promise<T | T[]> | undefined
          if (!rawFetch) {
            rawFetch = (doc ? adapter.db.get<T>(path) : adapter.db.list<T>(path)) as Promise<T | T[]>
            pathFetches.set(path, rawFetch)
            void rawFetch.finally(() => { if (pathFetches.get(path) === rawFetch) pathFetches.delete(path) })
          }
          const data = await rawFetch
          if (stopped) return
          const json = JSON.stringify(data ?? null)
          const changed = snapshotCache.get(path) !== json
          snapshotCache.set(path, json)
          dataCache.set(path, data)
          if (changed || !deliveredOnce) { deliveredOnce = true; deliver(data) }
          interval = changed ? POLL_MIN : Math.min(Math.round(interval * BACKOFF), POLL_MAX)
        } catch (err) {
          if (stopped) return
          onError?.(err)
          deliveredOnce = true
          deliver((doc ? null : []) as T | T[])
          interval = Math.min(Math.round(interval * BACKOFF), POLL_MAX)
        } finally {
          inFlight = false
          schedule(interval)
        }
      }

      const poller: Poller = { tick: () => void tick(), stop: clear, reset: () => { interval = POLL_MIN } }
      pollers.add(poller)
      // Instant stale-while-revalidate paint from the last value seen for this path.
      if (dataCache.has(path)) queueMicrotask(() => deliver(dataCache.get(path) as T | T[]))
      void tick()   // fresh initial fetch (even if loaded hidden — first paint stays truthful)

      return () => { stopped = true; clear(); pollers.delete(poller) }
    },

    async mutate(m: MutationPayload): Promise<void> {
      // Server derives the truthful actor from the JWT and commits the atomic
      // entity + audit + version + searchIndex envelope in one Cosmos transactional batch.
      try {
        await api('/db/mutate', { method: 'POST', body: JSON.stringify({ payload: m }) })
      } catch (err) {
        // Re-throw conflict with the path and local data so the UI can show a diff view.
        if (err instanceof MutationConflictError) throw new MutationConflictError(m.path, m.data)
        throw err
      }
      pokeAll()   // reflect the write in every open view without waiting out a backoff
    },

    async mutateBatch(ms: MutationPayload[]): Promise<void> {
      if (ms.length === 0) return
      await api('/db/mutateBatch', { method: 'POST', body: JSON.stringify({ payloads: ms }) })
      pokeAll()
    },

    async vote(path: string, _uid: string): Promise<void> {
      await api('/db/vote', { method: 'POST', body: JSON.stringify({ path }) })
      pokeAll()
    },

    async setNewsPins(uid: string, pinnedHashes: string[]): Promise<void> {
      await api('/db/setNewsPins', { method: 'POST', body: JSON.stringify({ uid, pinnedHashes }) })
      pokeAll()
    },

    // Optimistic concurrency lives in mutate() (expectedRev → 409 → MutationConflictError).
    // tx here just runs the caller's logic with the read helper; the rev re-check is the
    // server-side batch precondition, so no client-held transaction is required.
    async tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T> {
      return fn({ get: (path) => adapter.db.get(path) })
    },
  },

  storage: {
    async upload(path: string, file: File): Promise<string> {
      const buf = await file.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const { url } = await api<{ url: string }>('/storage/upload', {
        method: 'POST', body: JSON.stringify({ path, contentType: file.type, dataBase64: b64 }),
      })
      return url
    },
    async getUrl(path: string): Promise<string> {
      const { url } = await api<{ url: string }>(`/storage/url?path=${encodeURIComponent(path)}`)
      return url
    },
  },

  fns: {
    async call<TIn, TOut>(name: string, data: TIn): Promise<TOut> {
      return api<TOut>(`/ai/${name}`, { method: 'POST', body: JSON.stringify(data) })
    },

    async stream(name: string, data: unknown, onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
      const res = await fetch(`${API}/api/ai/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(data),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`Stream ${name} failed: ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) if (line.startsWith('data: ')) onChunk(line.slice(6))
        }
      } finally {
        reader.cancel().catch(() => {})
      }
    },
  },

  presence: {
    join(pid: string): Unsubscribe {
      if (!currentUser) return () => {}
      const beat = () => { if (typeof document !== 'undefined' && document.hidden) return; void api('/db/presence/join', { method: 'POST', body: JSON.stringify({ pid }) }).catch(() => {}) }
      beat()
      const timer = setInterval(beat, 30_000)
      return () => clearInterval(timer)
    },
    watch(pid: string, cb: (viewerUids: string[]) => void): Unsubscribe {
      let stopped = false
      const tick = () => {
        if (typeof document !== 'undefined' && document.hidden) return   // skip while backgrounded
        api<{ viewers: string[] }>('/db/presence/watch', { method: 'POST', body: JSON.stringify({ pid }) })
          .then(({ viewers }) => { if (!stopped) cb(viewers) })
          .catch(() => { if (!stopped) cb([]) })
      }
      void tick()
      const timer = setInterval(() => void tick(), 15_000)
      return () => { stopped = true; clearInterval(timer) }
    },
  },

  tenancy: {
    async listTenants(): Promise<TenantInfo[]> {
      const { tenants } = await api<{ tenants: TenantInfo[] }>('/admin/tenants')
      return tenants
    },
    async createTenant(id: string, name: string): Promise<void> {
      await api('/admin/tenants', { method: 'POST', body: JSON.stringify({ id, name }) })
    },
    async deleteTenant(id: string): Promise<void> {
      await api(`/admin/tenants/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async listUsers(opts?: { limit?: number; after?: string }): Promise<{ users: ManagedUser[]; hasMore: boolean }> {
      const params = new URLSearchParams()
      if (opts?.limit) params.set('limit', String(opts.limit))
      if (opts?.after)  params.set('after',  opts.after)
      const qs = params.size > 0 ? `?${params}` : ''
      return api<{ users: ManagedUser[]; hasMore: boolean }>(`/admin/users${qs}`)
    },
    async createUser(u: ManagedUser & { password?: string }): Promise<void> {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(u) })
    },
    async deleteUser(username: string): Promise<void> {
      await api(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    },
    async impersonate(targetUid: string, tenantId: string, reason: string): Promise<{ token: string; expiresAt: string; subject: string; tenantId: string }> {
      return api('/admin/impersonate', { method: 'POST', body: JSON.stringify({ targetUid, tenantId, reason }) })
    },
  },

  orgAdmin: {
    async listMembers(opts?: { limit?: number; after?: string }): Promise<{ members: TenantMember[]; hasMore: boolean }> {
      const params = new URLSearchParams()
      if (opts?.limit) params.set('limit', String(opts.limit))
      if (opts?.after)  params.set('after',  opts.after)
      const qs = params.size > 0 ? `?${params}` : ''
      return api<{ members: TenantMember[]; hasMore: boolean }>(`/tenant-admin/members${qs}`)
    },
    async inviteMember(m: { username?: string; email?: string; name?: string; role: string; password?: string }): Promise<TenantMember> {
      const { member } = await api<{ ok: boolean; member: TenantMember }>('/tenant-admin/members', { method: 'POST', body: JSON.stringify(m) })
      return member
    },
    async changeMemberRole(username: string, role: string): Promise<void> {
      await api(`/tenant-admin/members/${encodeURIComponent(username)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
    },
    async removeMember(username: string): Promise<void> {
      await api(`/tenant-admin/members/${encodeURIComponent(username)}`, { method: 'DELETE' })
    },
    async listAudit(opts?: { limit?: number }): Promise<unknown[]> {
      const qs = opts?.limit ? `?limit=${opts.limit}` : ''
      const { events } = await api<{ events: unknown[] }>(`/tenant-admin/audit${qs}`)
      return events
    },
  },
}
