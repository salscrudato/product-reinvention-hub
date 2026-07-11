'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude/GPT).
//
// Model routing + cost guard live in ./fleet.js (single source of deployment names =
// shared/src/ai/fleet.ts). NO deployment string is hardcoded here. Every call is gated by the
// fleet cost guard before dispatch and its token usage recorded after.
//   • chat             → GROUNDED_CITED (claude-opus-4-8), streamed, grounded + cited
//   • summarizeProduct → BULK_VERIFY   (claude-haiku-4-5), forced-tool structured summary
//
// Foundry serves Claude on the ANTHROPIC-NATIVE surface (POST /anthropic/v1/messages, headers
// x-api-key + anthropic-version). We speak the Anthropic Messages API directly. Honest 503 if AI
// is unconfigured or the budget ceiling is hit; honest {t:'error'} (never a fabricated answer) on
// failure.

const express = require('express')
const { requireRole, requireTenant } = require('./auth')
const fleet = require('./fleet')
const dataRouter = require('./data')

const router = express.Router()
// Ops escape hatches: explicit deployment overrides win over the fleet defaults.
// Set AZURE_FOUNDRY_DEPLOYMENT (chat) or AZURE_FOUNDRY_HAIKU_DEPLOYMENT (summarizeProduct)
// in App Service configuration when the Foundry deployment name differs from the fleet default.
const CHAT_OVERRIDE  = process.env.AZURE_FOUNDRY_DEPLOYMENT        || ''
const HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT  || ''

console.log(`[prodhub-host] AI configured=${fleet.isConfigured()}`)

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

async function grounding(query, productId, tenantId) {
  try {
    const { docs } = require('./cosmos')
    const params = [{ name: '@tid', value: tenantId }]
    let sql = "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.tenantId=@tid"
    if (productId) { sql += ' AND c.data.productId=@pid'; params.push({ name: '@pid', value: productId }) }
    const { resources } = await docs.items.query({ query: sql, parameters: params }, { maxItemCount: 500 }).fetchAll()
    const terms = String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    return resources
      .map((r) => { const text = String(r.data?.text || ''); const lc = text.toLowerCase(); return { text, score: terms.reduce((s, t) => s + (lc.includes(t) ? 1 : 0), 0) } })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.text)
  } catch (e) { console.warn('[ai] grounding failed:', e.message); return [] }
}

// ─── summarizeProduct: grounded, forced-tool structured product summary ───────────
// Cheap/fast (BULK_VERIFY / Haiku). Built ONLY from the client-supplied STRUCTURED metadata —
// never a form PDF — and the tool schema fixes the output shape so the result can only describe
// what the metadata contains. Ungrounded coverage names are dropped. Best-effort persisted to
// Cosmos productSummaries/{id} so the Overview tab hydrates instantly next visit; a persist
// failure never fails the request.
const SUMMARY_TOOL = {
  name: 'product_summary',
  description:
    'Return a concise, executive product summary built ONLY from the metadata provided. Never ' +
    'invent coverages, forms, limits, states or rules that are not in the input. If the metadata ' +
    'is thin, keep the summary short rather than padding it.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One crisp positioning line, e.g. "An ISO-style HO-3 open-peril homeowners product across 15 states."' },
      overview: { type: 'string', description: '2–3 plain-English sentences describing what this product is and who it serves, grounded in the metadata.' },
      highlights: {
        type: 'array', description: '3–5 at-a-glance facts as label/value tiles (e.g. Coverages: 10; Footprint: 15 states; Rating: 11 steps).',
        items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] },
      },
      coverageHighlights: {
        type: 'array', description: 'The most important coverages, each with a one-line plain-English note. Only coverages present in the metadata.',
        items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' } }, required: ['name', 'note'] },
      },
      considerations: { type: 'array', description: 'Notable rules, constraints or gaps a product manager should know, drawn from the metadata. Empty if none.', items: { type: 'string' } },
    },
    required: ['headline', 'overview', 'highlights', 'coverageHighlights'],
  },
}

const SUMMARY_SYSTEM =
  'You are a P&C insurance product analyst. Summarize a product for its product manager using ONLY ' +
  'the structured metadata provided. When a `baseForm` is present, treat it as the coverage form the ' +
  'product is built on — ground the headline/overview in it and cite its form number (e.g. "Built on ' +
  'HO 00 03"). Be concise, concrete and executive in tone. Never invent facts. Then call product_summary once.'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// Drop any coverageHighlight whose name doesn't correspond to a real metadata coverage, so an
// invented coverage never reaches the dashboard (tolerant containment match, ignoring case/punct).
function groundSummary(raw, coverages) {
  const known = (coverages || []).map((c) => norm(c && c.name)).filter(Boolean)
  const highlights = Array.isArray(raw.coverageHighlights) ? raw.coverageHighlights : []
  const grounded = highlights.filter((h) => {
    const n = norm(h && h.name)
    return !!n && known.some((k) => k.includes(n) || n.includes(k))
  })
  return { ...raw, coverageHighlights: grounded }
}

