'use strict'
// propose-mapping.js — PROPOSER + VALIDATOR ensemble for ISO workbook column/enum mapping.
//
// PROPOSER: claude-opus-4-8 (GROUNDED_CITED) — proposes column aliases, sheet-role hints,
//   enum crosswalk entries, citing exact cells from header rows + 15-row samples only.
// VALIDATOR: gpt-5.1 (cross-family) → adversarial claude-opus-4-8 fallback — confirms each
//   proposal points at literally existing text; drops anything unverifiable.
//
// POST /api/ai/proposeMapping
// Role: EDITOR+ (via requireCapability on the parent router)
// Body: { headers, samples, dataValidationVocab, unmappedColumns, sheetsSkipped }
// Returns: { aliasOverlay, enumOverlay, confidences, citations, droppedProposals, meta }

const fleet = require('../fleet')
const { _forcedToolCall, fetchWithRetry } = require('./_shared')

// ─── Anthropic PROPOSER tool schema ──────────────────────────────────────────
const PROPOSER_TOOL = {
  name: 'proposeColumnMappings',
  description: 'Propose canonical field mappings, enum crosswalk entries, and sheet role classifications for an ISO workbook where the deterministic mapper left gaps. Cite the exact cell reference for EVERY proposal.',
  input_schema: {
    type: 'object',
    properties: {
      columnAliases: {
        type: 'array',
        description: 'Column header values that map to canonical ISO importer fields.',
        items: {
          type: 'object',
          properties: {
            canonicalField: { type: 'string', description: 'Canonical field name (e.g. "coverage", "formNumber", "id", "category")' },
            headerValue:    { type: 'string', description: 'Exact header cell value as it appears in the source data' },
            cellRef:        { type: 'string', description: 'Cell reference e.g. "Sheet1!B1"' },
            confidence:     { type: 'number', description: '0.0-1.0 confidence' },
          },
          required: ['canonicalField', 'headerValue', 'cellRef', 'confidence'],
        },
      },
      enumCrosswalk: {
        type: 'array',
        description: 'Enum values that map to canonical FormCategory values. Valid targets: BASE_COVERAGE, DECLARATIONS, ENDORSEMENT, EXCLUSION, SCHEDULE, POLICY_NOTICE, POLICY_CONDITIONS, OTHER. NEVER propose ENDORSEMENT for "ISO Filed" or "Policy".',
        items: {
          type: 'object',
          properties: {
            rawValue:          { type: 'string', description: 'Exact raw enum value from the source data' },
            canonicalCategory: { type: 'string', description: 'Target canonical FormCategory' },
            cellRef:           { type: 'string', description: 'Cell reference where this value was observed' },
            confidence:        { type: 'number' },
          },
          required: ['rawValue', 'canonicalCategory', 'cellRef', 'confidence'],
        },
      },
      sheetRoleHints: {
        type: 'array',
        description: 'Sheet name to role classifications for sheets the deterministic parser could not identify.',
        items: {
          type: 'object',
          properties: {
            sheetName:  { type: 'string' },
            role:       { type: 'string', enum: ['framework', 'forms', 'rules', 'rating', 'dynamic', 'ldTables', 'rtTables'] },
            cellRef:    { type: 'string', description: 'Sheet tab name or specific cell supporting this classification' },
            confidence: { type: 'number' },
          },
          required: ['sheetName', 'role', 'cellRef', 'confidence'],
        },
      },
    },
    required: ['columnAliases', 'enumCrosswalk', 'sheetRoleHints'],
  },
}

// ─── Anthropic VALIDATOR tool schema ─────────────────────────────────────────
const VALIDATOR_TOOL_ANTHROPIC = {
  name: 'validateProposals',
  description: 'Adversarial validator: confirm that each proposal cited cell literally contains the stated value in the source data. Uncited proposals are automatically rejected. Drop aggressively — only verify=true when the cell text is literally present.',
  input_schema: {
    type: 'object',
    properties: {
      verified: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind:          { type: 'string', enum: ['columnAlias', 'enumCrosswalk', 'sheetRoleHint'] },
            proposalIndex: { type: 'number', description: 'Zero-based index into the proposals array for this kind' },
            verified:      { type: 'boolean', description: 'true = literal text confirmed in source; false = rejected' },
            reason:        { type: 'string', description: 'Brief reason for rejection (omit if verified=true)' },
          },
          required: ['kind', 'proposalIndex', 'verified'],
        },
      },
    },
    required: ['verified'],
  },
}

