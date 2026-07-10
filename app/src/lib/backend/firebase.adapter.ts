// Firebase implementation of BackendAdapter.
// Connects to the Emulator Suite when VITE_USE_EMULATORS=true.
// AWS-SWAP: replace with aws.adapter.ts — see aws.adapter.placeholder.ts for the mapping.
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
	getAuth, signInWithEmailAndPassword, signOut as fbSignOut,
	onAuthStateChanged, updatePassword, connectAuthEmulator, signInAnonymously,
} from 'firebase/auth'
import {
  getFirestore, doc, collection, getDoc, getDocs, onSnapshot,
  serverTimestamp, setDoc, deleteDoc, updateDoc,
  arrayUnion, increment,
  query as fbQuery, where, orderBy, limit as fbLimit,
  runTransaction, connectFirestoreEmulator,
} from 'firebase/firestore'
import type { Transaction } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'
import { firebaseConfig, FUNCTIONS_REGION } from './firebase.config'
import type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
import { MutationConflictError } from './types'
import { buildMutationWrites } from './envelope'
import { validateCoverageParent } from './coverageParent'
import { assertCoverageTermsValid, resolveLob } from '@pf/shared'
import type { CoverageTerm } from '@pf/shared'
import {
  REFID_SEGMENT, PRJ_COUNTER_KEY, productCounterKey,
  subEntityCounterKey, buildRefId, maxSeqIn,
} from './refIdAlloc'

// Singleton — safe under React StrictMode and Vite HMR.
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
const auth        = getAuth(firebaseApp)
const db          = getFirestore(firebaseApp)
const storage     = getStorage(firebaseApp)
const functions   = getFunctions(firebaseApp, FUNCTIONS_REGION)

// Wire emulators in development; module-level guard prevents duplicate connects on HMR.
// AWS-SWAP: no emulator step needed; point to real AWS endpoints per environment config.
// B8 FOOTGUN FIX: Storage is now emulated alongside Auth/Firestore/Functions. Previously
// Storage was left on the LIVE endpoint even in emulator mode, so a local base-form upload
// silently wrote objects into the PRODUCTION bucket. The old "CORS" note conflated two things:
// the local emulator (127.0.0.1:9199) has no cross-origin issue; the real CORS config is for
// the PROD bucket from a deployed origin (see the `cors:set`/`storage.cors.json` scripts).
// Because every connect lives in this one guarded block, when emulators are on, uploads/reads
// hit the emulator; when off (prod build), they hit prod — no path leaves local uploads on prod.
let _emulatorsWired = false
if (import.meta.env.VITE_USE_EMULATORS === 'true' && !_emulatorsWired) {
  _emulatorsWired = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)   // firebase.json → emulators.storage.port
}

/** Parse a Firestore document snapshot into a typed value with its id. */
function snapToData<T>(snapshot: { id: string; data(): Record<string, unknown> | undefined }): T | null {
  const d = snapshot.data()
  return d ? ({ id: snapshot.id, ...d } as unknown as T) : null
}

/** Extract the AuthUser from Firebase user + custom claims. */
async function toAuthUser(fbUser: {
  uid: string
  email: string | null
  displayName: string | null
  getIdTokenResult(force?: boolean): Promise<{ claims: Record<string, unknown> }>
}): Promise<AuthUser> {
  const result = await fbUser.getIdTokenResult()
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    name: fbUser.displayName,
    role: (result.claims['role'] as AuthUser['role']) ?? null,
  }
}

/** Build a Firestore Query from the adapter Query shape. */
function buildQuery(collRef: ReturnType<typeof collection>, q: Query) {
  const constraints: Parameters<typeof fbQuery>[1][] = []
  for (const w of q.where ?? []) constraints.push(where(w.field, w.op, w.value))
  for (const o of q.orderBy ?? []) constraints.push(orderBy(o.field, o.dir ?? 'asc'))
  if (q.limit != null) constraints.push(fbLimit(q.limit))
  return fbQuery(collRef, ...constraints)
}

// The indexable-type set + the atomic write envelope now live in ./envelope (pure,
// unit-testable, shared by mutate() and mutateBatch()).

