// Firestore security rules tests — requires the Firestore emulator to be running.
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
const unauthed = () => testEnv.unauthenticatedContext()

describe('Firestore security rules — role matrix', () => {

  // ── 1. VIEWER can read domain data ──────────────────────────────────────────
  it('VIEWER can read a product document', async () => {
    // Seed a product using admin bypass
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'products/HO3'), { name: 'HO-3', rev: 1 })
    })
    const db = viewer().firestore()
    await assertSucceeds(getDoc(doc(db, 'products/HO3')))
  })

  // ── 2. VIEWER cannot write to domain collections ─────────────────────────────
  it('VIEWER write to products is rejected', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'products/NEW'), { name: 'New Product' }))
  })

  // ── 3. VIEWER can create feedback ────────────────────────────────────────────
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

  // ── 4. VIEWER can vote (add own uid to voters, increment count) ──────────────
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

  // ── 5. EDITOR can write domain data ──────────────────────────────────────────
  it('EDITOR can create and update a product', async () => {
    const db = editor().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Editor Product', rev: 1 })
    )
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Updated', rev: 2 })
    )
  })

  // ── 6. ADMIN can write to users collection; unauthenticated cannot ────────────
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
})
