// BackendAdapter contract — the only interface app code may depend on.
// Platform-agnostic seam: the app depends only on this contract; swap the
// implementation, not the callers. The active implementation is the Azure host
// adapter (azure.adapter.ts) — JWT auth, Cosmos data, and Foundry AI over /api/*.
import type { Unsubscribe } from '@pf/shared'

export type Tier = 'VIEWER' | 'ANALYST' | 'EDITOR' | 'ADMIN' | 'SUPER_ADMIN'

export interface AuthUser {
  uid: string
  email: string | null
  name: string | null
  role: Tier | null
  /** The tenant this session is scoped to (null for a tenant-less admin session). */
  tenantId?: string | null
}

export interface TenantInfo { id: string; name: string; createdAt?: string; createdBy?: string }
export interface ManagedUser { username: string; role: Tier; tenants: string[] | '*'; email?: string; name?: string }

export interface Session {
  user: AuthUser
  token: string
}

export interface Query {
  where?: Array<{ field: string; op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains'; value: unknown }>
  orderBy?: Array<{ field: string; dir?: 'asc' | 'desc' }>
  limit?: number
  startAfter?: unknown
}

// Every mutation is atomic: entity + auditEvent + version + searchIndex + rev bump.
// Rev mismatch throws MutationConflictError so callers can show a conflict toast.
export interface MutationPayload {
  op: 'create' | 'update' | 'delete'
  path: string
  data?: Record<string, unknown>
  entityType: string
  productId?: string
  actor: { uid: string; name: string }
  expectedRev?: number   // absent = no optimistic lock
}

export class MutationConflictError extends Error {
  /** Entity path that triggered the 409 (e.g. "products/PH.PROD.001"). */
  readonly conflictPath?: string
  /** The data payload the caller was attempting to write. */
  readonly localData?: Record<string, unknown>
  constructor(path?: string, data?: Record<string, unknown>) {
    super('Document was modified by another user — please refresh.')
    this.conflictPath = path
    this.localData = data
  }
}

export interface BackendAdapter {
  auth: {
    /** Step 1 of OTP flow: request a one-time code for an email address. */
    requestOtp(email: string): Promise<void>
    /** Step 2 of OTP flow: submit the code to get a session. */
    verifyOtp(email: string, code: string, tenant?: string): Promise<Session>
    /** Bootstrap admin login: username + password, server-validated only (never trust client). */
    loginBootstrap(username: string, password: string, tenant?: string): Promise<Session>
    /** Tenants offered on the login screen (ids + names only; safe pre-auth). */
    listTenants(): Promise<TenantInfo[]>
    signOut(): Promise<void>
    /** Fires immediately with current user, then on every change. */
    onUser(cb: (user: AuthUser | null) => void): Unsubscribe
    changePassword(next: string): Promise<void>
  }
  db: {
    get<T>(path: string): Promise<T | null>
    list<T>(path: string, q?: Query): Promise<T[]>
    /** Subscribe to a document or collection query. Returns unsubscribe fn. On a listener
     *  error (e.g. a failed poll / offline) the data callback still degrades to `[]`/`null`
     *  so consumers resolve their loading state; pass `onError` to ALSO surface a recoverable
     *  error state instead of a silent empty (see the subscribe-error gap in ELEVATION_MATRIX). */
    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void, onError?: (err: unknown) => void): Unsubscribe
    /** Atomic entity + audit + version + searchIndex write. */
    mutate(m: MutationPayload): Promise<void>
    /** Batched mutate: each payload gets the SAME full envelope (entity + audit + version
     *  + searchIndex + rev), grouped into chunked transactions so a large write set (e.g.
     *  seeding 70+ tasks, or a re-seed that clears then re-creates) stays atomic per chunk
     *  and fully audited — never a raw write. No-op on an empty list. */
    mutateBatch(ms: MutationPayload[]): Promise<void>
    /** Vote (EDITOR+): increments votes.count and unions uid into votes.voters via the
     *  atomic mutate() envelope (entity + audit + version + searchIndex). VIEWER is read-only. */
    vote(path: string, uid: string): Promise<void>
    /** Pin update (EDITOR+): persists the caller's pinnedHashes to their `newsPrefs/{uid}`
     *  document via the atomic mutate() envelope (server-enforced: uid must equal the caller). */
    setNewsPins(uid: string, pinnedHashes: string[]): Promise<void>
    /** Rev-checked transaction wrapper for optimistic concurrency. */
    tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T>
  }
  storage: {
    upload(path: string, file: File): Promise<string>
    getUrl(path: string): Promise<string>
  }
  fns: {
    /** Invoke a server AI endpoint (POST /api/ai/<name>). */
    call<TIn, TOut>(name: string, data: TIn): Promise<TOut>
    /** Stream an SSE endpoint; calls onChunk for each text/event-stream line. Pass an
     *  AbortSignal to cancel the stream (unmount / conversation switch); an aborted
     *  stream rejects with a DOMException named 'AbortError', which callers ignore. */
    stream(name: string, data: unknown, onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<void>
  }
  presence: {
    /** Heartbeat doc in presence/{pid}/viewers/{uid}; returns cleanup fn. */
    join(pid: string): Unsubscribe
    /** Watch presence for a product; returns unsubscribe fn. */
    watch(pid: string, cb: (viewerUids: string[]) => void): Unsubscribe
  }
  /** Platform administration (ADMIN only, server-enforced): tenants + gated users. */
  tenancy: {
    listTenants(): Promise<TenantInfo[]>
    createTenant(id: string, name: string): Promise<void>
    deleteTenant(id: string): Promise<void>
    listUsers(): Promise<ManagedUser[]>
    createUser(u: ManagedUser & { password?: string }): Promise<void>
    deleteUser(username: string): Promise<void>
  }
}
