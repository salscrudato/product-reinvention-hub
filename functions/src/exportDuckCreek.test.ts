// exportDuckCreek.test.ts — server function role-guard + audit-continuity tests.
// Invokes the callable via its v2 `.run()` seam and asserts:
//   - Unauthenticated callers are rejected (unauthenticated HttpsError).
//   - VIEWER callers ARE allowed: export is a READ; VIEWER may export — this is the
//     two-sided role check that mirrors "all product data is readable by isAuthed()".
//   - EDITOR and ADMIN callers are also allowed.
//   - Missing required fields (productId, manuScriptID) throw invalid-argument.
//   - AUDIT CONTINUITY: every export writes an append-only `export-duckcreek` audit event
//     carrying the manuScriptID — including a REPEAT export of the same product (a second
//     event is written; exports are never deduped).
// No Firestore / Admin SDK call is reached in the rejection cases (the guard short-
// circuits before any write), keeping these as pure unit tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { exportDuckCreek } from './exportDuckCreek'

// Capture every auditEvents.add({...}) call so audit continuity can be asserted.
const addSpy = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.fn((_doc: any) => Promise.resolve({ id: 'stub-audit-id' })),
)

// Stub Firebase Admin so the callable can be imported without a real app.
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ add: addSpy }),
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

  it('does NOT write an audit event when the guard rejects (no silent partial write)', async () => {
    await rejectionOf(exportDuckCreek.run(reqAs('NONE', VALID_DATA)))
    await rejectionOf(exportDuckCreek.run(reqAs('VIEWER', { productId: 'prod-001' })))
    expect(addSpy).not.toHaveBeenCalled()
  })
})

describe('exportDuckCreek — audit continuity (manuScriptID event on EVERY export)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventOf = (i: number): any => addSpy.mock.calls[i]![0]

  it('writes an append-only export-duckcreek event carrying the manuScriptID + actor', async () => {
    const result = await exportDuckCreek.run(reqAs('EDITOR', VALID_DATA))
    expect(result).toEqual({ ok: true })
    expect(addSpy).toHaveBeenCalledTimes(1)
    const evt = eventOf(0)
    expect(evt.action).toBe('export-duckcreek')
    expect(evt.entityType).toBe('product')
    expect(evt.entityPath).toBe(`products/${VALID_DATA.productId}`)
    expect(evt.productId).toBe(VALID_DATA.productId)
    expect(evt.manuScriptID).toBe(VALID_DATA.manuScriptID)
    expect(evt.actor.uid).toBe('editor-uid')
    expect(evt.at).toBeDefined()   // serverTimestamp sentinel
  })

  it('writes a SECOND event on a REPEAT export of the same product (append-only, never deduped)', async () => {
    await exportDuckCreek.run(reqAs('EDITOR', VALID_DATA))
    await exportDuckCreek.run(reqAs('EDITOR', VALID_DATA))
    expect(addSpy).toHaveBeenCalledTimes(2)
    expect(eventOf(0).manuScriptID).toBe(VALID_DATA.manuScriptID)
    expect(eventOf(1).manuScriptID).toBe(VALID_DATA.manuScriptID)
    expect(eventOf(0).productId).toBe(VALID_DATA.productId)
    expect(eventOf(1).productId).toBe(VALID_DATA.productId)
  })

  it('records productRefId on the audit event when supplied', async () => {
    await exportDuckCreek.run(reqAs('VIEWER', { ...VALID_DATA, productRefId: 'PH.PROD.001' }))
    expect(eventOf(0).productRefId).toBe('PH.PROD.001')
  })
})
