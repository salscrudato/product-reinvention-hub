// retrieval/voyage.ts — the live embeddings + reranker provider (Voyage AI).
//
// Voyage is Anthropic's recommended embeddings partner (owned by MongoDB). This client
// reads VOYAGE_API_KEY exactly like the Anthropic client reads ANTHROPIC_API_KEY: the
// secret is passed in from the bound `defineSecret` INSIDE the handler and used only
// here — it is NEVER a VITE_* var, never sent to the browser, never logged. All calls
// are server-side (Cloud Functions) over HTTPS with an explicit per-request timeout.
//
// Models (override via env; verify current names/prices at docs.voyageai.com):
//   • embeddings — voyage-3.5-lite, 1024-dim, input_type document|query. voyage-context-3
//     (contextualized) is the drop-in upgrade: same wire shape on /v1/embeddings for the
//     lite model; route to /v1/contextualizedembeddings + per-product grouping to enable
//     neighbour-conditioned chunk vectors. int8 output halves storage further (pair with
//     shared quantizeInt8 on the query side); we store float for exact findNearest cosine.
//   • rerank    — rerank-2.5-lite over the KNN candidate set.
import type { EmbeddingsClient, Reranker } from './types'

const VOYAGE_BASE   = 'https://api.voyageai.com/v1'
const EMBED_MODEL   = process.env['VOYAGE_EMBED_MODEL']  ?? 'voyage-3.5-lite'
const RERANK_MODEL  = process.env['VOYAGE_RERANK_MODEL'] ?? 'rerank-2.5-lite'
const EMBED_DIM     = Number(process.env['VOYAGE_EMBED_DIM'] ?? 1024)
const TIMEOUT_MS    = 30_000

async function voyageFetch(apiKey: string, path: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${VOYAGE_BASE}${path}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    })
    if (!res.ok) {
      // Surface status only — never echo the body (it can restate the request/key context).
      throw new Error(`Voyage ${path} failed: HTTP ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Voyage embeddings over the standard /v1/embeddings endpoint. */
export class VoyageEmbeddings implements EmbeddingsClient {
  readonly model = EMBED_MODEL
  readonly dim   = EMBED_DIM
  constructor(private readonly apiKey: string) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const json = await voyageFetch(this.apiKey, '/embeddings', {
      model: this.model, input: texts, input_type: 'document', output_dimension: this.dim,
    }) as { data?: { index: number; embedding: number[] }[] }
    const data = json.data ?? []
    // Re-order by the returned index so vectors stay aligned to the input array.
    const out: number[][] = new Array(texts.length)
    for (const d of data) out[d.index] = d.embedding
    return out
  }

  async embedQuery(text: string): Promise<number[]> {
    const json = await voyageFetch(this.apiKey, '/embeddings', {
      model: this.model, input: [text], input_type: 'query', output_dimension: this.dim,
    }) as { data?: { embedding: number[] }[] }
    return json.data?.[0]?.embedding ?? []
  }
}

/** Voyage reranker over the /v1/rerank endpoint. */
export class VoyageReranker implements Reranker {
  readonly model = RERANK_MODEL
  constructor(private readonly apiKey: string) {}

  async rerank(query: string, docs: string[], topN: number): Promise<{ index: number; score: number }[]> {
    if (docs.length === 0) return []
    const json = await voyageFetch(this.apiKey, '/rerank', {
      model: this.model, query, documents: docs, top_k: Math.min(topN, docs.length),
    }) as { data?: { index: number; relevance_score: number }[] }
    return (json.data ?? []).map(d => ({ index: d.index, score: d.relevance_score }))
  }
}
