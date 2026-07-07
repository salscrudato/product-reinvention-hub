// BackendAdapter contract — the only interface app code may depend on.
// AWS-SWAP: all platform concerns live behind this seam; swap the implementation,
// not the callers.
import type { Unsubscribe } from '@pf/shared'

export interface AuthUser {
  uid: string
  email: string | null
  name: string | null
  role: 'VIEWER' | 'EDITOR' | 'ADMIN' | null
}

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
  constructor() { super('Document was modified by another user — please refresh.') }
}

export interface BackendAdapter {
  auth: {
    signIn(email: string, password: string): Promise<Session>
    signOut(): Promise<void>
    /** Fires immediately with current user, then on every change. */
    onUser(cb: (user: AuthUser | null) => void): Unsubscribe
    changePassword(next: string): Promise<void>
    /** TEMPORARY dev-only admin bypass — sets a fake ADMIN session with NO backend auth.
     *  Dev builds only (`import.meta.env.DEV`); a no-op otherwise. Because there is no real
     *  auth token, backend reads/writes are rejected by security rules (data won't load).
     *  Remove before production. See SignIn.tsx. */
    signInAsDevAdmin(): void
  }
  db: {
    get<T>(path: string): Promise<T | null>
    list<T>(path: string, q?: Query): Promise<T[]>
    /** Subscribe to a document or collection query. Returns unsubscribe fn. */
    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void): Unsubscribe
    /** Atomic entity + audit + version + searchIndex write. */
    mutate(m: MutationPayload): Promise<void>
    /** Narrow, un-audited vote: arrayUnion the uid into votes.voters and +1 votes.count.
     *  Matches the VIEWER vote-only path in firestore.rules (only `votes` may change). */
    vote(path: string, uid: string): Promise<void>
    /** Rev-checked transaction wrapper for optimistic concurrency. */
    tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T>
  }
  storage: {
    upload(path: string, file: File): Promise<string>
    getUrl(path: string): Promise<string>
  }
  fns: {
    /** Invoke a Firebase callable function. */
    call<TIn, TOut>(name: string, data: TIn): Promise<TOut>
    /** Stream an SSE endpoint; calls onChunk for each text/event-stream line. */
    stream(name: string, data: unknown, onChunk: (chunk: string) => void): Promise<void>
  }
  presence: {
    /** Heartbeat doc in presence/{pid}/viewers/{uid}; returns cleanup fn. */
    join(pid: string): Unsubscribe
    /** Watch presence for a product; returns unsubscribe fn. */
    watch(pid: string, cb: (viewerUids: string[]) => void): Unsubscribe
  }
}
