'use strict'
// server/lib/import-brain/stage1-classify.js — Sheet classification.
//
// Pipeline per sheet:
//   a. BULK (haiku) + BULK_ALT (gpt-5-mini) prefilter in parallel.
//      Both must agree it is non-content to skip without full reasoning.
//   b. REASONER_A (opus) + REASONER_B (gpt-5.1) classify independently in parallel.
//   c. Agreement  → auto-accept with averaged confidence.
//   d. Disagreement → adjudication pass (REASONER_A sees both rationales).
//   e. Adjudicator cannot resolve → humanFlagNeeded=true, domain='ignore'.
//
// REASONER_B is gpt-5.1 (OpenAI) — different family from REASONER_A (opus/Anthropic)
// for ensemble decorrelation (same rationale as the stage 5 adversarial validator).
// Temperature 0 on all Claude calls; OpenAI o-series does not accept temperature.

const fleet = require('../fleet')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const {
  STAGE1_PREFILTER_SYSTEM, STAGE1_CLASSIFY_SYSTEM, STAGE1_ADJUDICATE_SYSTEM,
} = require('./prompts')
const {
  extractJson, SHEET_DOMAINS, pMap, parseWithRetry, recordVote,
  TRUNCATED_STOP_REASONS, REFUSAL_STOP_REASONS,
} = require('./constants')

// Completion budgets. The bulk prefilter and both reasoner classifiers run on
// reasoning-class models on the OpenAI leg (gpt-5-mini / gpt-5.1) which spend
// completion budget on internal reasoning BEFORE emitting the vote — the
// 2026-07-27 live probe measured gpt-5-mini at 128 tokens returning
// finish_reason 'length' with ZERO content in 2/3 trials (all 128 tokens burned
// as reasoning). Output stays schema-bounded; only reasoning headroom grows.
const PREFILTER_MAX_TOKENS = 1024
const CLASSIFY_MAX_TOKENS  = 2048

// ─── Forced tools (schema-bounded verdicts) ───────────────────────────────────
// Classification and adjudication sit on the conflict-resolution path — the
// decisions confidence can only ratchet upward from. Free-text JSON left the
// domain to prose luck; a forced tool with an enum-constrained domain makes an
// out-of-vocabulary answer unrepresentable at the schema layer, and the parse
// helpers below still validate membership (belt and suspenders, both families
// probe-verified on this Foundry surface: tool_use / tool_calls with valid
// enum values on opus, gpt-5.1, gpt-5-mini and DeepSeek-V4-Pro, 2026-07-27).
// Declared Anthropic-shape; callOpenAI converts to function-calling on the fly
// (the filing pipeline proves the pattern under the same plumbing).

const CLASSIFY_TOOL = {
  name: 'classify_sheet',
  description: 'Classify the sheet into exactly one canonical domain. Call this tool exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      domain:     { type: 'string', enum: SHEET_DOMAINS },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale:  { type: 'string', description: 'One sentence citing the specific cell content.' },
    },
    required: ['domain', 'confidence', 'rationale'],
  },
}

const ADJUDICATE_TOOL = {
  name: 'adjudicate_sheet',
  description: 'Resolve the classifier disagreement into one domain, or flag for a human. Call this tool exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      domain:     { type: 'string', enum: SHEET_DOMAINS },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale:  { type: 'string', description: 'One sentence citing the specific cell content.' },
      humanFlag:  { type: 'boolean', description: 'true when neither rationale is convincing.' },
    },
    required: ['domain', 'confidence', 'rationale', 'humanFlag'],
  },
}

// ─── Serialise sheet metadata for the model ────────────────────────────────────
// Compact, grounding-safe representation of a SheetFingerprint.

