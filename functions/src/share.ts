// share.ts — creates share links (callable) and serves read-only snapshots (onRequest).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { randomBytes } from 'crypto'

// Initialize Admin SDK once per cold start.
if (!getApps().length) initializeApp()

// ─── createShareLink callable ─────────────────────────────────────────────────

interface CreateShareInput  { productId: string }
interface CreateShareOutput { token: string; expiresAt: string }

export const createShareLink = onCall<CreateShareInput>(
  { maxInstances: 10 },
  async (request): Promise<CreateShareOutput> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to create a share link')

    const { productId } = request.data
    if (!productId) throw new HttpsError('invalid-argument', 'productId is required')

    const db        = getFirestore()
    const token     = randomBytes(20).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Verify product exists
    const productDoc = await db.doc(`products/${productId}`).get()
    if (!productDoc.exists) throw new HttpsError('not-found', 'Product not found')

    await db.doc(`shareLinks/${token}`).set({
      productId,
      createdBy: request.auth.uid,
      expiresAt: Timestamp.fromDate(expiresAt),
    })

    return { token, expiresAt: expiresAt.toISOString() }
  },
)

// ─── getShareSnapshot callable ────────────────────────────────────────────────

interface SnapshotInput  { token: string }
interface SnapshotOutput {
  product:   Record<string, unknown>
  coverages: Record<string, unknown>[]
  forms:     Record<string, unknown>[]
  expired:   false
}

export const getShareSnapshot = onCall<SnapshotInput>(
  { maxInstances: 10 },
  async (request): Promise<SnapshotOutput | { expired: true }> => {
    const { token } = request.data
    if (!token) throw new HttpsError('invalid-argument', 'token is required')

    const db      = getFirestore()
    const linkDoc = await db.doc(`shareLinks/${token}`).get()
    if (!linkDoc.exists) throw new HttpsError('not-found', 'Share link not found')

    const link = linkDoc.data() as { productId: string; expiresAt: Timestamp }
    if (link.expiresAt.toDate() < new Date()) return { expired: true }

    const productDoc   = await db.doc(`products/${link.productId}`).get()
    const coveragesSnap = await db.collection(`products/${link.productId}/coverages`).get()
    const formsSnap     = await db.collection('forms').get()

    const productData = { id: productDoc.id, ...productDoc.data() }
    const coverages   = coveragesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const allForms    = formsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const forms = allForms.filter(f => {
      const d    = f as Record<string, unknown>
      const refs = (d['productRefIds'] as string[] | undefined) ?? []
      return refs.includes(link.productId)
    })

    return { product: productData, coverages, forms, expired: false }
  },
)
