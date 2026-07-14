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
  'actual text — never invent a variable, rule, factor, table row or number. Cite each item. For ' +
  'tables, return a SCHEMA + the verbatim region; deterministic code parses the rows. Call the ' +
  'forced tool exactly once.'

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

// ─── Escalation: haiku → sonnet → opus until the parse yields content ─────────
// A missing sonnet deployment (Foundry 4xx) is skipped; ladder degrades gracefully.

async function extractWithLadder({ systemPrompt, tool, block, instruction, maxTokens, budget, sanitize, isEmpty }) {
  let result = null
  let escalated = false
  for (const role of ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED']) {
    let deployment
    try { deployment = resolveAnthropic(role, budget) } catch { continue }
    let raw
    try { raw = await forcedTool(deployment, systemPrompt, [tool], tool.name, block, instruction, maxTokens, budget) } catch { raw = {} }
    const sanitized = sanitize(raw)
    if (!isEmpty(sanitized)) return { result: sanitized, escalated }
    result = result ?? sanitized
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
 * @param {object}    [opts.budget]          pre-created budget; created if omitted
 * @param {function}  [opts.emit]            SSE emit callback
 * @param {function}  [opts.extractPdfText]  (base64) => string | null  (injected by ai.js)
 * @returns {Promise<{bundle: object, extraction: object, escalated: boolean}>}
 */
async function runFilingPipeline(opts) {
  const { documents, productNameHint, filingStateHint } = opts
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

  const classifications = []
  for (const doc of documents) {
    const pdfText = doc.base64 ? extractText(doc.base64) : null
    const block   = buildContentBlock(doc, pdfText)
    const input   = await forcedTool(deployBulk, FILING_CLASSIFY_SYSTEM, [CLASSIFY_TOOL], CLASSIFY_TOOL.name, block, `Classify this document (filename: "${doc.name}").`, 500, budget)
      .catch(() => ({}))
    classifications.push(sanitizeCls(doc.name, input))
  }
  emit({ t: 'tool', name: 'filing:classify', phase: 'end', summary: classifications.map(c => `${String(c.name).split(/[\\/]/).pop()} -> ${c.role}`).join(', ') })
  emit({ t: 'json', key: 'filing:classifications', value: classifications })

  const roleOf = (role) => {
    const idx = classifications.findIndex(c => c.role === role)
    return idx !== -1 ? documents[idx] : null
  }
  const rateOrderDoc  = roleOf('rateOrder')
  const manualDoc     = roleOf('manual')
  const policyFormDoc = roleOf('policyForm')

  // ── EXTRACT: rate order (haiku → sonnet → opus until non-empty) ──
  let rateOrder = { variables: [] }
  if (rateOrderDoc) {
    emit({ t: 'tool', name: 'filing:extract:rateOrder', phase: 'start' })
    const pdfText = rateOrderDoc.base64 ? extractText(rateOrderDoc.base64) : null
    const block   = buildContentBlock(rateOrderDoc, pdfText)
    const ladder  = await extractWithLadder({
      systemPrompt: EXTRACT_SYSTEM, tool: RATE_ORDER_TOOL, block,
      instruction: 'Extract the rate order of calculations, in order.',
      maxTokens: 4000, budget,
      sanitize: sanitizeRO, isEmpty: (r) => !r || r.variables.length === 0,
    })
    rateOrder = ladder.result ?? { variables: [] }
    escalated = escalated || ladder.escalated
    emit({ t: 'tool', name: 'filing:extract:rateOrder', phase: 'end', summary: `${rateOrder.variables.length} variable(s)` })
  }

  // ── EXTRACT: manual (haiku → sonnet → opus until non-empty) ──
  let manual = { rules: [] }
  if (manualDoc) {
    emit({ t: 'tool', name: 'filing:extract:manual', phase: 'start' })
    const pdfText = manualDoc.base64 ? extractText(manualDoc.base64) : null
    const block   = buildContentBlock(manualDoc, pdfText)
    const ladder  = await extractWithLadder({
      systemPrompt: EXTRACT_SYSTEM, tool: MANUAL_TOOL, block,
      instruction: "Extract the manual's numbered rules — schemas + verbatim regions for tables, scalars for single facts.",
      maxTokens: 8000, budget,
      sanitize: sanitizeMnl, isEmpty: (r) => !r || r.rules.length === 0,
    })
    manual = ladder.result ?? { rules: [] }
    escalated = escalated || ladder.escalated
    emit({ t: 'tool', name: 'filing:extract:manual', phase: 'end', summary: `${manual.rules.length} rule(s)` })
  }

  // ── EXTRACT: policy form coverages (single-pass forced propose_coverages) ──
  // The full runFourSectionExtraction is not yet ported; use the same forced-tool approach
  // the original unifiedImport handler uses (haiku, forced propose_coverages tool).
  const PROPOSE_COVERAGES_TOOL = {
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
  let policyFormCoverageItems = []
  let baseFormNumber = policyFormDoc ? policyFormDoc.name.replace(/\.[^.]+$/, '') : 'BASE'
  if (policyFormDoc) {
    emit({ t: 'tool', name: 'filing:extract:policyForm', phase: 'start' })
    const pdfText = policyFormDoc.base64 ? extractText(policyFormDoc.base64) : null
    const block   = buildContentBlock(policyFormDoc, pdfText)
    const ladder  = await extractWithLadder({
      systemPrompt: COVERAGE_SYSTEM, tool: PROPOSE_COVERAGES_TOOL, block,
      instruction: `Extract ALL coverages this policy form defines. Filing state: ${filingState}.`,
      maxTokens: 4096, budget,
      sanitize: (raw) => (Array.isArray(raw?.coverages) ? raw.coverages : []).filter(c => c && c.name && c.citation),
      isEmpty: (r) => !r || r.length === 0,
    })
    const rawCovs = ladder.result ?? []
    escalated = escalated || ladder.escalated
    // formNumbers must ALWAYS be an array — reconcileFiling dereferences
    // c.formNumbers.length and a missing field crashes the whole reconcile.
    policyFormCoverageItems = rawCovs.map(c => ({
      name: c.name,
      requirement: c.requirement,
      premiumGenerating: c.premiumGenerating !== false,
      formNumbers: Array.isArray(c.formNumbers) ? c.formNumbers.filter(n => n && typeof n === 'string') : [],
      confidence: Number(c.confidence ?? 0.7),
      citation: c.citation,
    }))
    if (rawCovs[0]?.formNumbers?.[0]) baseFormNumber = rawCovs[0].formNumbers[0]
    emit({ t: 'tool', name: 'filing:extract:policyForm', phase: 'end', summary: `${rawCovs.length} coverage(s)` })
  }

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
    bundle = reconcile(extraction)
  } catch (e) {
    console.warn('[stage-filing] reconcileFiling failed (filing-shared.cjs may not be built):', e.message)
    bundle = {
      plan: {
        productId: `FIL.${filingState}.PROD`,
        product: { docId: 'fil-prod', label: extraction.productName, data: { refId: `FIL.${filingState}.PROD`, name: extraction.productName, lob: 'PH', state: filingState } },
        coverages: [], forms: [], rules: [], formRules: [], ratingProgram: null, ldTables: [], rtTables: [],
      },
      counts: { proposed: 0, accepted: 0, unresolved: 0 },
      review: {},
      unresolved: [],
    }
  }
  emit({ t: 'tool', name: 'filing:reconcile', phase: 'end', summary: `${bundle.counts?.accepted ?? 0} accepted, ${bundle.counts?.unresolved ?? 0} unresolved` })
  emit({ t: 'json', key: 'filing:bundle', value: bundle })

  return { bundle, extraction, escalated }
}

module.exports = { runFilingPipeline }
