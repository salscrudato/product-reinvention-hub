'use strict'
const fleet      = require('../fleet')
const dataRouter = require('../data')
const { fetchWithRetry } = require('./_shared')

const HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT || ''

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
      overview: { type: 'string', description: '2-3 plain-English sentences describing what this product is and who it serves, grounded in the metadata.' },
      highlights: {
        type: 'array', description: '3-5 at-a-glance facts as label/value tiles (e.g. Coverages: 10; Footprint: 15 states; Rating: 11 steps).',
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

function groundSummary(raw, product) {
  const coverages = Array.isArray(product?.coverages) ? product.coverages : (Array.isArray(product) ? product : [])
  const known = coverages.map((c) => norm(c && c.name)).filter(Boolean)
  const footprintCount = Array.isArray(product?.footprint) ? product.footprint.length : null

  const coverageHighlights = (Array.isArray(raw.coverageHighlights) ? raw.coverageHighlights : [])
    .filter((h) => { const n = norm(h?.name); return !!n && known.some((k) => k.includes(n) || n.includes(k)) })

  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : []).map((h) => {
    if (!h?.label || !h?.value || footprintCount === null) return h
    if (/states?/i.test(String(h.label))) {
      const m = /^(\d+)/.exec(String(h.value).trim())
      if (m && parseInt(m[1]) !== footprintCount) return { ...h, value: `${footprintCount} states` }
    }
    return h
  })

  return { ...raw, coverageHighlights, highlights }
}

async function persistSummary(tenantId, productId, data, actor) {
  try {
    await dataRouter.mutateInternal(
      tenantId,
      { op: 'update', path: `productSummaries/${productId}`, data, entityType: 'productSummary' },
      actor,
      '/api/ai/summarizeProduct',
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
    const upstream = await fetchWithRetry(fleet.anthropicMessagesUrl(), {
      method: 'POST',
      headers: fleet.anthropicHeaders(),
      body: JSON.stringify({
        model: deployment,
        max_tokens: 4096,
        system: [{ type: 'text', text: SUMMARY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'product_summary' },
        messages: [{ role: 'user', content: `PRODUCT METADATA (JSON):\n\n${JSON.stringify(p)}\n\nSummarize this product, then call product_summary.` }],
      }),
    }, { timeoutMs: 60_000 })
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      return res.status(502).json({ error: 'ai_upstream', message: `Foundry ${upstream.status}: ${detail}` })
    }
    const json = await upstream.json()
    fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
    require('../metering').meterCurrent(deployment, json.usage?.input_tokens, json.usage?.output_tokens) // per-tenant attribution (ALS)

    const tu = Array.isArray(json.content) ? json.content.find((b) => b.type === 'tool_use') : null
    const summary = groundSummary((tu && tu.input) || {}, p)

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

module.exports = { summarizeProduct }
