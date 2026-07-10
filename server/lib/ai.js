'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude).
//
// `chat` is a real grounded, cited answer: it retrieves context from Cosmos
// (groundingChunks), instructs claude-opus-4-8 to cite the [refId]/[form] tags
// present in that context, calls the Foundry deployment, and streams the answer
// back in the app's SSE StreamEvent shape.
//
// Foundry exposes Claude over more than one route depending on how the resource
// is provisioned, so the handler tries the known routes in order and uses the
// first that answers (result cached per process). Honest 503 if unconfigured;
// honest {t:'error'} if every route fails — never a fabricated answer.

const express = require('express')
const { requireAuth } = require('./auth')

const router = express.Router()
const SVC = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const OPENAI = SVC.replace('.services.ai.azure.com', '.openai.azure.com')
const COG = SVC.replace('.services.ai.azure.com', '.cognitiveservices.azure.com')
const KEY = process.env.AZURE_FOUNDRY_KEY
const DEPLOYMENT = process.env.AZURE_FOUNDRY_DEPLOYMENT || 'claude-opus-4-8'
const API_VERSION = process.env.AZURE_FOUNDRY_API_VERSION || '2024-08-01-preview'
const configured = Boolean(SVC && KEY)

// Candidate routes, tried in order. `kind` selects request/response shape.
function candidates(system, messages) {
  const anthropicBody = { model: DEPLOYMENT, max_tokens: 1024, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) }
  const openaiBody = { model: DEPLOYMENT, max_tokens: 1024, messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))] }
  return [
    { kind: 'anthropic', url: `${COG}/anthropic/v1/messages?api-version=2023-06-01`, headers: { 'api-key': KEY, 'anthropic-version': '2023-06-01' }, body: anthropicBody },
    { kind: 'anthropic', url: `${SVC}/anthropic/v1/messages`, headers: { 'api-key': KEY, 'anthropic-version': '2023-06-01' }, body: anthropicBody },
    { kind: 'openai', url: `${OPENAI}/openai/v1/chat/completions`, headers: { 'api-key': KEY }, body: openaiBody },
    { kind: 'openai', url: `${COG}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=2024-10-21`, headers: { 'api-key': KEY }, body: { messages: openaiBody.messages, max_tokens: 1024 } },
    { kind: 'openai', url: `${SVC}/models/chat/completions?api-version=${API_VERSION}`, headers: { 'api-key': KEY }, body: openaiBody },
  ]
}
let cachedUrl = null // the first route that worked this process — tried first next time

async function callFoundry(system, messages) {
  const cands = candidates(system, messages)
  const order = cachedUrl ? [...cands].filter((c) => c.url === cachedUrl).concat(cands.filter((c) => c.url !== cachedUrl)) : cands
  const errs = []
  const host = (u) => u.replace('https://foundry-prodhub-dev', '').split('?')[0]
  for (const c of order) {
    try {
      const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...c.headers }, body: JSON.stringify(c.body), signal: AbortSignal.timeout(120_000) })
      if (!r.ok) { errs.push(`${host(c.url)}=${r.status}:${(await r.text()).replace(/\s+/g, ' ').slice(0, 90)}`); continue }
      const j = await r.json()
      const text = c.kind === 'anthropic'
        ? (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
        : (j.choices?.[0]?.message?.content || '')
      if (text) { cachedUrl = c.url; return text }
      errs.push(`${host(c.url)}=200-empty`)
    } catch (e) { errs.push(`${host(c.url)}=ERR:${String(e.message || e).slice(0, 60)}`) }
  }
  throw new Error(errs.join(' || '))
}

function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
}
const emit = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`)

const SYSTEM = [
  'You are the Product Hub portfolio copilot for P&C insurance.',
  'Answer ONLY from the CONTEXT provided below. If the context is insufficient, say so plainly — never invent facts, coverages, forms, or numbers.',
  'Every substantive claim MUST cite its source using the bracketed reference tags that appear in the context, e.g. [PH.PROD.001] or a form-number tag. Do not fabricate reference tags.',
].join(' ')

async function grounding(query, productId) {
  try {
    const { docs } = require('./cosmos')
    const sql = productId
      ? "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.data.productId=@pid"
      : "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks'"
    const params = productId ? [{ name: '@pid', value: productId }] : []
    const { resources } = await docs.items.query({ query: sql, parameters: params }, { maxItemCount: 500 }).fetchAll()
    const terms = String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    return resources
      .map((r) => { const text = String(r.data?.text || ''); const lc = text.toLowerCase(); return { text, score: terms.reduce((s, t) => s + (lc.includes(t) ? 1 : 0), 0) } })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.text)
  } catch (e) { console.warn('[ai] grounding failed:', e.message); return [] }
}

router.post('/:name', requireAuth, async (req, res) => {
  const name = req.params.name
  if (!configured) return res.status(503).json({ error: 'ai_not_configured', name })
  if (name !== 'chat') return res.status(501).json({ error: 'ai_handler_not_ported', name })

  const body = req.body || {}
  const msgs = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  sse(res)
  try {
    const ctx = await grounding(lastUser, body.productId)
    const system = `${SYSTEM}\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}`
    const text = await callFoundry(system, msgs)
    // Emit in sentence-ish chunks so the UI renders progressively.
    for (const part of text.match(/[^.!?]+[.!?]*\s*/g) || [text]) emit(res, { t: 'token', v: part })
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 260)}` })
    emit(res, { t: 'done' })
    res.end()
  }
})

module.exports = router
