// azure.adapter.ts — the Azure implementation of BackendAdapter.
//
// Talks ONLY to the same-origin Azure host API (/api/*): JWT auth, Cosmos-backed
// data, and Foundry-Claude AI. No Firebase, no GCloud. This is the swap target
// for src/lib/backend/index.ts. The React app is unchanged — it depends only on
// this contract (see types.ts).
//
// Real-time: Firestore onSnapshot has no Cosmos equivalent in the browser, so
// subscribe() degrades to polling (initial fetch + interval). Semantics match
// the Firebase adapter: string paths only, even segments = document, odd =
// collection, degrade to null/[] + onError on failure.

import type { Unsubscribe } from '@pf/shared'
import type { AuthUser, BackendAdapter, ManagedUser, MutationPayload, Query, Session, TenantInfo } from './types'
import { MutationConflictError } from './types'

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const TOKEN_KEY = 'pf.azure.token'
const POLL_MS = 3500

// ─── token + fetch helpers ───────────────────────────────────────────────────
let token: string | null = (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || null

function decode(tok: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(tok.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null
    return { uid: p.sub, email: p.email ?? null, name: p.name ?? null, role: p.role ?? null }
  } catch { return null }
}

let currentUser: AuthUser | null = token ? decode(token) : null
const userListeners = new Set<(u: AuthUser | null) => void>()
function setUser(u: AuthUser | null) { currentUser = u; userListeners.forEach((cb) => cb(u)) }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

const isDoc = (path: string) => path.split('/').filter(Boolean).length % 2 === 0

export const adapter: BackendAdapter = {
  auth: {
    async signIn(email: string, password: string, tenant?: string): Promise<Session> {
      const { user, token: tok } = await api<{ user: AuthUser; token: string }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, username: email, password, tenant }),
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
      const tick = async () => {
        try {
          if (doc) { const d = await adapter.db.get<T>(path); if (!stopped) cb(d as T) }
          else { const d = await adapter.db.list<T>(path); if (!stopped) cb(d as T[]) }
        } catch (err) {
          if (stopped) return
          onError?.(err)
          cb((doc ? null : []) as T | T[])
        }
      }
      void tick()
      const timer = setInterval(() => void tick(), POLL_MS)
      return () => { stopped = true; clearInterval(timer) }
    },

    async mutate(m: MutationPayload): Promise<void> {
      // Server derives the truthful actor from the JWT and commits the atomic
      // entity + audit + version + searchIndex envelope in one Cosmos transactional batch.
      await api('/db/mutate', { method: 'POST', body: JSON.stringify({ payload: m }) })
    },

    async mutateBatch(ms: MutationPayload[]): Promise<void> {
      if (ms.length === 0) return
      await api('/db/mutateBatch', { method: 'POST', body: JSON.stringify({ payloads: ms }) })
    },

    async vote(path: string, _uid: string): Promise<void> {
      await api('/db/vote', { method: 'POST', body: JSON.stringify({ path }) })
    },

    async setNewsPins(uid: string, pinnedHashes: string[]): Promise<void> {
      await api('/db/setNewsPins', { method: 'POST', body: JSON.stringify({ uid, pinnedHashes }) })
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
      const beat = () => { void api('/db/presence/join', { method: 'POST', body: JSON.stringify({ pid }) }).catch(() => {}) }
      beat()
      const timer = setInterval(beat, 30_000)
      return () => clearInterval(timer)
    },
    watch(pid: string, cb: (viewerUids: string[]) => void): Unsubscribe {
      let stopped = false
      const tick = () => api<{ viewers: string[] }>('/db/presence/watch', { method: 'POST', body: JSON.stringify({ pid }) })
        .then(({ viewers }) => { if (!stopped) cb(viewers) })
        .catch(() => { if (!stopped) cb([]) })
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
    async listUsers(): Promise<ManagedUser[]> {
      const { users } = await api<{ users: ManagedUser[] }>('/admin/users')
      return users
    },
    async createUser(u: ManagedUser & { password?: string }): Promise<void> {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(u) })
    },
    async deleteUser(username: string): Promise<void> {
      await api(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    },
  },
}
