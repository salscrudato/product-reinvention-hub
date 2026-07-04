// Firebase implementation of BackendAdapter.
// Connects to the Emulator Suite when VITE_USE_EMULATORS=true.
// AWS-SWAP: replace with aws.adapter.ts — see aws.adapter.placeholder.ts for the mapping.
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut as fbSignOut,
  onAuthStateChanged, updatePassword, connectAuthEmulator,
} from 'firebase/auth'
import {
  getFirestore, doc, collection, getDoc, getDocs, onSnapshot,
  writeBatch, serverTimestamp, setDoc, deleteDoc, updateDoc,
  arrayUnion, increment,
  query as fbQuery, where, orderBy, limit as fbLimit,
  runTransaction, connectFirestoreEmulator,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'
import { firebaseConfig, FUNCTIONS_REGION } from './firebase.config'
import type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
import { MutationConflictError } from './types'

// Singleton — safe under React StrictMode and Vite HMR.
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
const auth        = getAuth(firebaseApp)
const db          = getFirestore(firebaseApp)
const storage     = getStorage(firebaseApp)
const functions   = getFunctions(firebaseApp, FUNCTIONS_REGION)

// Wire emulators in development; module-level guard prevents duplicate connects on HMR.
// AWS-SWAP: no emulator step needed; point to real AWS endpoints per environment config.
let _emulatorsWired = false
if (import.meta.env.VITE_USE_EMULATORS === 'true' && !_emulatorsWired) {
  _emulatorsWired = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
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

export const adapter: BackendAdapter = {
  auth: {
    async signIn(email, password): Promise<Session> {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const user = await toAuthUser(cred.user)
      const token = await cred.user.getIdToken()
      return { user, token }
    },

    async signOut(): Promise<void> {
      await fbSignOut(auth)
    },

    onUser(cb) {
      return onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) { cb(null); return }
        cb(await toAuthUser(fbUser))
      })
    },

    async changePassword(next) {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      await updatePassword(user, next)
    },
  },

  db: {
    async get<T>(path: string): Promise<T | null> {
      const snap = await getDoc(doc(db, path))
      return snapToData<T>(snap)
    },

    async list<T>(path: string, q?: Query): Promise<T[]> {
      const collRef = collection(db, path)
      const snap = await getDocs(q ? buildQuery(collRef, q) : collRef)
      return snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]
    },

    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void) {
      if (typeof pathOrQuery !== 'string') {
        throw new Error('subscribe() with a Query object requires a string path')
      }
      const parts = pathOrQuery.split('/').filter(Boolean)
      // On a listener error (e.g. permission-denied) surface it and degrade to an
      // empty result rather than hanging every consumer waiting on the callback.
      const onErr = (err: unknown) => {
        console.warn(`[subscribe] ${pathOrQuery} listener error:`, (err as { code?: string })?.code ?? err)
      }
      if (parts.length % 2 === 0) {
        // Document
        return onSnapshot(doc(db, pathOrQuery), (snap) => { cb(snapToData<T>(snap) as T) }, onErr)
      }
      // Collection
      return onSnapshot(collection(db, pathOrQuery),
        (snap) => { cb(snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]) },
        (err) => { onErr(err); cb([] as T[]) })
    },

    async mutate(m: MutationPayload): Promise<void> {
      // Atomic batch: entity + auditEvent + version (with field diffs) + searchIndex + rev bump.
      // Rev mismatch throws MutationConflictError → caller shows a friendly conflict toast.
      // AWS-SWAP: becomes a DynamoDB TransactWriteItems call in the Lambda adapter.
      const entityRef = doc(db, m.path)
      const now       = serverTimestamp()

      // Read current for rev check + diff computation before the batch.
      const current = m.op !== 'create' ? await getDoc(entityRef) : null

      if (m.expectedRev !== undefined && current) {
        const storedRev = (current.data() as Record<string, unknown>)?.['rev']
        if (storedRev !== m.expectedRev) throw new MutationConflictError()
      }

      // Compute field-level diff for the version snapshot.
      const prevData   = current?.data() ?? {}
      const nextData   = m.data ?? {}
      const allFields  = new Set([...Object.keys(prevData), ...Object.keys(nextData)])
      const diff: Array<{ field: string; before: unknown; after: unknown }> = []
      for (const field of allFields) {
        if (JSON.stringify(prevData[field]) !== JSON.stringify(nextData[field])) {
          diff.push({ field, before: prevData[field] ?? null, after: nextData[field] ?? null })
        }
      }

      const batch = writeBatch(db)

      if (m.op === 'delete') {
        batch.delete(entityRef)
      } else if (m.op === 'create') {
        batch.set(entityRef, { ...m.data, createdAt: now, updatedAt: now, updatedBy: m.actor.uid, rev: 1 })
      } else {
        const newRev = ((prevData['rev'] as number) ?? 0) + 1
        batch.update(entityRef, { ...m.data, updatedAt: now, updatedBy: m.actor.uid, rev: newRev })
      }

      // Audit event (append-only)
      batch.set(doc(collection(db, 'auditEvents')), {
        actor: m.actor, action: m.op, entityType: m.entityType,
        entityPath: m.path, productId: m.productId ?? null, at: now,
      })

      // Version snapshot with field-level diff
      batch.set(doc(collection(db, 'versions')), {
        entityType: m.entityType, entityPath: m.path,
        productId: m.productId ?? null,
        snapshot: m.op !== 'delete' ? (m.data ?? null) : null,
        diff, actor: m.actor, at: now,
      })

      // SearchIndex upsert: derive title/keywords from entity data for ⌘K palette.
      // AWS-SWAP: becomes a DynamoDB put on the searchIndex table.
      if (m.op !== 'delete' && m.data && INDEXABLE.has(m.entityType)) {
        const d = m.data
        const indexId  = m.path.replace(/\//g, '_')
        const title    = (d['name'] as string | undefined) ?? (d['title'] as string | undefined) ?? ''
        const subtitle = (d['refId'] as string | undefined) ?? m.entityType
        const keywords = [title, subtitle, d['refId'] as string, d['description'] as string]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .split(/\W+/)
          .filter(k => k.length > 2)
        batch.set(doc(db, `searchIndex/${indexId}`), {
          type:     m.entityType,
          refId:    (d['refId'] as string | null) ?? null,
          title,
          subtitle,
          path:     m.path,
          keywords: [...new Set(keywords)],
        })
      } else if (m.op === 'delete' && INDEXABLE.has(m.entityType)) {
        const indexId = m.path.replace(/\//g, '_')
        batch.delete(doc(db, `searchIndex/${indexId}`))
      }

      await batch.commit()
    },

    async vote(path: string, uid: string): Promise<void> {
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
      const snap = await uploadBytes(ref(storage, path), file)
      return getDownloadURL(snap.ref)
    },
    async getUrl(path) {
      return getDownloadURL(ref(storage, path))
    },
  },

  fns: {
    async call<TIn, TOut>(name: string, data: TIn): Promise<TOut> {
      const result = await httpsCallable<TIn, TOut>(functions, name)(data)
      return result.data
    },

    async stream(name, data, onChunk) {
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
      })
      if (!res.ok || !res.body) throw new Error(`Stream ${name} failed: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
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
      return onSnapshot(collection(db, `presence/${pid}/viewers`), (snap) => {
        cb(snap.docs.map((d) => d.id))
      })
    },
  },
}

export { MutationConflictError }
