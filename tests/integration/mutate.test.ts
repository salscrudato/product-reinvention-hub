// mutate() integration test (B6) — proves the single most load-bearing write path end-to-end
// against the Firestore emulator, using the REAL app adapter (app/src/lib/backend). The unit
// suite never exercises the transaction; tests/rules.test.ts proves only the RULES side. This
// closes that gap: the entity + audit + version(diff) + searchIndex envelope, the rev re-check
// + conflict rejection, and the coverage-term guard — the invariants a green gate could not
// otherwise catch regressing.
//
// It loads OPEN rules onto the adapter's project so the (unauthenticated) client can drive the
// transaction directly — this suite is about the transaction, not authz (that is rules.test.ts).
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { adapter, MutationConflictError } from '../../app/src/lib/backend'

const OPEN_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`

const OPEN_STORAGE_RULES = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} { allow read, write: if true; }
  }
}`

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'productreinvention',   // MUST match app/src/lib/backend/firebase.config.ts
    firestore: { rules: OPEN_RULES, host: '127.0.0.1', port: 8080 },
    storage:   { rules: OPEN_STORAGE_RULES, host: '127.0.0.1', port: 9199 },
  })
})
afterAll(async () => { await testEnv.cleanup() })
afterEach(async () => { await testEnv.clearFirestore() })

const actor = { uid: 'itest-user', name: 'Integration Tester' }
const get  = (path: string) => adapter.db.get<Record<string, unknown>>(path)
const list = (path: string) => adapter.db.list<Record<string, unknown>>(path)

const PROD = 'products/ITEST'

