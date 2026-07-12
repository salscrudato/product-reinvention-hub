// retrieval/retrieve.ts — the platform-free retrieval primitives.
//
//   • lexicalRetrieve — TF-IDF cosine over chunk text (the OFFLINE fallback + the eval's
//     retrieval-quality check). Used verbatim when no dense provider is configured
//     (no VOYAGE_API_KEY) or the vector index is empty, so grounding still works with
//     zero external dependencies.
//   • cosineSim / quantizeInt8 / dequantizeInt8 — the dense-vector math the functions/
//     vector store uses (int8 storage cuts the vector footprint ~4x). Kept here so it is
//     unit-tested in the gate rather than hidden behind a live embeddings call.
//
// The dense retriever (Voyage embeddings + a vector store + a reranker) lives in
// functions/src/retrieval behind a provider seam; it emits the SAME RetrievalHit[] as
// lexicalRetrieve, so the grounding tools are identical whichever backend answers.
import { rankDocuments } from '../search/rank'
import type { RankDoc } from '../search/rank'
import type { GroundingChunk, RetrievalHit, ChunkSourceType } from './types'

export interface RetrieveOptions {
  topK?:      number
  /** Restrict to these source types (e.g. only 'form' / 'dictionary'). */
  types?:     ChunkSourceType[]
  /** Restrict to one product's chunks (globals with productId=null always pass). */
  productId?: string
}

/** Rank chunks against a query by TF-IDF cosine over their text. The refId, form number
 *  and title are repeated into the ranked document so an id/name query weights the right
 *  chunk — the same weighting the legacy search_entities used, now over chunk bodies. */
export function lexicalRetrieve(
  query: string,
  chunks: readonly GroundingChunk[],
  opts: RetrieveOptions = {},
): RetrievalHit[] {
  const topK = opts.topK ?? 8
  const pool = chunks.filter(c => {
    if (opts.types && !opts.types.includes(c.metadata.type)) return false
    if (opts.productId && c.metadata.productId && c.metadata.productId !== opts.productId) return false
    return true
  })
  if (pool.length === 0) return []

  const docs: RankDoc[] = pool.map((c, i) => ({
    id: String(i),
    // refId ×2 + form number + title boost the citation anchors, then the body.
    text: `${c.metadata.refId ?? ''} ${c.metadata.refId ?? ''} ${c.metadata.formNumber ?? ''} ${c.metadata.title} ${c.text}`,
  }))
  const ranked = rankDocuments(query, docs, topK).filter(r => r.score > 0 || !query.trim())
  return ranked.map(r => ({ chunk: pool[Number(r.id)]!, score: r.score }))
}

// ─── Dense-vector math (used by the functions/ vector store) ────────────────────

/** Cosine similarity of two equal-length vectors (0 if either is a zero vector). */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export interface Int8Vector { values: number[]; scale: number }

/** Symmetric int8 quantization: one scale per vector maps [-max,max] → [-127,127].
 *  Direction (and therefore cosine similarity) is preserved to within quantization
 *  error, so int8 vectors can be compared directly or dequantized for exact cosine. */
export function quantizeInt8(vec: readonly number[]): Int8Vector {
  let max = 0
  for (const v of vec) { const a = Math.abs(v); if (a > max) max = a }
  const scale = max === 0 ? 1 : max / 127
  return { values: vec.map(v => Math.max(-127, Math.min(127, Math.round(v / scale)))), scale }
}

export function dequantizeInt8(q: Int8Vector): number[] {
  return q.values.map(v => v * q.scale)
}

// ─── Hybrid dense + lexical scoring (the server RAG ranker primitives) ──────────
// The deployed grounding retriever (server/lib/ai.js) fetches candidate chunks with
// their stored embedding vectors, embeds the query, and ranks by hybridScore(dense,
// lexical). These pure helpers keep that ranking logic unit-tested in the offline gate
// instead of hidden behind a live embeddings call — and guarantee the query and document
// tokenization always match (a classic source of silent lexical-recall bugs).

/** Tokenize a query or document into lowercased alphanumeric terms of length ≥ 2.
 *  The single source of truth for tokenization on both sides of the lexical scorer. */
export function retrievalTerms(s: string): string[] {
  return String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2)
}

/** Count non-overlapping occurrences of `needle` in `hay` (both already lowercased). */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  let n = 0, i = hay.indexOf(needle)
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length) }
  return n
}

/** Lexical relevance of `text` to `query` in [0,1]: mostly how many DISTINCT query terms
 *  appear in the text (coverage), plus a small capped bonus for repeated hits (density).
 *  Deterministic and corpus-free — a cheap complement to dense cosine that keeps exact
 *  refIds, form numbers and rare domain terms pulling their chunk up even when the
 *  embedding is lukewarm. Returns 0 for an empty query (dense score then stands alone). */
export function keywordOverlapScore(query: string, text: string): number {
  const terms = [...new Set(retrievalTerms(query))]
  if (terms.length === 0) return 0
  const lc = String(text ?? '').toLowerCase()
  let present = 0, hits = 0
  for (const t of terms) {
    const n = countOccurrences(lc, t)
    if (n > 0) { present++; hits += Math.min(n, 3) }
  }
  const coverage = present / terms.length          // fraction of query terms matched
  const density  = hits / (terms.length * 3)        // capped repetition bonus
  return 0.8 * coverage + 0.2 * density
}

/** Blend a dense cosine score with a lexical score into one ranking score.
 *  `alpha` weights the dense component; `1 - alpha` the lexical. When no dense score is
 *  available (`dense === null`, e.g. the embeddings API is down or a chunk was written
 *  before embeddings existed) the lexical score is returned unchanged, so lexical-only
 *  fallback ranking degrades gracefully rather than collapsing to zero. Negative cosines
 *  (rare for text embeddings) are clamped to 0. */
export function hybridScore(dense: number | null, lexical: number, alpha = 0.7): number {
  if (dense === null || Number.isNaN(dense)) return lexical
  const d = Math.max(0, Math.min(1, dense))
  return alpha * d + (1 - alpha) * lexical
}
