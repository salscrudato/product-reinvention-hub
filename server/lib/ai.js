'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude/GPT).
//
// Model routing + cost guard live in ./fleet.js (single source of deployment names =
// shared/src/ai/fleet.ts). NO deployment string is hardcoded here. Every call is gated by the
// fleet cost guard before dispatch and its token usage recorded after.
//   • chat             → GROUNDED_CITED (claude-opus-4-8), streamed, grounded + cited
//   • summarizeProduct → BULK_VERIFY   (claude-haiku-4-5), forced-tool structured summary
//   • unifiedImport    → BULK_VERIFY   (claude-haiku-4-5), forced-tool coverage extraction from filing PDF
//
// Foundry serves Claude on the ANTHROPIC-NATIVE surface (POST /anthropic/v1/messages, headers
// x-api-key + anthropic-version). We speak the Anthropic Messages API directly. Honest 503 if AI
// is unconfigured or the budget ceiling is hit; honest {t:'error'} (never a fabricated answer) on
// failure.

const express = require('express')
const { requireRole, requireTenant, RANK } = require('./auth')
const fleet = require('./fleet')
const dataRouter = require('./data')
const fs   = require('fs')
const path = require('path')
const { inflateSync, inflateRawSync } = require('zlib')

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

// Cap on groundingChunks loaded per chat call — keeps heap bounded regardless of corpus size.
const GROUNDING_CAP = 200

async function grounding(query, productId, tenantId) {
  try {
    const { docs } = require('./cosmos')
    const params = [{ name: '@tid', value: tenantId }]
    // TOP cap is a server constant, not user-supplied → no injection risk.
    let sql = `SELECT TOP ${GROUNDING_CAP} c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.tenantId=@tid`
    if (productId) { sql += ' AND c.data.productId=@pid'; params.push({ name: '@pid', value: productId }) }
    const { resources } = await docs.items.query({ query: sql, parameters: params }, { maxItemCount: GROUNDING_CAP }).fetchAll()
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

// Validate raw summary output against product metadata.
// Drops invented coverage highlights; corrects a fabricated state-count in
// highlights tiles; leaves headline/overview as prose (too hard to validate reliably).
function groundSummary(raw, product) {
  const coverages = Array.isArray(product?.coverages) ? product.coverages : (Array.isArray(product) ? product : [])
  const known = coverages.map((c) => norm(c && c.name)).filter(Boolean)
  const footprintCount = Array.isArray(product?.footprint) ? product.footprint.length : null

  // Drop coverageHighlights that don't match a real coverage name (existing guard).
  const coverageHighlights = (Array.isArray(raw.coverageHighlights) ? raw.coverageHighlights : [])
    .filter((h) => { const n = norm(h?.name); return !!n && known.some((k) => k.includes(n) || n.includes(k)) })

  // Correct a highlights tile whose label is state-related but value disagrees with footprint.
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

// ─── PDF text extraction (ported from functions/src/pdfText.ts) ──────────────
// Parses FlateDecode PDF streams and extracts PDF text string operators; pure Node.js, no AI.
function _pdfStrings(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '(') {
      let depth = 1; let j = i + 1; let buf = ''
      while (j < s.length && depth > 0) {
        const c = s[j]
        if (c === '\\') {
          const n = s[j + 1]
          if (!n) { j++; continue }
          if (n >= '0' && n <= '7') {
            let oct = n; let len = 2
            for (let k = 2; k <= 3; k++) { const d = s[j + k]; if (d && d >= '0' && d <= '7') { oct += d; len++ } else break }
            buf += String.fromCharCode(parseInt(oct, 8) & 0xff); j += len
          } else if ('nrtbf'.includes(n)) { buf += ' '; j += 2 }
          else if ('()\\'.includes(n)) { buf += n; j += 2 }
          else if (n === '\r') { j += s[j + 2] === '\n' ? 3 : 2 }
          else if (n === '\n') { j += 2 }
          else { buf += n; j += 2 }
        } else if (c === '(') { depth++; buf += c; j++ }
        else if (c === ')') { depth--; if (depth === 0) { j++; break } buf += c; j++ }
        else { buf += c; j++ }
      }
      out.push(buf); i = j
    } else if (ch === '<' && s[i + 1] !== '<') {
      const close = s.indexOf('>', i + 1)
      if (close > i) {
        const hex = s.slice(i + 1, close).replace(/[^0-9a-fA-F]/g, '')
        let hs = ''
        for (let k = 0; k + 1 < hex.length; k += 2) hs += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16))
        out.push(hs); i = close + 1
      } else i++
    } else i++
  }
  return out.join(' ')
}

