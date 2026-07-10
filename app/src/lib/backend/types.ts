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
    /** Dev-only admin bypass — a fake ADMIN session with NO backend auth, for working
     *  against the emulators. OPTIONAL and present ONLY in dev builds: the Firebase adapter
     *  spreads it in behind an `import.meta.env.DEV` guard, so esbuild strips it (and its
     *  name) from the production bundle. In production the property is absent — calling it
     *  throws. Because there is no real token, security rules reject every read/write. */
    signInAsDevAdmin?(): void
  }
  db: {
    get<T>(path: string): Promise<T | null>
    list<T>(path: string, q?: Query): Promise<T[]>
    /** Subscribe to a document or collection query. Returns unsubscribe fn. On a listener
     *  error (e.g. permission-denied / offline) the data callback still degrades to `[]`/`null`
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
    /** Narrow, un-audited vote: arrayUnion the uid into votes.voters and +1 votes.count.
     *  Matches the VIEWER vote-only path in firestore.rules (only `votes` may change). */
    vote(path: string, uid: string): Promise<void>
    /** Narrow, un-audited owner write to the caller's own `newsPrefs/{uid}` document.
     *  News is per-user content, not a governed entity, so pins persist WITHOUT the
     *  mutate() audit/version envelope (and match the owner-only newsPrefs rule). MERGES,
     *  so a pin update never clobbers the instruction the editor writes to the same doc. */
    setNewsPins(uid: string, pinnedHashes: string[]): Promise<void>
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
}
