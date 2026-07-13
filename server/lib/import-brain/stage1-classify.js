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
const { extractJson, SHEET_DOMAINS } = require('./constants')

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
  const results = []

  // Resolve deployments — all four calls go through fleet.guard() via resolvers.
  const deployBulk    = resolveAnthropic('BULK_VERIFY', budget)
  const deployOpus    = resolveAnthropic('GROUNDED_CITED', budget)
  const deployGptMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget)  // BULK_ALT prefilter
  const deployGpt     = resolveOpenAI(fleet.DEPLOY_GPT, budget)       // REASONER_B (gpt-5.1)

  for (const fp of sheets) {
    // Auto-classify Definitions sheets — fingerprinter already identified them.
    if (fp.isDefinitionsSheet) {
      results.push({
        sheetName:       fp.sheetName,
        domain:          'definitions',
        confidence:      1.0,
        rationale:       'Fingerprinter identified this as a Definitions/Glossary sheet.',
        disagreed:       false,
        humanFlagNeeded: false,
      })
      continue
    }

    const meta = serialiseSheet(fp)

    // ── Step a: BULK + BULK_ALT prefilter (parallel) ────────────────────────
    const [pfA, pfB] = await Promise.all([
      callAnthropic({ deployment: deployBulk, systemPrompt: STAGE1_PREFILTER_SYSTEM, userPrompt: meta, maxTokens: 128, budget }).catch(() => ({ raw: '' })),
      callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE1_PREFILTER_SYSTEM, userPrompt: meta, maxTokens: 128, budget }).catch(() => ({ raw: '' })),
    ])

    const pA = parsePrefilter(pfA.raw)
    const pB = parsePrefilter(pfB.raw)
    const bothIgnore = (pA?.prefilter === true) && (pB?.prefilter === true)

    if (bothIgnore) {
      results.push({
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      1.0,
        rationale:       `Both bulk models agree: ${pA.reason}.`,
        disagreed:       false,
        humanFlagNeeded: false,
      })
      continue
    }

    // ── Step b: REASONER_A (opus) + REASONER_B (gpt-5.1) classify in parallel ─
    const [rARes, rBRes] = await Promise.all([
      callAnthropic({ deployment: deployOpus, systemPrompt: STAGE1_CLASSIFY_SYSTEM, userPrompt: meta, maxTokens: 256, budget }).catch(() => ({ raw: '' })),
      callOpenAI({ deployment: deployGpt, systemPrompt: STAGE1_CLASSIFY_SYSTEM, userPrompt: meta, maxTokens: 256, budget }).catch(() => ({ raw: '' })),
    ])

    const rA = parseClassify(rARes.raw)
    const rB = parseClassify(rBRes.raw)

    // Parse failure on both → human flag
    if (!rA && !rB) {
      results.push({
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      0,
        rationale:       'Both reasoners returned unparseable responses; treating as ignore.',
        disagreed:       true,
        humanFlagNeeded: true,
      })
      review.push({ kind: 'disagreement', sheetName: fp.sheetName, detail: 'Both reasoners failed to classify sheet.' })
      continue
    }

    // One parse failure → use the winner at reduced confidence
    if (!rA || !rB) {
      const winner = rA ?? rB
      results.push({
        sheetName:       fp.sheetName,
        domain:          winner.domain,
        confidence:      winner.confidence * 0.8,
        rationale:       winner.rationale,
        reasonerADomain: rA?.domain,
        reasonerBDomain: rB?.domain,
        disagreed:       false,
        humanFlagNeeded: false,
      })
      continue
    }

    // ── Step c: Agreement → auto-accept ─────────────────────────────────────
    if (rA.domain === rB.domain) {
      results.push({
        sheetName:       fp.sheetName,
        domain:          rA.domain,
        confidence:      (rA.confidence + rB.confidence) / 2,
        rationale:       rA.rationale,
        reasonerADomain: rA.domain,
        reasonerBDomain: rB.domain,
        disagreed:       false,
        humanFlagNeeded: false,
      })
      continue
    }

    // ── Step d: Disagreement → adjudication (REASONER_A sees both rationales) ─
    const adjUser = [
      meta,
      `\nClassifier A said domain="${rA.domain}" (confidence ${rA.confidence.toFixed(2)}): ${rA.rationale}`,
      `Classifier B said domain="${rB.domain}" (confidence ${rB.confidence.toFixed(2)}): ${rB.rationale}`,
    ].join('\n')

    const adjRes = await callAnthropic({
      deployment: deployOpus, systemPrompt: STAGE1_ADJUDICATE_SYSTEM, userPrompt: adjUser, maxTokens: 256, budget,
      budget,
    }).catch(() => ({ raw: '' }))

    const adj = parseAdjudicate(adjRes.raw)

    // ── Step e: Adjudicator failed or flagged human ──────────────────────────
    if (!adj || adj.humanFlag) {
      results.push({
        sheetName:       fp.sheetName,
        domain:          'ignore',
        confidence:      0,
        rationale:       adj?.rationale ?? 'Adjudicator could not resolve disagreement.',
        reasonerADomain: rA.domain,
        reasonerBDomain: rB.domain,
        disagreed:       true,
        humanFlagNeeded: true,
      })
      review.push({
        kind:      'disagreement',
        sheetName: fp.sheetName,
        detail:    `Reasoner A: ${rA.domain} vs Reasoner B: ${rB.domain}. Adjudicator: ${adj?.domain ?? 'parse failure'}.`,
      })
      continue
    }

    results.push({
      sheetName:       fp.sheetName,
      domain:          adj.domain,
      confidence:      adj.confidence,
      rationale:       adj.rationale,
      reasonerADomain: rA.domain,
      reasonerBDomain: rB.domain,
      disagreed:       true,
      humanFlagNeeded: false,
    })
  }

  return results
}

module.exports = { classifySheets }
