// semanticCache.ts — the server side of the semantic response cache (Part A).
//
// A grounded chat answer is cached keyed on its QUERY EMBEDDING. A new query reuses a cached
// answer only when THREE gates pass (pure logic in @pf/shared/cost/semanticCache):
//   1. FRESHNESS  — every refId/form the cached answer cited still resolves (checked first;
//                   a stale-cited answer is never served, and is proactively evicted here).
//   2. SIMILARITY — the nearest cached query is within the CONSERVATIVE cosine threshold.
//   3. VERIFIER   — a cheap yes/no agrees the cached answer fits the new question.
// A hit skips retrieval + the Sonnet call; only the tiny verifier (+ one embed) is spent.
//
// PROVIDER-AGNOSTIC KEY: dense Voyage vectors when a key is configured (KNN via Firestore
// findNearest), else a deterministic LOCAL hash embedding (in-memory cosine over the small cache
// collection) — mirroring how retrieval degrades dense→lexical, so the cache WORKS with or without
// Voyage. The verifier is injectable (a live haiku by default; a stub in tests); with no verifier
// available the gate falls back to near-exact similarity (safe). Collection `semanticCache` is
// server-only (Admin SDK; denied to all clients in firestore.rules), like `groundingChunks`.
// AWS-SWAP: `semanticCache` → the same vector store as groundingChunks (OpenSearch/DynamoDB).
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_FAST } from './runtime'
import { staleCitedAnchors, decideSemanticCache, cosineSim } from '@pf/shared'
import { emptyUsage, addUsage } from './telemetry'
import type { UsageAccum } from './telemetry'

const COLLECTION   = 'semanticCache'
const VECTOR_FIELD = 'embedding'      // dense-mode FieldValue.vector (findNearest)
const LOCAL_SCAN   = 500              // local-mode: bounded read of the (small) cache collection

export type CacheMode = 'dense' | 'local'
export interface KnownSets { refIds: Set<string>; formNumbers: Set<string> }

export interface CachedEntry {
  id:        string
  query:     string
  answer:    string
  anchors:   string[]
  productId: string | null
}

interface CacheDoc { query: string; answer: string; anchors?: string[]; productId?: string | null; vec?: number[] }

/** Deterministic doc id so re-asking the same question OVERWRITES the entry rather than piling
 *  up near-duplicates. Scoped by product so the same question against two products caches apart. */
