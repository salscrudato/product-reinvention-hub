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
      // ── Concept-linker tail (R4): resolve the ambiguous links the deterministic passes left
      //    open. ONLY reference entity ids that appear in the provided MODEL ID SETS — a link to
      //    an id not in those sets is rejected. Cite the exact source row for every proposal. ──
      ratingGroupLinks: {
        type: 'array',
        description: 'Rating groups (from UNMATCHED RATING GROUPS) resolved to the coverage(s) they rate. refIds MUST be coverage refIds from MODEL COVERAGE IDS.',
        items: {
          type: 'object',
          properties: {
            groupName:  { type: 'string', description: 'Exact rating-group name as it appears in the source' },
            refIds:     { type: 'array', items: { type: 'string' }, description: 'Coverage refId(s) from MODEL COVERAGE IDS' },
            cellRef:    { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['groupName', 'refIds', 'cellRef', 'confidence'],
        },
      },
      tableCoverageLinks: {
        type: 'array',
        description: 'Reference tables (from UNLINKED REFERENCE TABLES) resolved to the coverage(s) whose terms they carry. refIds MUST be coverage refIds from MODEL COVERAGE IDS.',
        items: {
          type: 'object',
          properties: {
            tableRefId: { type: 'string', description: 'The reference-table refId (from UNLINKED REFERENCE TABLES)' },
            refIds:     { type: 'array', items: { type: 'string' }, description: 'Coverage refId(s) from MODEL COVERAGE IDS' },
            cellRef:    { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['tableRefId', 'refIds', 'cellRef', 'confidence'],
        },
      },
      ruleReferenceLinks: {
        type: 'array',
        description: 'Rule references (from UNRESOLVED RULE REFERENCES) resolved to the reference table(s) they cite. refIds MUST be table refIds from MODEL TABLE IDS.',
        items: {
          type: 'object',
          properties: {
            referenceText: { type: 'string', description: 'Exact rule-reference text as it appears in the source' },
            refIds:        { type: 'array', items: { type: 'string' }, description: 'Reference-table refId(s) from MODEL TABLE IDS' },
            cellRef:       { type: 'string' },
            confidence:    { type: 'number' },
          },
          required: ['referenceText', 'refIds', 'cellRef', 'confidence'],
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
            kind:          { type: 'string', enum: ['columnAlias', 'enumCrosswalk', 'sheetRoleHint', 'ratingGroupLink', 'tableCoverageLink', 'ruleReferenceLink'] },
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
  const {
    headers, samples, dataValidationVocab, unmappedColumns, sheetsSkipped,
    unmatchedGroups = [], unlinkedTables = [], unresolvedRuleRefs = [],
    coverageRefIds = [], tableRefIds = [],
  } = input

  const systemPrompt = `You are an ISO insurance workbook mapping expert. Propose column alias mappings, enum crosswalk entries, sheet role classifications, AND concept links for gaps the deterministic importer could not resolve.

CRITICAL RULES:
1. Cite the exact cell reference (e.g. "Sheet1!A1") for EVERY proposal — uncited proposals are rejected.
2. Only cite cells that literally appear in the HEADER ROWS and SAMPLE DATA provided.
3. Do not invent mappings from general knowledge not present in the input.
4. Confidence threshold: omit proposals with confidence < 0.7.
5. Enum crosswalk: NEVER map "ISO Filed" or "Policy" to any canonical category — these are outliers.
6. If no literal evidence exists for a category, return an empty array for it.
7. CONCEPT LINKS (ratingGroupLinks / tableCoverageLinks / ruleReferenceLinks): every refId you
   propose MUST appear verbatim in the provided MODEL COVERAGE IDS / MODEL TABLE IDS. Never invent
   an id, and never resolve a genuinely-missing coverage — if the concept has no matching id in the
   model, omit it (it will be flagged for the customer to add).`

  const dataBlock = {
    type: 'text',
    text: [
      'UNMAPPED COLUMNS (need canonical field names):',
      JSON.stringify(unmappedColumns, null, 2),
      '',
      'SHEETS SKIPPED (need role hints):',
      JSON.stringify(sheetsSkipped, null, 2),
      '',
      'UNMATCHED RATING GROUPS (resolve to coverage refIds, or omit if genuinely missing):',
      JSON.stringify(unmatchedGroups, null, 2),
      '',
      'UNLINKED REFERENCE TABLES (resolve to coverage refIds):',
      JSON.stringify(unlinkedTables, null, 2),
      '',
      'UNRESOLVED RULE REFERENCES (resolve to table refIds):',
      JSON.stringify(unresolvedRuleRefs, null, 2),
      '',
      'MODEL COVERAGE IDS (the ONLY valid coverage refIds):',
      JSON.stringify(coverageRefIds, null, 2),
      '',
      'MODEL TABLE IDS (the ONLY valid table refIds):',
      JSON.stringify(tableRefIds, null, 2),
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
const PROPOSAL_KINDS = [
  ['columnAliases',      'columnAlias'],
  ['enumCrosswalk',      'enumCrosswalk'],
  ['sheetRoleHints',     'sheetRoleHint'],
  ['ratingGroupLinks',   'ratingGroupLink'],
  ['tableCoverageLinks', 'tableCoverageLink'],
  ['ruleReferenceLinks', 'ruleReferenceLink'],
]

function applyVerdicts(proposals, verdicts) {
  if (!verdicts || !Array.isArray(verdicts.verified)) {
    // No verdicts → fail-safe: drop everything.
    const out = { droppedProposals: [] }
    for (const [field, kind] of PROPOSAL_KINDS) {
      out[field] = []
      ;(proposals[field] || []).forEach((item, i) => out.droppedProposals.push({ kind, index: i, item }))
    }
    return out
  }

  const rejectedIdx = Object.fromEntries(PROPOSAL_KINDS.map(([, kind]) => [kind, new Set()]))
  for (const v of verdicts.verified) {
    if (v.verified === false && v.kind && typeof v.proposalIndex === 'number') {
      rejectedIdx[v.kind]?.add(v.proposalIndex)
    }
  }

  const droppedProposals = []
  const out = { droppedProposals }
  for (const [field, kind] of PROPOSAL_KINDS) {
    out[field] = (proposals[field] || []).filter((item, i) => {
      if (rejectedIdx[kind].has(i)) { droppedProposals.push({ kind, index: i, item }); return false }
      return true
    })
  }
  return out
}

/** Drop any proposed link whose refIds are not ALL in the deterministic model's id sets — the
 *  AI may only reference entities that exist (dangling refs are never applied). Mutates `verified`
 *  in place and returns the count dropped. */
function validateEntityRefs(verified, coverageRefIds, tableRefIds) {
  const covSet = new Set(coverageRefIds || [])
  const tblSet = new Set(tableRefIds || [])
  let dropped = 0
  const keep = (arr, ids) => (arr || []).filter(p => {
    const ok = Array.isArray(p.refIds) && p.refIds.length > 0 && p.refIds.every(id => ids.has(id))
    if (!ok) { dropped++; verified.droppedProposals.push({ kind: 'danglingRef', item: p }) }
    return ok
  })
  verified.ratingGroupLinks   = keep(verified.ratingGroupLinks, covSet)
  verified.tableCoverageLinks = keep(verified.tableCoverageLinks, covSet)
  verified.ruleReferenceLinks = keep(verified.ruleReferenceLinks, tblSet)
  return dropped
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

  // Concept links (R4): keyed exactly as the shared mapper consumes them.
  const ratingGroupLinks = {}, tableCoverageLinks = {}, ruleReferenceLinks = {}
  for (const g of (verified.ratingGroupLinks || [])) {
    ratingGroupLinks[g.groupName] = g.refIds
    confidences[`rgl:${g.groupName}`] = g.confidence
    citations[`rgl:${g.groupName}`]   = g.cellRef
  }
  for (const t of (verified.tableCoverageLinks || [])) {
    tableCoverageLinks[t.tableRefId] = t.refIds
    confidences[`tcl:${t.tableRefId}`] = t.confidence
    citations[`tcl:${t.tableRefId}`]   = t.cellRef
  }
  for (const r of (verified.ruleReferenceLinks || [])) {
    ruleReferenceLinks[r.referenceText] = r.refIds
    confidences[`rrl:${r.referenceText}`] = r.confidence
    citations[`rrl:${r.referenceText}`]   = r.cellRef
  }

  return { columnAliases, enumOverrides, sheetRoleHints, ratingGroupLinks, tableCoverageLinks, ruleReferenceLinks, confidences, citations }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
async function proposeMapping(req, res) {
  const {
    unmappedColumns    = [],
    sheetsSkipped      = [],
    headers            = {},
    samples            = {},
    dataValidationVocab = {},
    // Concept-linker tail (R4): the ambiguous links the deterministic passes left open.
    unmatchedGroups    = [],
    unlinkedTables     = [],
    unresolvedRuleRefs = [],
    coverageRefIds     = [],
    tableRefIds        = [],
  } = req.body || {}

  const hasConceptTail = unmatchedGroups.length > 0 || unlinkedTables.length > 0 || unresolvedRuleRefs.length > 0

  // Guard: nothing to propose → return empty overlay without AI spend (8 known samples path).
  if (
    unmappedColumns.length === 0 &&
    sheetsSkipped.length === 0 &&
    Object.keys(dataValidationVocab).length === 0 &&
    !hasConceptTail
  ) {
    return res.json({ aliasOverlay: {}, enumOverlay: {}, confidences: {}, citations: {}, droppedProposals: [], meta: { skipped: true } })
  }

  const { allow, degrade, reason } = fleet.guard()
  if (!allow) return res.status(503).json({ error: 'ai_budget_ceiling', reason })

  const midDeploy         = fleet.resolveModel('MID_REASONER', degrade)   // claude-sonnet-5 (batch disambiguation)
  const groundedDeploy    = fleet.resolveModel('GROUNDED_CITED', degrade) // claude-opus-4-8 (escalation)
  const validatorDeployGPT = fleet.DEPLOY_GPT    // gpt-5.1 cross-family validator (may be undefined)
  const validatorDeployAnt = fleet.resolveModel('GROUNDED_CITED', false) // adversarial claude-opus-4-8

  const input = {
    headers, samples, dataValidationVocab, unmappedColumns, sheetsSkipped,
    unmatchedGroups, unlinkedTables, unresolvedRuleRefs, coverageRefIds, tableRefIds,
  }

  // ── Phase 1: PROPOSER ladder — MID_REASONER (sonnet-5) first, then escalate the concept-link
  //    RESIDUAL to GROUNDED_CITED (opus). Batched by category; telemetry (fleet.record) fires on
  //    every rung inside _forcedToolCall. ──
  let proposals
  try {
    proposals = await runProposer(input, midDeploy)
  } catch (err) {
    console.error('[proposeMapping] mid-reasoner proposer failed:', err.message)
    return res.status(500).json({ error: 'proposer_failed', message: err.message })
  }

  const key = (x, ...fields) => (typeof x === 'string' ? x : (fields.map(f => x?.[f]).find(Boolean) ?? ''))
  const resolvedG = new Set((proposals.ratingGroupLinks   || []).map(p => p.groupName))
  const resolvedT = new Set((proposals.tableCoverageLinks || []).map(p => p.tableRefId))
  const resolvedR = new Set((proposals.ruleReferenceLinks || []).map(p => p.referenceText))
  const residual = {
    unmatchedGroups:    unmatchedGroups.filter(g => !resolvedG.has(key(g, 'name', 'groupName'))),
    unlinkedTables:     unlinkedTables.filter(t => !resolvedT.has(key(t, 'refId', 'tableRefId'))),
    unresolvedRuleRefs: unresolvedRuleRefs.filter(r => !resolvedR.has(key(r, 'text', 'referenceText'))),
  }
  if ((residual.unmatchedGroups.length || residual.unlinkedTables.length || residual.unresolvedRuleRefs.length) && groundedDeploy !== midDeploy) {
    try {
      const esc = await runProposer({ ...input, ...residual }, groundedDeploy)
      proposals.ratingGroupLinks   = [...(proposals.ratingGroupLinks   || []), ...(esc.ratingGroupLinks   || [])]
      proposals.tableCoverageLinks = [...(proposals.tableCoverageLinks || []), ...(esc.tableCoverageLinks || [])]
      proposals.ruleReferenceLinks = [...(proposals.ruleReferenceLinks || []), ...(esc.ruleReferenceLinks || [])]
    } catch (err) {
      console.warn('[proposeMapping] grounded escalation failed (keeping mid-reasoner proposals):', err.message)
    }
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

  // ── Phase 3: Filter + validate entity refs + build overlay ───────────────
  const verified = applyVerdicts(proposals, verdicts)
  // Every concept-link refId must exist in the deterministic model — dangling refs are dropped
  // BEFORE the overlay is built, so an AI proposal can never link to an entity that isn't there.
  const danglingDropped = validateEntityRefs(verified, coverageRefIds, tableRefIds)
  const aliasOverlay = buildOverlay(verified)

  return res.json({
    aliasOverlay,
    enumOverlay:      aliasOverlay.enumOverrides,
    confidences:      aliasOverlay.confidences,
    citations:        aliasOverlay.citations,
    droppedProposals: verified.droppedProposals,
    meta: {
      proposerModel:   midDeploy,
      escalationModel: groundedDeploy,
      validatorModel:  validatorUsed,
      columnAliases:   (verified.columnAliases      || []).length,
      enumCrosswalk:   (verified.enumCrosswalk      || []).length,
      sheetRoleHints:  (verified.sheetRoleHints     || []).length,
      ratingGroupLinks:   (verified.ratingGroupLinks   || []).length,
      tableCoverageLinks: (verified.tableCoverageLinks || []).length,
      ruleReferenceLinks: (verified.ruleReferenceLinks || []).length,
      danglingDropped,
      dropped:        (verified.droppedProposals || []).length,
    },
  })
}

module.exports = { proposeMapping }