// ─── Server-authoritative O(1) refId allocation ───────────────────────────────
// refIds (PH.PROD.001, PH.COV.004, PH.RU.011, …) are minted from a single counter
// document (meta/refCounters).  The counter increment lives INSIDE the same Firestore
// runTransaction that writes the entity, so two simultaneous creates for the same segment
// can never collide — Firestore retries the loser and it reads the committed counter value.
// Pure key/format helpers live in ./refIdAlloc (importable by tests without Vite deps).
//
// Key scheme (underscores — Firestore treats dots in field names as nested-field paths):
//   PRJ                    — global project counter
//   {LOB}_PROD             — per-LOB product counter        e.g. PH_PROD
//   {LOB}_{SEG}_{pid}      — per-product sub-entity counter e.g. PH_COV_PH_PROD_001
//
// First allocation for a missing key: legacy getDocs scan seeds the counter at the current
// max, persists it atomically (conditional set — harmless if two callers race), then the
// main transaction proceeds O(1).  Once seeded, the legacy scan never runs again for that key.
//
// Scale note: at 50+ products, move the counter doc to a sharded sub-collection or
// migrate the build to a scheduled function; the seam is isolated to ensureCounterSeeded.

const COUNTER_DOC = 'meta/refCounters'

/** All information the transaction needs to allocate a refId atomically. */
interface CounterAlloc {
  counterKey: string
  buildRefId: (seq: number) => string
  /** Legacy getDocs scan — returns the current max sequence, run once to seed a missing key. */
  seedFrom:   () => Promise<number>
}

/** Resolve the LOB prefix for a sub-entity: O(1) product getDoc when productId is available,
 *  sibling scan otherwise (preserves pre-migration behaviour for callers that omit productId). */
async function subEntityLob(m: MutationPayload): Promise<string> {
  if (m.productId) {
    const psnap = await getDoc(doc(db, `products/${m.productId}`))
    return resolveLob(psnap.data() as { lob?: { refId?: string | null } } | undefined).prefix
  }
  // Fallback: derive LOB from an existing sibling's refId prefix.
  const collPath = m.path.split('/').filter(Boolean).slice(0, -1).join('/')
  const snap = await getDocs(collection(db, collPath))
  const prefix = snap.docs
    .map(d => (d.data() as { refId?: string | null }).refId)
    .find(r => typeof r === 'string' && r.includes('.'))
    ?.split('.')[0]
  return prefix ?? resolveLob(null).prefix
}

/** Build a CounterAlloc for a create mutation that needs a refId minted.
 *  Returns undefined when no refId is needed (non-create, explicit refId, or unknown type). */
async function prepareCounterAlloc(m: MutationPayload): Promise<CounterAlloc | undefined> {
  if (m.op !== 'create') return undefined
  const current = m.data?.['refId'] as string | null | undefined
  if (current && String(current).trim()) return undefined   // explicit refId wins

  // ── Projects ──
  if (m.entityType === 'project') {
    return {
      counterKey: PRJ_COUNTER_KEY,
      buildRefId: (seq) => `PRJ.${String(seq).padStart(3, '0')}`,
      seedFrom: async () => {
        const snap = await getDocs(collection(db, 'projects'))
        return snap.docs.reduce((mx, d) => {
          const n = Number(/^PRJ\.(\d+)/i.exec((d.data() as { refId?: string }).refId ?? '')?.[1] ?? 0)
          return Number.isFinite(n) && n > mx ? n : mx
        }, 0)
      },
    }
  }

  const segment = REFID_SEGMENT[m.entityType]
  if (!segment) return undefined

  const nopad = m.entityType === 'ratingProgram'

  // ── Products ──
  if (m.entityType === 'product') {
    const prefix = resolveLob({ lob: m.data?.['lob'] as { refId?: string | null } | undefined }).prefix
    const key = productCounterKey(prefix)
    return {
      counterKey: key,
      buildRefId: (seq) => buildRefId(prefix, segment, seq, nopad),
      seedFrom: async () => {
        const snap = await getDocs(collection(db, 'products'))
        const existing = snap.docs.map(d => (d.data() as { refId?: string | null }).refId)
        return maxSeqIn(existing, prefix, segment)
      },
    }
  }

  // ── Sub-entities (coverage, rule, formRule, ratingProgram) ──
  const prefix = await subEntityLob(m)
  const parts = m.path.split('/').filter(Boolean)
  const collPath = parts.slice(0, -1).join('/')
  const pid = m.productId ?? parts[1] ?? 'unknown'
  const key = subEntityCounterKey(prefix, segment, pid)
  // Authored rules/formRules start at 011 — 001–010 are reserved for seeded entries.
  const floor = m.entityType === 'rule' || m.entityType === 'formRule' ? 10 : 0
  return {
    counterKey: key,
    buildRefId: (seq) => buildRefId(prefix, segment, seq, nopad),
    seedFrom: async () => {
      const snap = await getDocs(collection(db, collPath))
      const existing = snap.docs.map(d => (d.data() as { refId?: string | null }).refId)
      return maxSeqIn(existing, prefix, segment, floor)
    },
  }
}