function entryId(query: string, productId: string | null): string {
  const s = `${(productId ?? '').toLowerCase()}::${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The cheap verifier's function shape — injectable so tests can drive it deterministically. */
export type VerifyFn = (cachedQuery: string, cachedAnswer: string, newQuery: string, usage: UsageAccum) => Promise<boolean>

/** The default (live) verifier: a deterministic (temperature 0, allowed on haiku) yes/no that the
 *  cached answer fits the NEW question. Any ambiguity resolves to NO — a false hit (a confidently-
 *  wrong answer for a similar-but-different question) is worse than a miss. */
export function haikuVerifier(client: Anthropic): VerifyFn {
  return async (cachedQuery, cachedAnswer, newQuery, usage) => {
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
}

export interface SemanticCacheResult {
  hit:           CachedEntry | null
  similarity:    number
  reason:        'hit' | 'stale-citation' | 'below-threshold' | 'verifier-declined' | 'no-candidate'
  verifierUsage: UsageAccum   // verifier tokens spent (0 if no candidate reached gate 3 / stub)
  staleEvicted:  boolean
}

/** A candidate cache entry + its similarity to the query, nearest-first. */
interface Candidate { ref: FirebaseFirestore.DocumentReference; data: CacheDoc; similarity: number }

/** Fetch nearest candidates by mode. Dense → Firestore findNearest (COSINE). Local → a bounded
 *  read of the cache collection + in-memory cosine over the stored `vec` (emulator-friendly; no
 *  vector index needed). Both return candidates nearest-first. */
async function fetchCandidates(mode: CacheMode, queryVector: number[]): Promise<Candidate[]> {
  const coll = getFirestore().collection(COLLECTION)
  if (mode === 'dense') {
    const snap = await coll.findNearest({
      vectorField: VECTOR_FIELD, queryVector, limit: 5, distanceMeasure: 'COSINE', distanceResultField: '_distance',
    }).get()
    return snap.docs.map(d => ({
      ref: d.ref, data: d.data() as CacheDoc, similarity: Math.max(0, 1 - ((d.get('_distance') as number | undefined) ?? 1)),
    }))
  }
  const snap = await coll.limit(LOCAL_SCAN).get()
  return snap.docs
    .map(d => ({ ref: d.ref, data: d.data() as CacheDoc, similarity: cosineSim(queryVector, (d.data() as CacheDoc).vec ?? []) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
}

/**
 * Look for a cached answer for `query`. Fetches nearest candidates (by mode), applies the three
 * gates nearest-first, evicts a stale-cited candidate (and keeps looking), and — only when
 * freshness + similarity pass — runs the verifier. Returns the hit (or null with a reason).
 */
export async function semanticCacheGet(params: {
  query:       string
  queryVector: number[]
  productId?:  string | null
  known:       KnownSets
  mode?:       CacheMode
  client?:     Anthropic          // used to build the default verifier when `verify` is omitted
  verify?:     VerifyFn           // injected verifier (tests); overrides the default
}): Promise<SemanticCacheResult> {
  const verifierUsage = emptyUsage()
  const productId = params.productId ?? null
  const mode = params.mode ?? 'dense'
  // Resolve gate 3: an injected verifier, else the live haiku verifier, else near-exact similarity.
  const verify: VerifyFn | null = params.verify ?? (params.client ? haikuVerifier(params.client) : null)

  const candidates = await fetchCandidates(mode, params.queryVector)
  let staleEvicted = false

  for (const c of candidates) {
    if ((c.data.productId ?? null) !== productId) continue   // scope must match exactly
    const anchors = c.data.anchors ?? []
    const stale = staleCitedAnchors(anchors, params.known.refIds, params.known.formNumbers)
    const outcome = decideSemanticCache({ similarity: c.similarity, staleAnchors: stale })

    if (outcome === 'stale-citation') {
      try { await c.ref.delete(); staleEvicted = true } catch { /* best-effort eviction */ }
      continue   // a stale nearest must not mask a fresh (slightly farther) candidate
    }
    if (outcome === 'below-threshold') {
      // Candidates are nearest-first, so once one is below the conservative floor, none farther can pass.
      return { hit: null, similarity: c.similarity, reason: 'below-threshold', verifierUsage, staleEvicted }
    }

    // Gate 3 — verifier (or near-exact fallback when none is available). Any error → miss.
    let agrees: boolean
    if (verify) { try { agrees = await verify(c.data.query, c.data.answer, params.query, verifierUsage) } catch { agrees = false } }
    else { agrees = c.similarity >= 0.999 }   // no verifier → only serve a near-exact match
    if (!agrees) return { hit: null, similarity: c.similarity, reason: 'verifier-declined', verifierUsage, staleEvicted }

    try { await c.ref.set({ hits: FieldValue.increment(1), lastHitAt: FieldValue.serverTimestamp() }, { merge: true }) } catch { /* stat only */ }
    return {
      hit: { id: c.ref.id, query: c.data.query, answer: c.data.answer, anchors, productId },
      similarity: c.similarity, reason: 'hit', verifierUsage, staleEvicted,
    }
  }
  return { hit: null, similarity: candidates[0]?.similarity ?? 0, reason: 'no-candidate', verifierUsage, staleEvicted }
}

/** Cache a fresh answer (upsert by deterministic id). `anchors` are the verified refIds/form
 *  numbers the answer cited (the freshness key). Stores the plain `vec` for local cosine and, in
 *  dense mode, also the `embedding` VectorValue for findNearest. */
export async function semanticCachePut(params: {
  query: string; queryVector: number[]; answer: string; anchors: string[]
  productId?: string | null; model: string; mode?: CacheMode
}): Promise<void> {
  try {
    const doc: Record<string, unknown> = {
      query:     params.query,
      answer:    params.answer,
      anchors:   params.anchors,
      productId: params.productId ?? null,
      model:     params.model,
      mode:      params.mode ?? 'dense',
      vec:       params.queryVector,
      hits:      0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if ((params.mode ?? 'dense') === 'dense') doc[VECTOR_FIELD] = FieldValue.vector(params.queryVector)
    await getFirestore().doc(`${COLLECTION}/${entryId(params.query, params.productId ?? null)}`).set(doc, { merge: false })
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
