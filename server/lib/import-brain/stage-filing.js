'use strict'
// server/lib/import-brain/stage-filing.js — REQ-2: FormatFingerprint-routed filing pipeline.
//
// Ported from functions/src/filingImport.ts (reference-only; never deployed from functions/).
// This module wraps CLASSIFY -> RATE_ORDER -> MANUAL -> RECONCILE for carrier filing PDFs.
// It uses the same fleet cost guard and SSE emit callback as the brain stages.
//
// Route: unifiedImport selects this module when the request body carries `documents` containing
// filing PDFs (mediaType application/pdf) WITHOUT a `structural` workbook model.
//
// Invariants held:
//   * Every rate-order variable and manual rule MUST cite its source (uncited items dropped
//     by the shared sanitizeRateOrder / sanitizeManual guards).
//   * The model never produces table rows — it returns a SCHEMA + verbatim region; deterministic
//     code parses the rows (in shared/src/insurance/filing/tableParser.ts via reconcileFiling).
//   * CLASSIFY uses haiku (BULK_VERIFY) — cheap, forced tool.
//   * RATE_ORDER + MANUAL use haiku first; escalate to opus (GROUNDED_CITED) on empty result.
//   * RECONCILE is pure and deterministic (no model call).
//   * All AI calls pass through resolveAnthropic() which enforces the fleet cost guard.

const { callAnthropic, resolveAnthropic, createBudget } = require('./ai-call')
const { FILING_CLASSIFY_SYSTEM } = require('./prompts')
const { pMap } = require('./constants')

// Lazy-load the shared filing sanitizers + reconciler (built by pnpm build:filing).
let _filingShared = null
function getFilingShared() {
  if (!_filingShared) { try { _filingShared = require('../filing-shared.cjs') } catch (e) { _filingShared = {} } }
  return _filingShared
}

// ─── Document role extraction tools (Anthropic forced-tool format) ────────────

const CLASSIFY_TOOL = {
  name: 'classify_filing_document',
  description:
    'Classify ONE filing document by its role, from STRUCTURAL cues — not the filename. ' +
    'rateOrder: a "rate order of calculations" with ordered Premium/Factor rows and per-form ' +
    'applicability columns. manual: a rate manual with dense NUMBERED rules and factor tables. ' +
    'policyForm: the policy contract, with a form-number/edition footer and coverage sections. ' +
    'other: none of these. Cite the specific cue you used.',
  input_schema: {
    type: 'object',
    properties: {
      role:       { type: 'string', enum: ['rateOrder', 'manual', 'policyForm', 'other'] },
      // A document can genuinely BE more than one thing (a manual with an
      // embedded rate-order appendix) — F13: multi-role must be expressible.
      secondaryRoles: { type: 'array', items: { type: 'string', enum: ['rateOrder', 'manual', 'policyForm'] }, description: 'OPTIONAL: additional roles this same document genuinely fulfils (e.g. a manual containing a rate-order appendix).' },
      cue:        { type: 'string', description: 'Structural cue used (heading / rule number / page). REQUIRED.' },
      confidence: { type: 'number', description: '0..1 confidence.' },
    },
    required: ['role', 'cue', 'confidence'],
  },
}

const RATE_ORDER_TOOL = {
  name: 'propose_rate_order',
  description:
    'Return the rate order of calculations as an ORDERED list of rating variables, exactly as ' +
    'the document sequences them. Each variable: op ADD for a Premium (additive) row or MUL for ' +
    'a Factor (multiplicative) row; the stage it belongs to; the product forms it applies to. ' +
    'Also return the referenced maximum-credit and minimum-premium rules if annotated. Never invent a variable.',
  input_schema: {
    type: 'object',
    properties: {
      variables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:       { type: 'string', description: 'The rating variable name exactly as printed.' },
            op:         { type: 'string', enum: ['ADD', 'MUL'], description: 'ADD = Premium; MUL = Factor.' },
            stage:      { type: 'string', enum: ['BASE_LOSS_COST', 'BASE_PREMIUM', 'ADJUSTED_BASE', 'INCREASED_LIMIT', 'ADDITIONAL_COVERAGE'] },
            forms:      { type: 'array', items: { type: 'string' }, description: 'Forms this row applies to.' },
            confidence: { type: 'number', description: '0..1.' },
            citation:   { type: 'string', description: 'Where found. REQUIRED.' },
          },
          required: ['name', 'op', 'stage', 'confidence', 'citation'],
        },
      },
      maxCreditRuleRef:  { type: 'string', description: 'Referenced maximum-credit rule, e.g. "Rule 92".' },
      minPremiumRuleRef: { type: 'string', description: 'Referenced minimum-premium rule.' },
      note:              { type: 'string' },
    },
    required: ['variables'],
  },
}

