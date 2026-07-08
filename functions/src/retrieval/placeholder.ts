// retrieval/placeholder.ts — an alternative retrieval provider, fully un-implemented.
// Mirrors app/src/lib/backend/aws.adapter.placeholder.ts: every method throws
// NotImplemented and carries a comment mapping it to the service that would replace the
// Voyage + Firestore live path. Documents the provider swap; the port interfaces in
// types.ts are the whole contract a real implementation must satisfy.
import type { EmbeddingsClient, Reranker, VectorStore } from './types'

function notImplemented(method: string): never {
  throw new Error(`Alternative retrieval provider: ${method} is not yet implemented.`)
}

// SWAP: Amazon Bedrock Titan Text Embeddings v2 (1024-dim), input_type via the request.
export const bedrockEmbeddings: EmbeddingsClient = {
  model: 'amazon.titan-embed-text-v2:0',
  dim:   1024,
  // SWAP: bedrock-runtime InvokeModel, body { inputText, dimensions, normalize }
  embedDocuments: (_texts) => notImplemented('embeddings.embedDocuments'),
  embedQuery:     (_text)  => notImplemented('embeddings.embedQuery'),
}

// SWAP: Cohere Rerank on Bedrock (cohere.rerank-v3-5:0) or an OpenSearch rerank pipeline.
export const bedrockReranker: Reranker = {
  model:  'cohere.rerank-v3-5:0',
  rerank: (_q, _docs, _n) => notImplemented('reranker.rerank'),
}

// SWAP: OpenSearch Serverless k-NN index (HNSW, cosine). `findNearest` → a knn query;
// `upsert` → _bulk index; `pruneExcept` → delete-by-query; `existingHashes` → a scroll
// over id+contentHash; `count` → the count API.
export const openSearchStore: VectorStore = {
  existingHashes: ()        => notImplemented('store.existingHashes'),
  upsert:         (_r)      => notImplemented('store.upsert'),
  pruneExcept:    (_k)      => notImplemented('store.pruneExcept'),
  count:          ()        => notImplemented('store.count'),
  query:          (_o)      => notImplemented('store.query'),
}
