// auditActor.test.ts — D: verify the audit event actor always equals the authenticated caller.
//
// Two layers:
//   1. callableActor() — pure extraction helper in runtime.ts. No mocks.
//   2. auditedMerge()  — the write path that reaches Firestore. Firestore is mocked so the
//      test runs without a real DB, and we assert the actor written to the auditEvent doc
//      equals the actor passed in — closing the blank-actor hole described in workstream D.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callableActor } from './runtime'

// ─── 1. Pure callableActor derivation ─────────────────────────────────────────

describe('callableActor — D: derive audit actor from onCall auth token', () => {
  it('uses display name when set', () => {
    expect(callableActor({ uid: 'u1', token: { name: 'Alice', email: 'a@b.com' } }))
      .toEqual({ uid: 'u1', name: 'Alice' })
  })

  it('falls back to email when display name is absent', () => {
    expect(callableActor({ uid: 'u1', token: { email: 'a@b.com' } }))
      .toEqual({ uid: 'u1', name: 'a@b.com' })
  })

  it('falls back to uid when neither name nor email is set', () => {
    expect(callableActor({ uid: 'u1', token: {} }))
      .toEqual({ uid: 'u1', name: 'u1' })
  })

  it('uid is the Firebase-verified caller uid — never blank', () => {
    expect(callableActor({ uid: 'firebase-uid-abc123', token: {} }).uid)
      .toBe('firebase-uid-abc123')
  })

  it('strips whitespace from display name before using it', () => {
    expect(callableActor({ uid: 'u1', token: { name: '  Alice  ' } }).name).toBe('Alice')
  })

  it('treats whitespace-only display name as absent and falls back to email', () => {
    expect(callableActor({ uid: 'u1', token: { name: '   ', email: 'a@b.com' } }).name)
      .toBe('a@b.com')
  })
})

// ─── 2. auditedMerge writes the actor faithfully (mocked Firestore) ───────────
// vi.hoisted() ensures the mock fn references are created before vi.mock() hoisting
// resolves — they can then be used both inside the factory and in test assertions.

const mockSet = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: () => ({}), exists: false }),
)

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc:        (path: string) => ({ id: path }),
    collection: (col: string) => ({ doc: () => ({ id: `${col}/auto` }) }),
    runTransaction: vi.fn().mockImplementation(
      async (cb: (tx: { get: typeof mockGet; set: typeof mockSet }) => Promise<void>) => {
        await cb({ get: mockGet, set: mockSet })
      },
    ),
  }),
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}))

// auditedMerge is imported AFTER the mock is wired up (vi.mock hoisting handles the order).
import { auditedMerge } from './audited'

describe('auditedMerge — D: actor.uid propagates to the audit event write', () => {
  beforeEach(() => {
    mockSet.mockClear()
    // Entity doc doesn't exist yet (fresh create path; prevData = {}).
    mockGet.mockResolvedValue({ data: () => ({}), exists: false })
  })

  it('writes actor.uid and actor.name into the auditEvent document', async () => {
    const actor = { uid: 'caller-uid-xyz', name: 'Test Caller' }
    await auditedMerge({
      path: 'forms/HO-00-03', entityType: 'form',
      patch: { description: 'A homeowners base form.' },
      actor,
    })

    // tx.set(ref, data, opts) — data is args[1]; the auditEvent is the set() with action.
    const auditCall = mockSet.mock.calls.find(
      (args) => typeof (args[1] as Record<string, unknown>)?.['action'] === 'string',
    )
    expect(auditCall, 'auditEvent write was not found').toBeDefined()
    const written = auditCall![1] as { actor: { uid: string; name: string } }
    expect(written.actor.uid).toBe('caller-uid-xyz')
    expect(written.actor.name).toBe('Test Caller')
  })

  it('entity write carries updatedBy === actor.uid', async () => {
    const actor = { uid: 'editor-uid-789', name: 'Editor' }
    await auditedMerge({
      path: 'forms/HO-00-03', entityType: 'form',
      patch: { description: 'x' },
      actor,
    })

    // tx.set(ref, data, opts) — data is args[1]; entity write has no action/snapshot/keywords.
    const entityCall = mockSet.mock.calls.find((args) => {
      const d = args[1] as Record<string, unknown>
      return !('action' in d) && !('snapshot' in d) && !('keywords' in d)
    })
    expect(entityCall, 'entity write was not found').toBeDefined()
    expect((entityCall![1] as Record<string, unknown>)['updatedBy']).toBe('editor-uid-789')
  })
})