const MANUAL_TOOL = {
  name: 'propose_manual_rules',
  description:
    "Return the manual's NUMBERED rules. For each rule give its number, title, kind, and concept. " +
    'CRITICAL: never transcribe table rows. For factor tables, return a SCHEMA (layout, keyColumns, ' +
    'valueColumn, and the VERBATIM text rowRegion copied from the page) — deterministic code parses ' +
    'the rows. For scalar facts use scalars. Distil eligibility prose into a condition->outcome ruleDraft. ' +
    'Never invent a rule, factor, or row.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ruleNumber: { type: 'string' },
            title:      { type: 'string' },
            kind:       { type: 'string', enum: ['BASE_LOSS_COST', 'FACTOR_TABLE', 'SCALAR', 'DEDUCTIBLE', 'CREDIT_CAP', 'MIN_PREMIUM', 'PREMIUM_CAP', 'SCHEDULED_PROPERTY', 'PROTECTIVE_DEVICE', 'ENDORSEMENT_SCHEDULE', 'ELIGIBILITY', 'OTHER'] },
            concept:    { type: 'string', description: 'Short concept key joining this rule to the rate order.' },
            table: {
              type: 'object',
              properties: {
                layout:      { type: 'string', enum: ['pairs', 'triples', 'matrix'] },
                keyColumns:  { type: 'array', items: { type: 'string' } },
                valueColumn: { type: 'string' },
                columnKeys:  { type: 'array', items: { type: 'string' }, description: 'matrix only: column-header values.' },
                rowRegion:   { type: 'string', description: 'The VERBATIM text region of the table.' },
              },
              required: ['layout', 'keyColumns', 'valueColumn', 'rowRegion'],
            },
            scalars:  { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, form: { type: 'string' } }, required: ['value'] } },
            ruleDraft: { type: 'object', properties: { condition: { type: 'string' }, outcome: { type: 'string' } }, required: ['condition', 'outcome'] },
            confidence: { type: 'number', description: '0..1.' },
            citation:   { type: 'string', description: 'Where found. REQUIRED.' },
          },
          required: ['ruleNumber', 'title', 'confidence', 'citation'],
        },
      },
      note: { type: 'string' },
    },
    required: ['rules'],
  },
}

const EXTRACT_SYSTEM =
  "You are a P&C actuarial analyst reading a rate filing. Ground EVERY item in the document's " +
  'actual text — never invent a variable, rule, factor, table row or number. ' +
  'CITATIONS ARE MANDATORY: every item MUST include a non-empty "citation" giving the page and ' +
  'heading or rule number where it appears (e.g. "p.1, Rate Order of Calculations table" or ' +
  '"Rule 406.C"). Items without a citation are DISCARDED by the pipeline — an uncited item is a ' +
  'wasted item. For tables, return a SCHEMA + the verbatim region; deterministic code parses the ' +
  'rows. Call the forced tool exactly once.'

// ─── Build content block from a filing document ───────────────────────────────
// TEXT FIRST: extracted text goes whole-document-in-context (up to 180k chars) so
// page traceability survives. When text extraction yields too little — encrypted
// PDFs, Identity-H CID fonts, remapped TrueType encodings, or true scans (the entire
// NJ/Lemonade/HO3 corpus falls in these classes) — fall back to a NATIVE PDF document
// block: the vision-capable Claude models read the pages directly, preserving
// page-level citations. Never converts Excel to PDF; this path is PDF-only.

const PDF_TEXT_MIN = 400

