'use strict'
// server/lib/import-brain/stage1-digest.js — CE3 Step 2: the compressed workbook digest.
//
// Replaces raw-dump ambitions: models NEVER receive full grids. Per sheet the digest
// carries purpose candidates (name + census signals), table regions, header candidates,
// detector outputs (repeating-parent, staircase, form-token counts, id grammar), the
// census fingerprint, and THREE sample rows per table region. Two decorrelated readers
// (GROUNDED_CITED / opus + VISION / gpt-5.1) study the same digest + glossary in
// parallel; each may REQUEST bounded windows (max WINDOW_DIM x WINDOW_DIM cells, max
// WINDOW_REQUESTS per model per workbook — enforced in code); a WORKBOOK_DIGEST
// synthesis (DEEP_REASONER on the /responses surface, GROUNDED_CITED chat fallback)
// adjudicates their disagreements against the requested windows or marks UNKNOWN.
//
// Output: WorkbookUnderstanding {
//   documentType, perSheet: [{ sheet, purpose, domain (existing 8 + UNKNOWN),
//   tables: [{ region, purpose, hierarchySignals }], linkingMechanisms, issues }],
//   crossSheetLinks, citations }
// The understanding is telemetry + adjudication input: stage-1 classification keeps its
// own prefilter skip-gate exactly as-is; disagreements between the two become review
// items, never silent overrides.

