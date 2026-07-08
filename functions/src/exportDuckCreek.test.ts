// exportDuckCreek.test.ts — server function role-guard tests (mirrors guards.test.ts).
// Invokes the callable via its v2 `.run()` seam and asserts:
//   - Unauthenticated callers are rejected (unauthenticated HttpsError).
//   - VIEWER callers ARE allowed: export is a READ; VIEWER may export — this is the
//     two-sided role check that mirrors "all product data is readable by isAuthed()".
//   - EDITOR and ADMIN callers are also allowed.
//   - Missing required fields (productId, manuScriptID) throw invalid-argument.
// No Firestore / Admin SDK call is reached in the rejection cases (the guard short-
// circuits before any write), keeping these as pure unit tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { exportDuckCreek } from './exportDuckCreek'

// Stub Firebase Admin so the callable can be imported without a real app.
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      add: () => Promise.resolve({ id: 'stub-audit-id' }),
    }),
  }),
  FieldValue: { serverTimestamp: () => ({ _type: 'serverTimestamp' }) },
}))
vi.mock('firebase-admin/app', () => ({
  getApps:    () => [{}],   // pretend an app is already initialised
  initializeApp: vi.fn(),
}))

type Role = 'VIEWER' | 'EDITOR' | 'ADMIN'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reqAs(role: Role | 'ANON' | 'NONE', data: unknown): any {
  const auth =
    role === 'NONE' ? undefined :
    role === 'ANON' ? { uid: 'anon-uid', token: {} } :
    { uid: `${role.toLowerCase()}-uid`, token: { role, name: `Test ${role}` } }
  return { data, auth }
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null } catch (e) { return e }
}

const VALID_DATA = { productId: 'prod-001', manuScriptID: 'PCG_HO_Admitted_ViewModel_US_1_0_0_0' }

beforeEach(() => { vi.clearAllMocks() })

describe('exportDuckCreek — unauthenticated caller is rejected', () => {
  it('rejects with unauthenticated when there is no auth', async () => {
    const err = await rejectionOf(exportDuckCreek.run(reqAs('NONE', VALID_DATA)))
    expect(err instanceof HttpsError).toBe(true)
    expect((err as HttpsError).code).toBe('unauthenticated')
  })
})

describe('exportDuckCreek — VIEWER is ALLOWED (export = read, mirrors isAuthed() rule)', () => {
  it('resolves successfully for a VIEWER caller with valid data', async () => {
    const result = await exportDuckCreek.run(reqAs('VIEWER', VALID_DATA))
    expect(result).toEqual({ ok: true })
  })
})

describe('exportDuckCreek — EDITOR and ADMIN are also allowed', () => {
  it('resolves for EDITOR', async () => {
    const result = await exportDuckCreek.run(reqAs('EDITOR', VALID_DATA))
    expect(result).toEqual({ ok: true })
  })

  it('resolves for ADMIN', async () => {
    const result = await exportDuckCreek.run(reqAs('ADMIN', VALID_DATA))
    expect(result).toEqual({ ok: true })
  })
})

describe('exportDuckCreek — invalid-argument guard', () => {
  it('rejects when productId is missing', async () => {
    const err = await rejectionOf(
      exportDuckCreek.run(reqAs('VIEWER', { manuScriptID: 'PCG_HO_X' })),
    )
    expect(err instanceof HttpsError).toBe(true)
    expect((err as HttpsError).code).toBe('invalid-argument')
  })

  it('rejects when manuScriptID is missing', async () => {
    const err = await rejectionOf(
      exportDuckCreek.run(reqAs('VIEWER', { productId: 'prod-001' })),
    )
    expect(err instanceof HttpsError).toBe(true)
    expect((err as HttpsError).code).toBe('invalid-argument')
  })
})
