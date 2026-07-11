// audited.ts — the server-side equivalent of the app adapter's mutate() envelope, for the
// rare cases where a Cloud Function must persist a change to a GOVERNED domain document (not
// a system/telemetry doc). One Admin SDK transaction writes the same atomic unit mutate() does:
//   1. entity write (field merge + rev bump + updatedAt/updatedBy)
//   2. append-only auditEvents/{autoId}
//   3. versions/{autoId} with a field-level diff + snapshot
//   4. searchIndex upsert (indexable types only)
// so a Function-authored change is exactly as audited, versioned and searchable as a user edit.
//
// Mirrors app/src/lib/backend/firebase.adapter.ts:mutate() — keep the two in sync. The one
// deliberate divergence: the searchIndex step MERGES keywords into any existing entry rather
// than rebuilding it wholesale, so it never clobbers the richer display (title/subtitle/keywords)
// the seed writes for a document — it only makes the newly-written field searchable.
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Same indexable set as the client seam (firebase.adapter.ts) + the seed.
const INDEXABLE = new Set(['product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task'])

export interface AuditedActor { uid: string; name: string }

export interface AuditedMergeOpts {
  /** Firestore path of the entity, e.g. `forms/HO-00-03`. */
  path:        string
  /** Domain entity type — drives searchIndex inclusion + audit/version metadata. */
  entityType:  string
  /** Partial field set to merge onto the entity (the authored/derived change). */
  patch:       Record<string, unknown>
  /** Real acting principal — attributed truthfully in the audit trail. */
  actor:       AuditedActor
  /** Owning product id for per-product entities; null for global docs (forms, tables). */
  productId?:  string | null
}

/** Persist `patch` onto `path` with the full mutate() governance envelope, atomically. */
export async function auditedMerge(opts: AuditedMergeOpts): Promise<void> {
  const db         = getFirestore()
  const entityRef  = db.doc(opts.path)
  const auditRef   = db.collection('auditEvents').doc()   // stable ids across tx retries
  const versionRef = db.collection('versions').doc()
  const searchRef  = db.doc(`searchIndex/${opts.path.replace(/\//g, '_')}`)
  const indexable  = INDEXABLE.has(opts.entityType)

  await db.runTransaction(async (tx) => {
    // All reads before any writes (Admin SDK transaction rule).
    const snap        = await tx.get(entityRef)
    const prev        = (snap.data() ?? {}) as Record<string, unknown>
    const existingIdx = indexable ? (await tx.get(searchRef)) : null

    const merged = { ...prev, ...opts.patch }

    // Field-level diff over the PATCHED keys only — accurate for a partial/derived write
    // (unchanged fields are never reported as removed).
    const diff: Array<{ field: string; before: unknown; after: unknown }> = []
    for (const field of Object.keys(opts.patch)) {
      if (JSON.stringify(prev[field]) !== JSON.stringify(opts.patch[field])) {
        diff.push({ field, before: prev[field] ?? null, after: opts.patch[field] ?? null })
      }
    }

    // 1. Entity write + rev bump (merge so we never drop unrelated fields).
    const newRev = ((prev['rev'] as number) ?? 0) + 1
    tx.set(entityRef, { ...opts.patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: opts.actor.uid, rev: newRev }, { merge: true })

    // 2. Append-only audit event (same shape as mutate()).
    tx.set(auditRef, {
      actor: opts.actor, action: 'update', entityType: opts.entityType,
      entityPath: opts.path, productId: opts.productId ?? null, at: FieldValue.serverTimestamp(),
    })

    // 3. Version snapshot + diff (same shape as mutate(); snapshot is the incoming patch).
    tx.set(versionRef, {
      entityType: opts.entityType, entityPath: opts.path, productId: opts.productId ?? null,
      snapshot: opts.patch, diff, actor: opts.actor, at: FieldValue.serverTimestamp(),
    })

    // 4. SearchIndex: MERGE keywords derived from the patched string values into the existing
    //    entry so the change is searchable without clobbering the seed's display. If no entry
    //    exists yet, build a minimal one from the merged doc (mirrors mutate()).
    if (indexable) {
      const patchKeywords = Object.values(opts.patch)
        .filter((v): v is string => typeof v === 'string')
        .join(' ').toLowerCase().split(/\W+/).filter(k => k.length > 2)

      if (existingIdx?.exists) {
        const prevKeywords = (existingIdx.data()?.['keywords'] as string[] | undefined) ?? []
        tx.set(searchRef, { keywords: [...new Set([...prevKeywords, ...patchKeywords])] }, { merge: true })
      } else {
        const title    = (merged['name'] as string | undefined) ?? (merged['title'] as string | undefined) ?? ''
        const subtitle = (merged['refId'] as string | undefined) ?? opts.entityType
        const keywords = [title, subtitle, merged['refId'] as string, ...patchKeywords]
          .filter(Boolean).join(' ').toLowerCase().split(/\W+/).filter(k => k.length > 2)
        tx.set(searchRef, {
          type: opts.entityType, refId: (merged['refId'] as string | null) ?? null,
          title, subtitle, path: opts.path, keywords: [...new Set(keywords)],
        })
      }
    }
  })
}
