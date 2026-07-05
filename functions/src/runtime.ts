// runtime.ts — shared AI plumbing: the Anthropic client (secret-bound), Firebase
// ID-token verification + role guard, SSE helpers, and model constants. The AI
// functions (ai/extract/news) compose these so secret handling, auth and
// streaming stay in exactly one place.
// AWS-SWAP: secret → Secrets Manager; verifyIdToken → Cognito JWT verify; SSE is
// plain HTTPS and ports to Lambda URLs unchanged.
import { defineSecret } from 'firebase-functions/params'
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

// Two models per spec: a reasoning model for chat/analysis, a fast model for
// bulk/simple generations. Fable 5 has thinking always on and REJECTS the
// sampling params (temperature/top_p/top_k → 400) — grounded chat leans on tools,
// not sampling. Haiku is right-sized for the news scout and accepts temperature.
export const MODEL      = 'claude-fable-5'    // reasoning: portfolio chat, analysis
export const MODEL_FAST = 'claude-haiku-4-5'  // bulk/simple: market-news scout

/** Anthropic client — call inside a handler so the bound secret is resolvable.
 *  maxRetries adds explicit exponential backoff on 429 / 5xx / connection errors. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 4 })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface Caller {
  uid:  string
  role: Role | null
  name: string
}

export class AuthError extends Error {}

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