// ─── OpenAI function-calling equivalent (gpt-5.1 cross-family validator) ─────
const VALIDATOR_TOOL_OPENAI = {
  type: 'function',
  function: {
    name: 'validateProposals',
    description: VALIDATOR_TOOL_ANTHROPIC.description,
    parameters: VALIDATOR_TOOL_ANTHROPIC.input_schema,
  },
}

// ─── PROPOSER ─────────────────────────────────────────────────────────────────
async function runProposer(input, deployment) {
  const { headers, samples, dataValidationVocab, unmappedColumns, sheetsSkipped } = input

  const systemPrompt = `You are an ISO insurance workbook mapping expert. Propose column alias mappings, enum crosswalk entries, and sheet role classifications for gaps the deterministic importer could not resolve.

CRITICAL RULES:
1. Cite the exact cell reference (e.g. "Sheet1!A1") for EVERY proposal — uncited proposals are rejected.
2. Only cite cells that literally appear in the HEADER ROWS and SAMPLE DATA provided.
3. Do not invent mappings from general knowledge not present in the input.
4. Confidence threshold: omit proposals with confidence < 0.7.
5. Enum crosswalk: NEVER map "ISO Filed" or "Policy" to any canonical category — these are outliers.
6. If no literal evidence exists for a category, return an empty array for it.`

  const dataBlock = {
    type: 'text',
    text: [
      'UNMAPPED COLUMNS (need canonical field names):',
      JSON.stringify(unmappedColumns, null, 2),
      '',
      'SHEETS SKIPPED (need role hints):',
      JSON.stringify(sheetsSkipped, null, 2),
      '',
      'DATA VALIDATION VOCAB (workbook dropdown values):',
      JSON.stringify(dataValidationVocab, null, 2),
      '',
      'HEADER ROWS + 15-ROW SAMPLE PER SHEET:',
      JSON.stringify(headers, null, 2),
      '',
      'SAMPLE DATA:',
      JSON.stringify(samples, null, 2),
    ].join('\n'),
    cache_control: { type: 'ephemeral' },
  }

  return _forcedToolCall(
    deployment,
    systemPrompt,
    [PROPOSER_TOOL],
    'proposeColumnMappings',
    [dataBlock],
    'Propose column aliases, enum crosswalk entries, and sheet role hints. Cite every proposal.',
    2048,
  )
}

// ─── VALIDATOR via OpenAI / gpt-5.1 (cross-family) ───────────────────────────
async function runValidatorGPT(input, proposals, deployment) {
  const sourceSnippet = JSON.stringify({
    headers: input.headers,
    samples: input.samples,
    dataValidationVocab: input.dataValidationVocab,
  }, null, 2)

  const body = {
    model: deployment,
    messages: [
      {
        role: 'system',
        content: 'You are a hostile proposal validator. Verify each AI mapping proposal against the literal source data only. Reject anything not literally present at the cited cell. Call validateProposals with your verdict for every proposal.',
      },
      {
        role: 'user',
        content: `SOURCE DATA (literal input — only this matters):\n${sourceSnippet}\n\nPROPOSALS TO VALIDATE:\n${JSON.stringify(proposals, null, 2)}\n\nFor each proposal, confirm the cellRef literally contains the stated text. Return verified=false for anything you cannot confirm.`,
      },
    ],
    max_completion_tokens: 1024,
    tools: [VALIDATOR_TOOL_OPENAI],
    tool_choice: { type: 'function', function: { name: 'validateProposals' } },
  }

  const resp = await fetchWithRetry(fleet.openaiChatUrl(), {
    method: 'POST',
    headers: fleet.openaiHeaders(),
    body: JSON.stringify(body),
  }, { timeoutMs: 60_000 })

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 200)
    throw new Error(`GPT validator ${resp.status}: ${detail}`)
  }
  const json = await resp.json()
  fleet.record(deployment, json.usage?.prompt_tokens, json.usage?.completion_tokens)

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall) return null
  try { return JSON.parse(toolCall.function?.arguments || '{}') } catch { return null }
}