function buildContentBlock(doc, pdfText) {
  const name = String(doc.name || 'document')
  if (pdfText && pdfText.length >= PDF_TEXT_MIN) {
    return { type: 'text', text: `FILING DOCUMENT (${name}):\n\n${pdfText.slice(0, 180_000)}` }
  }
  if (doc.text && String(doc.text).length >= PDF_TEXT_MIN) {
    return { type: 'text', text: `FILING DOCUMENT (${name}):\n\n${String(doc.text).slice(0, 180_000)}` }
  }
  if (doc.base64) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } }
  }
  return { type: 'text', text: `FILING DOCUMENT (${name}):\n\n${String(doc.text || '').slice(0, 180_000)}` }
}

// ─── One forced-tool Anthropic call (via the shared ai-call helper) ───────────
// callAnthropic provides retry with backoff, the cost guard / no-cap import context,
// and per-run spend telemetry. Returns the parsed tool input object.

async function forcedTool(deployment, systemPrompt, tools, toolName, contentBlock, instruction, maxTokens, budget) {
  // Native-PDF document blocks make the model read whole page images — a 25-page
  // manual at opus can exceed the default 120s; give extraction calls headroom.
  const timeoutMs = contentBlock && contentBlock.type === 'document' ? 300_000 : 120_000
  const res = await callAnthropic({
    deployment, systemPrompt, tools, toolName, maxTokens, budget, timeoutMs,
    contentBlocks: [contentBlock, { type: 'text', text: instruction }],
  })
  try { return JSON.parse(res.raw) } catch { return {} }
}

// ─── Escalation strategies ────────────────────────────────────────────────────
// TEXT blocks: haiku → sonnet → opus sequentially until the parse yields content
// (cheap-first; a missing rung is skipped).
// DOCUMENT (vision) blocks: haiku and opus read the pages IN PARALLEL and the
// richer non-empty result wins (sequential ladders re-read the whole PDF per rung
// — slow and wasteful); sonnet only runs if both come back empty.
// `count` sizes a sanitized result so the race can prefer the richer extraction;
// `rawCount` counts the model's PRE-sanitize items so silent citation-drops surface.
// `heavyDoc` (a dense manual): the cheap haiku racer runs ONCE with no empty-retry — a wasted
// ~5-minute re-read of the whole PDF — while opus keeps its retry as the authoritative rung; and
// each rung emits a per-rung progress notice so a multi-minute opus read never looks hung.

