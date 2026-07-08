// semanticCache.ts — the server side of the semantic response cache (Part A).
//
// A grounded chat answer is cached keyed on its QUERY EMBEDDING (Voyage). A new query reuses a
// cached answer only when THREE gates pass (pure logic in @pf/shared/cost/semanticCache):
//   1. FRESHNESS  — every refId/form the cached answer cited still resolves (checked first;
//                   a stale-cited answer is never served, and is proactively evicted here).
//   2. SIMILARITY — the nearest cached query is within the CONSERVATIVE cosine threshold.
//   3. VERIFIER   — a cheap haiku yes/no agrees the cached answer fits the new question.
// A hit skips retrieval + the Sonnet call entirely; only the tiny verifier (+ one embed) is
// spent. The whole path is gated on a Voyage key (prod), so offline the cache is simply absent
// and chat behaves exactly as before — the pure gates are still exercised in the gate.
//
// Collection `semanticCache` is server-only (Admin SDK; denied to all clients in firestore.rules),
// like `groundingChunks`. Dense KNN uses Firestore findNearest (needs a vector index on
// `embedding`, created at deploy like the groundingChunks index).
// AWS-SWAP: `semanticCache` → the same vector store as groundingChunks (OpenSearch/DynamoDB).
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_FAST } from './runtime'
import { staleCitedAnchors, decideSemanticCache } from '@pf/shared'
import { emptyUsage, addUsage } from './telemetry'
import type { UsageAccum } from './telemetry'

const COLLECTION   = 'semanticCache'
const VECTOR_FIELD = 'embedding'

export interface KnownSets { refIds: Set<string>; formNumbers: Set<string> }

export interface CachedEntry {
  id:        string
  query:     string
  answer:    string
  anchors:   string[]
  productId: string | null
}

interface CacheDoc { query: string; answer: string; anchors?: string[]; productId?: string | null }

/** Deterministic doc id so re-asking the same question OVERWRITES the entry rather than piling
 *  up near-duplicates. Scoped by product so the same question against two products caches apart. */