/** Ensure the counter key exists in meta/refCounters; seeds from a legacy scan on first use.
 *  The final write is guarded by a short transaction so a concurrent seeder can never
 *  overwrite a counter that another transaction already incremented. */
async function ensureCounterSeeded(alloc: CounterAlloc): Promise<void> {
  const metaRef = doc(db, COUNTER_DOC)
  const snap = await getDoc(metaRef)
  if (((snap.data() ?? {}) as Record<string, number>)[alloc.counterKey] !== undefined) return
  const seedValue = await alloc.seedFrom()
  console.info(`[refCounters] seeding "${alloc.counterKey}" at ${seedValue} (legacy scan)`)
  await runTransaction(db, async (tx) => {
    const current = ((await tx.get(metaRef)).data() ?? {}) as Record<string, number>
    if (current[alloc.counterKey] !== undefined) return   // raced — skip overwrite
    tx.set(metaRef, { [alloc.counterKey]: seedValue }, { merge: true })
  })
}

// ─── Atomic write envelope (shared by mutate + mutateBatch) ───────────────────
// Maps the pure envelope descriptors (see ./envelope) onto one Firestore transaction:
// entity (+rev) · auditEvent · version(diff) · searchIndex. Audit/version refs are minted
// inside the transaction — only the committed attempt's writes persist, so a retry never
// duplicates them. The caller performs the rev re-check + coverage guard before this runs.
function applyEnvelope(
  tx: Transaction, m: MutationPayload,
  data: Record<string, unknown> | undefined, prevData: Record<string, unknown>, now: unknown,
): void {
  const entityRef = doc(db, m.path)
  const searchRef = doc(db, `searchIndex/${m.path.replace(/\//g, '_')}`)
  for (const w of buildMutationWrites(m, data, prevData, { now })) {
    switch (w.target) {
      case 'entity':
        if (w.op === 'delete') tx.delete(entityRef)
        else if (w.op === 'update') tx.update(entityRef, w.data!)
        else tx.set(entityRef, w.data!)
        break
      case 'audit':   tx.set(doc(collection(db, 'auditEvents')), w.data!); break
      case 'version': tx.set(doc(collection(db, 'versions')), w.data!); break
      case 'searchIndex':
        if (w.op === 'delete') tx.delete(searchRef)
        else tx.set(searchRef, w.data!)
        break
    }
  }
}

/** Guard a coverage-term write against the structural invariants, inside the transaction
 *  (against the merged stored+incoming doc) so a corrupt option matrix can never persist. */
function assertCoverageWrite(m: MutationPayload, data: Record<string, unknown> | undefined, prevData: Record<string, unknown>): void {
  if (m.entityType === 'coverage' && m.op !== 'delete' && data && 'terms' in data) {
    assertCoverageTermsValid({ ...prevData, ...data } as {
      allStates?: boolean; states?: string[]; terms?: CoverageTerm[]
    })
  }
}

// Bare-username sign-in maps "name" → "name@USERNAME_DOMAIN" (the synthetic address the
// seeded accounts are provisioned under), so users can log in with just "sal" / "rebecca".
const USERNAME_DOMAIN = 'productreinvention.app'

// VITE_ALLOW_GUEST (public flag, default true): when 'false', the adapter does NOT auto-
// connect an anonymous read-only session, so the app requires a real credentialed sign-in
// (the Landing page offers sign-in only). The default preserves today's anonymous-browse
// behavior. See docs/adr/0004-guest-read-floor.md.
const ALLOW_GUEST = import.meta.env.VITE_ALLOW_GUEST !== 'false'
// One-shot guard so we don't loop endlessly if anonymous sign-in fails or is disabled.
let triedAnonSignIn = false

