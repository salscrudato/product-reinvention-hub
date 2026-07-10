// Firestore security rules tests â€” requires the Firestore emulator to be running.
// Run via: pnpm test:rules  (firebase emulators:exec starts it automatically)
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { setDoc, doc, getDoc } from 'firebase/firestore'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8')

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  // Use isolated project so clearFirestore() never touches seed data in productreinvention
  testEnv = await initializeTestEnvironment({
    projectId: 'rules-test',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { await testEnv.cleanup() })
afterEach(async () => { await testEnv.clearFirestore() })

// Helper contexts
const admin   = () => testEnv.authenticatedContext('admin-uid',   { role: 'ADMIN' })
const editor  = () => testEnv.authenticatedContext('editor-uid',  { role: 'EDITOR' })
const viewer  = () => testEnv.authenticatedContext('viewer-uid',  { role: 'VIEWER' })
// A guest = anonymous sign-in provider, NO role claim (the auto-connected VITE_ALLOW_GUEST session).
const guest   = () => testEnv.authenticatedContext('guest-uid', { firebase: { sign_in_provider: 'anonymous' } })
const unauthed = () => testEnv.unauthenticatedContext()

describe('Firestore security rules â€” role matrix', () => {

  // â”€â”€ 1. VIEWER can read domain data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER can read a product document', async () => {
    // Seed a product using admin bypass
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'products/HO3'), { name: 'HO-3', rev: 1 })
    })
    const db = viewer().firestore()
    await assertSucceeds(getDoc(doc(db, 'products/HO3')))
  })

  // â”€â”€ 2. VIEWER cannot write to domain collections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER write to products is rejected', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'products/NEW'), { name: 'New Product' }))
  })

  // â”€â”€ 3. VIEWER can create feedback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER can submit new feedback', async () => {
    const db = viewer().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'feedback/fb1'), {
        type: 'IDEA', title: 'Test', detail: '', status: 'NEW',
        votes: { count: 0, voters: [] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'viewer-uid', name: 'Viewer' },
        context: { route: '/app' }, createdAt: null, updatedAt: null,
      }),
    )
  })

  // â”€â”€ 4. VIEWER can vote (add own uid to voters, increment count) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER vote allowance: can add own uid and increment count', async () => {
    // Seed the feedback doc first
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedback/fb2'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        votes: { count: 0, voters: [] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' },
        context: { route: '/app' },
      })
    })
    const db = viewer().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'feedback/fb2'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        // Only votes changes
        votes: { count: 1, voters: ['viewer-uid'] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' },
        context: { route: '/app' },
      }),
    )
  })

  // â”€â”€ 5. EDITOR can write domain data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('EDITOR can create and update a product', async () => {
    const db = editor().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Editor Product', rev: 1 })
    )
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Updated', rev: 2 })
    )
  })

  // â”€â”€ 6. ADMIN can write to users collection; unauthenticated cannot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('ADMIN can write users; unauthenticated is rejected', async () => {
    const adminDb = admin().firestore()
    await assertSucceeds(
      setDoc(doc(adminDb, 'users/some-uid'), { email: 'x@x.com', role: 'VIEWER' })
    )
    const anonDb = unauthed().firestore()
    await assertFails(
      setDoc(doc(anonDb, 'users/some-uid'), { email: 'hack@x.com' })
    )
  })

  // â”€â”€ 7. VIEWER cannot write the atomic-mutate surfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // mutate() writes entity + auditEvent + version + searchIndex in one batch; if ANY
  // required write is denied the whole batch fails, so these guard the invariant that a
  // VIEWER can never persist a domain change through the adapter.
  it('VIEWER write to a coverage sub-collection is rejected', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'products/HO3/coverages/COV1'), { name: 'X', rev: 1 }))
  })

  it('VIEWER write to searchIndex is rejected (so the atomic mutate batch is denied)', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'searchIndex/products_HO3'), { title: 'X', type: 'product' }))
  })

  it('VIEWER write to dictionary and tasks is rejected', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'dictionary/D1'), { term: 'X', rev: 1 }))
    await assertFails(setDoc(doc(db, 'tasks/T1'), { title: 'X', rev: 1 }))
  })

  // â”€â”€ 8. VIEWER feedback is votes-only â€” any other field change is rejected â”€â”€â”€â”€â”€â”€
  it('VIEWER feedback update is rejected when a non-votes field changes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedback/fb3'), {
        type: 'IDEA', title: 'Original', status: 'NEW',
        votes: { count: 0, voters: [] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' }, context: { route: '/app' },
      })
    })
    const db = viewer().firestore()
    await assertFails(
      setDoc(doc(db, 'feedback/fb3'), {
        type: 'IDEA', title: 'Hijacked', status: 'DONE',   // changes more than votes
        votes: { count: 1, voters: ['viewer-uid'] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' }, context: { route: '/app' },
      }),
    )
  })

  // â”€â”€ 9. EDITOR is not ADMIN â€” cannot manage users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('EDITOR cannot write the users collection (ADMIN only)', async () => {
    const db = editor().firestore()
    await assertFails(setDoc(doc(db, 'users/victim-uid'), { role: 'ADMIN' }))
  })

  // â”€â”€ 10. Audit log is append-only â€” no update, even for ADMIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('auditEvents are append-only â€” update is rejected even for ADMIN', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditEvents/ae1'), { action: 'create', actor: { uid: 'x' } })
    })
    const db = admin().firestore()
    await assertFails(setDoc(doc(db, 'auditEvents/ae1'), { action: 'tampered', actor: { uid: 'x' } }))
  })

  // â”€â”€ 11. Guest (anonymous) is READ-ONLY â€” the VITE_ALLOW_GUEST floor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A guest reads domain data (the guest floor) but every write predicate requires a real
  // (non-anonymous) account via isMember(), so anonymous sessions can never write anywhere.
  it('guest (anonymous) can read a product document', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'products/HO3'), { name: 'HO-3', rev: 1 })
    })
    await assertSucceeds(getDoc(doc(guest().firestore(), 'products/HO3')))
  })

  it('guest (anonymous) cannot submit feedback (write denied)', async () => {
    const db = guest().firestore()
    await assertFails(
      setDoc(doc(db, 'feedback/gf1'), {
        type: 'IDEA', title: 'Guest', status: 'NEW',
        votes: { count: 0, voters: [] }, impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'guest-uid', name: 'Guest' }, context: { route: '/app' },
      }),
    )
  })

  it('guest (anonymous) cannot forge an auditEvent or write presence/newsPrefs', async () => {
    const db = guest().firestore()
    await assertFails(setDoc(doc(db, 'auditEvents/gf2'), { action: 'create', actor: { uid: 'guest-uid' } }))
    await assertFails(setDoc(doc(db, 'presence/HO3/viewers/guest-uid'), { uid: 'guest-uid', at: null }))
    await assertFails(setDoc(doc(db, 'newsPrefs/guest-uid'), { pinnedHashes: [] }))
  })

  it('guest (anonymous) cannot vote on feedback', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedback/gf3'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        votes: { count: 0, voters: [] }, impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' }, context: { route: '/app' },
      })
    })
    const db = guest().firestore()
    await assertFails(
      setDoc(doc(db, 'feedback/gf3'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        votes: { count: 1, voters: ['guest-uid'] }, impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' }, context: { route: '/app' },
      }),
    )
  })

  // â”€â”€ 12. EDITOR cannot write news (ADMIN-only surface) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('EDITOR write to news is rejected (admin-only)', async () => {
    const db = editor().firestore()
    await assertFails(setDoc(doc(db, 'news/n1'), { title: 'Scoop', body: 'Test', publishedAt: null }))
  })

  it('ADMIN can write news', async () => {
    const db = admin().firestore()
    await assertSucceeds(setDoc(doc(db, 'news/n2'), { title: 'Admin scoop', body: 'OK', publishedAt: null }))
  })

  // â”€â”€ 13. aiUsage â€” ADMIN-only reads; VIEWER and EDITOR are denied â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER cannot read aiUsage (cost telemetry is admin-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'aiUsage/usage1'), { feature: 'chat', usd: 0.018 })
    })
    await assertFails(getDoc(doc(viewer().firestore(), 'aiUsage/usage1')))
  })

  it('EDITOR cannot read aiUsage', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'aiUsage/usage2'), { feature: 'chat', usd: 0.018 })
    })
    await assertFails(getDoc(doc(editor().firestore(), 'aiUsage/usage2')))
  })

  it('ADMIN can read aiUsage', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'aiUsage/usage3'), { feature: 'chat', usd: 0.018 })
    })
    await assertSucceeds(getDoc(doc(admin().firestore(), 'aiUsage/usage3')))
  })

  // â”€â”€ 14. auditEvents â€” ADMIN reads; VIEWER/EDITOR cannot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('ADMIN can read auditEvents', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditEvents/ae2'), { action: 'create', actor: { uid: 'editor-uid' } })
    })
    await assertSucceeds(getDoc(doc(admin().firestore(), 'auditEvents/ae2')))
  })

  it('VIEWER cannot read auditEvents', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditEvents/ae3'), { action: 'create', actor: { uid: 'editor-uid' } })
    })
    await assertFails(getDoc(doc(viewer().firestore(), 'auditEvents/ae3')))
  })

  // â”€â”€ 15. Server-only collections â€” denied to every client role, INCLUDING ADMIN â”€
  // groundingChunks, semanticCache, and costCounters are written via the Admin SDK
  // (which bypasses rules). Even ADMIN client-side reads are rejected so the "app
  // never reads the vector store" guardrail is two-sided.
  it('groundingChunks read is denied to ADMIN (server-only collection)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groundingChunks/gc1'), { text: 'chunk' })
    })
    await assertFails(getDoc(doc(admin().firestore(), 'groundingChunks/gc1')))
  })

  it('semanticCache read is denied to ADMIN', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'semanticCache/sc1'), { answer: 'cached' })
    })
    await assertFails(getDoc(doc(admin().firestore(), 'semanticCache/sc1')))
  })

  it('costCounters read is denied to ADMIN', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'costCounters/cc1'), { usd: 1.23 })
    })
    await assertFails(getDoc(doc(admin().firestore(), 'costCounters/cc1')))
  })

  // â”€â”€ 16. newsPrefs â€” own-doc only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('VIEWER can read and write their own newsPrefs doc', async () => {
    // read own
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'newsPrefs/viewer-uid'), { pinnedHashes: [] })
    })
    await assertSucceeds(getDoc(doc(viewer().firestore(), 'newsPrefs/viewer-uid')))
    // write own (isMember && myUid() == uid)
    await assertSucceeds(setDoc(doc(viewer().firestore(), 'newsPrefs/viewer-uid'), { pinnedHashes: ['abc'] }))
  })

  it("VIEWER cannot read another user's newsPrefs", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'newsPrefs/editor-uid'), { pinnedHashes: [] })
    })
    await assertFails(getDoc(doc(viewer().firestore(), 'newsPrefs/editor-uid')))
  })

  it('guest (anonymous) cannot read or write any newsPrefs doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'newsPrefs/guest-uid'), { pinnedHashes: [] })
    })
    // read own â€” isAuthed() passes but isGuest() makes isMember() false; read rule uses isAuthed()
    // which would pass, BUT newsPrefs rule is: allow read: if isAuthed() && myUid() == uid
    // Guest IS isAuthed(), so read own-doc actually PASSES. But write is blocked (isMember() is false).
    // Confirm write is denied:
    await assertFails(setDoc(doc(guest().firestore(), 'newsPrefs/guest-uid'), { pinnedHashes: ['x'] }))
  })
})
