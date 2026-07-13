'use strict'
// _shared.js — utilities shared across all ai/ handler modules.
// Paths are relative to server/lib/ai/ (one level deeper than the old ai.js).

const fleet = require('../fleet')
const embed = require('../embed')
const fs    = require('fs')
const path  = require('path')
const { inflateSync, inflateRawSync } = require('zlib')

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
}
const emit = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`)

// ─── fetchWithRetry: exp backoff + jitter on 408/429/5xx ─────────────────────
async function fetchWithRetry(url, opts, { maxAttempts = 3, timeoutMs = 90_000 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const base   = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
      const jitter = Math.floor(Math.random() * 500)
      await new Promise(r => setTimeout(r, base + jitter))
    }
    let resp
    try {
      resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      if (attempt === maxAttempts - 1) throw e
      continue
    }
    if (resp.status !== 408 && resp.status !== 429 && resp.status < 500) return resp
    if (attempt === maxAttempts - 1) return resp
    try { await resp.arrayBuffer() } catch { /* drain */ }
    const ra = Number(resp.headers.get('Retry-After') || 0)
    if (ra > 0) await new Promise(r => setTimeout(r, Math.min(ra * 1000, 30_000)))
  }
}

// ─── Forced-tool AI call ──────────────────────────────────────────────────────
// opts.thinking — { type:'enabled', budget_tokens:N } enables extended thinking.
// system — string (auto-wrapped with ephemeral cache_control) or block array.
async function _forcedToolCall(deployment, system, tools, toolName, blocks, instruction, maxTokens, opts = {}) {
  const { thinking = null } = opts
  const headers = { ...fleet.anthropicHeaders() }
  if (thinking) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14'
  const systemBlocks = Array.isArray(system)
    ? system
    : [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  const body = {
    model: deployment,
    max_tokens: maxTokens,
    system: systemBlocks,
    tools,
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: instruction }] }],
  }
  // temperature is deprecated on claude-opus-4-8 and claude-haiku-4-5.
  // Do not include it — omitting it gives deterministic behavior by default.
  if (thinking) body.thinking = thinking
  const upstream = await fetchWithRetry(fleet.anthropicMessagesUrl(), {
    method: 'POST', headers, body: JSON.stringify(body),
  }, { timeoutMs: 90_000 })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`Foundry ${upstream.status}: ${detail}`)
  }
  const json = await upstream.json()
  fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
  const tu = Array.isArray(json.content) ? json.content.find((b) => b.type === 'tool_use') : null
  return (tu && tu.input) || {}
}

// ─── Grounding ────────────────────────────────────────────────────────────────
const GROUNDING_CAP = Number(process.env.AI_GROUNDING_CAP) || 400
const DETAIL_CAP    = Number(process.env.AI_DETAIL_CAP)    || 18
const HYBRID_ALPHA  = 0.72
const DENSE_FLOOR   = 0.22

let _retrieveMod = null
function getRetrieve() {
  if (!_retrieveMod) { try { _retrieveMod = require('../retrieve-shared.cjs') } catch { _retrieveMod = {} } }
  return _retrieveMod
}

function lexicalTargetOf(data) {
  const m = data.metadata || {}
  return `${m.refId ?? ''} ${m.refId ?? ''} ${m.formNumber ?? ''} ${m.title ?? ''} ${data.text ?? ''}`
}

async function grounding(query, productId, tenantId) {
  try {
    const { docs } = require('../cosmos').resolveTenantStore(tenantId)   // SILO_READY seam
    const R = getRetrieve()
    const tidParam = [{ name: '@tid', value: tenantId }]

    let baseline = []
    if (!productId) {
      const bSql = `SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.tenantId=@tid AND c.data.type=@etype`
      const { resources: bRes } = await docs.items.query(
        { query: bSql, parameters: [...tidParam, { name: '@etype', value: 'product' }] },
        { maxItemCount: 200 },
      ).fetchAll()
      baseline = [...new Set(bRes.map((r) => String(r.data?.text || '')).filter(Boolean))]
    }

    const p2 = [...tidParam]
    let sql = `SELECT TOP ${GROUNDING_CAP} c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.tenantId=@tid`
    if (productId) { sql += ' AND c.data.productId=@pid'; p2.push({ name: '@pid', value: productId }) }
    const { resources } = await docs.items.query({ query: sql, parameters: p2 }, { maxItemCount: GROUNDING_CAP }).fetchAll()

    const qVec = String(query || '').trim() ? await embed.embedOne(query) : null
    const cos = R.cosineSim
    const kw  = R.keywordOverlapScore
    const hyb = R.hybridScore

    const baselineSet = new Set(baseline)
    const byText = new Map()
    for (const r of resources) {
      const data = r.data || {}
      const text = String(data.text || '')
      if (!text || baselineSet.has(text)) continue
      const hasEmb = !!(data.embedding && Array.isArray(data.embedding.q))
      const prev = byText.get(text)
      if (!prev || (hasEmb && !prev.hasEmb)) byText.set(text, { data, hasEmb })
    }

    const scored = []
    for (const { data } of byText.values()) {
      const text = String(data.text || '')
      const cvec = data.embedding && Array.isArray(data.embedding.q) ? data.embedding.q : null
      const dense   = (qVec && cvec && cos) ? cos(qVec, cvec) : null
      const lexical = kw ? kw(query || '', lexicalTargetOf(data)) : 0
      const score   = hyb ? hyb(dense, lexical, HYBRID_ALPHA) : lexical
      const relevant = (dense !== null && dense >= DENSE_FLOOR) || lexical > 0
      if (relevant) scored.push({ text, score })
    }
    const detail = scored.sort((a, b) => b.score - a.score).slice(0, DETAIL_CAP).map((x) => x.text)
    return { baseline, detail }
  } catch (e) { console.warn('[ai] grounding failed:', e.message); return { baseline: [], detail: [] } }
}

async function groundingFlat(query, productId, tenantId) {
  const { baseline, detail } = await grounding(query, productId, tenantId)
  return [...baseline, ...detail]
}

// ─── PDF extraction ───────────────────────────────────────────────────────────
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

// ─── Sample file resolver ─────────────────────────────────────────────────────
function _findSampleFile(name) {
  const samplesDir = path.join(__dirname, '../../../samples')
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

// ─── Azure Blob fetch ─────────────────────────────────────────────────────────
async function _fetchBlobBase64(blobPath) {
  const conn = process.env.AZURE_BLOB_CONNECTION
  if (!conn || !blobPath) return null
  try {
    const { BlobServiceClient } = require('@azure/storage-blob')
    const container = process.env.AZURE_BLOB_CONTAINER || 'uploads'
    const client = BlobServiceClient.fromConnectionString(conn).getContainerClient(container).getBlockBlobClient(blobPath)
    const buf = await client.downloadToBuffer()
    return buf.toString('base64')
  } catch { return null }
}

// ─── Lazy loaders ─────────────────────────────────────────────────────────────
let _chunkMod = null
function _getChunker() {
  if (!_chunkMod) { try { _chunkMod = require('../chunk-shared.cjs') } catch { _chunkMod = {} } }
  return _chunkMod
}

let _importBrain = null
function getImportBrain() {
  if (!_importBrain) { try { _importBrain = require('../import-brain/index') } catch { _importBrain = {} } }
  return _importBrain
}

let _stageFiling = null
function getStageFiling() {
  if (!_stageFiling) { try { _stageFiling = require('../import-brain/stage-filing') } catch { _stageFiling = {} } }
  return _stageFiling
}

module.exports = {
  sse, emit, fetchWithRetry, _forcedToolCall,
  grounding, groundingFlat,
  _extractPdfText, _findSampleFile, _fetchBlobBase64,
  _getChunker, getImportBrain, getStageFiling,
}
