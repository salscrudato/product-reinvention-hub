// functions/src/import/brain/stage1_classify.ts — Sheet classification.
//
// Pipeline:
//   a. BULK + BULK_ALT pre-filter each sheet independently (cheap pass).
//      Both must agree it's non-content for it to be skipped without reasoning.
//   b. For each content sheet, REASONER_A and REASONER_B classify independently.
//   c. If they agree → auto-accept with averaged confidence.
//   d. If they disagree → adjudication pass (REASONER_A sees both rationales).
//   e. If adjudicator also cannot resolve → humanFlagNeeded=true + domain='ignore'.
//
// All AI calls are server-side; citations in rationales are required by the prompt.

import type { SheetFingerprint } from '@pf/shared'
import type { RoutingBudget } from '../../ai/router'
import {
  BRAIN_REASONER_A, BRAIN_REASONER_B, BRAIN_BULK, BRAIN_BULK_ALT,
  extractFieldsWithRole,
} from '../../ai/router'
import {
  STAGE1_PREFILTER_SYSTEM, STAGE1_CLASSIFY_SYSTEM, STAGE1_ADJUDICATE_SYSTEM,
} from './prompts'
import type { ClassifiedSheet, ReviewItem } from './types'
import { extractJson, SHEET_DOMAINS } from './types'
import type { SheetDomain } from './types'

// ─── Pre-filter response shape ─────────────────────────────────────────────────

interface PrefilterResponse {
  prefilter: boolean
  reason:    string
}

// ─── Classify response shape ───────────────────────────────────────────────────

interface ClassifyResponse {
  domain:     SheetDomain
  confidence: number
  rationale:  string
}

interface AdjudicateResponse extends ClassifyResponse {
  humanFlag: boolean
}

// ─── Sheet metadata serialiser ────────────────────────────────────────────────
// Produces a compact, grounding-safe representation of a sheet for the model.

function serialiseSheet(fp: SheetFingerprint): string {
  const headers = fp.columnProfiles
    .filter(c => c.headerLabel)
    .map(c => `  Col ${c.colIndex}: "${c.headerLabel}" [${c.isEnumLike ? 'enum' : c.hasDollarPattern ? '$' : c.hasDatePattern ? 'date' : 'text'}]`)
    .join('\n')

  const samples = fp.columnProfiles
    .slice(0, 8)
    .filter(c => c.distinctSample.length > 0)
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

function parsePrefilter(raw: string): PrefilterResponse | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    if (typeof obj['prefilter'] !== 'boolean') return null
    return { prefilter: Boolean(obj['prefilter']), reason: String(obj['reason'] ?? 'unknown') }
  } catch { return null }
}

function parseClassify(raw: string): ClassifyResponse | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    const domain = obj['domain'] as string
    if (!SHEET_DOMAINS.includes(domain as SheetDomain)) return null
    return {
      domain:     domain as SheetDomain,
      confidence: Number(obj['confidence'] ?? 0.5),
      rationale:  String(obj['rationale'] ?? ''),
    }
  } catch { return null }
}

