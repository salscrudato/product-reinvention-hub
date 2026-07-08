// retrieval/index.ts — the composed retrieval backend + the single retrieve() entry the
// grounding tools call. Selects the provider (Voyage when a key is configured, else the
// dependency-free lexical fallback), runs an indexed KNN query, then reranks the small
// candidate set down to top-k. One flip of `store` swaps Firestore → the placeholder.
//
// SWAP: `store = firestoreVectorStore` → `openSearchStore` (retrieval/placeholder.ts);
// `getProvider` → Bedrock embeddings + reranker. The RetrievalProvider / VectorStore
// ports (types.ts) are the entire contract, exactly like the app's aws.adapter seam.
import { firestoreVectorStore } from './firestoreStore'
import { VoyageEmbeddings, VoyageReranker } from './voyage'
import type { RetrievalProvider, VectorStore, ChunkFilter } from './types'
import type { RetrievalHit } from '@pf/shared'

/** Build the retrieval provider for this request. A non-empty Voyage key selects dense
 *  embeddings + reranker; otherwise the lexical fallback (embeddings/reranker null). */
export function getProvider(voyageKey?: string): RetrievalProvider {
  if (voyageKey && voyageKey.trim()) {
    return { name: 'voyage', embeddings: new VoyageEmbeddings(voyageKey), reranker: new VoyageReranker(voyageKey) }
  }
  return { name: 'lexical', embeddings: null, reranker: null }
}

/** The active vector store (Firestore). Swap to placeholder.openSearchStore to migrate. */
export const store: VectorStore = firestoreVectorStore

export interface RetrieveParams {
  query:       string
  topK?:       number      // final results returned to the model (default 8)
  candidateK?: number      // KNN candidates fetched before rerank (default 3× topK)
  filter?:     ChunkFilter
  voyageKey?:  string      // caller passes the resolved server secret (undefined ⇒ lexical)
}

/**
 * Embed the query (dense) or pass the raw text (lexical), fetch candidates from the
 * indexed store, then rerank down to top-k. Returns ONLY the top chunks with their
 * metadata — never the whole collection — which is the input-token reduction over the
 * legacy full-scan tools. Lexical mode skips embed+rerank and ranks by TF-IDF directly.
 */
export async function retrieve(params: RetrieveParams): Promise<RetrievalHit[]> {
  const topK       = params.topK ?? 8
  const candidateK = params.candidateK ?? Math.max(topK * 3, 24)
  const provider   = getProvider(params.voyageKey)

  // Embed the query for the dense path. A Voyage outage must NOT blank grounding — degrade
  // to the lexical store fallback (queryVector=null) rather than throwing.
  let queryVector: number[] | null = null
  if (provider.embeddings) {
    try { queryVector = await provider.embeddings.embedQuery(params.query) }
    catch (e) { console.warn('[retrieval] query embed failed; using lexical fallback:', e instanceof Error ? e.message : e) }
  }

  const candidates = await store.query({
    queryVector,
    queryText: params.query,
    topK:      queryVector ? candidateK : topK,
    filter:    params.filter,
  })
  if (candidates.length === 0) return []

  // Rerank the candidate set down to top-k. On a reranker failure, keep the store's own
  // (distance/lexical) order rather than losing the results.
  if (queryVector && provider.reranker && candidates.length > 1) {
    try {
      const ranked = await provider.reranker.rerank(params.query, candidates.map(c => c.chunk.text), topK)
      if (ranked.length) return ranked.map(r => ({ chunk: candidates[r.index]!.chunk, score: r.score }))
    } catch (e) {
      console.warn('[retrieval] rerank failed; using vector order:', e instanceof Error ? e.message : e)
    }
  }
  return candidates.slice(0, topK)
}

export type { RetrievalProvider, VectorStore, EmbeddingsClient, Reranker, ChunkFilter } from './types'
