// Unit tests for the requireRole helper (runtime.ts).
// Verifies that describeForm's EDITOR|ADMIN guard and refreshNews's ADMIN guard
// reject a VIEWER server-side — E1 invariant: both Firestore rules AND Functions
// must enforce the same role constraint.
//
// Pure unit tests: no Firebase Admin SDK, no Anthropic client, no emulator.
// requireRole only reads the auth token and throws HttpsError.
import { describe, it, expect } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { requireRole } from './runtime'

// Minimal auth-token shapes matching what Firebase Functions v2 passes to onCall.
const viewerAuth = { token: { role: 'VIEWER'  } as Record<string, unknown> }
const editorAuth = { token: { role: 'EDITOR'  } as Record<string, unknown> }
const adminAuth  = { token: { role: 'ADMIN'   } as Record<string, unknown> }
const noRoleAuth = { token: {}                  as Record<string, unknown> }

function catchRole(auth: typeof viewerAuth | null, ...roles: ('VIEWER'|'EDITOR'|'ADMIN')[]): unknown {
  try { requireRole(auth as Parameters<typeof requireRole>[0], ...roles as Parameters<typeof requireRole>[1][]); return null }
  catch (e) { return e }
}

function isPermDenied(e: unknown): boolean {
  return e instanceof HttpsError && e.code === 'permission-denied'
}

describe('requireRole — describeForm guard (EDITOR | ADMIN)', () => {
  it('rejects VIEWER with permission-denied', () => {
    expect(isPermDenied(catchRole(viewerAuth, 'EDITOR', 'ADMIN'))).toBe(true)
  })

  it('rejects missing role claim (anonymous) with permission-denied', () => {
    expect(isPermDenied(catchRole(noRoleAuth, 'EDITOR', 'ADMIN'))).toBe(true)
  })

  it('rejects null auth with permission-denied', () => {
    expect(isPermDenied(catchRole(null, 'EDITOR', 'ADMIN'))).toBe(true)
  })

  it('allows EDITOR through', () => {
    expect(catchRole(editorAuth, 'EDITOR', 'ADMIN')).toBeNull()
  })

  it('allows ADMIN through', () => {
    expect(catchRole(adminAuth, 'EDITOR', 'ADMIN')).toBeNull()
  })
})

describe('requireRole — refreshNews guard (ADMIN only)', () => {
  it('rejects VIEWER with permission-denied', () => {
    expect(isPermDenied(catchRole(viewerAuth, 'ADMIN'))).toBe(true)
  })

  it('rejects EDITOR with permission-denied', () => {
    expect(isPermDenied(catchRole(editorAuth, 'ADMIN'))).toBe(true)
  })

  it('allows ADMIN through', () => {
    expect(catchRole(adminAuth, 'ADMIN')).toBeNull()
  })
})