describe('adapter.db.mutate() — the atomic write envelope (emulator)', () => {

  it('create writes entity + audit + version + searchIndex atomically (rev:1)', async () => {
    await adapter.db.mutate({
      op: 'create', path: PROD, entityType: 'product', actor,
      data: { name: 'Integration Product', refId: 'ITEST.PROD.001', lob: { name: 'Home' } },
    })

    const p = await get(PROD)
    expect(p?.rev).toBe(1)
    expect(p?.name).toBe('Integration Product')
    expect(p?.updatedBy).toBe(actor.uid)
    expect(p?.createdAt).toBeTruthy()

    const audits = await list('auditEvents')
    expect(audits.filter(a => a.entityPath === PROD && a.action === 'create')).toHaveLength(1)

    const versions = await list('versions')
    const v = versions.find(x => x.entityPath === PROD)
    expect(v).toBeTruthy()
    expect((v!.snapshot as { name?: string })?.name).toBe('Integration Product')

    // product is an INDEXABLE type → a ⌘K entry is written in the SAME transaction
    const idx = await get('searchIndex/products_ITEST')
    expect(idx?.type).toBe('product')
    expect(idx?.title).toBe('Integration Product')
  })

  it('update with the correct expectedRev bumps rev and records a field-level diff', async () => {
    await adapter.db.mutate({ op: 'create', path: PROD, entityType: 'product', actor, data: { name: 'Original', refId: 'ITEST.PROD.001' } })
    await adapter.db.mutate({ op: 'update', path: PROD, entityType: 'product', actor, expectedRev: 1, data: { name: 'Renamed', refId: 'ITEST.PROD.001' } })

    const p = await get(PROD)
    expect(p?.rev).toBe(2)
    expect(p?.name).toBe('Renamed')

    const versions = await list('versions')
    const diffV = versions.find(v => Array.isArray(v.diff) &&
      (v.diff as Array<{ field: string; before: unknown; after: unknown }>)
        .some(d => d.field === 'name' && d.before === 'Original' && d.after === 'Renamed'))
    expect(diffV).toBeTruthy()
  })

  it('update with a STALE expectedRev throws MutationConflictError and never overwrites', async () => {
    await adapter.db.mutate({ op: 'create', path: PROD, entityType: 'product', actor, data: { name: 'V1', refId: 'ITEST.PROD.001' } })
    await adapter.db.mutate({ op: 'update', path: PROD, entityType: 'product', actor, expectedRev: 1, data: { name: 'V2', refId: 'ITEST.PROD.001' } })

    // A writer that still holds rev:1 must lose to the committed rev:2.
    await expect(
      adapter.db.mutate({ op: 'update', path: PROD, entityType: 'product', actor, expectedRev: 1, data: { name: 'STALE', refId: 'ITEST.PROD.001' } }),
    ).rejects.toBeInstanceOf(MutationConflictError)

    const p = await get(PROD)
    expect(p?.name).toBe('V2')   // the losing write left no trace
    expect(p?.rev).toBe(2)
  })

  it('term guard: a coverage with two default options is rejected and NOTHING persists', async () => {
    const badTerm = {
      id: 't1', label: 'Limit', kind: 'LIMIT',
      optionSet: [
        { id: 'o1', label: 'A', type: 'FLAT', value: 1000, isDefault: true, enabled: true, allStates: true, states: [] },
        { id: 'o2', label: 'B', type: 'FLAT', value: 2000, isDefault: true, enabled: true, allStates: true, states: [] },
      ],
    }
    await expect(
      adapter.db.mutate({
        op: 'create', path: `${PROD}/coverages/COV1`, entityType: 'coverage', actor,
        data: { name: 'Bad Coverage', refId: 'ITEST.COV.001', allStates: true, states: [], terms: [badTerm] },
      }),
    ).rejects.toThrow(/Invalid coverage terms|default/i)

    // The domain guard runs INSIDE the transaction, so the whole envelope aborts.
    expect(await get(`${PROD}/coverages/COV1`)).toBeNull()
    const audits = await list('auditEvents')
    expect(audits.filter(a => a.entityPath === `${PROD}/coverages/COV1`)).toHaveLength(0)
  })

  it('delete removes entity + searchIndex, appends a delete audit + null-snapshot version', async () => {
    await adapter.db.mutate({ op: 'create', path: PROD, entityType: 'product', actor, data: { name: 'ToDelete', refId: 'ITEST.PROD.001' } })
    await adapter.db.mutate({ op: 'delete', path: PROD, entityType: 'product', actor })

    expect(await get(PROD)).toBeNull()
    expect(await get('searchIndex/products_ITEST')).toBeNull()

    const audits = await list('auditEvents')
    expect(audits.some(a => a.entityPath === PROD && a.action === 'delete')).toBe(true)

    const versions = await list('versions')
    expect(versions.some(v => v.entityPath === PROD && v.snapshot === null)).toBe(true)
  })

  it('searchIndex upkeep: a NON-indexable entity type writes no ⌘K doc (but is still audited)', async () => {
    await adapter.db.mutate({ op: 'create', path: `newsPrefs/${actor.uid}`, entityType: 'newsPrefs', actor, data: { instruction: 'track rate filings' } })

    expect(await get(`searchIndex/newsPrefs_${actor.uid}`)).toBeNull()
    const audits = await list('auditEvents')
    expect(audits.some(a => a.entityPath === `newsPrefs/${actor.uid}`)).toBe(true)
  })
})

describe('adapter.storage — emulator wiring (B8: local uploads never reach prod)', () => {
  it('upload + getUrl resolve to the Storage EMULATOR host, not the production bucket', async () => {
    const path = `uploads/${actor.uid}/hello.txt`
    const uploadUrl = await adapter.storage.upload(path, new Blob(['hello from the emulator']))
    const fetchedUrl = await adapter.storage.getUrl(path)

    // The emulator serves download URLs off 127.0.0.1:9199. A prod write would return a
    // firebasestorage.googleapis.com URL — this is the assertion that proves the B8 fix: with
    // VITE_USE_EMULATORS on, storage is wired to the emulator, so a local upload can't hit prod.
    expect(uploadUrl).toContain('127.0.0.1:9199')
    expect(fetchedUrl).toContain('127.0.0.1:9199')
    expect(uploadUrl).not.toContain('firebasestorage.googleapis.com')
  })
})