function serialiseSheet(fp) {
  const headers = (fp.columnProfiles || [])
    .filter(c => c.headerLabel)
    .map(c => {
      const tag = c.isEnumLike ? 'enum' : c.hasDollarPattern ? '$' : c.hasDatePattern ? 'date' : 'text'
      return `  Col ${c.colIndex}: "${c.headerLabel}" [${tag}]`
    })
    .join('\n')

  const samples = (fp.columnProfiles || [])
    .slice(0, 8)
    .filter(c => c.distinctSample && c.distinctSample.length > 0)
    .map(c => `  Col ${c.colIndex}: ${c.distinctSample.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}`)
    .join('\n')

  const defSnippet = fp.definitions
    ? fp.definitions.slice(0, 5).map(d => `  "${d.columnName}": ${d.description.slice(0, 80)}`).join('\n')
    : ''

  return [
    `Sheet name: "${fp.sheetName}"`,
    `Layout: ${fp.layoutShape} | Data rows: ${fp.dataRowCount} | Columns: ${fp.dataColCount}`,
    fp.isDefinitionsSheet ? '(This is a Definitions/Glossary sheet)' : '',
    headers ? `Column headers:\n${headers}` : '(No clear header row detected)',
    samples ? `Sample cell values:\n${samples}` : '',
    defSnippet ? `Definition entries:\n${defSnippet}` : '',
  ].filter(Boolean).join('\n')
}

// ─── Safe parse helpers ────────────────────────────────────────────────────────

function parsePrefilter(raw) {
  try {
    const obj = extractJson(raw)
    if (typeof obj.prefilter !== 'boolean') return null
    return { prefilter: Boolean(obj.prefilter), reason: String(obj.reason ?? 'unknown') }
  } catch { return null }
}

function parseClassify(raw) {
  try {
    const obj = extractJson(raw)
    const domain = obj.domain
    if (!SHEET_DOMAINS.includes(domain)) return null
    return { domain, confidence: Number(obj.confidence ?? 0.5), rationale: String(obj.rationale ?? '') }
  } catch { return null }
}

