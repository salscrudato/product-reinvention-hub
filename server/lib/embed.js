'use strict'
// embed.js — dense embedding vectors for RAG grounding, via Azure AI Foundry's
// OpenAI-native embeddings surface (text-embedding-3-small, the EMBED fleet role).
//
// Vectors are requested at 512 dimensions (the `dimensions` param — text-embedding-3-small
// supports Matryoshka truncation) and stored int8-quantized on each grounding chunk, so a
// chunk's vector costs ~0.5KB in Cosmos instead of ~8KB of float64 JSON. Cosine similarity is
// scale-invariant, so int8 values rank identically to the float originals (see retrieve.ts).
//
// Every function here is BEST-EFFORT: any failure (AI unconfigured, budget ceiling, upstream
// error, timeout) returns null so the caller silently falls back to lexical ranking. Embeddings
// are a retrieval-quality enhancement, never a correctness dependency — a chat answer is still
// grounded and cited (or an honest "not found") without them.

const fleet = require('./fleet')

// Lazy-load the shared int8 quantizer (built by `pnpm build:retrieve`). Absent bundle → no
// quantization (vectors simply aren't stored; lexical fallback still works).
let _retrieve = null
function retrieve() {
  if (!_retrieve) { try { _retrieve = require('./retrieve-shared.cjs') } catch { _retrieve = {} } }
  return _retrieve
}

const EMBED_DEPLOYMENT = process.env.AZURE_FOUNDRY_EMBED_DEPLOYMENT || fleet.DEPLOY_EMBED || 'text-embedding-3-small'
const EMBED_DIMS       = Number(process.env.AZURE_FOUNDRY_EMBED_DIMS) || 512
const MAX_BATCH        = 96    // one request embeds up to this many texts (latency/robustness cap)
const MAX_CHARS        = 8000  // truncate very long chunk text before embedding (token budget guard)

/** Embed an array of texts → array of float vectors (same order), or null on any failure.
 *  Splits into ≤ MAX_BATCH requests. All-or-nothing: if any sub-batch fails the whole call
 *  returns null, so we never produce a corpus where only some chunks are dense-rankable
 *  (which would make hybrid scores incomparable across chunks). */
async function embedBatch(texts, { timeoutMs = 20_000 } = {}) {
  if (!fleet.isConfigured()) return null
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').slice(0, MAX_CHARS))
  if (list.length === 0) return null
  const g = fleet.guard()
  if (!g.allow) return null // budget ceiling reached — skip embeds; lexical fallback still answers
  try {
    const out = new Array(list.length)
    for (let i = 0; i < list.length; i += MAX_BATCH) {
      const slice = list.slice(i, i + MAX_BATCH)
      const upstream = await fetch(fleet.openaiEmbeddingsUrl(), {
        method: 'POST',
        headers: fleet.openaiHeaders(),
        body: JSON.stringify({ model: EMBED_DEPLOYMENT, input: slice, dimensions: EMBED_DIMS }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!upstream.ok) { console.warn(`[embed] Foundry ${upstream.status}`); return null }
      const json = await upstream.json()
      // Embeddings bill input tokens only; record so the shared spend guard reflects real cost.
      fleet.record(EMBED_DEPLOYMENT, json.usage?.total_tokens || json.usage?.prompt_tokens || 0, 0)
      for (const d of (json.data || [])) {
        const v = Array.isArray(d.embedding) ? d.embedding : null
        if (!v) return null
        out[i + (typeof d.index === 'number' ? d.index : 0)] = v
      }
    }
    return out.every(Boolean) ? out : null
  } catch (e) { console.warn('[embed] failed:', e.message); return null }
}

/** Embed a single text → float vector, or null on failure. */
async function embedOne(text, opts) {
  const r = await embedBatch([text], opts)
  return r ? r[0] : null
}

/** Int8-quantize a float vector for compact Cosmos storage → { q: number[], s: number }
 *  (quantized values + scale). Cosine over `q` alone is correct because cosine is
 *  scale-invariant; `s` is kept so the vector can be dequantized for exact cosine if needed.
 *  Returns null when the vector is empty or the quantizer bundle is unavailable. */
function quantize(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null
  const { quantizeInt8 } = retrieve()
  if (!quantizeInt8) return null
  const { values, scale } = quantizeInt8(vec)
  return { q: values, s: scale }
}

module.exports = { embedBatch, embedOne, quantize, EMBED_DIMS, EMBED_DEPLOYMENT }
