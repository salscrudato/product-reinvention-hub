// exportDuckCreek.ts — records a Duck Creek manuscript export in the audit trail.
// Export is a READ of product data, so any authenticated user (including VIEWER) may
// export — no canEdit() gate, mirroring the Excel export's role behaviour.
// The XML is built entirely client-side (the PDM/serializer are pure @pf/shared
// functions). This callable's sole job is to write an append-only audit event via
// the Admin SDK so the export record is server-attributed and tamper-evident.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getApps, initializeApp } from 'firebase-admin/app'

if (!getApps().length) initializeApp()

export const exportDuckCreek = onCall(async (req) => {
  // Any authenticated user may export (export = read-only product view).
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to export.')

  const data = req.data as { productId?: unknown; productRefId?: unknown; manuScriptID?: unknown }
  const productId   = typeof data.productId   === 'string' ? data.productId   : null
  const manuScriptID = typeof data.manuScriptID === 'string' ? data.manuScriptID : null
  const productRefId = typeof data.productRefId === 'string' ? data.productRefId : undefined

  if (!productId)    throw new HttpsError('invalid-argument', 'productId is required.')
  if (!manuScriptID) throw new HttpsError('invalid-argument', 'manuScriptID is required.')

  const actor = {
    uid:  req.auth.uid,
    name: (req.auth.token['name'] as string | undefined)
       ?? (req.auth.token['email'] as string | undefined)
       ?? 'User',
  }

  const db = getFirestore()
  // Append-only audit event — Admin SDK bypasses rules; auditEvents also allows
  // `create: if isAuthed()` so the intent is consistent with both paths.
  await db.collection('auditEvents').add({
    actor,
    action:     'export-duckcreek',
    entityType: 'product',
    entityPath: `products/${productId}`,
    productId,
    ...(productRefId ? { productRefId } : {}),
    manuScriptID,
    at: FieldValue.serverTimestamp(),
  })

  return { ok: true }
})
