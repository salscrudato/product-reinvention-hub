'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude).
//
// `chat` streams a real grounded, cited answer from the Foundry claude-opus-4-8
// deployment. Foundry serves Claude on the ANTHROPIC-NATIVE surface:
//   POST {resource}.services.ai.azure.com/anthropic/v1/messages
//   headers: x-api-key: <key>, anthropic-version: 2023-06-01   (NO api-version query)
// (per Microsoft Learn "Deploy and use Claude models in Microsoft Foundry").
// So we speak the Anthropic Messages API directly and parse its SSE stream.
//
// Grounding: lexical context from Cosmos groundingChunks; the model is told to
// cite the [refId]/[form] tags present in that context. Honest 503 if unset;
// honest {t:'error'} (never a fabricated answer) on failure.

const express = require('express')
const { requireAuth } = require('./auth')

const router = express.Router()
const SVC = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const KEY = process.env.AZURE_FOUNDRY_KEY
const DEPLOYMENT = process.env.AZURE_FOUNDRY_DEPLOYMENT || 'claude-opus-4-8'
const ANTHROPIC_VERSION = process.env.AZURE_FOUNDRY_ANTHROPIC_VERSION || '2023-06-01'
const configured = Boolean(SVC && KEY)
const MESSAGES_URL = `${SVC}/anthropic/v1/messages`

console.log(`[prodhub-host] AI configured=${configured} url=${MESSAGES_URL} deployment=${DEPLOYMENT}`)

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
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }))
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  sse(res)
  try {
    const ctx = await grounding(lastUser, body.productId)
    const system = `${SYSTEM}\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}`
    const upstream = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({ model: DEPLOYMENT, max_tokens: 1024, system, stream: true, messages: msgs.length ? msgs : [{ role: 'user', content: 'Hello' }] }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      emit(res, { t: 'error', message: `Foundry ${upstream.status}: ${detail}` })
      emit(res, { t: 'done' }); return res.end()
    }
    // Anthropic Messages SSE: data lines carry {type:'content_block_delta', delta:{type:'text_delta', text}}.
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) emit(res, { t: 'token', v: j.delta.text })
          else if (j.type === 'error') emit(res, { t: 'error', message: j.error?.message || 'stream error' })
        } catch { /* keep-alive / partial */ }
      }
    }
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
})

module.exports = router
