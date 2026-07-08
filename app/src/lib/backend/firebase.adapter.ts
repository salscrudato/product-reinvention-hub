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
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'
import { firebaseConfig, FUNCTIONS_REGION } from './firebase.config'
import type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
import { MutationConflictError } from './types'
import { assertCoverageTermsValid, resolveLob } from '@pf/shared'
import type { CoverageTerm } from '@pf/shared'

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

// Entity types that belong in the ⌘K search index. Others (feedback, comment,
// newsPrefs…) skip the searchIndex write — which also keeps VIEWER feedback
// submissions within their allowed rule surface (searchIndex is EDITOR+ write).
const INDEXABLE = new Set(['product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task'])

// ─── Server-authoritative refId allocation ────────────────────────────────────
// refIds (PH.PROD.001, PH.COV.004, PH.RU.011, …) used to be minted ad-hoc across half a
// dozen components, and several create paths left them null. Allocation is now centralized
// HERE at the single write seam: on a create that omits a refId, the adapter mints one from
// the entity's LOB prefix + the next free sequence, so refId-bearing entities are never null
// and the scheme lives in one place. An EXPLICIT refId (import, clone, hand-authored, seed)
// always wins — this only fills the gaps. The sibling scan runs as a pre-read before the
// transaction (Firestore client transactions cannot query), so it is race-tolerant.
const REFID_SEGMENT: Record<string, string> = {
  product: 'PROD', coverage: 'COV', rule: 'RU', formRule: 'FORM.RU', ratingProgram: 'RAT',
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Next sequence for refIds sharing `<prefix>.<segment>.` — max existing suffix + 1 (or floor). */
function nextRefIdSeq(existing: (string | null | undefined)[], prefix: string, segment: string, floor = 0): number {
  const re = new RegExp(`^${escapeRe(prefix)}\\.${escapeRe(segment)}\\.(\\d+)`, 'i')
  const max = existing.reduce((m, r) => {
    const n = Number(re.exec(r ?? '')?.[1] ?? 0)
    return Number.isFinite(n) && n > m ? n : m
  }, floor)
  return max + 1
}

async function refIdsIn(collectionPath: string): Promise<(string | null | undefined)[]> {
  const snap = await getDocs(collection(db, collectionPath))
  return snap.docs.map(d => (d.data() as { refId?: string | null }).refId)
}

/** Mint a refId for a create that lacks one; undefined when not applicable (explicit refId,
 *  non-create, or a type that carries no refId). */
async function allocateRefId(m: MutationPayload): Promise<string | undefined> {
  if (m.op !== 'create') return undefined
  const segment = REFID_SEGMENT[m.entityType]
  if (!segment) return undefined
  const current = m.data?.['refId'] as string | null | undefined
  if (current && String(current).trim()) return undefined   // explicit refId wins

  const pad = (n: number) => m.entityType === 'ratingProgram' ? String(n) : String(n).padStart(3, '0')

  if (m.entityType === 'product') {
    const prefix = resolveLob({ lob: m.data?.['lob'] as { refId?: string | null } | undefined }).prefix
    const seq = nextRefIdSeq(await refIdsIn('products'), prefix, segment)
    return `${prefix}.${segment}.${pad(seq)}`
  }

  // Sub-entities: siblings live in the collection that contains m.path (drop the doc id).
  const parts = m.path.split('/').filter(Boolean)
  const collectionPath = parts.slice(0, -1).join('/')
  const siblings = await refIdsIn(collectionPath)
  // Resolve the LOB prefix from an existing sibling, else the parent product's LOB.
  let prefix = siblings.find(r => typeof r === 'string' && r.includes('.'))?.split('.')[0]
  if (!prefix && m.productId) {
    const psnap = await getDoc(doc(db, `products/${m.productId}`))
    prefix = resolveLob(psnap.data() as { lob?: { refId?: string | null } } | undefined).prefix
  }
  if (!prefix) prefix = resolveLob(null).prefix   // default line
  // Authored rules historically start at 011 (001–010 reserved for seeded rules).
  const floor = m.entityType === 'rule' || m.entityType === 'formRule' ? 10 : 0
  return `${prefix}.${segment}.${pad(nextRefIdSeq(siblings, prefix, segment, floor))}`
}

// ─── TEMPORARY dev-only admin bypass (no Firebase auth) ───────────────────────
// A fake ADMIN session held entirely client-side. Dev builds only; because there is
// no real ID token, Firestore rules reject every read/write (the workspace loads
// empty). Persisted in sessionStorage so a reload keeps it.
// Bare-username sign-in maps "name" → "name@USERNAME_DOMAIN" (the address the seeded
// accounts are provisioned under), so users can log in with just "sal" / "rebecca".
const USERNAME_DOMAIN = 'productreinvention.app'
const DEV_BYPASS_KEY = 'pf.devAdminBypass'
const DEV_ADMIN: AuthUser = { uid: 'dev-admin', email: 'dev-admin@local', name: 'Dev Admin (bypass)', role: 'ADMIN' }
// Seeded demo-admin account (HO3_SEED_USERS: sal@productreinvention.app / scrudato).
// Used by signInAsAdmin() for a real sign-in that carries a genuine token + ADMIN claim.
const DEMO_ADMIN_EMAIL    = 'sal@productreinvention.app'
const DEMO_ADMIN_PASSWORD = 'scrudato'
let bypassActive = import.meta.env.DEV && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DEV_BYPASS_KEY) === '1'
const bypassListeners = new Set<(u: AuthUser | null) => void>()
// One-shot guard so we don't loop endlessly if anonymous sign-in fails or is disabled.
let triedAnonSignIn = false

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
      if (bypassActive) {
        bypassActive = false
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(DEV_BYPASS_KEY)
        for (const cb of bypassListeners) cb(null)
        return
      }
      await fbSignOut(auth)
    },

	    onUser(cb) {
	      bypassListeners.add(cb)
	      const unsubFb = onAuthStateChanged(auth, async (fbUser) => {
	        if (bypassActive) return   // dev bypass owns the session; ignore Firebase state
	        if (!fbUser) {
	          // Auto-connect anonymous users so live endpoints that require a token (AI, reads)
	          // work without a manual sign-in. This respects security rules: anonymous users
	          // still have no role claim, so they cannot write where EDITOR/ADMIN is required.
	          if (!triedAnonSignIn) {
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
	      if (bypassActive) cb(DEV_ADMIN)   // emit the fake session immediately on subscribe
	      return () => { bypassListeners.delete(cb); unsubFb() }
	    },

    // No-credentials admin: a REAL sign-in as the seeded demo admin. Unlike the dev
    // bypass below, this returns a genuine session (token + ADMIN claim), so data loads
    // and writes persist. Clears any active dev bypass first so the real session owns onUser.
    async signInAsAdmin(): Promise<Session> {
      if (bypassActive) {
        bypassActive = false
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(DEV_BYPASS_KEY)
      }
      const cred  = await signInWithEmailAndPassword(auth, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD)
      const user  = await toAuthUser(cred.user)
      const token = await cred.user.getIdToken()
      return { user, token }
    },

    // REMOVE-BEFORE-PROD: dev-only admin bypass. No-op outside dev builds (import.meta.env.DEV guard).
    signInAsDevAdmin() {
      if (!import.meta.env.DEV) return
      bypassActive = true
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(DEV_BYPASS_KEY, '1')
      for (const cb of bypassListeners) cb(DEV_ADMIN)
    },

    async changePassword(next) {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      await updatePassword(user, next)
    },
  },

  db: {
    async get<T>(path: string): Promise<T | null> {
      if (bypassActive) return null   // dev bypass: no backend
      const snap = await getDoc(doc(db, path))
      return snapToData<T>(snap)
    },

    async list<T>(path: string, q?: Query): Promise<T[]> {
      if (bypassActive) return []     // dev bypass: no backend
      const collRef = collection(db, path)
      const snap = await getDocs(q ? buildQuery(collRef, q) : collRef)
      return snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]
    },

    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void) {
      if (typeof pathOrQuery !== 'string') {
        throw new Error('subscribe() with a Query object requires a string path')
      }
      const parts = pathOrQuery.split('/').filter(Boolean)
      // Dev bypass: resolve consumers with empty data and make NO Firestore call, so
      // the app doesn't flood the console trying to reach a backend that isn't there.
      if (bypassActive) {
        queueMicrotask(() => cb((parts.length % 2 === 0 ? null : []) as T | T[]))
        return () => {}
      }
      // On a listener error (e.g. permission-denied) surface it and degrade to an
      // empty result rather than hanging every consumer waiting on the callback.
      const onErr = (err: unknown) => {
        console.warn(`[subscribe] ${pathOrQuery} listener error:`, (err as { code?: string })?.code ?? err)
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
      if (bypassActive) throw new Error('Dev admin bypass — changes are not saved (no backend).')
      // ONE atomic transaction: entity + auditEvent + version (with field diffs) + searchIndex
      // + rev bump. A transaction — not a bare writeBatch — is required for correct optimistic
      // concurrency: the rev is read and re-checked INSIDE the transaction, and Firestore aborts
      // + retries (or fails) if the entity changes before commit. So a concurrent writer can never
      // slip between the rev check and the commit and be silently overwritten — the loser gets a
      // MutationConflictError → a friendly "please refresh" toast. (A writeBatch only makes the
      // writes atomic; it does NOT revalidate a value read beforehand, which is the whole point.)
      // The batched executor is pure and idempotent, so a transaction retry is safe.
      // AWS-SWAP: becomes a DynamoDB TransactWriteItems with a rev ConditionExpression.
      const entityRef  = doc(db, m.path)
      const auditRef   = doc(collection(db, 'auditEvents'))   // stable ids across retries
      const versionRef = doc(collection(db, 'versions'))
      const searchRef  = doc(db, `searchIndex/${m.path.replace(/\//g, '_')}`)
      const indexable  = INDEXABLE.has(m.entityType)

      // Server-authoritative refId: fill an omitted one for refId-bearing creates so nothing
      // persists null (see allocateRefId). Explicit refIds pass through untouched. The scan
      // is a pre-read (client transactions can't query); the write itself stays transactional.
      const mintedRefId = await allocateRefId(m)
      const data: Record<string, unknown> | undefined = mintedRefId
        ? { ...(m.data ?? {}), refId: mintedRefId }
        : m.data

      await runTransaction(db, async (tx) => {
        const now = serverTimestamp()

        // Read current INSIDE the transaction — for the rev check + the field diff. Because the
        // read is transactional, the rev we validate is the rev we commit against.
        const current  = m.op !== 'create' ? await tx.get(entityRef) : null
        const prevData = (current?.data() ?? {}) as Record<string, unknown>

        if (m.expectedRev !== undefined && current) {
          if (prevData['rev'] !== m.expectedRev) throw new MutationConflictError()
        }

        // Compute field-level diff for the version snapshot.
        const nextData  = (data ?? {}) as Record<string, unknown>
        const allFields = new Set([...Object.keys(prevData), ...Object.keys(nextData)])
        const diff: Array<{ field: string; before: unknown; after: unknown }> = []
        for (const field of allFields) {
          if (JSON.stringify(prevData[field]) !== JSON.stringify(nextData[field])) {
            diff.push({ field, before: prevData[field] ?? null, after: nextData[field] ?? null })
          }
        }

        // Domain guard at the seam: a coverage term write must satisfy the structural
        // typed-model invariants (exactly one enabled default; each option's states ⊆
        // the coverage scope). Validated against the merged (stored + incoming) document
        // so no path — present or future — can persist a corrupt option matrix. Throwing
        // here aborts the whole transaction. Only runs when the payload carries `terms`.
        if (m.entityType === 'coverage' && m.op !== 'delete' && data && 'terms' in data) {
          const merged = { ...prevData, ...data } as {
            allStates?: boolean; states?: string[]; terms?: CoverageTerm[]
          }
          assertCoverageTermsValid(merged)
        }

        // Entity write + rev bump.
        if (m.op === 'delete') {
          tx.delete(entityRef)
        } else if (m.op === 'create') {
          tx.set(entityRef, { ...data, createdAt: now, updatedAt: now, updatedBy: m.actor.uid, rev: 1 })
        } else {
          const newRev = ((prevData['rev'] as number) ?? 0) + 1
          tx.update(entityRef, { ...data, updatedAt: now, updatedBy: m.actor.uid, rev: newRev })
        }

        // Audit event (append-only).
        tx.set(auditRef, {
          actor: m.actor, action: m.op, entityType: m.entityType,
          entityPath: m.path, productId: m.productId ?? null, at: now,
        })

        // Version snapshot with field-level diff.
        tx.set(versionRef, {
          entityType: m.entityType, entityPath: m.path,
          productId: m.productId ?? null,
          snapshot: m.op !== 'delete' ? (data ?? null) : null,
          diff, actor: m.actor, at: now,
        })

        // SearchIndex upsert/delete: keep the ⌘K palette in sync in the SAME atomic unit.
        // AWS-SWAP: becomes a DynamoDB put/delete on the searchIndex table.
        if (m.op !== 'delete' && data && indexable) {
          const d = data
          const title    = (d['name'] as string | undefined) ?? (d['title'] as string | undefined) ?? ''
          const subtitle = (d['refId'] as string | undefined) ?? m.entityType
          const keywords = [title, subtitle, d['refId'] as string, d['description'] as string]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .split(/\W+/)
            .filter(k => k.length > 2)
          tx.set(searchRef, {
            type:     m.entityType,
            refId:    (d['refId'] as string | null) ?? null,
            title,
            subtitle,
            path:     m.path,
            keywords: [...new Set(keywords)],
          })
        } else if (m.op === 'delete' && indexable) {
          tx.delete(searchRef)
        }
      })
    },

    async vote(path: string, uid: string): Promise<void> {
      if (bypassActive) throw new Error('Dev admin bypass — voting is not saved (no backend).')
      // Narrow, un-audited write matching the VIEWER vote-only rule: only `votes`
      // changes (arrayUnion the uid, +1 count). AWS-SWAP: DynamoDB UpdateItem ADD.
      await updateDoc(doc(db, path), {
        'votes.voters': arrayUnion(uid),
        'votes.count':  increment(1),
      })
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
      if (bypassActive) throw new Error('Dev admin bypass — uploads are not saved (no backend). Sign in with a real account.')
      const snap = await uploadBytes(ref(storage, path), file)
      return getDownloadURL(snap.ref)
    },
    async getUrl(path) {
      if (bypassActive) throw new Error('Dev admin bypass — no backend.')
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
      if (bypassActive) { queueMicrotask(() => cb([])); return () => {} }
      return onSnapshot(collection(db, `presence/${pid}/viewers`), (snap) => {
        cb(snap.docs.map((d) => d.id))
      })
    },
  },
}

export { MutationConflictError }