const fleet = require('../fleet')
const brainShared = require('../import-brain-shared.cjs')
const { callAnthropic, callOpenAI, callResponses, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { extractJson, colLetter, recordVote, TRUNCATED_STOP_REASONS, REFUSAL_STOP_REASONS } = require('./constants')

const WINDOW_DIM = 40
const WINDOW_REQUESTS = 12
const KNOWN_DOMAINS = new Set(['framework', 'forms', 'rules', 'rating', 'definitions', 'dynamicFields', 'formRules', 'tables', 'UNKNOWN'])

// ─── Digest builder (pure over census + structural fingerprints) ──────────────

function sampleRows(fp, region, count = 3) {
  if (!fp || !Array.isArray(fp.cells)) return []
  const start = region ? Math.max(0, region.headerRow ?? region.rowStart) : 0
  const out = []
  for (let r = start; r < fp.cells.length && out.length < count; r++) {
    if (region && (r < region.rowStart || r > region.rowEnd)) continue
    const row = fp.cells[r]
    if (!row || !row.some(c => c !== null && c !== '')) continue
    out.push(row.slice(0, 24).map(v => (v === null ? '' : String(v).slice(0, 40))))
  }
  return out
}

function buildWorkbookDigest({ censuses, structural }) {
  const fpByName = new Map()
  for (const fp of (structural && structural.sheets) || []) fpByName.set(fp.sheetName, fp)
  const perSheet = []
  for (const census of censuses || []) {
    for (const s of (census && census.sheets) || []) {
      const fp = fpByName.get(s.name)
      let detectors = {}
      try {
        detectors = {
          repeatingParentCols: (brainShared.repeatingParentRuns(s) || []).length,
          staircaseCols: (brainShared.staircaseHierarchy(s) || []).length,
          formTokens: (brainShared.formTokenCensus(s) || { count: 0 }).count,
          idPrefixes: (brainShared.idColumnProfile(s) || { prefixes: {} }).prefixes,
        }
      } catch { detectors = {} }
      perSheet.push({
        sheet: s.name,
        hidden: !!s.hidden,
        dims: s.dims,
        nonEmpty: s.nonEmpty,
        fingerprint: s.fingerprint,
        tables: (s.tables || []).map(t => ({
          region: `${colLetter(t.colStart)}${t.rowStart + 1}:${colLetter(t.colEnd)}${t.rowEnd + 1}`,
          headerRow: t.headerRow,
          headerConfidence: t.headerConfidence,
          samples: sampleRows(fp, t),
        })),
        detectors,
      })
    }
  }
  return { sourceName: structural?.sourceName ?? '', perSheet }
}

// ─── Window service (the bounded give-me tool) — enforced in CODE ─────────────

function serveWindow(fpByName, req) {
  const fp = fpByName.get(String(req.sheet || ''))
  if (!fp || !Array.isArray(fp.cells)) return { sheet: req.sheet, error: 'no such sheet' }
  const r1 = Math.max(0, Number(req.r1) | 0)
  const c1 = Math.max(0, Number(req.c1) | 0)
  const r2 = Math.min(fp.cells.length - 1, Math.min(r1 + WINDOW_DIM - 1, Number(req.r2) | 0))
  const c2 = Math.min(c1 + WINDOW_DIM - 1, Number(req.c2) | 0)
  const rows = []
  for (let r = r1; r <= r2; r++) {
    rows.push((fp.cells[r] || []).slice(c1, c2 + 1).map(v => (v === null ? '' : String(v).slice(0, 60))))
  }
  return { sheet: fp.sheetName, r1, c1, rows }
}

// ─── Reader loop: digest -> (optional window requests) -> understanding ───────

const READER_SYSTEM = [
  'You are analyzing a compressed STRUCTURAL DIGEST of an insurance product workbook.',
  'You never see full grids. If you need to inspect cells, respond ONLY with',
  `{"windowRequests":[{"sheet":"<name>","r1":0,"r2":39,"c1":0,"c2":39}]} (max ${WINDOW_REQUESTS} windows, each at most ${WINDOW_DIM}x${WINDOW_DIM}).`,
  'Otherwise respond ONLY with the final JSON:',
  '{"documentType":"<short>","perSheet":[{"sheet":"<name>","purpose":"<short>","domain":"<framework|forms|rules|rating|definitions|dynamicFields|formRules|tables|UNKNOWN>","tables":[{"region":"<A1:B2>","purpose":"<short>","hierarchySignals":["<signal>"]}],"linkingMechanisms":["<how rows reference other sheets>"],"issues":["<data-quality issue>"]}],"crossSheetLinks":["<link>"],"citations":["<Sheet!A1 cells that ground your claims>"]}',
  'GLOSSARY: framework/PCM = coverage hierarchy backbone; forms = policy form catalog;',
  'rules = eligibility/underwriting rules; rating = premium algorithm steps/tables;',
  'refIds like GL.COV.001 are governed identifiers (byte-exact, never invent).',
  'Ground every claim in digest content or a requested window; UNKNOWN over guessing.',
].join('\n')

function parseReader(raw) {
  try {
    const j = extractJson(raw)
    if (!j || typeof j !== 'object') return null
    return j
  } catch { /* fall through to prose armor */ }
  // Prose armor: both reader families were measured opening with narration
  // ("Looking at this digest, I have strong signal…") before the JSON — a
  // whole reading lost to preamble. Extract the FIRST balanced top-level JSON
  // object from mixed prose; string-aware so braces inside values don't
  // truncate the scan. The reading itself is still schema-checked by
  // normalizeUnderstanding downstream.
  const s = String(raw ?? '')
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const j = JSON.parse(s.slice(start, i + 1))
          return j && typeof j === 'object' ? j : null
        } catch { return null }
      }
    }
  }
  return null
}

