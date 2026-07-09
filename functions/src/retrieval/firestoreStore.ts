// retrieval/firestoreStore.ts — the live VectorStore, backed by Firestore.
//
// One doc per chunk in `groundingChunks`, holding the chunk text + traceability metadata
// and (when a provider produced one) a dense `embedding` VectorValue. Dense queries use
// Firestore KNN `findNearest` (COSINE) — a genuine INDEXED nearest-neighbour query, not a
// collection scan. When the index has no vectors (offline / no VOYAGE_API_KEY), the store
// falls back to lexical ranking over the stored text (seed-scale) so grounding still works.
//
// Either way the tool surface gets top-k RetrievalHits — never the whole collection — which
// is the input-token win over the old full-collection-scan tools (OBSERVATIONS B10).
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { lexicalRetrieve } from '@pf/shared'
import type { GroundingChunk, RetrievalHit } from '@pf/shared'
import type { VectorStore, ChunkFilter } from './types'

const COLLECTION = 'groundingChunks'
const VECTOR_FIELD = 'embedding'

/** Firestore doc ids may not contain '/'. Chunk ids use ':' and '.', which are legal. */
const docId = (chunkId: string) => chunkId.replace(/\//g, '_')

interface ChunkDoc {
  id:          string
  text:        string
  contentHash: string
  metadata:    GroundingChunk['metadata']
}

function toChunk(d: ChunkDoc): GroundingChunk {
  return { id: d.id, text: d.text, contentHash: d.contentHash, metadata: d.metadata }
}

function passesFilter(c: GroundingChunk, filter?: ChunkFilter): boolean {
  if (!filter) return true
  if (filter.types && !filter.types.includes(c.metadata.type)) return false
  if (filter.productId && c.metadata.productId && c.metadata.productId !== filter.productId) return false
  return true
}

export const firestoreVectorStore: VectorStore = {
  async existingHashes() {
    const snap = await getFirestore().collection(COLLECTION).select('id', 'contentHash').get()
    const out = new Map<string, string>()
    for (const d of snap.docs) {
      const id = d.get('id') as string | undefined
      const hash = d.get('contentHash') as string | undefined
      if (id && hash) out.set(id, hash)
    }
    return out
  },

  async upsert(records) {
    const db = getFirestore()
    for (let i = 0; i < records.length; i += 400) {
      const batch = db.batch()
      for (const { chunk, vector } of records.slice(i, i + 400)) {
        const doc: Record<string, unknown> = {
          id: chunk.id, text: chunk.text, contentHash: chunk.contentHash,
          metadata: chunk.metadata,
          type: chunk.metadata.type, productId: chunk.metadata.productId,
          updatedAt: FieldValue.serverTimestamp(),
        }
        // Full overwrite (set, no merge): a chunk that lost its vector (lexical mode)
        // simply carries no embedding field, and findNearest ignores it.
        if (vector && vector.length) doc[VECTOR_FIELD] = FieldValue.vector(vector)
        batch.set(db.doc(`${COLLECTION}/${docId(chunk.id)}`), doc)
      }
      await batch.commit()
    }
  },

  async pruneExcept(keep) {
    const db = getFirestore()
    const snap = await db.collection(COLLECTION).select('id').get()
    const stale = snap.docs.filter(d => { const id = d.get('id') as string | undefined; return id != null && !keep.has(id) })
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch()
      for (const d of stale.slice(i, i + 400)) batch.delete(d.ref)
      await batch.commit()
    }
    return stale.length
  },

  async count() {
    const snap = await getFirestore().collection(COLLECTION).count().get()
    return snap.data().count
  },

  async query({ queryVector, queryText, topK, filter }) {
    const coll = getFirestore().collection(COLLECTION)

    // ── Dense path — indexed KNN nearest-neighbour (COSINE) ──────────────────
    if (queryVector && queryVector.length) {
      // Over-fetch, then apply the type/product filter client-side so no composite
      // vector index is required for every filter combination.
      const snap = await coll.findNearest({
        vectorField: VECTOR_FIELD, queryVector, limit: Math.max(topK * 4, 40),
        distanceMeasure: 'COSINE', distanceResultField: '_distance',
      }).get()
      const hits: RetrievalHit[] = []
      for (const d of snap.docs) {
        const chunk = toChunk(d.data() as ChunkDoc)
        if (!passesFilter(chunk, filter)) continue
        const distance = (d.get('_distance') as number | undefined) ?? 1
        hits.push({ chunk, score: Math.max(0, 1 - distance) })   // cosine sim = 1 − cosine distance
        if (hits.length >= topK) break
      }
      return hits
    }

    // ── Lexical fallback — no vectors indexed (offline / no key) ─────────────
    const snap = await coll.get()
    const chunks = snap.docs.map(d => toChunk(d.data() as ChunkDoc))
    return lexicalRetrieve(queryText, chunks, { topK, types: filter?.types, productId: filter?.productId })
  },
}