// ─── Dev-only admin bypass — the ENTIRE feature lives behind ONE static guard ─────────────
// A fake ADMIN session held entirely client-side, for working against the emulators without
// provisioning an account. There is no real ID token, so Firestore rules reject every read/
// write (the workspace loads empty); the flag persists in sessionStorage so a reload keeps it.
// `import.meta.env.DEV` is replaced with a literal `false` in a production build, so esbuild
// dead-code-eliminates this whole block — and the conditionally-spread `signInAsDevAdmin`
// method below — so neither the method name nor the sessionStorage key survives into app/dist
// (verified by grepping dist). In production `devBypass` is `null` and the method is absent, so
// an accidental call throws (TypeError) rather than granting any bypass.
const devBypass = import.meta.env.DEV
  ? (() => {
      const KEY = 'pf.devAdminBypass'
      const admin: AuthUser = { uid: 'dev-admin', email: 'dev-admin@local', name: 'Dev Admin (bypass)', role: 'ADMIN' }
      const listeners = new Set<(u: AuthUser | null) => void>()
      let active = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KEY) === '1'
      return {
        admin,
        listeners,
        get active() { return active },
        engage() {
          active = true
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KEY, '1')
          for (const cb of listeners) cb(admin)
        },
        clear() {
          active = false
          if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(KEY)
          for (const cb of listeners) cb(null)
        },
      }
    })()
  : null

