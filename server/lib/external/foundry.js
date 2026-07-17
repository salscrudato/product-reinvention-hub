'use strict'
// external/foundry.js — ready-to-use callers for the EXTENDED Foundry deployments
// (deep reasoning, verify panel, quality embeddings, rerank, document OCR).
//
// Same resource + key as the core fleet; deployment names resolve through
// fleet.EXTENDED_DEPLOYMENTS (single source: shared/src/ai/fleet.ts). Every call
// goes through the fleet cost guard (guard → dispatch → record) like all other AI.
// Core chat/embed roles stay on server/lib/fleet.js — this module is ONLY the
// specialty surfaces the core router doesn't speak.
//
// All functions throw on non-2xx with a compact error; callers own retries.

const fleet = require('../fleet')

const EXT = fleet.EXTENDED_DEPLOYMENTS

/** Shared dispatch: guard → fetch → record. `estTokens` covers non-token-billed
 *  surfaces (rerank/OCR) so the spend window still moves; token surfaces pass real usage. */
async function dispatch(url, headers, body, deploymentName, usageOf) {
  const g = fleet.guard()
  if (!g.allow) { const e = new Error('ai_budget_ceiling'); e.status = 503; throw e }
  // Bound every outbound AI call so a hung Foundry socket can't wedge the request (F16).
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  if (!res.ok) { const e = new Error(`foundry_${res.status}: ${text.slice(0, 300)}`); e.status = res.status; throw e }
  const json = JSON.parse(text)
  const { input, output } = usageOf(json)
  fleet.record(deploymentName, input, output)
  return json
}

/** Deep-escalation reasoning (gpt-5.4-pro). Uses the /responses API — this deployment
 *  REJECTS chat/completions (probe-verified 400). Returns { text, raw }.
 *  @param {string} input                 - The prompt (plain string).
 *  @param {object} [opts]
 *  @param {number} [opts.maxOutputTokens=4096] */
async function deepReason(input, opts = {}) {
  const dep = EXT.DEEP_REASONER.deploymentName
  const body = { model: dep, input, max_output_tokens: opts.maxOutputTokens ?? 4096 }
  const json = await dispatch(fleet.openaiResponsesUrl(), fleet.openaiHeaders(), body, dep,
    j => ({ input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0 }))
  const text = (json.output || [])
    .flatMap(o => o.content || [])
    .filter(c => c.type === 'output_text')
    .map(c => c.text).join('')
  return { text, raw: json }
}

/** One verify-panel judge call (cross-vendor lineage: 'xai' → grok-4.3, 'deepseek' →
 *  DeepSeek-V4-Pro). Standard chat surface. Returns { text, raw }.
 *  @param {'xai'|'deepseek'} lineage
 *  @param {Array} messages  - OpenAI-format messages
 *  @param {object} [opts]
 *  @param {number} [opts.maxTokens=2048] */
async function verifyJudge(lineage, messages, opts = {}) {
  const dep = (lineage === 'deepseek' ? EXT.VERIFY_DEEPSEEK : EXT.VERIFY_XAI).deploymentName
  const body = { model: dep, messages, max_completion_tokens: opts.maxTokens ?? 2048 }
  const json = await dispatch(fleet.openaiChatUrl(), fleet.openaiHeaders(), body, dep,
    j => ({ input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 }))
  return { text: json.choices?.[0]?.message?.content ?? '', raw: json }
}

/** Quality (query-time) embeddings — text-embedding-3-large. Bulk write-time embedding
 *  stays on the core EMBED role. Returns number[][] aligned to `inputs`.
 *  @param {string[]} inputs */
async function embedQuality(inputs) {
  const dep = EXT.EMBED_QUALITY.deploymentName
  const json = await dispatch(fleet.openaiEmbeddingsUrl(), fleet.openaiHeaders(), { model: dep, input: inputs }, dep,
    j => ({ input: j.usage?.prompt_tokens || 0, output: 0 }))
  return json.data.map(d => d.embedding)
}

/** Cross-encoder rerank (Cohere v4 pro) over retrieval candidates. Returns
 *  [{ index, score, document }] sorted best-first — `index` refers into `documents`.
 *  Billed per-search, not per-token: recorded as a nominal 1k-token charge.
 *  @param {string}   query
 *  @param {string[]} documents
 *  @param {object}   [opts]
 *  @param {number}   [opts.topN=documents.length] */
async function rerank(query, documents, opts = {}) {
  const dep = EXT.RERANK.deploymentName
  const body = { model: dep, query, documents, top_n: opts.topN ?? documents.length }
  const json = await dispatch(fleet.cohereRerankUrl(), fleet.openaiHeaders(), body, dep,
    () => ({ input: 1000, output: 0 }))
  return (json.results || []).map(r => ({ index: r.index, score: r.relevance_score, document: documents[r.index] }))
}

/** Document OCR (Mistral Document AI) → markdown per page, with NATIVE <table> markup —
 *  the structured-table feed for the import parser (fixes 0-char PDF extraction).
 *  Pass exactly one of documentUrl (https or data: URL of a PDF) or imageDataUrl.
 *  Billed per-page: recorded as a nominal 1k tokens/page.
 *  @param {object} src - { documentUrl } | { imageDataUrl }
 *  @returns {Promise<{ pages: Array<{ index:number, markdown:string }>, raw:object }>} */
async function documentOcr(src) {
  const dep = EXT.DOC_OCR.deploymentName
  const document = src.documentUrl
    ? { type: 'document_url', document_url: src.documentUrl }
    : { type: 'image_url', image_url: src.imageDataUrl }
  const json = await dispatch(fleet.mistralOcrUrl(), fleet.openaiHeaders(), { model: dep, document }, dep,
    j => ({ input: 1000 * Math.max(1, (j.pages || []).length), output: 0 }))
  return { pages: (json.pages || []).map(p => ({ index: p.index, markdown: p.markdown })), raw: json }
}

module.exports = { deepReason, verifyJudge, embedQuality, rerank, documentOcr }
