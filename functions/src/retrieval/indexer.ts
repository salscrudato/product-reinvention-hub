// retrieval/indexer.ts — build the grounding vector index from the live corpus.
//
// Reads products + their subcollections and the global forms/dictionary/tables, chunks
// them with the shared builders, then does an INCREMENTAL build: only chunks whose
// contentHash changed are re-embedded + upserted, and chunks that no longer exist are
// pruned. A Voyage key enables dense embeddings; without one the chunks are stored for
// lexical ranking (still a valid, queryable index). Exposed as the ADMIN-only
// `reindexGrounding` callable and reused by the seed script.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import {
  chunkProduct, chunkCoverage, chunkRule, chunkFormRule, chunkForm,
  chunkDictionary, chunkRatingProgram, chunkLdTable, chunkRtTable, dedupeChunks,
} from '@pf/shared'
import type {
  GroundingChunk, Product, Coverage, Rule, FormRule, Form, DictionaryEntry,
  RatingProgram, LDTable, RTTable,
} from '@pf/shared'
import { VOYAGE_API_KEY, voyageKey, requireRole } from '../runtime'
import { getProvider, store } from './index'

const pidOf = (path: string) => path.split('/')[1] ?? ''   // products/<pid>/...
const EMBED_BATCH = 96

/** Read the whole corpus from Firestore and build its chunk list (deduped). */
export async function loadCorpusChunks(): Promise<GroundingChunk[]> {
  const db = getFirestore()
  const [prodSnap, covSnap, ruleSnap, frSnap, rpSnap, formSnap, dictSnap, ldSnap, rtSnap] = await Promise.all([
    db.collection('products').get(),
    db.collectionGroup('coverages').get(),
    db.collectionGroup('rules').get(),
    db.collectionGroup('formRules').get(),
    db.collectionGroup('ratingPrograms').get(),
    db.collection('forms').get(),
    db.collection('dictionary').get(),
    db.collection('ldTables').get(),
    db.collection('rtTables').get(),
  ])

  const chunks: GroundingChunk[] = []
  for (const d of prodSnap.docs)  chunks.push(chunkProduct(d.data() as Product))
  for (const d of covSnap.docs)   chunks.push(chunkCoverage(d.data() as Coverage, pidOf(d.ref.path)))
  for (const d of ruleSnap.docs)  chunks.push(chunkRule(d.data() as Rule, pidOf(d.ref.path)))
  for (const d of frSnap.docs)    chunks.push(chunkFormRule(d.data() as FormRule, pidOf(d.ref.path)))
  for (const d of rpSnap.docs)    chunks.push(chunkRatingProgram(d.data() as RatingProgram, pidOf(d.ref.path)))
  for (const d of formSnap.docs)  chunks.push(chunkForm(d.data() as Form))
  for (const d of dictSnap.docs)  chunks.push(chunkDictionary(d.data() as DictionaryEntry))
  for (const d of ldSnap.docs)    chunks.push(chunkLdTable(d.id, d.data() as LDTable))
  for (const d of rtSnap.docs)    chunks.push(chunkRtTable(d.id, d.data() as RTTable))
  return dedupeChunks(chunks)
}

export interface IndexReport {
  mode:    'dense' | 'lexical'
  total:   number   // chunks in the corpus now
  indexed: number   // changed chunks re-embedded/upserted this run
  skipped: number   // unchanged chunks left as-is (incremental)
  pruned:  number   // stale chunks deleted
}

/** Incremental build: embed + upsert only changed chunks, prune the departed. */
export async function buildGroundingIndex(opts: { voyageKey?: string } = {}): Promise<IndexReport> {
  const provider = getProvider(opts.voyageKey)
  const chunks   = await loadCorpusChunks()
  const existing = await store.existingHashes()

  const changed = chunks.filter(c => existing.get(c.id) !== c.contentHash)

  // Embed changed chunks in batches (dense mode); lexical mode stores null vectors.
  const vectors = new Map<string, number[] | null>()
  if (provider.embeddings && changed.length) {
    for (let i = 0; i < changed.length; i += EMBED_BATCH) {
      const batch = changed.slice(i, i + EMBED_BATCH)
      const embs  = await provider.embeddings.embedDocuments(batch.map(c => c.text))
      batch.forEach((c, j) => vectors.set(c.id, embs[j] ?? null))
    }
  }

  await store.upsert(changed.map(c => ({ chunk: c, vector: vectors.get(c.id) ?? null })))
  const pruned = await store.pruneExcept(new Set(chunks.map(c => c.id)))

  return {
    mode:    provider.embeddings ? 'dense' : 'lexical',
    total:   chunks.length,
    indexed: changed.length,
    skipped: chunks.length - changed.length,
    pruned,
  }
}

// ─── reindexGrounding — ADMIN-only callable ────────────────────────────────────
// Two-sided role enforcement: gated ADMIN here AND `groundingChunks` is denied to all
// clients in firestore.rules (Admin-SDK writes only). Rebuilding the index is a
// privileged, corpus-wide operation, so it sits with the other ADMIN maintenance tools.
export const reindexGrounding = onCall(
  { secrets: [VOYAGE_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (req) => {
    requireRole(req.auth, 'ADMIN')
    try {
      return await buildGroundingIndex({ voyageKey: voyageKey() })
    } catch (err) {
      console.error('[reindexGrounding] failed:', err)
      throw new HttpsError('internal', 'Index rebuild failed.')
    }
  },
)
