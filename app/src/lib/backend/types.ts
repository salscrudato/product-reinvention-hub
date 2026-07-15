// BackendAdapter contract — the only interface app code may depend on.
// Platform-agnostic seam: the app depends only on this contract; swap the
// implementation, not the callers. The active implementation is the Azure host
// adapter (azure.adapter.ts) — JWT auth, Cosmos data, and Foundry AI over /api/*.
import type { Unsubscribe } from '@pf/shared'

// Two-plane role set. See docs/AUTHORITIES.md for the full capability matrix.
// Tenant plane: VIEWER, inquiry personas (UNDERWRITING/COMPLIANCE/CLAIMS/ACTUARIAL/ANALYST), EDITOR, TENANT_ADMIN.
// Platform plane: SUPPORT, SUPER_ADMIN.
// ADMIN is the legacy alias for TENANT_ADMIN (still appears in existing JWTs; normalized server-side).
export type Tier =
  | 'VIEWER'
  | 'UNDERWRITING' | 'COMPLIANCE' | 'CLAIMS' | 'ACTUARIAL' | 'ANALYST'
  | 'EDITOR'
  | 'TENANT_ADMIN' | 'ADMIN'
  | 'SUPPORT'
  | 'SUPER_ADMIN'
  | 'POLICYHOLDER'   // consumer persona: own policy + own carrier tenant only, portal:* caps only

// Capabilities that can be checked client-side (supplementary UI gating only;
// server is always the authoritative gate).
export type Capability =
  | 'product:read' | 'product:write'
  | 'ai:invoke'
  | 'filing:generate' | 'changeset:approve'
  | 'member:manage' | 'role:assign' | 'audit:read'
  | 'platform:tenants' | 'platform:users' | 'platform:audit' | 'platform:impersonate'
  | 'portal:read' | 'portal:upload'

export interface AuthUser {
  uid: string
  email: string | null
  name: string | null
  role: Tier | null
  /** The tenant this session is scoped to (null for a tenant-less admin session). */
  tenantId?: string | null
  /**
   * Effective feature flags for this session's tenant (server-resolved: global default +
   * tenant override). Present after /auth/me resolves; used to hide disabled surfaces from
   * nav. The SERVER remains the authoritative gate — this is UI convenience only.
   */
  flags?: Record<string, boolean> | null
}

export interface TenantInfo { id: string; name: string; status?: 'active' | 'suspended'; createdAt?: string; createdBy?: string }
export interface ManagedUser { username: string; role: Tier; tenants: string[] | '*'; email?: string; name?: string; disabled?: boolean }

// Member of a specific tenant (returned by tenant-admin endpoints).
export interface TenantMember { username: string; role: Tier; email?: string; name?: string; disabled?: boolean; invitedBy?: string; invitedAt?: string }

// Per-tenant drill-down returned by GET /api/admin/tenants/:id/summary.
export interface TenantSummary {
  tenant: { tenantId: string; name: string; status?: 'active' | 'suspended'; createdAt?: string; createdBy?: string }
  userCount: number
  entityCounts: Record<string, number>
  recentActivity: Array<{ op: string; entityType: string; entityPath: string; actor?: { uid: string; name?: string }; at: string }>
}

// One event from the platform / tenant audit viewers (server-filtered, paginated).
export interface AuditSearchEvent {
  id: string
  kind?: string  // 'audit' (data mutation) | 'platformAudit' | 'loginAudit' | 'impersonateAudit'
  op?: string; action?: string; event?: string
  entityType?: string; entityPath?: string
  actor?: { uid?: string; name?: string; impersonatedBy?: { uid: string; name?: string } } | string
  detail?: Record<string, unknown>
  tenantId?: string; rev?: number
  at: string
}

export interface AuditSearchFilters {
  source?: 'all' | 'data' | 'platform'
  tenant?: string; actor?: string; entityType?: string; action?: string
  since?: string; until?: string
  limit?: number; cursor?: string
}

export interface Session {
  user: AuthUser
  token: string
}

// ─── Policyholder portal (POLICYHOLDER persona; server-scoped to own uid + tenant) ───
export interface PortalPolicy {
  fileName: string | null
  uploadedAt: string | null
  insuredName: string
  insuredAddress: { line1?: string; city?: string; state?: string; zip?: string }
  carrierName: string
  policyNumber: string
  lob: string
  effectiveDate: string
  expirationDate: string
  coverages: Array<{ name: string; limit?: string; deductible?: string }>
  endorsements: Array<{ name: string; formNumber?: string }>
  extraction: { role: string; deployment: string; at: string } | null
  summary: PortalSummary | null
}

