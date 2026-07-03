// runtime.ts — shared AI plumbing: the Anthropic client (secret-bound), Firebase
// ID-token verification + role guard, SSE helpers, and model constants. Every
// AI function (ai/builder/claims/gap/describe/health) composes these so secret
// handling, auth and streaming stay in exactly one place.
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

// Single model for both reasoning and bulk/simple generations per spec.
export const MODEL = 'claude-sonnet-4-6'

/** Anthropic client — call inside a handler so the bound secret is resolvable. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
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