function parseAdjudicate(raw: string): AdjudicateResponse | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    const domain = obj['domain'] as string
    if (!SHEET_DOMAINS.includes(domain as SheetDomain)) return null
    return {
      domain:     domain as SheetDomain,
      confidence: Number(obj['confidence'] ?? 0.5),
      rationale:  String(obj['rationale'] ?? ''),
      humanFlag:  Boolean(obj['humanFlag'] ?? false),
    }
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function classifySheets(
  sheets:  SheetFingerprint[],
  budget:  RoutingBudget,
  review:  ReviewItem[],
): Promise<ClassifiedSheet[]> {
  const results: ClassifiedSheet[] = []

  for (const fp of sheets) {
    // Auto-classify Definitions sheets — the fingerprinter already identified them.
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

    // ── Step a: BULK pre-filter (both families must agree it's non-content) ──────
    const [bulkRaw, bulkAltRaw] = await Promise.all([
      extractFieldsWithRole(BRAIN_BULK, {
        systemPrompt: STAGE1_PREFILTER_SYSTEM,
        userPrompt:   meta,
        maxTokens:    128,
      }, budget),
      extractFieldsWithRole(BRAIN_BULK_ALT, {
        systemPrompt: STAGE1_PREFILTER_SYSTEM,
        userPrompt:   meta,
        maxTokens:    128,
      }, budget),
    ])

    const pA = parsePrefilter(bulkRaw.raw)
    const pB = parsePrefilter(bulkAltRaw.raw)
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

    // ── Step b: REASONER_A and REASONER_B independent classification ─────────────
    const [rAResult, rBResult] = await Promise.all([
      extractFieldsWithRole(BRAIN_REASONER_A, {
        systemPrompt: STAGE1_CLASSIFY_SYSTEM,
        userPrompt:   meta,
        maxTokens:    256,
      }, budget),
      extractFieldsWithRole(BRAIN_REASONER_B, {
        systemPrompt: STAGE1_CLASSIFY_SYSTEM,
        userPrompt:   meta,
        maxTokens:    256,
      }, budget),
    ])

    const rA = parseClassify(rAResult.raw)
    const rB = parseClassify(rBResult.raw)

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

    // Use whichever parsed if the other failed
    if (!rA || !rB) {
      const winner = rA ?? rB!
      results.push({
        sheetName:        fp.sheetName,
        domain:           winner.domain,
        confidence:       winner.confidence * 0.8,
        rationale:        winner.rationale,
        reasonerADomain:  rA?.domain,
        reasonerBDomain:  rB?.domain,
        disagreed:        false,
        humanFlagNeeded:  false,
      })
      continue
    }

    // ── Step c: Agreement → auto-accept ──────────────────────────────────────────
    if (rA.domain === rB.domain) {
      results.push({
        sheetName:        fp.sheetName,
        domain:           rA.domain,
        confidence:       (rA.confidence + rB.confidence) / 2,
        rationale:        rA.rationale,
        reasonerADomain:  rA.domain,
        reasonerBDomain:  rB.domain,
        disagreed:        false,
        humanFlagNeeded:  false,
      })
      continue
    }

    // ── Step d: Disagreement → adjudication (REASONER_A sees both rationales) ───
    const adjUser = [
      meta,
      `\nClassifier A said domain="${rA.domain}" (confidence ${rA.confidence.toFixed(2)}): ${rA.rationale}`,
      `Classifier B said domain="${rB.domain}" (confidence ${rB.confidence.toFixed(2)}): ${rB.rationale}`,
    ].join('\n')

    const adjResult = await extractFieldsWithRole(BRAIN_REASONER_A, {
      systemPrompt: STAGE1_ADJUDICATE_SYSTEM,
      userPrompt:   adjUser,
      maxTokens:    256,
    }, budget)

    const adj = parseAdjudicate(adjResult.raw)

    // ── Step e: Adjudicator failed or flagged human ───────────────────────────────
    if (!adj || adj.humanFlag) {
      results.push({
        sheetName:        fp.sheetName,
        domain:           'ignore',
        confidence:       0,
        rationale:        adj?.rationale ?? 'Adjudicator could not resolve disagreement.',
        reasonerADomain:  rA.domain,
        reasonerBDomain:  rB.domain,
        disagreed:        true,
        humanFlagNeeded:  true,
      })
      review.push({
        kind:      'disagreement',
        sheetName: fp.sheetName,
        detail:    `Reasoner A: ${rA.domain} vs Reasoner B: ${rB.domain}. Adjudicator: ${adj?.domain ?? 'parse failure'}.`,
      })
      continue
    }

    results.push({
      sheetName:        fp.sheetName,
      domain:           adj.domain,
      confidence:       adj.confidence,
      rationale:        adj.rationale,
      reasonerADomain:  rA.domain,
      reasonerBDomain:  rB.domain,
      disagreed:        true,
      humanFlagNeeded:  false,
    })
  }

  return results
}