export interface PortalSummary {
  /** Server-sanitized HTML fragment — the client MUST sanitize again before render. */
  html: string
  /** 'model' = judge-approved generation; 'fallback' = deterministic non-model summary. */
  source: 'model' | 'fallback'
  attempts: number
  generatedAt: string
  scores: Record<string, number> | null
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
    /** Cursor-paged list (server-enforced page cap). Pass the returned cursor to get the next page. */
    listPage<T>(path: string, q?: Query & { pageSize?: number; cursor?: string }): Promise<{ data: T[]; cursor: string | null; hasMore: boolean }>
    /** Subscribe to a document or collection query. Returns unsubscribe fn. On a listener
     *  error (e.g. a failed poll / offline) the data callback still degrades to `[]`/`null`
     *  so consumers resolve their loading state; pass `onError` to ALSO surface a recoverable
     *  error state instead of a silent empty (see the subscribe-error gap in ELEVATION_MATRIX). */
    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void, onError?: (err: unknown) => void, query?: Query): Unsubscribe
    /** Atomic entity + audit + version + searchIndex write. */
    mutate(m: MutationPayload): Promise<void>
    /** Batched mutate: each payload gets the SAME full envelope (entity + audit + version
     *  + searchIndex + rev), grouped into chunked transactions so a large write set (e.g.
     *  seeding 70+ tasks, or a re-seed that clears then re-creates) stays atomic per chunk
     *  and fully audited — never a raw write. No-op on an empty list. */
    mutateBatch(ms: MutationPayload[]): Promise<void>
    /** Restore an entity to a past rev (HISTORY_SPEC §2). The SERVER reconstructs the target
     *  state (reverse-applying diffs) and commits it as a FORWARD op:'restore' mutation —
     *  new rev + version doc + hash-chained audit event — so the chain extends, never bends.
     *  The client never sends a snapshot. `expectedRev` is the optimistic-concurrency token:
     *  a stale view throws MutationConflictError (409). An unreconstructable history (a gap
     *  or a delete inside the range) rejects with an Error (422). */
    restore(path: string, targetRev: number, expectedRev?: number): Promise<{ rev: number; restoredFrom: number }>
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
  /** Platform administration (SUPER_ADMIN + SUPPORT only, server-enforced): cross-tenant ops. */
  tenancy: {
    listTenants(opts?: { q?: string; limit?: number; after?: string }): Promise<{ tenants: TenantInfo[]; hasMore: boolean }>
    createTenant(id: string, name: string): Promise<void>
    updateTenant(id: string, patch: { name?: string; status?: 'active' | 'suspended' }): Promise<void>
    deleteTenant(id: string): Promise<void>
    /** Per-tenant drill-down: user count, entity counts by type, recent activity. */
    tenantSummary(id: string): Promise<TenantSummary>
    listUsers(opts?: { q?: string; tenant?: string; limit?: number; after?: string }): Promise<{ users: ManagedUser[]; hasMore: boolean }>
    createUser(u: Partial<ManagedUser> & { username: string; password?: string }): Promise<void>
    updateUser(username: string, patch: { role?: Tier; tenants?: string[] | '*'; disabled?: boolean; password?: string; name?: string; email?: string }): Promise<void>
    deleteUser(username: string): Promise<void>
    /** Impersonate a tenant user (SUPPORT/SUPER_ADMIN only). Returns a short-lived token. */
    impersonate(targetUid: string, tenantId: string, reason: string): Promise<{ token: string; expiresAt: string; subject: string; tenantId: string }>
    /** Platform audit viewer: server-filtered, cursor-paginated, read-only. */
    searchAudit(filters: AuditSearchFilters): Promise<{ events: AuditSearchEvent[]; cursor: string | null; hasMore: boolean }>
  }
  /** Policyholder portal (POLICYHOLDER persona only; every call is server-scoped to the
   *  JWT's uid + tenant — no identifiers cross the wire, so cross-policy/cross-tenant
   *  reach is impossible from the client by construction). */
  portal: {
    /** Own policy record, or null before the one-time upload. */
    me(): Promise<{ policy: PortalPolicy | null }>
    /** One-time PDF upload (server enforces PDF magic bytes + 15 MB cap + one-per-account). */
    upload(file: File): Promise<{ ok: boolean; policy: PortalPolicy }>
    /** Generate (or fetch the stored) judged coverage summary for the own policy. */
    generateSummary(): Promise<{ ok: boolean; summary: PortalSummary; cached?: boolean }>
  }
  /** Self-service org admin (TENANT_ADMIN only, same-tenant enforced). */
  orgAdmin: {
    listMembers(opts?: { limit?: number; after?: string }): Promise<{ members: TenantMember[]; hasMore: boolean }>
    inviteMember(m: { username?: string; email?: string; name?: string; role: Tier; password?: string }): Promise<TenantMember>
    changeMemberRole(username: string, role: Tier): Promise<void>
    setMemberDisabled(username: string, disabled: boolean): Promise<void>
    removeMember(username: string): Promise<void>
    listAudit(opts?: { entityType?: string; action?: string; actor?: string; since?: string; limit?: number; cursor?: string }): Promise<{ events: AuditSearchEvent[]; cursor: string | null; hasMore: boolean }>
  }
}