// ─── VALIDATOR via Anthropic / adversarial claude-opus-4-8 (fallback) ────────
async function runValidatorAnthropic(input, proposals, deployment) {
  const systemPrompt = `You are an adversarial validator. Your only job is to reject mapping proposals that cannot be confirmed by literal text in the source data provided. For each proposal: does the cited cell literally contain exactly the stated text? When in doubt, reject (verified=false). Uncited proposals are automatically rejected. Be maximally skeptical.`

  const dataBlock = {
    type: 'text',
    text: [
      'SOURCE DATA (literal input — only this is authoritative):',
      JSON.stringify({ headers: input.headers, samples: input.samples, dataValidationVocab: input.dataValidationVocab }, null, 2),
      '',
      'PROPOSALS TO VALIDATE:',
      JSON.stringify(proposals, null, 2),
    ].join('\n'),
    cache_control: { type: 'ephemeral' },
  }

  return _forcedToolCall(
    deployment,
    systemPrompt,
    [VALIDATOR_TOOL_ANTHROPIC],
    'validateProposals',
    [dataBlock],
    'Validate each proposal. Call validateProposals with verified=true only when the cited cell literally contains the stated text.',
    1024,
  )
}

// ─── Apply validation verdicts ────────────────────────────────────────────────
function applyVerdicts(proposals, verdicts) {
  if (!verdicts || !Array.isArray(verdicts.verified)) {
    // No verdicts → fail-safe: drop everything.
    return {
      columnAliases:   [],
      enumCrosswalk:   [],
      sheetRoleHints:  [],
      droppedProposals: [
        ...(proposals.columnAliases  || []).map((item, i) => ({ kind: 'columnAlias',     index: i, item })),
        ...(proposals.enumCrosswalk  || []).map((item, i) => ({ kind: 'enumCrosswalk',   index: i, item })),
        ...(proposals.sheetRoleHints || []).map((item, i) => ({ kind: 'sheetRoleHint',   index: i, item })),
      ],
    }
  }

  const rejectedIdx = { columnAlias: new Set(), enumCrosswalk: new Set(), sheetRoleHint: new Set() }
  for (const v of verdicts.verified) {
    if (v.verified === false && v.kind && typeof v.proposalIndex === 'number') {
      rejectedIdx[v.kind]?.add(v.proposalIndex)
    }
  }

  const droppedProposals = []
  const filterKind = (arr, kind, rejSet) => arr.filter((item, i) => {
    if (rejSet.has(i)) { droppedProposals.push({ kind, index: i, item }); return false }
    return true
  })

  return {
    columnAliases:   filterKind(proposals.columnAliases  || [], 'columnAlias',    rejectedIdx.columnAlias),
    enumCrosswalk:   filterKind(proposals.enumCrosswalk  || [], 'enumCrosswalk',  rejectedIdx.enumCrosswalk),
    sheetRoleHints:  filterKind(proposals.sheetRoleHints || [], 'sheetRoleHint',  rejectedIdx.sheetRoleHint),
    droppedProposals,
  }
}

