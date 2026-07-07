// share.ts — snapshot share links. createShare (EDITOR+) mints a read-only snapshot
// of a product and its coverages, stored in shares/{id}. getShare (public HTTP) returns
// the snapshot so an unauthenticated viewer can read it without touching Firestore rules.
// Admin SDK only — never exposed to client rules (per functions/CLAUDE.md).
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Role } from '@pf/shared'

if (!getApps().length) initializeApp()

interface CreateShareInput {
  productId:      string
  note?:          string
  expiresInDays?: number  // default 30
}

// ─── createShare ─────────────────────────────────────────────────────────────

export const createShare = onCall<CreateShareInput>(
  { maxInstances: 5 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to create a share link.')
    const role = (req.auth.token as { role?: Role }).role
    if (role !== 'EDITOR' && role !== 'ADMIN') {
      throw new HttpsError('permission-denied', 'EDITOR or ADMIN role required to create share links.')
    }

    const { productId, note, expiresInDays = 30 } = req.data
    if (!productId?.trim()) throw new HttpsError('invalid-argument', 'productId is required.')
    if (expiresInDays < 1 || expiresInDays > 365) {
      throw new HttpsError('invalid-argument', 'expiresInDays must be between 1 and 365.')
    }

    const db = getFirestore()

    // Read product + its coverages atomically from the current state.
    const productRef  = db.doc(`products/${productId}`)
    const productSnap = await productRef.get()
    if (!productSnap.exists) throw new HttpsError('not-found', `Product ${productId} not found.`)

    const coverageSnaps = await db.collection(`products/${productId}/coverages`).get()
    const coverages = coverageSnaps.docs.map(d => ({ id: d.id, ...d.data() }))

    const shareId   = db.collection('shares').doc().id
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000)

    await db.doc(`shares/${shareId}`).set({
      productId,
      note:      note?.trim() ?? '',
      createdBy: { uid: req.auth.uid, name: (req.auth.token.name as string | undefined) ?? req.auth.uid },
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: expiresAt.toISOString(),
      snapshot:  {
        product:   { id: productId, ...productSnap.data() },
        coverages,
      },
    })

    return { shareId }
  },
)

// ─── getShare ─────────────────────────────────────────────────────────────────
// Public HTTPS endpoint — no auth required. Returns the share snapshot JSON or
// 404/410 if the share does not exist or has expired.

export const getShare = onRequest({ maxInstances: 10 }, async (req, res) => {
  const shareId = (req.query.id as string | undefined)?.trim()
  if (!shareId) { res.status(400).json({ error: 'id query parameter is required.' }); return }

  const db = getFirestore()
  const snap = await db.doc(`shares/${shareId}`).get()

  if (!snap.exists) { res.status(404).json({ error: 'Share link not found.' }); return }

  const data = snap.data() as Record<string, unknown>
  const expiresAt = typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : null
  if (expiresAt && expiresAt < new Date()) {
    res.status(410).json({ error: 'This share link has expired.' })
    return
  }

  res.setHeader('Cache-Control', 'public, max-age=60')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ id: shareId, ...data })
})