export const adapter: BackendAdapter = {
  auth: {
    async signIn(email, password): Promise<Session> {
      // Accept a bare username (e.g. "sal") as well as a full email — a username maps to
      // <username>@USERNAME_DOMAIN, the synthetic address the account is provisioned under.
      const id = email.trim()
      const addr = id.includes('@') ? id : `${id.toLowerCase()}@${USERNAME_DOMAIN}`
      const cred = await signInWithEmailAndPassword(auth, addr, password)
      const user = await toAuthUser(cred.user)
      const token = await cred.user.getIdToken()
      return { user, token }
    },

    async signOut(): Promise<void> {
      // Clear the dev bypass first so onUser listeners fall back to the real Firebase state.
      if (devBypass?.active) { devBypass.clear(); return }
      await fbSignOut(auth)
    },

	    onUser(cb) {
	      devBypass?.listeners.add(cb)
	      const unsubFb = onAuthStateChanged(auth, async (fbUser) => {
	        if (devBypass?.active) return   // dev bypass owns the session; ignore Firebase state
	        if (!fbUser) {
	          // Auto-connect anonymous users so live endpoints that require a token (AI, reads)
	          // work without a manual sign-in. This respects security rules: anonymous users
	          // still have no role claim, so they cannot write where EDITOR/ADMIN is required.
	          // Gated by VITE_ALLOW_GUEST (default true): false skips the guest floor entirely.
          if (ALLOW_GUEST && !triedAnonSignIn) {
	            triedAnonSignIn = true
	            try {
	              await signInAnonymously(auth)
	              return
	            } catch (err) {
	              console.warn('[auth] Anonymous sign-in failed; falling back to signed-out state.', err)
	            }
	          }
	          cb(null)
	          return
	        }
	        // Guard: getIdTokenResult() can time out when the Firebase backend is
	        // unreachable (e.g. network flakiness, cold start). An unhandled rejection
	        // here crashes React 19's effect error handler and breaks context provision,
	        // causing the "useUser must be inside UserProvider" loop. Fall back to null
	        // (signed-out) so the app redirects cleanly instead of crashing.
	        try {
	          cb(await toAuthUser(fbUser))
	        } catch (err) {
	          console.warn('[auth] Failed to resolve user token; signing out:', err)
	          cb(null)
	        }
	      })
	      if (devBypass?.active) cb(devBypass.admin)   // emit the fake session immediately on subscribe
	      return () => { devBypass?.listeners.delete(cb); unsubFb() }
	    },

    // Dev-only admin bypass — spread in ONLY for dev builds. `import.meta.env.DEV` is a static
    // `false` in production, so esbuild drops this property entirely: the name `signInAsDevAdmin`
    // never reaches app/dist and a production caller invoking it throws (the method is absent).
    ...(import.meta.env.DEV
      ? { signInAsDevAdmin() { devBypass?.engage() } }
      : {}),

    async changePassword(next) {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      await updatePassword(user, next)
    },
  },

  db: {
    async get<T>(path: string): Promise<T | null> {
      if (devBypass?.active) return null   // dev bypass: no backend
      const snap = await getDoc(doc(db, path))
      return snapToData<T>(snap)
    },

    async list<T>(path: string, q?: Query): Promise<T[]> {
      if (devBypass?.active) return []     // dev bypass: no backend
      const collRef = collection(db, path)
      const snap = await getDocs(q ? buildQuery(collRef, q) : collRef)
      return snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]
    },

    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void, onError?: (err: unknown) => void) {
      if (typeof pathOrQuery !== 'string') {
        throw new Error('subscribe() with a Query object requires a string path')
      }
      const parts = pathOrQuery.split('/').filter(Boolean)
      // Dev bypass: resolve consumers with empty data and make NO Firestore call, so
      // the app doesn't flood the console trying to reach a backend that isn't there.
      if (devBypass?.active) {
        queueMicrotask(() => cb((parts.length % 2 === 0 ? null : []) as T | T[]))
        return () => {}
      }
      // On a listener error (e.g. permission-denied) log + degrade to an empty result rather
      // than hanging every consumer, AND forward to the optional onError so a surface can show
      // a recoverable error state instead of a silent empty.
      const onErr = (err: unknown) => {
        console.warn(`[subscribe] ${pathOrQuery} listener error:`, (err as { code?: string })?.code ?? err)
        onError?.(err)
      }
      if (parts.length % 2 === 0) {
        // Document — on error (e.g. permission-denied), degrade to null so consumers
        // resolve their loading state instead of hanging (mirrors the collection path).
        return onSnapshot(doc(db, pathOrQuery),
          (snap) => { cb(snapToData<T>(snap) as T) },
          (err) => { onErr(err); cb(null as T) })
      }
      // Collection
      return onSnapshot(collection(db, pathOrQuery),
        (snap) => { cb(snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]) },
        (err) => { onErr(err); cb([] as T[]) })
    },

    async mutate(m: MutationPayload): Promise<void> {
      // Dev bypass: no backend to write to. Fail clearly so callers show a friendly toast.
      if (devBypass?.active) throw new Error('Dev admin bypass — changes are not saved (no backend).')
      // ONE atomic transaction: entity + auditEvent + version (with field diffs) + searchIndex
      // + rev bump. A transaction — not a bare writeBatch — is required for correct optimistic
      // concurrency: the rev is read and re-checked INSIDE the transaction, and Firestore aborts
      // + retries (or fails) if the entity changes before commit. So a concurrent writer can never
      // slip between the rev check and the commit and be silently overwritten — the loser gets a
      // MutationConflictError → a friendly "please refresh" toast. (A writeBatch only makes the
      // writes atomic; it does NOT revalidate a value read beforehand, which is the whole point.)
      // AWS-SWAP: becomes a DynamoDB TransactWriteItems with a rev ConditionExpression.
      //
      // O(1) refId: prepareCounterAlloc resolves the counter key (and the LOB if needed).
      // ensureCounterSeeded seeds meta/refCounters once from a legacy scan if the key is absent.
      // The actual counter increment — and refId minting — happens INSIDE runTransaction so two
      // simultaneous creates in the same segment always get distinct sequence numbers.
      const alloc = await prepareCounterAlloc(m)
      if (alloc) await ensureCounterSeeded(alloc)

      // C: reject orphan sub-coverages — a non-null parentId must resolve to a real coverage
      // refId in the same product. Pre-read outside the transaction (client transactions can't
      // query); same pattern as the counter seed. Throws before runTransaction on mismatch.
      if (m.entityType === 'coverage' && m.op !== 'delete') {
        const parentId = (m.data ?? {})['parentId'] as string | null | undefined
        if (parentId) {
          if (!m.productId) throw new Error('Coverage write with parentId requires productId')
          const covSnap = await getDocs(collection(db, `products/${m.productId}/coverages`))
          const existingRefs = covSnap.docs
            .map(d => (d.data() as { refId?: string }).refId)
            .filter((r): r is string => Boolean(r))
          validateCoverageParent(parentId, existingRefs)
        }
      }

      const entityRef = doc(db, m.path)
      const metaRef   = doc(db, COUNTER_DOC)
      await runTransaction(db, async (tx) => {
        // READ phase — Firestore requires all reads before any write.
        const current  = m.op !== 'create' ? await tx.get(entityRef) : null
        const metaSnap = alloc ? await tx.get(metaRef) : null
        const prevData = (current?.data() ?? {}) as Record<string, unknown>
        const counters = ((metaSnap?.data() ?? {}) as Record<string, number>)

        // COMPUTE — mint the refId from the current counter value + 1.
        let mintedRefId: string | undefined
        let newSeq: number | undefined
        if (alloc) {
          newSeq = (counters[alloc.counterKey] ?? 0) + 1
          mintedRefId = alloc.buildRefId(newSeq)
        }
        const data: Record<string, unknown> | undefined = mintedRefId
          ? { ...(m.data ?? {}), refId: mintedRefId }
          : m.data

        // WRITE phase.
        if (m.expectedRev !== undefined && current && prevData['rev'] !== m.expectedRev) {
          throw new MutationConflictError()
        }
        assertCoverageWrite(m, data, prevData)     // aborts the whole transaction on a bad matrix
        if (alloc && newSeq !== undefined) {
          tx.set(metaRef, { [alloc.counterKey]: newSeq }, { merge: true })
        }
        applyEnvelope(tx, m, data, prevData, serverTimestamp())   // entity + audit + version + searchIndex
      })
    },

    async mutateBatch(ms: MutationPayload[]): Promise<void> {
      if (devBypass?.active) throw new Error('Dev admin bypass — changes are not saved (no backend).')
      if (ms.length === 0) return

      // Resolve counter allocation info for every create that needs a refId.
      // Explicit refIds and non-creates return undefined (no counter needed).
      const withAllocs = await Promise.all(ms.map(async (m) => ({
        m,
        alloc: await prepareCounterAlloc(m),
      })))

      // Seed any missing counter keys (deduped — multiple creates for the same key are fine).
      const uniqueAllocs = new Map<string, CounterAlloc>()
      for (const { alloc } of withAllocs) {
        if (alloc && !uniqueAllocs.has(alloc.counterKey)) uniqueAllocs.set(alloc.counterKey, alloc)
      }
      await Promise.all([...uniqueAllocs.values()].map(ensureCounterSeeded))

      // Chunk by write budget: each entity performs up to 4 writes (entity + audit + version
      // + searchIndex) plus one shared counter doc write per chunk. Firestore caps a
      // transaction at 500 writes; stay well under for large re-seeds.
      const MAX_PER_CHUNK = Math.floor(449 / 4)   // ≈112 entities per transaction (1 spare for counter)
      const metaRef = doc(db, COUNTER_DOC)
      for (let i = 0; i < withAllocs.length; i += MAX_PER_CHUNK) {
        const chunk = withAllocs.slice(i, i + MAX_PER_CHUNK)
        await runTransaction(db, async (tx) => {
          // READ phase — Firestore requires all reads before any write.
          const chunkHasAlloc = chunk.some(x => x.alloc)
          const metaSnap = chunkHasAlloc ? await tx.get(metaRef) : null
          const counters  = ((metaSnap?.data() ?? {}) as Record<string, number>)
          const running   = { ...counters }   // in-memory values; updated per allocation

          const prev = new Map<string, Record<string, unknown>>()
          for (const { m } of chunk) {
            if (m.op !== 'create') {
              const snap = await tx.get(doc(db, m.path))
              prev.set(m.path, (snap.data() ?? {}) as Record<string, unknown>)
            }
          }

          // COMPUTE — mint refIds for all creates in this chunk using the shared running counters.
          const resolved = chunk.map(({ m, alloc }) => {
            let mintedRefId: string | undefined
            if (alloc) {
              const seq = (running[alloc.counterKey] ?? 0) + 1
              running[alloc.counterKey] = seq
              mintedRefId = alloc.buildRefId(seq)
            }
            return { m, data: mintedRefId ? { ...(m.data ?? {}), refId: mintedRefId } : m.data }
          })

          // WRITE phase — one full envelope per payload, all under a single serverTimestamp.
          const now = serverTimestamp()

          // Write updated counter values in a single merge set (one Firestore write).
          const updates: Record<string, number> = {}
          for (const key of Object.keys(running)) {
            if (running[key] !== (counters[key] ?? 0)) updates[key] = running[key]!
          }
          if (Object.keys(updates).length > 0) tx.set(metaRef, updates, { merge: true })

          for (const { m, data } of resolved) {
            const prevData = prev.get(m.path) ?? {}
            if (m.expectedRev !== undefined && m.op !== 'create' && prevData['rev'] !== m.expectedRev) {
              throw new MutationConflictError()
            }
            assertCoverageWrite(m, data, prevData)
            applyEnvelope(tx, m, data, prevData, now)
          }
        })
      }
    },

    async vote(path: string, uid: string): Promise<void> {
      if (devBypass?.active) throw new Error('Dev admin bypass — voting is not saved (no backend).')
      // Narrow, un-audited write matching the VIEWER vote-only rule: only `votes`
      // changes (arrayUnion the uid, +1 count). AWS-SWAP: DynamoDB UpdateItem ADD.
      await updateDoc(doc(db, path), {
        'votes.voters': arrayUnion(uid),
        'votes.count':  increment(1),
      })
    },

    async setNewsPins(uid: string, pinnedHashes: string[]): Promise<void> {
      if (devBypass?.active) throw new Error('Dev admin bypass — pins are not saved (no backend).')
      // Owner-scoped merge write to newsPrefs/{uid} (matches the owner-only rule). Merges
      // so the `instruction` the editor writes to the same doc is preserved; no audit/
      // version envelope — pins are personal UI state, not governed content.
      // AWS-SWAP: DynamoDB UpdateItem SET pinnedHashes.
      await setDoc(
        doc(db, `newsPrefs/${uid}`),
        { pinnedHashes, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },

    async tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T> {
      // runTransaction gives Firestore-level atomicity; the helpers.get respects the transaction.
      return runTransaction(db, (fsTx) => {
        const txGet = async <U>(path: string): Promise<U | null> => {
          const snap = await fsTx.get(doc(db, path))
          return snapToData<U>(snap)
        }
        return fn({ get: txGet })
      })
    },
  },

  storage: {
    async upload(path, file) {
      // Dev bypass: no real auth token, so Storage rules reject the write — fail with a
      // clear message rather than a raw 403 (mirrors db.mutate's guard).
      if (devBypass?.active) throw new Error('Dev admin bypass — uploads are not saved (no backend). Sign in with a real account.')
      const snap = await uploadBytes(ref(storage, path), file)
      return getDownloadURL(snap.ref)
    },
    async getUrl(path) {
      if (devBypass?.active) throw new Error('Dev admin bypass — no backend.')
      return getDownloadURL(ref(storage, path))
    },
  },

  fns: {
    async call<TIn, TOut>(name: string, data: TIn): Promise<TOut> {
      const result = await httpsCallable<TIn, TOut>(functions, name)(data)
      return result.data
    },

    async stream(name, data, onChunk, signal) {
      // SSE over HTTPS — identical streaming pattern on Lambda.
      // AWS-SWAP: swap the base URL; the SSE parsing below is platform-agnostic.
      const base = import.meta.env.VITE_USE_EMULATORS === 'true'
        ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/${FUNCTIONS_REGION}`
        : `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net`

      const user = auth.currentUser
      const token = user ? await user.getIdToken() : null

      const res = await fetch(`${base}/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
        signal,   // caller-owned cancellation (unmount / conversation switch)
      })
      if (!res.ok || !res.body) throw new Error(`Stream ${name} failed: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) onChunk(line.slice(6))
          }
        }
      } finally {
        // Release the stream on any exit (done, throw, or abort) so the connection
        // is not held open; cancel() is a no-op once the reader is already closed.
        reader.cancel().catch(() => {})
      }
    },
  },

  presence: {
    join(pid) {
      const user = auth.currentUser
      if (!user) return () => {}
      const presRef = doc(db, `presence/${pid}/viewers/${user.uid}`)
      const heartbeat = () => void setDoc(presRef, { uid: user.uid, at: serverTimestamp() }, { merge: true })
      heartbeat()
      const timer = setInterval(heartbeat, 30_000)
      return () => {
        clearInterval(timer)
        void deleteDoc(presRef)
      }
    },

    watch(pid, cb) {
      if (devBypass?.active) { queueMicrotask(() => cb([])); return () => {} }
      return onSnapshot(collection(db, `presence/${pid}/viewers`), (snap) => {
        cb(snap.docs.map((d) => d.id))
      })
    },
  },
}

export { MutationConflictError }