async function readerLoop({ label, call, digestPrompt, fpByName, review, budget, vote }) {
  // One reader = one VOTE: window-request rounds are part of a single attempt,
  // so only the loop's terminal outcome is recorded (never per-round).
  const tally = (outcome) => { if (vote) recordVote(vote.budget, vote.site, vote.family, outcome) }
  let served = 0
  let prompt = digestPrompt
  let retried = false
  for (let round = 0; round < 3; round++) {
    let res
    try { res = await call(prompt) } catch (e) {
      review.push({ kind: 'digest-reader-error', detail: `${label}: ${String(e && e.message || e).slice(0, 120)}` })
      tally('empty')
      return null
    }
    let j = parseReader(res && res.raw)
    if (!j) {
      if (res && TRUNCATED_STOP_REASONS.has(res.stopReason)) { tally('truncated'); return null }
      if (res && REFUSAL_STOP_REASONS.has(res.stopReason)) { tally('refused'); return null }
      if (!res || !res.raw) { tally('empty'); return null }
      // Malformed with a clean stop gets the house policy every other site
      // already has (P0-7): named telemetry + exactly ONE targeted retry —
      // the first instrumented Core run lost the whole gpt digest reading to a
      // single unretried parse failure.
      if (retried) { tally('malformed'); return null }
      retried = true
      review.push({ kind: 'digest-reader-malformed', detail: `${label}: unparseable reading; retrying once. Raw head: "${String(res.raw).replace(/\s+/g, ' ').slice(0, 160)}"` })
      tally('retry')
      try { res = await call(prompt) } catch { tally('empty'); return null }
      j = parseReader(res && res.raw)
      if (!j) { tally('malformed'); return null }
    }
    if (Array.isArray(j.windowRequests) && j.windowRequests.length > 0 && round < 2) {
      const allowed = j.windowRequests.slice(0, Math.max(0, WINDOW_REQUESTS - served))
      served += allowed.length
      const windows = allowed.map(r => serveWindow(fpByName, r || {}))
      prompt = `${digestPrompt}\n\nREQUESTED WINDOWS (${served}/${WINDOW_REQUESTS} used — no more will be served):\n${JSON.stringify(windows).slice(0, 60_000)}\n\nNow respond with the FINAL JSON understanding only.`
      continue
    }
    tally('cast')
    return { understanding: j, windowsServed: served }
  }
  tally('malformed')
  return null
}

function normalizeUnderstanding(u) {
  if (!u || typeof u !== 'object') return null
  const perSheet = Array.isArray(u.perSheet) ? u.perSheet : []
  return {
    documentType: String(u.documentType || 'UNKNOWN').slice(0, 80),
    perSheet: perSheet.map(s => ({
      sheet: String((s && s.sheet) || ''),
      purpose: String((s && s.purpose) || '').slice(0, 200),
      domain: KNOWN_DOMAINS.has(s && s.domain) ? s.domain : 'UNKNOWN',
      tables: Array.isArray(s && s.tables) ? s.tables.slice(0, 24).map(t => ({
        region: String((t && t.region) || ''),
        purpose: String((t && t.purpose) || '').slice(0, 200),
        hierarchySignals: Array.isArray(t && t.hierarchySignals) ? t.hierarchySignals.slice(0, 8).map(String) : [],
      })) : [],
      linkingMechanisms: Array.isArray(s && s.linkingMechanisms) ? s.linkingMechanisms.slice(0, 8).map(String) : [],
      issues: Array.isArray(s && s.issues) ? s.issues.slice(0, 8).map(String) : [],
    })),
    crossSheetLinks: Array.isArray(u.crossSheetLinks) ? u.crossSheetLinks.slice(0, 24).map(String) : [],
    citations: Array.isArray(u.citations) ? u.citations.slice(0, 64).map(String) : [],
  }
}

// ─── Main: dual readers + WORKBOOK_DIGEST synthesis ───────────────────────────

