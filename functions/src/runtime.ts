// runtime.ts — shared AI plumbing: the Anthropic client (secret-bound), Firebase
// ID-token verification + role guard, SSE helpers, and model constants. The AI
// functions (ai/extract/news) compose these so secret handling, auth and
// streaming stay in exactly one place.
// plain HTTPS and ports to Lambda URLs unchanged.
import { defineSecret } from 'firebase-functions/params'
import { HttpsError } from 'firebase-functions/v2/https'
import type { Request } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import Anthropic from '@anthropic-ai/sdk'
import type { Role } from '@pf/shared'

// Initialize the Admin SDK once per cold start (shared with share.ts's guard).
if (!getApps().length) initializeApp()

// The Anthropic key. Canonical homes: functions/.env.local (emulator) and Firebase
// Secrets (prod). Bind via `secrets: [ANTHROPIC_API_KEY]` on every AI function.
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// The Voyage embeddings/rerank key — same handling model as the Anthropic key: a SERVER
// secret (functions/.env.local locally, Firebase Secret in prod), read only inside
// functions/, NEVER a VITE_* var, never sent to the browser, never logged. Bind via
// `secrets: [VOYAGE_API_KEY]` on functions that retrieve or reindex. Optional: with no key
// the retrieval layer falls back to the dependency-free lexical ranker (see retrieval/).
export const VOYAGE_API_KEY = defineSecret('VOYAGE_API_KEY')

/** The Voyage key if configured (bound + non-empty), else undefined → lexical retrieval.
 *  `.value()` throws when the secret isn't bound to the running function; we treat any
 *  failure or empty value as "not configured" so retrieval degrades safely to lexical. */
export function voyageKey(): string | undefined {
  try { const v = VOYAGE_API_KEY.value(); return v && v.trim() ? v : undefined }
  catch { return undefined }
}

// Two GA models per spec: a reasoning model for chat/analysis and a fast model for
// bulk/simple generations. Sonnet 5 runs adaptive thinking by default and REJECTS
// non-default sampling params (temperature/top_p/top_k → 400), so the reasoning
// path passes none — grounding comes from the tools, not from sampling. Haiku 4.5
// is right-sized for the news scout and still accepts sampling. Project Glasswing
// operators can swap MODEL on this one line to the gated reasoning model
// (claude-mythos-5); it shares Sonnet 5's surface — adaptive thinking on, no
// sampling params — so nothing else changes. See docs/adr/0001-model-ids.md.
export const MODEL      = 'claude-sonnet-5'   // reasoning: portfolio chat, analysis
export const MODEL_FAST = 'claude-haiku-4-5'  // bulk/simple: market-news scout

// ─── Prompt-cache breakpoint (explicit 1-hour TTL) ─────────────────────────────
// Every cached prefix in this project — tools + system, and any cached document — is
// marked with THIS single breakpoint value, so the stable prefix stays warm across the
// minutes-long gaps between calls that the default 5-minute TTL would drop: a product-
// workspace session, the nightly news run, a multi-turn claims/extraction request. A 1h
// cache write costs ~2x input (vs ~1.25x for 5m), but a stable prefix is READ far more
// than written, so the blended cost still falls — and telemetry prices cache writes at
// the 1h rate so the Admin cost tab stays honest.
//
// Caching is a prefix match (order: tools → system → messages): put the breakpoint on the
// LAST stable block and keep the volatile per-request suffix after it. Min cacheable prefix
// is 1024 tok on Sonnet and 4096 tok on Haiku — below that the marker is a silent no-op
// (no error), so a small Haiku prefix simply won't cache until it grows past the floor.
//
// SDK 0.54's CacheControlEphemeral type models only { type:'ephemeral' } and does not yet
// type the (GA) `ttl` field, so we extend it locally — additive, no `as unknown` hole. The
// wire API accepts `ttl`; EphemeralCacheControl is a structural SUBTYPE of the SDK type, so
// assigning CACHE_1H to a `CacheControlEphemeral`-typed field is safe and the `ttl` survives
// on the runtime object. Verified against docs.claude.com: 1h TTL is GA, no beta header.
export type EphemeralCacheControl = Anthropic.CacheControlEphemeral & { ttl?: '5m' | '1h' }
export const CACHE_1H: EphemeralCacheControl = { type: 'ephemeral', ttl: '1h' }