function entryId(query: string, productId: string | null): string {
  const s = `${(productId ?? '').toLowerCase()}::${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Gate 3 — the cheap verifier. A deterministic (temperature 0, allowed on haiku) yes/no that
 *  the cached answer actually fits the NEW question. Any ambiguity resolves to NO: a false hit
 *  (a confidently-wrong answer for a similar-but-different question) is worse than a miss. */
async function verifierAgrees(
  client: Anthropic, cachedQuery: string, cachedAnswer: string, newQuery: string, usage: UsageAccum,
): Promise<boolean> {
  const msg = await client.messages.create({
    model: MODEL_FAST, max_tokens: 5, temperature: 0,
    system:
      'You decide whether a previously-written answer FULLY and CORRECTLY answers a NEW question. ' +
      'Reply with exactly "YES" or "NO". Reply "NO" if the new question asks about anything the ' +
      'answer does not already cover, a different entity, or a different figure.',
    messages: [{ role: 'user', content:
      `PREVIOUS QUESTION:\n${cachedQuery}\n\nPREVIOUS ANSWER:\n${cachedAnswer}\n\n` +
      `NEW QUESTION:\n${newQuery}\n\nDoes the PREVIOUS ANSWER fully and correctly answer the NEW QUESTION? Reply YES or NO.` }],
  }, { timeout: 15_000 })
  addUsage(usage, msg.usage)
  const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim().toUpperCase()
  return text.startsWith('YES')
}

export interface SemanticCacheResult {
  hit:           CachedEntry | null
  similarity:    number
  reason:        'hit' | 'stale-citation' | 'below-threshold' | 'verifier-declined' | 'no-candidate'
  verifierUsage: UsageAccum   // haiku tokens spent on the verifier (0 if no candidate reached it)
  staleEvicted:  boolean
}

/**
 * Look for a cached answer for `query`. Runs KNN over the cache vectors, applies the three
 * gates, evicts a stale-cited candidate, and — only when freshness + similarity pass — runs the
 * cheap verifier. Returns the hit (or null with a reason) plus the verifier's token usage.
 */
export async function semanticCacheGet(params: {
  client:      Anthropic
  query:       string
  queryVector: number[]
  productId?:  string | null
  known:       KnownSets
}): Promise<SemanticCacheResult> {
  const verifierUsage = emptyUsage()
  const productId = params.productId ?? null
  const db = getFirestore()

  const snap = await db.collection(COLLECTION).findNearest({
    vectorField: VECTOR_FIELD, queryVector: params.queryVector, limit: 5,
    distanceMeasure: 'COSINE', distanceResultField: '_distance',
  }).get()

  for (const d of snap.docs) {
    const data = d.data() as CacheDoc
    if ((data.productId ?? null) !== productId) continue   // scope must match exactly
    const similarity = Math.max(0, 1 - ((d.get('_distance') as number | undefined) ?? 1))
    const anchors = data.anchors ?? []
    const stale = staleCitedAnchors(anchors, params.known.refIds, params.known.formNumbers)
    const outcome = decideSemanticCache({ similarity, staleAnchors: stale })

    if (outcome === 'stale-citation') {
      let staleEvicted = false
      try { await d.ref.delete(); staleEvicted = true } catch { /* best-effort eviction */ }
      return { hit: null, similarity, reason: 'stale-citation', verifierUsage, staleEvicted }
    }
    if (outcome === 'below-threshold') {
      // Candidates come back distance-sorted, so once the nearest in-scope one is below the
      // conservative threshold, no farther one can pass — stop.
      return { hit: null, similarity, reason: 'below-threshold', verifierUsage, staleEvicted: false }
    }

    // Gate 3 — cheap verifier. On any error, treat as a miss (never a false hit).
    let agrees = false
    try { agrees = await verifierAgrees(params.client, data.query, data.answer, params.query, verifierUsage) }
    catch { agrees = false }
    if (!agrees) return { hit: null, similarity, reason: 'verifier-declined', verifierUsage, staleEvicted: false }

    try { await d.ref.set({ hits: FieldValue.increment(1), lastHitAt: FieldValue.serverTimestamp() }, { merge: true }) } catch { /* stat only */ }
    return {
      hit: { id: d.id, query: data.query, answer: data.answer, anchors, productId },
      similarity, reason: 'hit', verifierUsage, staleEvicted: false,
    }
  }
  return { hit: null, similarity: 0, reason: 'no-candidate', verifierUsage, staleEvicted: false }
}

/** Cache a fresh answer (upsert by deterministic id). `anchors` are the verified refIds/form
 *  numbers the answer cited (from verifiedCitedAnchors) — the freshness key for future reads. */
export async function semanticCachePut(params: {
  query: string; queryVector: number[]; answer: string; anchors: string[]
  productId?: string | null; model: string
}): Promise<void> {
  try {
    await getFirestore().doc(`${COLLECTION}/${entryId(params.query, params.productId ?? null)}`).set({
      query:     params.query,
      answer:    params.answer,
      anchors:   params.anchors,
      productId: params.productId ?? null,
      model:     params.model,
      [VECTOR_FIELD]: FieldValue.vector(params.queryVector),
      hits:      0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false })
  } catch (e) {
    console.warn('[semanticCache] put failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Invalidation hook (Part B): drop every cached answer that cited ANY of these anchors — used by
 * the mutate() invalidation trigger when an entity changes, so a cached answer can't outlive the
 * data it summarized even while its refId still resolves. Returns the number evicted.
 */
export async function invalidateSemanticCacheByAnchors(anchors: readonly string[]): Promise<number> {
  const unique = [...new Set(anchors.filter(Boolean))]
  if (unique.length === 0) return 0
  const db = getFirestore()
  let removed = 0
  for (let i = 0; i < unique.length; i += 30) {   // array-contains-any caps at 30 values
    const slice = unique.slice(i, i + 30)
    try {
      const snap = await db.collection(COLLECTION).where('anchors', 'array-contains-any', slice).get()
      for (let j = 0; j < snap.docs.length; j += 400) {
        const batch = db.batch()
        for (const d of snap.docs.slice(j, j + 400)) { batch.delete(d.ref); removed++ }
        await batch.commit()
      }
    } catch (e) {
      console.warn('[semanticCache] invalidate failed:', e instanceof Error ? e.message : e)
    }
  }
  return removed
}