async function digestWorkbook({ censuses, structural, budget, review, emit }) {
  const send = typeof emit === 'function' ? emit : () => {}
  const digest = buildWorkbookDigest({ censuses, structural })
  if (digest.perSheet.length === 0) return null

  const fpByName = new Map()
  for (const fp of (structural && structural.sheets) || []) fpByName.set(fp.sheetName, fp)

  const digestPrompt = `WORKBOOK DIGEST (${digest.sourceName}):\n${JSON.stringify(digest).slice(0, 100_000)}`

  let deployOpus = null
  let deployGpt = null
  try { deployOpus = resolveAnthropic('GROUNDED_CITED', budget) } catch { /* offline */ }
  try { deployGpt = resolveOpenAI(fleet.DEPLOY_GPT, budget) } catch { /* offline */ }
  if (!deployOpus && !deployGpt) return { digest, understanding: null, offline: true }

  const [a, b] = await Promise.all([
    deployOpus ? readerLoop({
      label: 'digest-reader-A(opus)', digestPrompt, fpByName, review, budget,
      vote: { budget, site: 'stage1-digest', family: 'anthropic' },
      call: (p) => callAnthropic({ deployment: deployOpus, systemPrompt: READER_SYSTEM, userPrompt: p, maxTokens: 8192, budget }),
    }) : null,
    deployGpt ? readerLoop({
      label: 'digest-reader-B(gpt)', digestPrompt, fpByName, review, budget,
      vote: { budget, site: 'stage1-digest', family: 'openai' },
      call: (p) => callOpenAI({ deployment: deployGpt, systemPrompt: READER_SYSTEM, userPrompt: p, maxTokens: 8192, budget }),
    }) : null,
  ])

  const ua = normalizeUnderstanding(a && a.understanding)
  const ub = normalizeUnderstanding(b && b.understanding)
  if (!ua && !ub) return { digest, understanding: null }
  if (!ua || !ub) {
    const only = ua || ub
    review.push({ kind: 'digest-single-family', detail: `workbook digest: only one reader family produced an understanding — synthesis skipped, single-family result carried review-flagged.` })
    return { digest, understanding: only, singleFamily: true }
  }

  // Synthesis: WORKBOOK_DIGEST (DEEP_REASONER on /responses; GROUNDED_CITED fallback).
  const synthesisInput = [
    'Two independent analysts read the same workbook digest. Synthesize ONE WorkbookUnderstanding JSON',
    '(same schema). Where they disagree on a sheet\'s domain/purpose, prefer the reading grounded in',
    'cited cells; if neither grounds it, use domain UNKNOWN. Respond with the JSON only.',
    `ANALYST A: ${JSON.stringify(ua).slice(0, 40_000)}`,
    `ANALYST B: ${JSON.stringify(ub).slice(0, 40_000)}`,
  ].join('\n')

  let synthesized = null
  let synthesisRoute = null
  try {
    const ext = require('../fleet-shared.cjs')
    const primaryRole = (ext.WORKBOOK_DIGEST && ext.WORKBOOK_DIGEST.primary) || 'DEEP_REASONER'
    const dep = ext.EXTENDED_DEPLOYMENTS && ext.EXTENDED_DEPLOYMENTS[primaryRole] && ext.EXTENDED_DEPLOYMENTS[primaryRole].deploymentName
    if (dep) {
      const res = await callResponses({ deployment: dep, input: synthesisInput, maxOutputTokens: 8192, budget })
      synthesized = normalizeUnderstanding(parseReader(res.raw))
      synthesisRoute = `responses:${primaryRole}`
    }
  } catch { synthesized = null }
  if (!synthesized && deployOpus) {
    try {
      const res = await callAnthropic({ deployment: deployOpus, systemPrompt: 'Synthesize the two analyses into one JSON. Respond with JSON only.', userPrompt: synthesisInput, maxTokens: 8192, budget })
      synthesized = normalizeUnderstanding(parseReader(res.raw))
      synthesisRoute = 'chat:GROUNDED_CITED-fallback'
    } catch { synthesized = null }
  }

  const understanding = synthesized || ua
  // Reader disagreements surface as review items (visible, never silently resolved).
  const domainOf = (u) => new Map((u.perSheet || []).map(s => [s.sheet, s.domain]))
  const da = domainOf(ua)
  const db = domainOf(ub)
  for (const [sheet, dA] of da) {
    const dB = db.get(sheet)
    if (dB && dA !== dB) {
      review.push({ kind: 'digest-domain-disagreement', sheetName: sheet, detail: `workbook digest: readers disagree on "${sheet}" (${dA} vs ${dB}); synthesis says "${(understanding.perSheet.find(s => s.sheet === sheet) || {}).domain || 'UNKNOWN'}".` })
    }
  }
  send({ t: 'json', key: 'brain:digest', value: { documentType: understanding.documentType, sheets: understanding.perSheet.length, synthesisRoute, windowsServed: (a && a.windowsServed || 0) + (b && b.windowsServed || 0) } })
  return { digest, understanding, synthesisRoute }
}

module.exports = { digestWorkbook, buildWorkbookDigest, serveWindow, readerLoop, normalizeUnderstanding, WINDOW_DIM, WINDOW_REQUESTS }
