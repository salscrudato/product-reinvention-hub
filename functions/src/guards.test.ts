// Function-level auth/role guard tests (B7) — invokes the REAL exported callables via their
// v2 `.run()` test seam and asserts they reject a VIEWER / anonymous caller BEFORE doing any
// privileged work. This is stronger than testing requireRole() in isolation (roleGuard.test.ts):
// it proves each Function actually wires the guard, closing the two-sided-role invariant on the
// server side. Every rejection short-circuits at the guard, so no Firestore / Anthropic call is
// ever reached — these stay pure unit tests (no emulator, no secret, no network).
import { describe, it, expect } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { setUserRole } from './admin'
import { describeForm } from './describeForm'
import { refreshNews } from './news'

type Role = 'VIEWER' | 'EDITOR' | 'ADMIN'

/** Build the minimal CallableRequest the guard path reads (data + auth token). Returns `any`
 *  so the one stub serves every callable's differently-typed request. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reqAs(role: Role | 'ANON' | 'NONE', data: unknown): any {
  const auth =
    role === 'NONE' ? undefined :
    role === 'ANON' ? { uid: 'anon', token: {} } :
    { uid: `${role.toLowerCase()}-uid`, token: { role } }
  return { data, auth }
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null } catch (e) { return e }
}
const isPermDenied = (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied'

describe('setUserRole — ADMIN only (mirrors users/{uid} isAdmin() rule)', () => {
  const createInput = { action: 'create', email: 'x@y.com', password: 'secret1', role: 'VIEWER' as Role }

  it('rejects VIEWER with permission-denied', async () => {
    expect(isPermDenied(await rejectionOf(setUserRole.run(reqAs('VIEWER', createInput))))).toBe(true)
  })
  it('rejects EDITOR with permission-denied', async () => {
    expect(isPermDenied(await rejectionOf(setUserRole.run(reqAs('EDITOR', createInput))))).toBe(true)
  })
  it('rejects an anonymous (no-role) caller', async () => {
    expect(isPermDenied(await rejectionOf(setUserRole.run(reqAs('ANON', createInput))))).toBe(true)
  })
})

describe('describeForm — EDITOR | ADMIN (mirrors forms/{key} canEdit() rule)', () => {
  it('rejects VIEWER with permission-denied', async () => {
    expect(isPermDenied(await rejectionOf(describeForm.run(reqAs('VIEWER', { formKey: 'HO-00-03' }))))).toBe(true)
  })
  it('rejects an anonymous (no-role) caller', async () => {
    expect(isPermDenied(await rejectionOf(describeForm.run(reqAs('ANON', { formKey: 'HO-00-03' }))))).toBe(true)
  })
})

describe('refreshNews — ADMIN only (mirrors news/{id} isAdmin() rule)', () => {
  it('rejects VIEWER with permission-denied', async () => {
    expect(isPermDenied(await rejectionOf(refreshNews.run(reqAs('VIEWER', {}))))).toBe(true)
  })
  it('rejects EDITOR with permission-denied', async () => {
    expect(isPermDenied(await rejectionOf(refreshNews.run(reqAs('EDITOR', {}))))).toBe(true)
  })
  it('rejects an unauthenticated caller', async () => {
    // refreshNews throws `unauthenticated` before the role check when there is no auth at all.
    const e = await rejectionOf(refreshNews.run(reqAs('NONE', {})))
    expect(e instanceof HttpsError && (e.code === 'unauthenticated' || e.code === 'permission-denied')).toBe(true)
  })
})