async function persistSummary(tenantId, productId, data, actor) {
  // Route through the atomic envelope so audit + version + searchIndex are written
  // and rev is properly incremented on each re-summary. Non-fatal: a persist failure
  // never fails the summarizeProduct request.
  try {
    await dataRouter.mutateInternal(
      tenantId,
      { op: 'update', path: `productSummaries/${productId}`, data, entityType: 'productSummary' },
      actor,
    )
  } catch (e) {
    console.warn('[ai] summarizeProduct persist failed (non-fatal):', e.message)
  }
}

async function summarizeProduct(req, res) {
  const body = req.body || {}
  const p = body.product
  if (!p || !p.name) return res.status(400).json({ error: 'no_product_metadata' })

  const g = fleet.guard()
  if (!g.allow) return res.status(503).json({ error: 'ai_budget_ceiling', message: 'AI is temporarily limited — the budget ceiling has been reached.' })
  const deployment = HAIKU_OVERRIDE || fleet.resolveModel('BULK_VERIFY', g.degrade)

  try {
    const upstream = await fetch(fleet.anthropicMessagesUrl(), {
      method: 'POST',
      headers: fleet.anthropicHeaders(),
      body: JSON.stringify({
        model: deployment,
        max_tokens: 1200,
        system: SUMMARY_SYSTEM,
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'product_summary' },
        messages: [{ role: 'user', content: `PRODUCT METADATA (JSON):\n\n${JSON.stringify(p)}\n\nSummarize this product, then call product_summary.` }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      return res.status(502).json({ error: 'ai_upstream', message: `Foundry ${upstream.status}: ${detail}` })
    }
    const json = await upstream.json()
    fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)

    const tu = Array.isArray(json.content) ? json.content.find((b) => b.type === 'tool_use') : null
    const summary = groundSummary((tu && tu.input) || {}, p.coverages)

    const now = new Date().toISOString()
    const stored = {
      id: body.productId || null,
      ...summary,
      productName: p.name,
      basisFormNumber: (p.baseForm && p.baseForm.number) || null,
      metaHash: body.metaHash || null,
      model: deployment,
      generatedAt: now,
      generatedBy: req.user.uid,
      stale: false,
    }
    if (body.productId) await persistSummary(req.user.tenantId, body.productId, stored, { uid: req.user.uid, name: req.user.name })
    return res.json(stored)
  } catch (err) {
    return res.status(500).json({ error: 'ai_error', message: String((err && err.message) || err).slice(0, 220) })
  }
}

// ─── chat: streamed, grounded, cited portfolio copilot ────────────────────────────
async function chat(req, res) {
  const body = req.body || {}
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }))
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  sse(res)

  const g = fleet.guard()
  if (!g.allow) {
    emit(res, { t: 'error', message: 'AI is temporarily limited — the budget ceiling has been reached. Please try again shortly.' })
    emit(res, { t: 'done' }); return res.end()
  }
  const deployment = CHAT_OVERRIDE || fleet.resolveModel('GROUNDED_CITED', g.degrade)

  try {
    const ctx = await grounding(lastUser, body.productId, req.user.tenantId)
    const system = `${SYSTEM}\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}`
    const upstream = await fetch(fleet.anthropicMessagesUrl(), {
      method: 'POST',
      headers: fleet.anthropicHeaders(),
      body: JSON.stringify({ model: deployment, max_tokens: 1024, system, stream: true, messages: msgs.length ? msgs : [{ role: 'user', content: 'Hello' }] }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      emit(res, { t: 'error', message: `Foundry ${upstream.status}: ${detail}` })
      emit(res, { t: 'done' }); return res.end()
    }
    // Anthropic Messages SSE: content_block_delta carries text; message_start/message_delta carry
    // token usage — captured so the cost guard records real spend for this streamed call.
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let inputTokens = 0
    let outputTokens = 0
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
          else if (j.type === 'message_start') { inputTokens = j.message?.usage?.input_tokens || 0; outputTokens = j.message?.usage?.output_tokens || 0 }
          else if (j.type === 'message_delta' && j.usage?.output_tokens != null) outputTokens = j.usage.output_tokens
          else if (j.type === 'error') emit(res, { t: 'error', message: j.error?.message || 'stream error' })
        } catch { /* keep-alive / partial */ }
      }
    }
    fleet.record(deployment, inputTokens, outputTokens)
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

router.post('/:name', requireRole('ANALYST'), requireTenant, async (req, res) => {
  const name = req.params.name
  if (!fleet.isConfigured()) return res.status(503).json({ error: 'ai_not_configured', name })
  if (name === 'chat') return chat(req, res)
  if (name === 'summarizeProduct') return summarizeProduct(req, res)
  return res.status(501).json({ error: 'ai_handler_not_ported', name })
})

module.exports = router
