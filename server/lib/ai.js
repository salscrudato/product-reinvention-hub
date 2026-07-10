'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude).
//
// Replaces the Firebase Cloud Functions AI surface. `chat` is a real grounded,
// cited, streaming answer: it retrieves context from Cosmos (groundingChunks),
// instructs claude-opus-4-8 to cite the [refId]/[form] tags present in that
// context, and streams tokens back in the app's SSE StreamEvent shape.
//
// Foundry is wired from App Service settings (AZURE_FOUNDRY_ENDPOINT/KEY/
// DEPLOYMENT/API_VERSION). Honest 503 if unset; honest {t:'error'} if the model
// call fails (e.g. network/firewall) — never a fabricated answer.

const express = require('express')
const { requireAuth } = require('./auth')

const router = express.Router()
const ENDPOINT = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const KEY = process.env.AZURE_FOUNDRY_KEY
const DEPLOYMENT = process.env.AZURE_FOUNDRY_DEPLOYMENT || 'claude-opus-4-8'
const API_VERSION = process.env.AZURE_FOUNDRY_API_VERSION || '2024-05-01-preview'
const configured = Boolean(ENDPOINT && KEY)
const CHAT_URL = `${ENDPOINT}/models/chat/completions?api-version=${API_VERSION}`

console.log(`[prodhub-host] AI configured=${configured} deployment=${DEPLOYMENT}`)

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
  'Every substantive claim MUST cite its source using the bracketed reference tags that appear in the context, e.g. [PH.PROD.001], [PH.COV.003], or a form number tag. Do not fabricate reference tags.',
].join(' ')

// Lexical grounding over the migrated groundingChunks (dense vectors are a later add).
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
      .map((r) => {
        const text = String(r.data?.text || '')
        const lc = text.toLowerCase()
        const score = terms.reduce((s, t) => s + (lc.includes(t) ? 1 : 0), 0)
        return { text, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.text)
  } catch (e) {
    console.warn('[ai] grounding failed:', e.message)
    return []
  }
}

router.post('/:name', requireAuth, async (req, res) => {
  const name = req.params.name
  if (!configured) {
    return res.status(503).json({ error: 'ai_not_configured', detail: 'Set AZURE_FOUNDRY_ENDPOINT/KEY in App Service settings.', name })
  }
  if (name !== 'chat') {
    // Other handlers (analyzeClaim, extractCoverages, …) port next; don't fake them.
    return res.status(501).json({ error: 'ai_handler_not_ported', name })
  }

  // ── grounded streaming chat ────────────────────────────────────────────────
  const body = req.body || {}
  const msgs = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  sse(res)
  try {
    const ctx = await grounding(lastUser, body.productId)
    const system = `${SYSTEM}\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}`
    const upstream = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': KEY },
      body: JSON.stringify({
        model: DEPLOYMENT,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'system', content: system }, ...msgs.map((m) => ({ role: m.role, content: m.content }))],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => '')).slice(0, 300)
      emit(res, { t: 'error', message: `Foundry ${upstream.status}: ${detail || 'unreachable'}` })
      emit(res, { t: 'done' })
      return res.end()
    }
    // Parse OpenAI-style SSE: data: {choices:[{delta:{content}}]} … data: [DONE]
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
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const delta = j.choices?.[0]?.delta?.content
          if (delta) emit(res, { t: 'token', v: delta })
        } catch { /* keep-alive / non-JSON line */ }
      }
    }
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 200)}` })
    emit(res, { t: 'done' })
    res.end()
  }
})

module.exports = router