/** Anthropic client — call inside a handler so the bound secret is resolvable.
 *  maxRetries adds explicit exponential backoff on 429 / 5xx / connection errors. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 4 })
}

/** Whether an Anthropic SDK failure is worth retrying: rate limit, request timeout,
 *  a transient 5xx / overloaded, or a connection drop. Used for partial-stream
 *  recovery (ai.ts) on top of the client's own maxRetries — which only covers
 *  establishing the request, not a fault surfaced mid-stream. */
export function isRetryableAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true   // includes timeouts
  if (err instanceof Anthropic.APIError) {
    const s = err.status
    return s === 408 || s === 409 || s === 429 || (typeof s === 'number' && s >= 500)
  }
  return false
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface Caller {
  uid:  string
  role: Role | null
  name: string
}

export class AuthError extends Error {}

/**
 * Assert that the onCall auth token carries one of the required roles.
 * Mirrors the Firestore rule on the same collection — both sides must agree.
 * Throws HttpsError('permission-denied') if the role does not match.
 *
 * Usage:
 *   requireRole(req.auth, 'EDITOR', 'ADMIN')  // canEdit() surfaces
 *   requireRole(req.auth, 'ADMIN')             // isAdmin() surfaces
 */
export function requireRole(
  auth: { token: Record<string, unknown> } | null | undefined,
  ...roles: Role[]
): void {
  const role = auth?.token?.['role'] as string | undefined
  if (!roles.includes(role as Role)) {
    throw new HttpsError('permission-denied', `${roles.join(' or ')} access required.`)
  }
}

/** Verify the caller's Firebase ID token (Bearer header) and return uid + role. */
export async function authenticate(req: Request): Promise<Caller> {
  const header = req.headers.authorization ?? ''
  const match  = /^Bearer (.+)$/.exec(header)
  if (!match) throw new AuthError('Sign in to use AI features.')

  const decoded = await getAuth().verifyIdToken(match[1])
  return {
    uid:  decoded.uid,
    role: (decoded['role'] as Role | undefined) ?? null,
    name: (decoded['name'] as string | undefined) ?? decoded.email ?? 'User',
  }
}

/**
 * Derive a truthful audit actor from an onCall request's auth context.
 * Mirrors authenticate()'s fallback chain: display name → email → uid (never blank).
 * Call AFTER the auth guard; the caller must already have verified req.auth is non-null.
 */
export function callableActor(
  auth: { uid: string; token: Record<string, unknown> },
): { uid: string; name: string } {
  const name =
    (auth.token['name'] as string | undefined)?.trim() ||
    (auth.token['email'] as string | undefined)?.trim() ||
    auth.uid
  return { uid: auth.uid, name }
}

// ─── SSE ────────────────────────────────────────────────────────────────────────

// Minimal structural type — satisfied by the Express response onRequest provides,
// without pulling express types into the surface.
export interface SseResponse {
  setHeader(name: string, value: string): void
  write(chunk: string): boolean
  end(): void
  flushHeaders?(): void
}

/** Every event the AI stream emits. The client parses each `data:` line as JSON. */
export type StreamEvent =
  | { t: 'token'; v: string }                                   // assistant text delta
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }                 // structured payload (drafts, determinations)
  // Non-fatal advisory. `kind` is a MACHINE-READABLE discriminator so the client renders
  // its OWN canonical copy (see app/src/lib/ai/notices.ts) instead of trusting free text —
  // this is how the honest-status wording is kept from drifting across surfaces. `message`
  // remains as a server-authored fallback for older clients / kinds without canonical copy.
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[];
      kind?: 'degrade' | 'deny' | 'breaker' | 'cached' | 'unverified' }
  | { t: 'error'; message: string }
  | { t: 'done' }

export function openSse(res: SseResponse): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
}

export function send(res: SseResponse, event: StreamEvent): void {
  // Blank line terminates the SSE record; JSON.stringify escapes any newlines.
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}
