// retrieval/types.ts — the server-side retrieval seam.
//
// Mirrors the app's Firebase→AWS adapter seam (app/src/lib/backend), but for the
// grounding retriever: a small set of PORTS so the embeddings provider, reranker and
// vector store can each be swapped without touching the grounding tools. The live
// implementation is Voyage (embeddings + reranker) over a Firestore vector store; the
// swap is documented in retrieval/placeholder.ts (Bedrock + OpenSearch), exactly like
// aws.adapter.placeholder.ts.
//
// BACKEND-ONLY: nothing here is importable from app/ — embeddings + vectors never reach
// the browser, and the VOYAGE_API_KEY is read only inside voyage.ts (server secret).
import type { GroundingChunk, RetrievalHit, ChunkSourceType } from '@pf/shared'

/** Turns text into dense vectors. Documents are embedded together so a contextualized
 *  model (voyage-context-3) can condition each chunk's vector on its neighbours. */
export interface EmbeddingsClient {
  readonly model: string
  readonly dim:   number
  /** Embed a batch of chunk bodies. Returns one vector per input, order-aligned. */
  embedDocuments(texts: string[]): Promise<number[][]>
  /** Embed a single search query (input_type=query). */
  embedQuery(text: string): Promise<number[]>
}

/** Re-orders a candidate set by true relevance to the query (rerank-2.5-lite). */
export interface Reranker {
  readonly model: string
  /** Return indices into `docs`, most-relevant first, at most `topN`, with a score. */
  rerank(query: string, docs: string[], topN: number): Promise<{ index: number; score: number }[]>
}

/** Narrow the candidate pool before ranking (by entity type and/or owning product). */
export interface ChunkFilter {
  types?:     ChunkSourceType[]
  productId?: string
}

/** Persists chunk vectors + metadata and answers nearest-neighbour queries. The live
 *  store is Firestore (KNN `findNearest` when vectors exist; lexical text ranking when
 *  they don't). Incremental build is driven by `existingHashes` + `pruneExcept`. */
export interface VectorStore {
  /** Currently-indexed chunk id → contentHash, so the indexer re-embeds only what changed. */
  existingHashes(): Promise<Map<string, string>>
  /** Upsert chunks. `vector` is null in lexical mode (no embeddings provider). */
  upsert(records: { chunk: GroundingChunk; vector: number[] | null }[]): Promise<void>
  /** Delete every indexed chunk whose id is NOT in `keep`; returns the count pruned. */
  pruneExcept(keep: Set<string>): Promise<number>
  count(): Promise<number>
  /** Retrieve candidates. `queryVector` null → rank stored text lexically. */
  query(opts: {
    queryVector: number[] | null
    queryText:   string
    topK:        number
    filter?:     ChunkFilter
  }): Promise<RetrievalHit[]>
}

/** The composed retrieval backend for one request. `embeddings === null` selects the
 *  dependency-free lexical path (no VOYAGE_API_KEY, or an empty index). */
export interface RetrievalProvider {
  readonly name:       string
  readonly embeddings: EmbeddingsClient | null
  readonly reranker:   Reranker | null
}