function parseAdjudicate(raw) {
  try {
    const obj = extractJson(raw)
    const domain = obj.domain
    if (!SHEET_DOMAINS.includes(domain)) return null
    return {
      domain,
      confidence: Number(obj.confidence ?? 0.5),
      rationale:  String(obj.rationale ?? ''),
      humanFlag:  Boolean(obj.humanFlag ?? false),
    }
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} sheets  SheetFingerprint[]
 * @param {object}   budget  { degraded: boolean }
 * @param {object[]} review  ReviewItem[] (mutated in place)
 * @returns {Promise<object[]>} ClassifiedSheet[]
 */
async function classifySheets(sheets, budget, review) {
  // Resolve deployments — all four calls go through fleet.guard() via resolvers.
  const deployBulk    = resolveAnthropic('BULK_VERIFY', budget)
  const deployOpus    = resolveAnthropic('GROUNDED_CITED', budget)
  const deployGptMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget)  // BULK_ALT prefilter
  const deployGpt     = resolveOpenAI(fleet.DEPLOY_GPT, budget)       // REASONER_B (gpt-5.1)

  // Sheets classify independently — run up to 4 in flight (pMap keeps order).
  async function classifyOne(fp) {
    // Auto-classify Definitions sheets — fingerprinter already identified them.
    if (fp.isDefinitionsSheet) {
      return {
        sheetName:       fp.sheetName,
        domain:          'definitions',
        confidence:      1.0,
        rationale:       'Fingerprinter identified this as a Definitions/Glossary sheet.',
        disagreed:       false,
        humanFlagNeeded: false,
      }
    }

    const meta = serialiseSheet(fp)

    // ── Step a: BULK + BULK_ALT prefilter (parallel) ────────────────────────
    // A failed leg is a MISSING VOTE, counted per family/outcome — a starved or
    // refusing leg must be visible in brain:spend, never an indistinguishable ''.
    const [pfA, pfB] = await Promise.all([
      callAnthropic({ deployment: deployBulk, systemPrompt: STAGE1_PREFILTER_SYSTEM, userPrompt: meta, maxTokens: PREFILTER_MAX_TOKENS, budget }).catch(() => null),
      callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE1_PREFILTER_SYSTEM, userPrompt: meta, maxTokens: PREFILTER_MAX_TOKENS, budget }).catch(() => null),
    ])

    const prefilterVote = (res, family) => {
      const site = 'stage1-prefilter'
      if (!res) { recordVote(budget, site, family, 'empty'); return null }
      if (TRUNCATED_STOP_REASONS.has(res.stopReason)) { recordVote(budget, site, family, 'truncated'); return null }
      if (REFUSAL_STOP_REASONS.has(res.stopReason)) { recordVote(budget, site, family, 'refused'); return null }
      if (!res.raw) { recordVote(budget, site, family, 'empty'); return null }
      const parsed = parsePrefilter(res.raw)
      recordVote(budget, site, family, parsed ? 'cast' : 'malformed')
      return parsed
    }
    const pA = prefilterVote(pfA, 'anthropic')
    const pB = prefilterVote(pfB, 'openai')
    const bothIgnore = (pA?.prefilter === true) && (pB?.prefilter === true)

    if (bothIgnore) {
      // BREADCRUMB, not a silent drop. This was the pipeline's only 100%-silent
      // whole-sheet drop: a domain of 'ignore' at confidence 1.0, no review item,
      // and the sheet excluded from the stage-4.5 conservation sweep too — decided
      // by the two most token-starved models in the fleet. The verdict stands (a
      // cheap prefilter that cannot skip anything is not a prefilter), but it is
      // now NAMED: both voters, both reasons, and the sheet stays in sweep scope
      // so its cells still get a disposition. `prefilterSkipped` is what the
      // orchestrator reads to keep it there.
      review.push({
        kind: 'prefilter-skip', sheetName: fp.sheetName,
        detail: `"${fp.sheetName}" (${fp.layoutShape}, ${fp.dataRowCount} data row(s) × ${fp.dataColCount} column(s)) was skipped before classification: BULK/anthropic said "${pA.reason}", BULK_ALT/openai said "${pB.reason}". Both cheap voters agreed it is non-content, so no reasoner ever read it. Its cells still go to the conservation sweep — confirm nothing real was skipped.`,
      })
      return {
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      1.0,
        rationale:       `Both bulk models agree: ${pA.reason}.`,
        prefilterSkipped: true,
        prefilterReasons: { anthropic: pA.reason, openai: pB.reason },
        disagreed:       false,
        humanFlagNeeded: false,
      }
    }

    // ── Step b: REASONER_A (opus) + REASONER_B (gpt-5.1) classify in parallel.
    // Malformed output = telemetry + one targeted retry per side (P0-7/F16). ──
    const [rA, rB] = await Promise.all([
      parseWithRetry({ call: () => callAnthropic({ deployment: deployOpus, systemPrompt: STAGE1_CLASSIFY_SYSTEM, userPrompt: meta, maxTokens: CLASSIFY_MAX_TOKENS, budget, tools: [CLASSIFY_TOOL], toolName: CLASSIFY_TOOL.name }), parse: parseClassify, review, stage: 'stage1', sheetName: fp.sheetName, what: 'REASONER_A classify', vote: { budget, site: 'stage1-classify', family: 'anthropic' } }),
      parseWithRetry({ call: () => callOpenAI({ deployment: deployGpt, systemPrompt: STAGE1_CLASSIFY_SYSTEM, userPrompt: meta, maxTokens: CLASSIFY_MAX_TOKENS, budget, tools: [CLASSIFY_TOOL], toolName: CLASSIFY_TOOL.name }), parse: parseClassify, review, stage: 'stage1', sheetName: fp.sheetName, what: 'REASONER_B classify', vote: { budget, site: 'stage1-classify', family: 'openai' } }),
    ])

    // Parse failure on both → human flag
    if (!rA && !rB) {
      review.push({ kind: 'disagreement', sheetName: fp.sheetName, detail: 'Both reasoners failed to classify sheet.' })
      return {
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      0,
        rationale:       'Both reasoners returned unparseable responses; treating as ignore.',
        disagreed:       true,
        humanFlagNeeded: true,
      }
    }

    // One parse failure → use the winner at reduced confidence
    if (!rA || !rB) {
      const winner = rA ?? rB
      return {
        sheetName:       fp.sheetName,
        domain:          winner.domain,
        confidence:      winner.confidence * 0.8,
        rationale:       winner.rationale,
        reasonerADomain: rA?.domain,
        reasonerBDomain: rB?.domain,
        disagreed:       false,
        humanFlagNeeded: false,
      }
    }

    // ── Step c: Agreement → auto-accept ─────────────────────────────────────
    if (rA.domain === rB.domain) {
      return {
        sheetName:       fp.sheetName,
        domain:          rA.domain,
        confidence:      (rA.confidence + rB.confidence) / 2,
        rationale:       rA.rationale,
        reasonerADomain: rA.domain,
        reasonerBDomain: rB.domain,
        disagreed:       false,
        humanFlagNeeded: false,
      }
    }

    // ── Step d: Disagreement → adjudication (REASONER_A sees both rationales) ─
    const adjUser = [
      meta,
      `\nClassifier A said domain="${rA.domain}" (confidence ${rA.confidence.toFixed(2)}): ${rA.rationale}`,
      `Classifier B said domain="${rB.domain}" (confidence ${rB.confidence.toFixed(2)}): ${rB.rationale}`,
    ].join('\n')

    const adj = await parseWithRetry({
      call: () => callAnthropic({
        deployment: deployOpus, systemPrompt: STAGE1_ADJUDICATE_SYSTEM, userPrompt: adjUser, maxTokens: 256, budget,
        tools: [ADJUDICATE_TOOL], toolName: ADJUDICATE_TOOL.name,
      }),
      parse: parseAdjudicate, review, stage: 'stage1', sheetName: fp.sheetName, what: 'adjudication',
      vote: { budget, site: 'stage1-adjudicate', family: 'anthropic' },
    })

    // ── Step e: Adjudicator failed or flagged human ──────────────────────────
    if (!adj || adj.humanFlag) {
      review.push({
        kind:      'disagreement',
        sheetName: fp.sheetName,
        detail:    `Reasoner A: ${rA.domain} vs Reasoner B: ${rB.domain}. Adjudicator: ${adj?.domain ?? 'parse failure'}.`,
      })
      return {
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      0,
        rationale:       adj?.rationale ?? 'Adjudicator could not resolve disagreement.',
        reasonerADomain: rA.domain,
        reasonerBDomain: rB.domain,
        disagreed:       true,
        humanFlagNeeded: true,
      }
    }

    return {
      sheetName:       fp.sheetName,
      domain:          adj.domain,
      confidence:      adj.confidence,
      rationale:       adj.rationale,
      reasonerADomain: rA.domain,
      reasonerBDomain: rB.domain,
      disagreed:       true,
      humanFlagNeeded: false,
    }
  }

  const classified = await pMap(sheets, classifyOne, 4)

  // Every dropped sheet leaves a breadcrumb. `ignore` means "extract nothing from
  // this whole sheet" — the largest single decision the pipeline makes — and the
  // reasoner-agreed path reached it with a rationale that lived only in the stage-1
  // JSON payload, never in the review queue. The prefilter path emits its own,
  // richer item above; every other route to `ignore` gets this one. Volume is
  // bounded by the sheet count (a handful per workbook), so this cannot become a
  // noise floor.
  for (const c of classified) {
    if (c.domain !== 'ignore' || c.prefilterSkipped) continue
    if (c.humanFlagNeeded) continue            // already carries a `disagreement` item
    review.push({
      kind: 'sheet-ignored', sheetName: c.sheetName,
      detail: `"${c.sheetName}" was classified as non-content (confidence ${Number(c.confidence ?? 0).toFixed(2)}) and nothing was extracted from it: ${c.rationale || 'no rationale recorded'}`,
    })
  }

  return classified
}

module.exports = { classifySheets }