// ─── Build AliasOverlay from verified proposals ───────────────────────────────
function buildOverlay(verified) {
  const columnAliases  = {}
  const enumOverrides  = {}
  const sheetRoleHints = {}
  const confidences    = {}
  const citations      = {}

  for (const ca of (verified.columnAliases || [])) {
    if (!columnAliases[ca.canonicalField]) columnAliases[ca.canonicalField] = []
    columnAliases[ca.canonicalField].push(ca.headerValue)
    const key = `col:${ca.canonicalField}:${ca.headerValue}`
    confidences[key] = ca.confidence
    citations[key]   = ca.cellRef
  }

  for (const ec of (verified.enumCrosswalk || [])) {
    const key = ec.rawValue.toUpperCase().replace(/\s+/g, ' ').trim()
    enumOverrides[key] = ec.canonicalCategory
    confidences[`enum:${key}`] = ec.confidence
    citations[`enum:${key}`]   = ec.cellRef
  }

  for (const sh of (verified.sheetRoleHints || [])) {
    sheetRoleHints[sh.sheetName] = sh.role
    confidences[`sheet:${sh.sheetName}`] = sh.confidence
    citations[`sheet:${sh.sheetName}`]   = sh.cellRef
  }

  return { columnAliases, enumOverrides, sheetRoleHints, confidences, citations }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
async function proposeMapping(req, res) {
  const {
    unmappedColumns    = [],
    sheetsSkipped      = [],
    headers            = {},
    samples            = {},
    dataValidationVocab = {},
  } = req.body || {}

  // Guard: nothing to propose → return empty overlay without AI spend (8 known samples path).
  if (
    unmappedColumns.length === 0 &&
    sheetsSkipped.length === 0 &&
    Object.keys(dataValidationVocab).length === 0
  ) {
    return res.json({ aliasOverlay: {}, enumOverlay: {}, confidences: {}, citations: {}, droppedProposals: [], meta: { skipped: true } })
  }

  const { allow, degrade, reason } = fleet.guard()
  if (!allow) return res.status(503).json({ error: 'ai_budget_ceiling', reason })

  const proposerDeploy    = fleet.resolveModel('GROUNDED_CITED', degrade)
  const validatorDeployGPT = fleet.DEPLOY_GPT    // gpt-5.1 cross-family validator (may be undefined)
  const validatorDeployAnt = fleet.resolveModel('GROUNDED_CITED', false) // adversarial claude-opus-4-8

  const input = { headers, samples, dataValidationVocab, unmappedColumns, sheetsSkipped }

  // ── Phase 1: PROPOSER (claude-opus-4-8, GROUNDED_CITED) ──────────────────
  let proposals
  try {
    proposals = await runProposer(input, proposerDeploy)
  } catch (err) {
    console.error('[proposeMapping] proposer failed:', err.message)
    return res.status(500).json({ error: 'proposer_failed', message: err.message })
  }

  // ── Phase 2: VALIDATOR (cross-family gpt-5.1, then adversarial claude fallback) ──
  let verdicts = null
  let validatorUsed = 'none'

  if (validatorDeployGPT) {
    try {
      verdicts     = await runValidatorGPT(input, proposals, validatorDeployGPT)
      validatorUsed = validatorDeployGPT
    } catch (err) {
      console.warn('[proposeMapping] gpt validator failed, falling back to adversarial claude:', err.message)
    }
  }

  if (!verdicts) {
    try {
      verdicts     = await runValidatorAnthropic(input, proposals, validatorDeployAnt)
      validatorUsed = validatorDeployAnt
    } catch (err) {
      console.error('[proposeMapping] adversarial claude validator failed:', err.message)
      // Fail-safe: treat all verdicts as unverified (applyVerdicts handles null).
    }
  }

  // ── Phase 3: Filter + build overlay ──────────────────────────────────────
  const verified     = applyVerdicts(proposals, verdicts)
  const aliasOverlay = buildOverlay(verified)

  return res.json({
    aliasOverlay,
    enumOverlay:      aliasOverlay.enumOverrides,
    confidences:      aliasOverlay.confidences,
    citations:        aliasOverlay.citations,
    droppedProposals: verified.droppedProposals,
    meta: {
      proposerModel:  proposerDeploy,
      validatorModel: validatorUsed,
      columnAliases:  (verified.columnAliases  || []).length,
      enumCrosswalk:  (verified.enumCrosswalk  || []).length,
      sheetRoleHints: (verified.sheetRoleHints || []).length,
      dropped:        (verified.droppedProposals || []).length,
    },
  })
}

module.exports = { proposeMapping }
