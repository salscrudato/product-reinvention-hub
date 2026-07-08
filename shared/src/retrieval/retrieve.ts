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