function _extractPdfText(base64) {
  try {
    const buf = Buffer.from(base64, 'base64')
    if (buf.length < 100) return null
    const raw = buf.toString('latin1')
    const chunks = []
    const re = /stream\r?\n/g
    let m
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length
      const end = raw.indexOf('endstream', start)
      if (end < 0) { re.lastIndex = start; continue }
      const dict = raw.slice(Math.max(0, m.index - 400), m.index)
      let content = raw.slice(start, end)
      if (/\/FlateDecode/.test(dict)) {
        const bytes = Buffer.from(content, 'latin1')
        try { content = inflateSync(bytes).toString('latin1') }
        catch { try { content = inflateRawSync(bytes).toString('latin1') } catch { re.lastIndex = end; continue } }
      }
      chunks.push(_pdfStrings(content))
      re.lastIndex = end
    }
    const out = chunks.join(' ').replace(/\s+/g, ' ').trim()
    if (out.length < 24) return null
    let printable = 0; let alnum = 0
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i)
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable++
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alnum++
    }
    return (alnum >= 16 && printable / out.length >= 0.8) ? out.slice(0, 500_000) : null
  } catch { return null }
}

// ─── Sample file resolver (LOCAL: load fixtures by name from samples/ tree) ───
function _findSampleFile(name) {
  const samplesDir = path.join(__dirname, '../../samples')
  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) { const r = walk(fp); if (r) return r }
      else if (e.name === name) return fp
    }
    return null
  }
  return walk(samplesDir)
}

// ─── Forced-tool AI call (Anthropic Messages API on Foundry) ─────────────────
async function _forcedToolCall(deployment, system, tools, toolName, blocks, instruction, maxTokens) {
  const upstream = await fetch(fleet.anthropicMessagesUrl(), {
    method: 'POST',
    headers: fleet.anthropicHeaders(),
    body: JSON.stringify({
      model: deployment,
      max_tokens: maxTokens,
      system,
      tools,
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: instruction }] }],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`Foundry ${upstream.status}: ${detail}`)
  }
  const json = await upstream.json()
  fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
  const tu = Array.isArray(json.content) ? json.content.find((b) => b.type === 'tool_use') : null
  return (tu && tu.input) || {}
}

// ─── unifiedImport: extract coverages from a carrier filing PDF ───────────────
// EDITOR+ only — extracted proposals flow directly to mutate() via importProduct.ts.
// Grounded: reads the actual filing text via the forced propose_coverages tool.
// Cited: proposals without a document citation are dropped (mirrors functions/ sanitizer).
// Emits {t:'tool'} progress + {t:'json'} bundle (real client) + {t:'token'} (smoke compat).
const _PROPOSE_COVERAGES = {
  name: 'propose_coverages',
  description: 'Return the coverages the base form actually defines. Only include coverages the document describes — never invent a coverage, form, limit or requirement.',
  input_schema: {
    type: 'object',
    properties: {
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string' },
            requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean' },
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Form numbers exactly as printed. Only numbers present in the document.' },
            limitHint:         { type: 'string' },
            confidence:        { type: 'number', description: '0..1 confidence this coverage is correctly identified.' },
            citation:          { type: 'string', description: 'Section/heading where found. REQUIRED — proposals without a citation are discarded.' },
          },
          required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
        },
      },
      note: { type: 'string' },
    },
    required: ['coverages'],
  },
}

const _IMPORT_SYSTEM =
  'You are a P&C actuarial analyst extracting structured coverage data from an insurance policy form. ' +
  'Ground EVERY coverage in the document\'s actual text — never invent a coverage, form number, or limit. ' +
  'Cite each item by section or heading. Include form numbers only if they literally appear in the document. ' +
  'Call propose_coverages exactly once with ALL coverages the form defines.'