async function extractWithLadder({ systemPrompt, tool, block, instruction, maxTokens, budget, sanitize, isEmpty, count, emit, label, heavyDoc }) {
  const emitFn = typeof emit === 'function' ? emit : () => {}
  const sizeOf = typeof count === 'function' ? count : (r) => (isEmpty(r) ? 0 : 1)
  const isDoc = !!(block && block.type === 'document')
  const rawItems = (raw) => {
    if (!raw || typeof raw !== 'object') return 0
    for (const v of Object.values(raw)) if (Array.isArray(v)) return v.length
    return 0
  }
  const attempt = async (role, { allowRetry = true } = {}) => {
    let deployment
    try { deployment = resolveAnthropic(role, budget) } catch { return null }
    // Progress: reading a native-PDF (vision) block can take minutes at opus; surface each rung
    // so the UI shows forward motion instead of a hung tool.
    if (isDoc) emitFn({ t: 'notice', level: 'info', kind: 'extract-progress', message: `${label ?? tool.name}: ${role} reading the document (a native-PDF read can take a few minutes)…` })
    let raw
    let callError = null
    try { raw = await forcedTool(deployment, systemPrompt, [tool], tool.name, block, instruction, maxTokens, budget) } catch (e) { raw = {}; callError = String(e && e.message || e).slice(0, 180) }
    // Models occasionally return an empty/under-filled tool call ({} or ancillary
    // fields without the primary array) — one retry with an explicit reminder
    // recovers most of these. Skipped for the cheap racer on a dense manual (allowRetry:false).
    if (allowRetry && !callError && rawItems(raw) === 0) {
      if (isDoc) emitFn({ t: 'notice', level: 'info', kind: 'extract-progress', message: `${label ?? tool.name}: ${role} empty — retrying once…` })
      const retryInstruction = `${instruction}\n\nIMPORTANT: your previous attempt returned an empty tool call. You MUST populate the primary array field of the tool with EVERY item found in the document (with citations). Do not summarize in "note" — fill the array.`
      try {
        const retry = await forcedTool(deployment, systemPrompt, [tool], tool.name, block, retryInstruction, maxTokens, budget)
        if (rawItems(retry) > 0) raw = retry
      } catch { /* keep original */ }
    }
    const sanitized = sanitize(raw)
    const before = rawItems(raw)
    const after = sizeOf(sanitized)
    if (callError) {
      emitFn({ t: 'notice', level: 'warn', kind: 'extract-error', message: `${label ?? tool.name}: ${role} call failed — ${callError}` })
    } else if (before > 0 && after === 0) {
      emitFn({ t: 'notice', level: 'warn', kind: 'citations-dropped', message: `${label ?? tool.name}: ${role} extracted ${before} item(s) but ALL were dropped by the citation guard — model omitted citations.` })
    } else if (before === 0) {
      const rawStr = JSON.stringify(raw ?? {})
      emitFn({ t: 'notice', level: 'info', kind: 'extract-empty', message: `${label ?? tool.name}: ${role} returned no items — raw tool output ${rawStr.length} chars: ${rawStr.slice(0, 200)}` })
    }
    return { role, sanitized, before, after }
  }

  if (isDoc) {
    // Dense manual: the haiku racer gets NO empty-retry (a wasted whole-PDF re-read); opus keeps
    // its retry. Non-heavy docs keep the prior behaviour (both racers retry once).
    const [a, b] = await Promise.all([
      attempt('BULK_VERIFY', { allowRetry: !heavyDoc }),
      attempt('GROUNDED_CITED'),
    ])
    const candidates = [a, b].filter(Boolean).filter(r => !isEmpty(r.sanitized))
    if (candidates.length > 0) {
      candidates.sort((x, y) => sizeOf(y.sanitized) - sizeOf(x.sanitized))
      return { result: candidates[0].sanitized, escalated: candidates[0].role !== 'BULK_VERIFY' }
    }
    const c = await attempt('MID_REASONER')
    if (c && !isEmpty(c.sanitized)) return { result: c.sanitized, escalated: true }
    return { result: (a ?? b ?? c)?.sanitized ?? null, escalated: true }
  }

  let result = null
  let escalated = false
  for (const role of ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED']) {
    const r = await attempt(role)
    if (!r) continue
    if (!isEmpty(r.sanitized)) return { result: r.sanitized, escalated }
    result = result ?? r.sanitized
    escalated = true
  }
  return { result, escalated }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run CLASSIFY -> RATE_ORDER -> MANUAL -> RECONCILE for filing PDFs.
 *
 * @param {object} opts
 * @param {object[]}  opts.documents        [{ name, text, base64? }]
 * @param {string}    [opts.productNameHint]
 * @param {string}    [opts.filingStateHint] e.g. 'NJ'
 * @param {string}    [opts.lobRefIdHint]    stage-0's content-derived LOB (F18), e.g. 'PA.LOB.001'
 * @param {object}    [opts.budget]          pre-created budget; created if omitted
 * @param {function}  [opts.emit]            SSE emit callback
 * @param {function}  [opts.extractPdfText]  (base64) => string | null  (injected by ai.js)
 * @returns {Promise<{bundle: object, extraction: object, escalated: boolean}>}
 */
async function runFilingPipeline(opts) {
  const { documents, productNameHint, filingStateHint, lobRefIdHint } = opts
  const emit         = typeof opts.emit === 'function' ? opts.emit : () => {}
  const budget       = opts.budget ?? createBudget()
  const extractText  = typeof opts.extractPdfText === 'function' ? opts.extractPdfText : () => null
  const shared       = getFilingShared()
  const sanitizeCls  = shared.sanitizeClassification  ?? ((n, i) => ({ name: n, role: i?.role ?? 'other', cue: i?.cue ?? '', confidence: Number(i?.confidence ?? 0) }))
  const sanitizeRO   = shared.sanitizeRateOrder       ?? ((i) => ({ variables: [] }))
  const sanitizeMnl  = shared.sanitizeManual          ?? ((i) => ({ rules: [] }))
  const reconcile    = shared.reconcileFiling         ?? (() => ({ plan: {}, counts: { proposed: 0, accepted: 0, unresolved: 0 }, review: {} }))

  let escalated = false

  // ── CLASSIFY ──
  emit({ t: 'tool', name: 'filing:classify', phase: 'start' })
  const deployBulk = resolveAnthropic('BULK_VERIFY', budget)

  const classifications = await pMap(documents, async (doc) => {
    const pdfText = doc.base64 ? extractText(doc.base64) : null
    const block   = buildContentBlock(doc, pdfText)
    const input   = await forcedTool(deployBulk, FILING_CLASSIFY_SYSTEM, [CLASSIFY_TOOL], CLASSIFY_TOOL.name, block, `Classify this document (filename: "${doc.name}").`, 500, budget)
      .catch(() => ({}))
    return sanitizeCls(doc.name, input)
  }, 3)
  emit({ t: 'tool', name: 'filing:classify', phase: 'end', summary: classifications.map(c => `${String(c.name).split(/[\\/]/).pop()} -> ${c.role}`).join(', ') })
  emit({ t: 'json', key: 'filing:classifications', value: classifications })

  // F13: role assignment is a PARTITION, not a lookup — every document lands
  // in every bucket it was classified into (primary + secondary roles), and
  // every document the extractors do not consume is surfaced later, never
  // silently ignored.
  const docsByRole = new Map()
  classifications.forEach((c, i) => {
    for (const role of [c.role, ...(Array.isArray(c.secondaryRoles) ? c.secondaryRoles : [])]) {
      const list = docsByRole.get(role) ?? []
      list.push(documents[i])
      docsByRole.set(role, list)
    }
  })
  const rateOrderDocs  = docsByRole.get('rateOrder') ?? []
  const manualDocs     = docsByRole.get('manual') ?? []
  const policyFormDocs = docsByRole.get('policyForm') ?? []
  const policyFormDoc  = policyFormDocs[0] ?? null
  // Documents that will NOT be extracted by any role loop — reported after
  // reconcile as unprocessed (role 'other', and surplus rate orders: the rate
  // order is ORDER-SEMANTIC, merging two would interleave two sequences).
  const unprocessedDocs = []
  for (const doc of docsByRole.get('other') ?? []) {
    const cls = classifications.find(c => c.name === doc.name)
    unprocessedDocs.push({ doc, role: 'other', cue: cls?.cue ?? '' })
  }
  for (const doc of rateOrderDocs.slice(1)) {
    const cls = classifications.find(c => c.name === doc.name)
    unprocessedDocs.push({ doc, role: 'rateOrder', cue: `${cls?.cue ?? ''} — a rate order is order-semantic; only the first extracts` })
  }

  // ── EXTRACT: rate order + manual + policy form IN PARALLEL (independent docs) ──
  const extractRateOrder = async () => {
    const rateOrderDoc = rateOrderDocs[0]
    if (!rateOrderDoc) return { variables: [] }
    emit({ t: 'tool', name: 'filing:extract:rateOrder', phase: 'start' })
    const pdfText = rateOrderDoc.base64 ? extractText(rateOrderDoc.base64) : null
    const block   = buildContentBlock(rateOrderDoc, pdfText)
    const ladder  = await extractWithLadder({
      systemPrompt: EXTRACT_SYSTEM, tool: RATE_ORDER_TOOL, block,
      instruction: 'Extract the rate order of calculations, in order. Remember: every variable MUST carry a citation (page + table/heading).',
      maxTokens: 16000, budget,
      sanitize: sanitizeRO, isEmpty: (r) => !r || r.variables.length === 0,
      count: (r) => r?.variables?.length ?? 0, emit, label: 'rate-order',
    })
    const ro = ladder.result ?? { variables: [] }
    escalated = escalated || ladder.escalated
    emit({ t: 'tool', name: 'filing:extract:rateOrder', phase: 'end', summary: `${ro.variables.length} variable(s)${ro.note ? ` — ${ro.note}` : ''}` })
    if (ro.note) emit({ t: 'notice', level: 'warn', kind: 'sanitize-note', message: `rate-order: ${ro.note}` })
    return ro
  }

  const extractManual = async () => {
    if (manualDocs.length === 0) return { rules: [] }
    emit({ t: 'tool', name: 'filing:extract:manual', phase: 'start' })
    // EVERY manual extracts (F13); with >1, each rule's citation is prefixed
    // with its source document so merged provenance stays per-document.
    const perDoc = await pMap(manualDocs, async (doc) => {
      const pdfText = doc.base64 ? extractText(doc.base64) : null
      const block   = buildContentBlock(doc, pdfText)
      const ladder  = await extractWithLadder({
        systemPrompt: EXTRACT_SYSTEM, tool: MANUAL_TOOL, block,
        instruction: "Extract the manual's numbered rules — schemas + verbatim regions for tables, scalars for single facts. Remember: every rule MUST carry a citation (page + rule number).",
        maxTokens: 16000, budget,
        sanitize: sanitizeMnl, isEmpty: (r) => !r || r.rules.length === 0,
        count: (r) => r?.rules?.length ?? 0, emit, label: `manual-rules:${doc.name}`,
        heavyDoc: true,   // dense rate manual — drop the cheap racer's empty-retry (latency)
      })
      escalated = escalated || ladder.escalated
      const mn = ladder.result ?? { rules: [] }
      if (mn.note) emit({ t: 'notice', level: 'warn', kind: 'sanitize-note', message: `manual (${doc.name}): ${mn.note}` })
      return { doc, rules: mn.rules }
    }, 2)
    const rules = perDoc.flatMap(({ doc, rules: docRules }) =>
      manualDocs.length > 1
        ? docRules.map(r => ({ ...r, citation: `${doc.name} — ${r.citation}` }))
        : docRules)
    if (manualDocs.length > 1) {
      emit({ t: 'notice', level: 'info', kind: 'multi-manual-merge', message: `${manualDocs.length} manual documents merged (${manualDocs.map(d => d.name).join(', ')}); each rule's citation names its source document.` })
    }
    emit({ t: 'tool', name: 'filing:extract:manual', phase: 'end', summary: `${rules.length} rule(s) from ${manualDocs.length} document(s)` })
    return { rules }
  }

  // ── EXTRACT: policy form coverages (single-pass forced propose_coverages) ──
  // The full runFourSectionExtraction is not yet ported; use the same forced-tool approach
  // the original unifiedImport handler uses (haiku, forced propose_coverages tool).
  const PROPOSE_COVERAGES_TOOL = {
    name: 'propose_coverages',
    description: 'Return the coverages the base form actually defines. Only include coverages the document describes — never invent a coverage, form, limit or requirement. A policy contract usually does NOT state product-level mandatory status or premium treatment: when the document does not establish a fact, say UNKNOWN — never guess.',
    input_schema: {
      type: 'object',
      properties: {
        coverages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:              { type: 'string' },
              requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL', 'UNKNOWN'], description: 'UNKNOWN when the document does not establish product-level mandatory status.' },
              premiumGenerating: { type: 'string', enum: ['YES', 'NO', 'UNKNOWN'], description: 'UNKNOWN when the document does not state premium treatment.' },
              formNumbers:       { type: 'array', items: { type: 'string' } },
              confidence:        { type: 'number' },
              citation:          { type: 'string', description: 'REQUIRED.' },
            },
            required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
          },
        },
      },
      required: ['coverages'],
    },
  }
  const COVERAGE_SYSTEM =
    "You are a P&C actuarial analyst extracting structured coverage data from an insurance policy form. " +
    "Ground EVERY coverage in the document's actual text — never invent a coverage, form number, or limit. " +
    "Cite each item by section or heading. Call propose_coverages exactly once."

  const filingState = String(filingStateHint || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
  let baseFormNumber = policyFormDoc ? policyFormDoc.name.replace(/\.[^.]+$/, '') : 'BASE'

  const extractPolicyForm = async () => {
    if (policyFormDocs.length === 0) return []
    emit({ t: 'tool', name: 'filing:extract:policyForm', phase: 'start' })
    // EVERY policy form extracts (F13); with >1, each coverage's citation is
    // prefixed with its source document.
    const perDoc = await pMap(policyFormDocs, async (doc) => {
      const pdfText = doc.base64 ? extractText(doc.base64) : null
      const block   = buildContentBlock(doc, pdfText)
      const ladder  = await extractWithLadder({
        systemPrompt: COVERAGE_SYSTEM, tool: PROPOSE_COVERAGES_TOOL, block,
        instruction: `Extract ALL coverages this policy form defines. Filing state: ${filingState}. Every coverage MUST carry a citation (page + section).`,
        maxTokens: 8192, budget,
        sanitize: (raw) => (Array.isArray(raw?.coverages) ? raw.coverages : []).filter(c => c && c.name && c.citation),
        isEmpty: (r) => !r || r.length === 0,
        count: (r) => r?.length ?? 0, emit, label: `policy-form:${doc.name}`,
      })
      escalated = escalated || ladder.escalated
      return { doc, covs: ladder.result ?? [] }
    }, 2)
    const rawCovs = perDoc.flatMap(({ doc, covs }) =>
      policyFormDocs.length > 1
        ? covs.map(c => ({ ...c, citation: `${doc.name} — ${c.citation}` }))
        : covs)
    if (rawCovs[0]?.formNumbers?.[0]) baseFormNumber = rawCovs[0].formNumbers[0]
    emit({ t: 'tool', name: 'filing:extract:policyForm', phase: 'end', summary: `${rawCovs.length} coverage(s) from ${policyFormDocs.length} document(s)` })
    // formNumbers must ALWAYS be an array — reconcileFiling dereferences
    // c.formNumbers.length and a missing field crashes the whole reconcile.
    // F14: not-stated facts land as UNKNOWN / null — never a guessed value
    // (the old `!== false` turned an ABSENT premium marker into true).
    const reqOf = (v) => {
      const t = String(v ?? '').toUpperCase()
      return t === 'MANDATORY' || t === 'OPTIONAL' ? t : 'UNKNOWN'
    }
    const pgOf = (v) => {
      if (v === true || v === 'YES' || v === 'TRUE') return true
      if (v === false || v === 'NO' || v === 'FALSE') return false
      return null
    }
    return rawCovs.map(c => ({
      name: c.name,
      requirement: reqOf(c.requirement),
      premiumGenerating: pgOf(c.premiumGenerating),
      formNumbers: Array.isArray(c.formNumbers) ? c.formNumbers.filter(n => n && typeof n === 'string') : [],
      confidence: Number(c.confidence ?? 0.7),
      citation: c.citation,
    }))
  }

  // All three documents extract concurrently — they are independent artifacts.
  const [rateOrder, manual, policyFormCoverageItems] = await Promise.all([
    extractRateOrder(),
    extractManual(),
    extractPolicyForm(),
  ])

  const policyForm = { coverages: { items: policyFormCoverageItems }, forms: { items: [] }, rules: { items: [] }, rating: { items: [] } }

  // ── RECONCILE (pure/deterministic — no AI) ──
  emit({ t: 'tool', name: 'filing:reconcile', phase: 'start' })
  const extraction = {
    classifications,
    rateOrder,
    manual,
    policyForm,
    filingState,
    baseFormNumber,
    baseFormEdition: '',
    productName: productNameHint || baseFormNumber || 'Imported Filing',
  }

  let bundle
  try {
    // F18: the stage-0 router already derived the line from content — thread it.
    bundle = reconcile(extraction, { lobRefIdHint })
  } catch (e) {
    console.warn('[stage-filing] reconcileFiling failed (filing-shared.cjs may not be built):', e.message)
    // Registry-resolved lob OBJECT even on the fallback (a bare-string lob
    // breaks the app's product surfaces); hint honored, PH the warned default.
    let registryLob = null
    let fbPrefix = 'PH'
    try {
      const reg = require('../import-brain-shared.cjs').LOB_REGISTRY
      registryLob = lobRefIdHint && reg && reg[lobRefIdHint] ? { refId: reg[lobRefIdHint].refId, name: reg[lobRefIdHint].name } : null
      if (registryLob) fbPrefix = reg[lobRefIdHint].refIdPrefix || reg[lobRefIdHint].code || 'PH'
    } catch { /* registry bundle unavailable — default below */ }
    const fallbackLob = registryLob ?? { refId: 'PH.LOB.001', name: 'Personal Home' }
    // F15: a minted id carries the SYNTH marker — never mistakable for a source id.
    const fbProductRefId = `${fbPrefix}.PROD.SYNTH.FIL${filingState}`
    bundle = {
      plan: {
        productId: fbProductRefId,
        product: { docId: 'fil-prod', label: extraction.productName, data: { refId: fbProductRefId, name: extraction.productName, lob: fallbackLob, state: filingState } },
        coverages: [], forms: [], rules: [], formRules: [], ratingProgram: null, ldTables: [], rtTables: [],
      },
      counts: { proposed: 0, accepted: 0, unresolved: 0 },
      review: {},
      unresolved: [],
    }
  }
  // ── F13 visibility: every document lands somewhere the reviewer can see ────
  // Real classifications replace the 'unknown' placeholders normalizeBundle
  // would otherwise mint, and unprocessed documents enter BOTH importWarnings
  // and the conservation ledger (proposed/unresolved move together so
  // proposed = accepted + unresolved keeps holding).
  bundle.fingerprint = bundle.fingerprint || {}
  // Keep the scalars normalizeBundle would have minted — pre-creating the
  // fingerprint must never blank the container/format badges (judge-found).
  if (!bundle.fingerprint.container) bundle.fingerprint.container = 'PDF'
  if (!bundle.fingerprint.detectedFormat) bundle.fingerprint.detectedFormat = 'COMPANY_FILING_PDF'
  if (!Array.isArray(bundle.fingerprint.lineGuesses)) bundle.fingerprint.lineGuesses = []
  bundle.fingerprint.documentRoles = classifications.map(c => ({
    documentName: c.name, role: c.role, confidence: c.confidence,
    ...(Array.isArray(c.secondaryRoles) && c.secondaryRoles.length > 0 ? { secondaryRoles: c.secondaryRoles } : {}),
  }))
  if (unprocessedDocs.length > 0) {
    bundle.importWarnings = Array.isArray(bundle.importWarnings) ? bundle.importWarnings : []
    bundle.unresolved = Array.isArray(bundle.unresolved) ? bundle.unresolved : []
    bundle.counts = bundle.counts || { proposed: 0, accepted: 0, unresolved: 0 }
    for (const { doc, role, cue } of unprocessedDocs) {
      bundle.importWarnings.push({ kind: 'unprocessed-document', sheet: null, row: null, field: null, detail: `${doc.name} classified "${role}" (${cue}) — not extracted; review it manually or re-upload it separately.` })
      // UnresolvedItem contract: {stage, kind, name, reason, citation} — the
      // review UI renders u.name, so the DOCUMENT NAME must live there.
      bundle.unresolved.push({ stage: 'classify', kind: 'unprocessed-document', name: doc.name, reason: `document classified "${role}" was not extracted`, citation: cue || '(no structural cue)' })
      bundle.counts.proposed += 1
      bundle.counts.unresolved += 1
    }
    emit({ t: 'notice', level: 'warn', kind: 'unprocessed-document', message: `${unprocessedDocs.length} document(s) were not extracted (${unprocessedDocs.map(u => u.doc.name).join(', ')}) — surfaced in the review queue.` })
  }

  emit({ t: 'tool', name: 'filing:reconcile', phase: 'end', summary: `${bundle.counts?.accepted ?? 0} accepted, ${bundle.counts?.unresolved ?? 0} unresolved` })
  emit({ t: 'json', key: 'filing:bundle', value: bundle })

  return { bundle, extraction, escalated }
}

module.exports = { runFilingPipeline }