async function unifiedImport(req, res) {
  // Importer proposals flow to mutate() — EDITOR+ required (mirrors the mutate role gate)
  if ((RANK[req.user.role] ?? -1) < RANK['EDITOR']) {
    return res.status(403).json({ error: 'editor_required', message: 'Filing import requires EDITOR access or above.' })
  }

  const body = req.body || {}
  sse(res)

  const g = fleet.guard()
  if (!g.allow) {
    emit(res, { t: 'error', message: 'AI budget ceiling reached — try again shortly.' })
    emit(res, { t: 'done' }); return res.end()
  }
  const deployment = HAIKU_OVERRIDE || fleet.resolveModel('BULK_VERIFY', g.degrade)

  try {
    const rawDocs = Array.isArray(body.documents) ? body.documents.filter((d) => d && d.name) : []
    if (rawDocs.length === 0) {
      emit(res, { t: 'error', message: 'No documents supplied.' }); emit(res, { t: 'done' }); return res.end()
    }

    // Accept base64 or dataBase64; fall back to loading the fixture from disk (LOCAL mode)
    const docs = rawDocs.map((d) => {
      let b64 = d.base64 || d.dataBase64 || ''
      if (!b64) {
        const diskPath = _findSampleFile(String(d.name))
        if (diskPath) { try { b64 = fs.readFileSync(diskPath).toString('base64') } catch { /* leave empty */ } }
      }
      return { name: String(d.name), base64: b64, text: String(d.text || ''), mediaType: String(d.type || d.mediaType || 'application/pdf') }
    }).filter((d) => d.base64 || d.text)

    if (docs.length === 0) {
      emit(res, { t: 'error', message: 'No document content available (provide base64 or a named fixture).' })
      emit(res, { t: 'done' }); return res.end()
    }

    const filingState = String(body.filingState || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
    const productName = String(body.productName || docs[0].name.replace(/\.[^.]+$/, '') || 'Imported Filing').slice(0, 200)
    const doc = docs[0]

    emit(res, { t: 'tool', name: 'extract:coverages', phase: 'start', summary: doc.name })

    // Prefer extracted text — smaller payload → faster + cheaper than sending raw PDF bytes
    const pdfText = doc.base64 ? _extractPdfText(doc.base64) : null
    let contentBlock
    if (pdfText && pdfText.length > 100) {
      contentBlock = { type: 'text', text: `FILING DOCUMENT (${doc.name}):\n\n${pdfText.slice(0, 60_000)}` }
    } else if (doc.base64 && doc.mediaType === 'application/pdf') {
      contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } }
    } else {
      contentBlock = { type: 'text', text: `FILING DOCUMENT (${doc.name}):\n\n${doc.text.slice(0, 60_000)}` }
    }

    const extractedInput = await _forcedToolCall(
      deployment, _IMPORT_SYSTEM, [_PROPOSE_COVERAGES], 'propose_coverages',
      [contentBlock],
      `Extract ALL coverages this policy form defines. For each coverage include any form number(s) that appear in the document. Filing state: ${filingState}.`,
      2048,
    )

    // Drop uncited proposals (mirrors functions/ sanitizer invariant)
    const rawCoverages = (Array.isArray(extractedInput.coverages) ? extractedInput.coverages : [])
      .filter((c) => c && c.name && c.citation)

    emit(res, { t: 'tool', name: 'extract:coverages', phase: 'end', summary: `${rawCoverages.length} coverage(s) extracted` })

    // Assign HO-prefixed refIds — HO = Homeowners, the LOB for PH carrier policy forms
    const coverageEntities = rawCoverages.map((c, i) => {
      const refId = `HO-COV-${String(i + 1).padStart(3, '0')}`
      return {
        docId: refId.toLowerCase(),
        refId,
        label: String(c.name),
        data: {
          refId,
          name: String(c.name),
          formNumbers: Array.isArray(c.formNumbers) ? c.formNumbers.filter((n) => n && typeof n === 'string') : [],
          premiumGenerating: c.premiumGenerating !== false,
          requirement: c.requirement === 'OPTIONAL' ? 'OPTIONAL' : 'MANDATORY',
          confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.7,
          citation: String(c.citation || ''),
        },
      }
    })

    const productRefId = `FIL.${filingState}.PROD`
    const bundle = {
      plan: {
        productId: productRefId,
        product: {
          docId: 'fil-prod', label: productName,
          data: { refId: productRefId, name: productName, lob: 'PH', state: filingState },
        },
        coverages: coverageEntities,
        forms: [], rules: [], formRules: [], ratingProgram: null, ldTables: [], rtTables: [],
      },
      filingState,
      baseFormNumber: coverageEntities[0]?.data?.formNumbers?.[0] || doc.name.replace(/\.[^.]+$/, ''),
      baseFormEdition: '',
      review: {
        product: { items: [{ section: 'product', label: productName, confidence: 0.85, citation: doc.name }] },
        coverages: {
          items: coverageEntities.map((e) => ({
            section: 'coverages', label: e.data.name, refId: e.refId,
            docId: e.docId, confidence: e.data.confidence, citation: e.data.citation,
          })),
        },
        tables: { items: [] }, rules: { items: [] }, rating: { items: [] },
      },
      unresolved: [],
      counts: { proposed: coverageEntities.length, accepted: coverageEntities.length, unresolved: 0 },
      fingerprint: {
        container: 'PDF', detectedFormat: 'COMPANY_FILING_PDF',
        lineGuesses: [{ lobRefId: 'PH.LOB.001', confidence: 0.85, signals: [] }],
        documentRoles: docs.map((d) => ({ documentName: d.name, role: 'policyForm', confidence: 0.9 })),
      },
      extractionPlan: {
        format: 'COMPANY_FILING_PDF', lobRefId: 'PH.LOB.001', archetype: null,
        documentRoleAssignments: docs.map((d) => ({ documentName: d.name, role: 'policyForm', extractor: 'AI_EXTRACT_FULL' })),
        splitStrategy: 'SINGLE_PRODUCT',
      },
      sampledVerifications: [], splitProducts: [],
      // Smoke-compat direct coverages: readSse captures {t:'token'} chunks and joins them;
      // JSON.parse(full) → hoBundle.coverages is what the smoke assertion reads
      coverages: coverageEntities.map((e) => ({ refId: e.refId, name: e.data.name, formNumbers: e.data.formNumbers })),
    }

    emit(res, { t: 'json', key: 'bundle', value: bundle })
    // One token event whose value is the coverage summary JSON — smoke harness reads this
    emit(res, { t: 'token', v: JSON.stringify({ coverages: bundle.coverages }) })
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `Import error: ${String((err && err.message) || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
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
    let fullText = ''  // accumulated for post-stream citation validation
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
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
            fullText += j.delta.text
            emit(res, { t: 'token', v: j.delta.text })
          } else if (j.type === 'message_start') { inputTokens = j.message?.usage?.input_tokens || 0; outputTokens = j.message?.usage?.output_tokens || 0 }
          else if (j.type === 'message_delta' && j.usage?.output_tokens != null) outputTokens = j.usage.output_tokens
          else if (j.type === 'error') emit(res, { t: 'error', message: j.error?.message || 'stream error' })
        } catch { /* keep-alive / partial */ }
      }
    }
    fleet.record(deployment, inputTokens, outputTokens)
    // Citation validation: extract [refId] patterns the model cited and diff against
    // the bracketed anchors present in the grounding context. Any cited ref absent from
    // context is flagged as potentially fabricated so the client can badge the answer.
    const cited = [...new Set([...fullText.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]))]
    if (cited.length > 0) {
      const inCtx = new Set(ctx.flatMap((c) => [...c.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])))
      const unverified = cited.filter((r) => !inCtx.has(r))
      if (unverified.length > 0) {
        emit(res, { t: 'notice', kind: 'unverified', level: 'warn', message: `Unverified citation(s): ${unverified.join(', ')} — not found in retrieved context.`, refs: unverified })
      }
    }
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

// exportDuckCreek — records a client-side Duck Creek manuscript download in the audit trail.
// Not an AI call: no fleet/model needed. Writes an append-only audit event to Cosmos.
async function exportDuckCreek(req, res) {
  const { productId, productRefId, manuScriptID } = req.body ?? {}
  if (typeof productId !== 'string' || !productId)
    return res.status(400).json({ error: 'productId is required' })
  if (typeof manuScriptID !== 'string' || !manuScriptID)
    return res.status(400).json({ error: 'manuScriptID is required' })
  const { docs } = require('./cosmos')
  const tid   = req.tenant
  const actor = { uid: req.user?.uid ?? 'unknown', name: req.user?.name ?? req.user?.email ?? 'User' }
  await docs.items.create({
    id:       require('crypto').randomUUID(),
    pk:       `${tid}|__duckcreek_audit__`,
    kind:     'duckcreek_export_audit',
    tenantId: tid,
    data: {
      actor,
      action:     'export-duckcreek',
      entityType: 'product',
      entityPath: `products/${productId}`,
      productId,
      ...(typeof productRefId === 'string' && productRefId ? { productRefId } : {}),
      manuScriptID,
      at: new Date().toISOString(),
    },
  })
  return res.json({ ok: true })
}

router.post('/:name', requireRole('ANALYST'), requireTenant, async (req, res) => {
  const name = req.params.name
  if (name === 'exportDuckCreek') return exportDuckCreek(req, res)
  if (!fleet.isConfigured()) return res.status(503).json({ error: 'ai_not_configured', name })
  if (name === 'chat') return chat(req, res)
  if (name === 'summarizeProduct') return summarizeProduct(req, res)
  if (name === 'unifiedImport') return unifiedImport(req, res)
  return res.status(501).json({ error: 'ai_handler_not_ported', name })
})

module.exports = router
